"""KYC level 2 (2026-11-23): Holehe sign-up checks + Gravatar, queue, pacing, results, API."""
import asyncio
import json
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.l2_checks import DEFAULT_MODULES, assess, available_modules, chosen_modules, lookup
from app.l2_runner import L2Settings, next_douala_midnight, run_one
from app.l2_store import L2Store
from app.main import create_app
from tests.test_api import SECRET, signed

EMAIL = "kyc-l2-test@example.org"


@pytest.fixture(autouse=True)
def log_mode(monkeypatch):
    monkeypatch.setenv("KYC_L2_MODE", "log")
    monkeypatch.delenv("KYC_L2_ONLY_EMAILS", raising=False)
    monkeypatch.delenv("KYC_L2_MODULES", raising=False)


def store(tmp_path):
    return L2Store(str(tmp_path / "k.sqlite"), SECRET)


def queue_emails(path) -> list:
    return [r[0] for r in sqlite3.connect(path).execute("SELECT email FROM l2_queue").fetchall()]


# ------------------------------------------------------------------ module rules

def test_default_modules_exist_and_are_signup_checks():
    avail = available_modules()
    run, refused = chosen_modules(avail, "")
    assert refused == [] and sorted(run) == sorted(DEFAULT_MODULES)
    assert all(avail[n]["method"] == "register" for n in run)


def test_banned_modules_never_run_whatever_the_setting():
    avail = available_modules()
    # porn / medical / osint categories, and password-recovery or login checks (could e-mail the person)
    asked = "pornhub,caringbridge,rocketreach,adobe,amazon,gravatar,instagram,doesnotexist"
    run, refused = chosen_modules(avail, asked)
    assert list(run) == ["instagram"]
    assert set(refused) == {"pornhub", "caringbridge", "rocketreach", "adobe", "amazon", "gravatar", "doesnotexist"}
    for name, m in avail.items():
        if m["category"] in ("porn", "medical", "osint") or m["method"] != "register":
            assert not m["allowed"], name


# ------------------------------------------------------------------ the lookup

class FakeClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def mod(exists=None, rate=False, sleep=0.0, boom=False):
    async def fn(email, client, out):
        if sleep:
            await asyncio.sleep(sleep)
        if boom:
            raise RuntimeError("site changed")
        out.append({"name": "x", "exists": bool(exists), "rateLimit": rate, "emailrecovery": "j***@gmail.com", "phoneNumber": "+237 6** ** 12"})
    return fn


def test_lookup_keeps_only_booleans_and_names():
    async def grav(email, client):
        return True
    mods = {"a": mod(True), "b": mod(False), "c": mod(rate=True), "d": mod(sleep=5), "e": mod(boom=True), "f": mod(True)}
    res = asyncio.run(lookup(EMAIL, mods, timeout=0.2, client_factory=FakeClient, gravatar=grav))
    assert res["found"] == ["a", "f"] and res["answered"] == 3 and res["asked"] == 6 and res["gravatar"] is True
    assert set(res) == {"found", "asked", "answered", "gravatar", "ms"}  # no recovery address, no phone hint
    assert "j***" not in json.dumps(res) and "237" not in json.dumps(res)


def test_assess():
    assert assess(["a", "b", "c"], 10, False) == (["email_established"], -10)
    assert assess([], 10, True) == (["email_established"], -10)
    assert assess([], 10, False) == (["email_no_footprint"], 15)
    assert assess([], 4, False) == ([], 0)       # too few answers to say "nowhere"
    assert assess([], 10, None) == ([], 0)       # Gravatar did not answer
    assert assess(["a"], 10, False) == ([], 0)


# ------------------------------------------------------------------ queue and store

def test_off_mode_stores_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("KYC_L2_MODE", "off")
    s = store(tmp_path)
    assert s.enqueue([{"ref": "u1", "email": EMAIL, "trigger": "hold"}]) == {"u1": "off"}
    assert queue_emails(tmp_path / "k.sqlite") == []


def test_allowlist_refuses_other_addresses_without_storing(tmp_path, monkeypatch):
    monkeypatch.setenv("KYC_L2_ONLY_EMAILS", f" {EMAIL.upper()} , other@example.org")
    s = store(tmp_path)
    out = s.enqueue([{"ref": "u1", "email": "real.member@gmail.com", "trigger": "hold"},
                     {"ref": "u2", "email": EMAIL, "trigger": "hold"},
                     {"ref": "u3", "email": "not-an-address", "trigger": "hold"}])
    assert out == {"u1": "not_allowlisted", "u2": "queued", "u3": "invalid"}
    assert queue_emails(tmp_path / "k.sqlite") == [EMAIL]


def test_address_deleted_once_looked_up_and_result_reused(tmp_path):
    s = store(tmp_path)
    s.enqueue([{"ref": "u1", "email": EMAIL, "trigger": "hold"}])
    row = s.claim()
    s.save(row, {"found": ["github"], "asked": 20, "answered": 15, "gravatar": False})
    assert queue_emails(tmp_path / "k.sqlite") == []
    raw = sqlite3.connect(tmp_path / "k.sqlite").execute("SELECT * FROM l2_results").fetchall()
    assert EMAIL not in json.dumps(raw)                      # only an HMAC of the address
    r = s.results(["u1"])["u1"]
    assert r["found"] == ["github"] and r["answered"] == 15 and r["gravatar"] is False and r["trigger"] == "hold"
    # same member again within 90 days: nothing new
    assert s.enqueue([{"ref": "u1", "email": EMAIL, "trigger": "score_hold"}]) == {"u1": "fresh"}
    # another account with the same address: the recent result is reused, no lookup
    assert s.enqueue([{"ref": "u2", "email": EMAIL.upper(), "trigger": "hold"}]) == {"u2": "fresh"}
    assert s.results(["u2"])["u2"]["found"] == ["github"] and queue_emails(tmp_path / "k.sqlite") == []
    # the address changed: forget drops it
    assert s.forget(["u1"]) == 1 and s.results(["u1"]) == {}


def test_new_address_while_looking_up_stays_queued(tmp_path):
    s = store(tmp_path)
    s.enqueue([{"ref": "u1", "email": EMAIL, "trigger": "hold"}])
    row = s.claim()
    s.enqueue([{"ref": "u1", "email": "new.address@example.org", "trigger": "contact_change_flagged"}])
    s.save(row, {"found": [], "asked": 20, "answered": 0, "gravatar": None})
    assert queue_emails(tmp_path / "k.sqlite") == ["new.address@example.org"]
    assert s.claim() is not None


# ------------------------------------------------------------------ the runner

def fake_lookup(found=("github",)):
    calls = []

    def f(email, modules):
        calls.append((email, sorted(modules)))
        return {"found": list(found), "asked": len(modules), "answered": len(modules), "gravatar": False, "ms": 1}
    return f, calls


def test_daily_cap_waits_for_tomorrow(tmp_path):
    s = store(tmp_path)
    st = L2Settings()
    st.per_day = 1
    for i in range(2):
        s.enqueue([{"ref": f"u{i}", "email": f"t{i}@example.org", "trigger": "hold"}])
    f, calls = fake_lookup()
    now = time.time()
    assert run_one(s, {"github": None, "twitter": None}, st, now, f) == "checked"
    assert run_one(s, {"github": None, "twitter": None}, st, now + 61, f) == "capped"
    assert len(calls) == 1
    assert run_one(s, {"github": None}, st, now + 62, f) == "idle"             # released until tomorrow
    assert run_one(s, {"github": None}, st, next_douala_midnight(now) + 120, f) == "checked"


def test_module_hourly_limit_and_off_mode(tmp_path, monkeypatch):
    s = store(tmp_path)
    st = L2Settings()
    st.module_per_hour = 1
    for i in range(2):
        s.enqueue([{"ref": f"u{i}", "email": f"t{i}@example.org", "trigger": "hold"}])
    f, calls = fake_lookup()
    now = 1_800_000_000.0
    run_one(s, {"github": None, "twitter": None}, st, now, f)
    run_one(s, {"github": None, "twitter": None}, st, now + 60, f)
    assert calls[0][1] == ["github", "twitter"] and calls[1][1] == []         # same hour: both used up
    assert s.results(["u1"])["u1"]["asked"] == 2                              # held back = asked, unanswered
    monkeypatch.setenv("KYC_L2_MODE", "off")
    assert run_one(s, {"github": None}, st, now + 120, f) == "idle"


def test_failures_retry_then_drop_the_address(tmp_path):
    s = store(tmp_path)
    s.enqueue([{"ref": "u1", "email": EMAIL, "trigger": "hold"}])

    def boom(email, modules):
        raise RuntimeError("network")
    now = time.time()
    for i in range(5):
        row_now = now + i * 10 ** 6
        assert run_one(s, {}, L2Settings(), row_now, boom) == "failed"
    assert queue_emails(tmp_path / "k.sqlite") == []


# ------------------------------------------------------------------ API

def client(tmp_path):
    return TestClient(create_app(secret=SECRET, db_path=str(tmp_path / "k.sqlite"), lookup=lambda d: True))


def post(c, path, body):
    raw, h = signed(body)
    return c.post(path, content=raw, headers=h)


def test_api_enqueue_results_forget(tmp_path):
    c = client(tmp_path)
    assert c.post("/v1/l2/enqueue", json={"items": [{"ref": "u1", "email": EMAIL}]}).status_code == 401
    assert post(c, "/v1/l2/enqueue", {"items": [{"ref": "u1"}]}).status_code == 400
    assert post(c, "/v1/l2/enqueue", {"items": [{"ref": str(i), "email": EMAIL} for i in range(101)]}).status_code == 400
    r = post(c, "/v1/l2/enqueue", {"items": [{"ref": "u1", "email": EMAIL, "trigger": "hold"}]})
    assert r.status_code == 200 and r.json() == {"outcomes": {"u1": "queued"}}

    # level 1 for u1, then level 2 results: merged; u2 has level 2 only
    post(c, "/v1/enqueue", {"items": [{"ref": "u1", "fingerprint": "f", "priority": "live", "reason": "signup", "fields": {"email": EMAIL}}]})
    s = store(tmp_path)
    s.save(s.claim(), {"found": [], "asked": 20, "answered": 12, "gravatar": False})
    from app.dns_cache import DomainCache
    from app.runner import Settings, run_batch
    from app.store import Store
    run_batch(Store(str(tmp_path / "k.sqlite"), SECRET), DomainCache(str(tmp_path / "k.sqlite"), lookup=lambda d: True), Settings())
    s.enqueue([{"ref": "u2", "email": "other@example.org", "trigger": "dormant_reactivated"}])
    s.save(s.claim(), {"found": ["github", "spotify", "twitter"], "asked": 20, "answered": 18, "gravatar": True})

    res = post(c, "/v1/results", {"refs": ["u1", "u2"]}).json()["results"]
    u1, u2 = res["u1"], res["u2"]
    assert u1["level"] == 2 and "email_no_footprint" in u1["reasons"] and u1["level2"]["points"] == 15
    assert u1["score"] >= 15 and u1["level2"]["answered"] == 12 and u1["signals"]  # level 1 kept
    assert u2["level"] == 2 and u2["score"] == 0 and u2["reasons"] == ["email_established"] and u2["level2"]["gravatar"] is True
    assert EMAIL not in json.dumps(res) and "other@example.org" not in json.dumps(res)

    st = post(c, "/v1/status", {}).json()["level2"]
    assert st["mode"] == "log" and st["results"] == 2 and st["queued"] == 0
    assert post(c, "/v1/l2/forget", {"refs": ["u2"]}).json() == {"forgotten": 1}
    assert "level2" not in post(c, "/v1/results", {"refs": ["u1", "u2"]}).json()["results"].get("u2", {})
