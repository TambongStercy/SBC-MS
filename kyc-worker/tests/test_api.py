import hashlib, hmac, json, time
from fastapi.testclient import TestClient
from app.main import create_app

SECRET = "s" * 40


def client(tmp_path, calls=None):
    def lookup(d):
        if calls is not None:
            calls.append(d)
        return d != "nomail.example"
    return TestClient(create_app(secret=SECRET, db_path=str(tmp_path / "k.sqlite"), lookup=lookup))


def signed(body, ts=None, secret=SECRET):
    raw = json.dumps(body).encode()
    ts = str(int(time.time()) if ts is None else ts)
    sig = hmac.new(secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return raw, {"x-kyc-timestamp": ts, "x-kyc-signature": sig, "content-type": "application/json"}


def test_refuses_unsigned_bad_and_old(tmp_path):
    c = client(tmp_path)
    body = {"items": [{"ref": "1", "email": "a@gmail.com"}]}
    assert c.post("/v1/level1", json=body).status_code == 401
    raw, h = signed(body, secret="x" * 40)
    assert c.post("/v1/level1", content=raw, headers=h).status_code == 401
    raw, h = signed(body, ts=int(time.time()) - 600)
    assert c.post("/v1/level1", content=raw, headers=h).status_code == 401
    raw, h = signed(body)
    assert c.post("/v1/level1", content=raw + b" ", headers=h).status_code == 401  # body changed after signing


def test_batch_limits(tmp_path):
    c = client(tmp_path)
    raw, h = signed({"items": []})
    assert c.post("/v1/level1", content=raw, headers=h).status_code == 400
    raw, h = signed({"items": [{"ref": str(i)} for i in range(501)]})
    assert c.post("/v1/level1", content=raw, headers=h).status_code == 400


def test_batch_scores_and_caches_domains(tmp_path):
    calls = []
    c = client(tmp_path, calls)
    items = [{"ref": f"u{i}", "email": f"member{i}@gmail.com", "phone": "237670000001", "country": "CM"} for i in range(50)]
    items.append({"ref": "bad", "email": "x@nomail.example", "phone": "123", "country": "CM"})
    raw, h = signed({"items": items})
    r = c.post("/v1/level1", content=raw, headers=h)
    assert r.status_code == 200
    res = {x["ref"]: x for x in r.json()["results"]}
    assert len(res) == 51 and res["u3"]["score"] == 0
    assert set(res["bad"]["reasons"]) == {"phone_invalid", "email_no_mx"}
    assert sorted(calls) == ["gmail.com", "nomail.example"]  # one query per domain
    raw, h = signed({"items": items[:5]})
    c.post("/v1/level1", content=raw, headers=h)
    assert len(calls) == 2  # cached
    health = c.get("/health").json()
    assert health["domains"] == 2 and health["items"] == 56
    assert "member" not in json.dumps(health)


def test_refuses_without_secret(tmp_path):
    import pytest
    with pytest.raises(RuntimeError):
        create_app(secret="short", db_path=str(tmp_path / "k.sqlite"))
