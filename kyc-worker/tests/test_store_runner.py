"""KYC on the secondary server (2026-11-22): queue, runner, results, and the signed API."""
import calendar
import json
import sqlite3
import time

from fastapi.testclient import TestClient

from app.dns_cache import DomainCache
from app.main import create_app
from app.runner import Settings, douala_hour, in_night, run_batch
from app.store import Store
from tests.test_api import SECRET, signed


def douala(h: int) -> float:
    """The next h:30 Douala time at least a minute from now (rows queued now are due by then)."""
    t = time.gmtime()
    at = calendar.timegm((t.tm_year, t.tm_mon, t.tm_mday, (h - 1) % 24, 30, 0, 0, 0, 0))
    return at if at > time.time() + 60 else at + 86_400


NOON, NIGHT = douala(12), douala(3)


def setup(tmp_path):
    path = str(tmp_path / "k.sqlite")
    store = Store(path, SECRET)
    cache = DomainCache(path, lookup=lambda d: d != "nomail.example")
    s = Settings()
    s.backfill_anytime = False
    return store, cache, s


def item(ref, fp="fp1", priority="live", reason="signup", **fields):
    base = {"email": f"{ref}@yahoo.fr", "phone": "237670000001", "country": "CM"}
    base.update(fields)
    return {"ref": ref, "fingerprint": fp, "priority": priority, "reason": reason, "fields": base}


def test_douala_night_window():
    s = Settings()
    assert douala_hour(NIGHT) == 3 and in_night(NIGHT, s) and not in_night(NOON, s)


def test_checks_stores_and_forgets_fields(tmp_path):
    store, cache, s = setup(tmp_path)
    store.enqueue([item("a", email="john.doe@gmail.com"), item("b", email="johndoe+sbc@gmail.com"),
                   item("c", email="x@nomail.example", phone="123")])
    out = run_batch(store, cache, s, NOON)
    assert out == {"claimed": 3, "checked": 3, "failed": 0}
    assert store.status()["queued"] == 0
    r = store.results(["a", "b", "c"])
    assert r["a"]["variantAccounts"] == 1 and r["b"]["variantAccounts"] == 1
    assert "email_variant_shared" in r["b"]["reasons"] and r["b"]["score"] >= s.variant_points
    assert {"phone_invalid", "email_no_mx"} <= set(r["c"]["reasons"])
    assert r["a"]["checkedAt"].endswith("Z") and r["a"]["level"] == 1
    # Nothing in the database file holds an address or a number once checked.
    db = sqlite3.connect(str(tmp_path / "k.sqlite"))
    dump = json.dumps([db.execute(f"SELECT * FROM {t}").fetchall() for t in ("queue", "results")])
    assert "@" not in dump and "john" not in dump and "2376700" not in dump


def test_needed_and_fingerprints(tmp_path):
    store, cache, s = setup(tmp_path)
    assert store.needed([{"ref": "a", "fingerprint": "fp1"}]) == ["a"]  # never checked
    store.enqueue([item("a")])
    assert store.needed([{"ref": "a", "fingerprint": "fp1"}]) == []  # already queued with these fields
    run_batch(store, cache, s, NOON)
    assert store.needed([{"ref": "a", "fingerprint": "fp1"}, {"ref": "z", "fingerprint": "x"}]) == ["z"]
    assert store.needed([{"ref": "a", "fingerprint": "fp2"}]) == ["a"]  # fields changed since
    assert store.enqueue([item("a")]) == 0  # same fields as the result: not checked again
    assert store.enqueue([item("a", fp="fp2")]) == 1 and store.status()["queued"] == 1
    store.expire(time.time() + 400 * 86_400)
    assert store.needed([{"ref": "a", "fingerprint": "fp1"}]) == ["a"]  # result expired (12 months)
    assert store.status()["results"] == 0


def test_backfill_only_at_night_live_first(tmp_path):
    store, cache, s = setup(tmp_path)
    store.enqueue([item("a", priority="backfill", reason="refresh"), item("b", priority="backfill", reason="refresh")])
    assert run_batch(store, cache, s, NOON)["claimed"] == 0
    store.enqueue([item("b", reason="contact_change")])  # a live submission lifts it
    out = run_batch(store, cache, s, NOON)
    assert out["checked"] == 1 and store.results(["b"]) and not store.results(["a"])
    assert run_batch(store, cache, s, NIGHT)["checked"] == 1
    assert store.status()["queued"] == 0


def test_resubmitted_during_check_runs_again(tmp_path):
    store, cache, s = setup(tmp_path)
    store.enqueue([item("a", email="temp@mailinator.com")])
    from app.checks import level1

    def check(it, lookup):
        store.enqueue([item("a", fp="fp2", email="claire@gmail.com")])  # changed mid-check
        return level1(it, lookup)

    assert run_batch(store, cache, s, NOON, check=check)["checked"] == 1
    assert store.status()["queued"] == 1
    run_batch(store, cache, s, NOON)
    r = store.results(["a"])["a"]
    assert "email_disposable" not in r["reasons"] and store.status()["queued"] == 0


def test_failed_check_backs_off(tmp_path):
    store, cache, s = setup(tmp_path)
    store.enqueue([item("a")])

    def boom(it, lookup):
        raise RuntimeError("dns")

    assert run_batch(store, cache, s, NOON, check=boom)["failed"] == 1
    assert run_batch(store, cache, s, NOON + 5)["claimed"] == 0  # not due yet
    assert run_batch(store, cache, s, NOON + 120)["checked"] == 1
    assert store.status()["retrying"] == 0


def api(tmp_path):
    return TestClient(create_app(secret=SECRET, db_path=str(tmp_path / "k.sqlite"), lookup=lambda d: True))


def post(c, path, body):
    raw, h = signed(body)
    return c.post(path, content=raw, headers=h)


def test_api_enqueue_needed_results_status(tmp_path):
    c = api(tmp_path)
    body = {"items": [item("6b0000000000000000000001", email="a.b@gmail.com")]}
    assert c.post("/v1/enqueue", json=body).status_code == 401  # unsigned
    assert post(c, "/v1/enqueue", {"items": [{"ref": "x"}]}).status_code == 400
    assert post(c, "/v1/enqueue", {"items": [item(str(i)) for i in range(501)]}).status_code == 400
    assert post(c, "/v1/enqueue", body).json() == {"queued": 1}
    assert post(c, "/v1/enqueue", body).json() == {"queued": 1}  # still queued: replaced, one row
    assert post(c, "/v1/needed", {"items": [{"ref": "6b0000000000000000000001", "fingerprint": "fp1"}]}).json() == {"refs": []}
    st = post(c, "/v1/status", {}).json()
    assert st["queued"] == 1 and st["live"] == 1 and st["results"] == 0

    # The runner (its own container in production) checks it; then the results are readable.
    store, cache, s = Store(str(tmp_path / "k.sqlite"), SECRET), DomainCache(str(tmp_path / "k.sqlite"), lookup=lambda d: True), Settings()
    run_batch(store, cache, s, NOON)
    r = post(c, "/v1/results", {"refs": ["6b0000000000000000000001", "6b0000000000000000000002"]}).json()["results"]
    assert list(r) == ["6b0000000000000000000001"] and r["6b0000000000000000000001"]["band"] == "low"
    assert "@" not in json.dumps(r) and "fingerprint" not in json.dumps(r)
    assert post(c, "/v1/results", {"refs": []}).status_code == 400
    assert c.post("/v1/status", json={}).status_code == 401


def test_enqueue_keeps_known_fields_only(tmp_path):
    c = api(tmp_path)
    it = item("r1")
    it["fields"]["password"] = "secret"
    it["fields"]["email"] = "x" * 500 + "@gmail.com"
    assert post(c, "/v1/enqueue", {"items": [it]}).status_code == 200
    row = Store(str(tmp_path / "k.sqlite"), SECRET).claim(10, True)[0]
    assert "password" not in row["fields"] and len(row["fields"]["email"]) == 200
