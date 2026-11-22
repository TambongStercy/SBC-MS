"""KYC level 3: encrypted store, retention, API, hint checks (fake face engine), runner."""
import base64, hashlib, hmac, json, math, os, struct, time

import pytest
from fastapi.testclient import TestClient

from app.l3_checks import SAME_PERSON, analyse, load_engine
from app.l3_store import DAY, L3Store
from app.main import create_app
from app.runner import run_l3

SECRET, KEY = "s" * 40, "k" * 40


def fake_img(faces=(), sharp=200.0, bright=120.0, tag="") -> bytes:
    """A 'JPEG' whose payload the fake engine reads: face vectors, sharpness, brightness."""
    payload = json.dumps({"faces": [list(f) for f in faces], "sharp": sharp, "bright": bright, "tag": tag}).encode()
    return (b"\xff\xd8\xff" + payload).ljust(2048, b" ")


class FakeEngine:
    name = "fake"

    def decode(self, data):
        if data[:3] != b"\xff\xd8\xff":
            return None
        return json.loads(data[3:].strip())

    def quality(self, img):
        return {"width": 800, "height": 600, "sharpness": img["sharp"], "brightness": img["bright"]}

    def faces(self, img, min_score):
        return img["faces"]

    def feature(self, img, face):
        return struct.pack(f"{len(face)}f", *face)

    def similarity(self, a, b):
        va, vb = struct.unpack(f"{len(a)//4}f", a), struct.unpack(f"{len(b)//4}f", b)
        dot = sum(x * y for x, y in zip(va, vb))
        return dot / (math.sqrt(sum(x * x for x in va)) * math.sqrt(sum(y * y for y in vb)))


ALICE, BOB = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)


def store(tmp_path, **kw):
    return L3Store(str(tmp_path / "k.sqlite"), KEY, **kw)


# ---------------------------------------------------------------- store
def test_store_encrypts_and_limits(tmp_path):
    s = store(tmp_path)
    selfie = fake_img([ALICE], tag="secret-selfie-bytes")
    rid, why = s.submit("m1", "fraud_hold", {"id_front": fake_img([ALICE]), "selfie": selfie})
    assert rid and why is None
    raw = open(tmp_path / "k.sqlite", "rb").read() + (open(tmp_path / "k.sqlite-wal", "rb").read() if os.path.exists(tmp_path / "k.sqlite-wal") else b"")
    assert b"secret-selfie-bytes" not in raw  # never stored in clear
    assert s.image(rid, "selfie") == (selfie, "image/jpeg")
    assert s.submit("m1", "fraud_hold", {"id_front": fake_img(), "selfie": fake_img()}) == (None, "open")
    rec = s.get(rid)
    assert rec["status"] == "pending" and rec["images"] == ["id_front", "selfie"] and rec["ref"] == "m1"
    # a decided request frees the slot; 3 a day at most
    assert s.decide(rid, "refused", "agent1", "Photo floue, à refaire")
    assert s.decide(rid, "approved", "agent2", "second decision refused") is None
    for _ in range(2):
        r2, _ = s.submit("m1", "fraud_hold", {"id_front": fake_img(), "selfie": fake_img()})
        s.decide(r2, "refused", "agent1", "test test test")
    assert s.submit("m1", "fraud_hold", {"id_front": fake_img(), "selfie": fake_img()}) == (None, "limit")


def test_retention(tmp_path):
    s = store(tmp_path)
    t = 1_800_000_000.0
    decided, _ = s.submit("m1", "authenticator_reset", {"id_front": fake_img([ALICE]), "selfie": fake_img([ALICE])}, now=t)
    never, _ = s.submit("m2", "lost_access", {"id_front": fake_img([BOB]), "selfie": fake_img([BOB])}, now=t)
    s.save_scores(decided, {"hints": []}, now=t, face=b"\x00" * 12, ref="m1")
    s.decide(decided, "approved", "agent1", "Pièce et selfie concordants", now=t + DAY)
    assert s.purge(t + 30 * DAY) == {"imagesDeleted": 0, "recordsDeleted": 0}
    assert s.purge(t + 31 * DAY + 1) == {"imagesDeleted": 1, "recordsDeleted": 0}  # 30 days after the decision
    rec = s.get(decided)
    assert rec["images"] == [] and rec["imagesDeletedAt"] and rec["decidedBy"] == "agent1" and s.image(decided, "selfie") is None
    assert s.other_faces("x") == []  # the face vector went with the images
    assert s.purge(t + 60 * DAY + 1)["imagesDeleted"] == 1  # never decided: 60 days
    assert s.get(never)["status"] == "pending" and s.get(never)["images"] == []
    assert s.next_pending() is None  # nothing to check without images
    assert s.purge(t + DAY + 365 * DAY + 1)["recordsDeleted"] == 1  # decision kept 12 months
    assert s.get(decided) is None and s.get(never) is not None


def test_same_image_elsewhere(tmp_path):
    s = store(tmp_path)
    same = fake_img([ALICE], tag="shared")
    a, _ = s.submit("m1", "fraud_hold", {"id_front": same, "selfie": fake_img([ALICE])})
    b, _ = s.submit("m2", "fraud_hold", {"id_front": same, "selfie": fake_img([ALICE], tag="other")})
    assert s.same_image_elsewhere(b) == 1 and s.same_image_elsewhere(a) == 1
    c, _ = s.submit("m3", "fraud_hold", {"id_front": fake_img(tag="c"), "selfie": fake_img(tag="c2")})
    assert s.same_image_elsewhere(c) == 0


def test_key_required(tmp_path):
    with pytest.raises(RuntimeError):
        L3Store(str(tmp_path / "k.sqlite"), "short")


# ---------------------------------------------------------------- checks (hints)
def test_checks_same_person():
    scores, face = analyse({"id_front": fake_img([(0.9, 0.1, 0.0)]), "selfie": fake_img([ALICE])}, FakeEngine())
    assert scores["match"]["same"] and scores["match"]["score"] >= SAME_PERSON and face
    assert scores["hints"] == []


def test_checks_hints():
    e = FakeEngine()
    s, _ = analyse({"id_front": fake_img([BOB]), "selfie": fake_img([ALICE])}, e)
    assert "faces_differ" in s["hints"] and s["match"]["same"] is False
    s, face = analyse({"id_front": fake_img([]), "selfie": fake_img([], sharp=10, bright=20)}, e)
    assert {"id_no_face", "selfie_no_face", "selfie_blurry", "selfie_dark"} <= set(s["hints"]) and face is None and s["match"] is None
    s, _ = analyse({"id_front": fake_img([ALICE]), "selfie": fake_img([ALICE, BOB])}, e)
    assert "selfie_several_faces" in s["hints"]
    s, _ = analyse({"id_front": b"\x89PNG\r\n\x1a\n broken", "selfie": fake_img([ALICE])}, e)
    assert "id_front_unreadable" in s["hints"] and s["images"]["id_front"] == {"readable": False}
    s, _ = analyse({"id_front": fake_img([ALICE]), "selfie": fake_img([ALICE])}, e,
                   other_faces=[("r1", "m9", struct.pack("3f", 0.95, 0.05, 0.0)), ("r2", "m8", struct.pack("3f", *BOB))], same_image_elsewhere=2)
    assert {"face_seen_on_other_account", "image_reused"} <= set(s["hints"])
    assert [x["ref"] for x in s["sameFaceOtherPeople"]] == ["m9"] and s["sameImageOtherPeople"] == 2
    s, face = analyse({"id_front": fake_img([ALICE]), "selfie": fake_img([ALICE])}, None)
    assert s["engine"] == "unavailable" and s["hints"] == ["engine_unavailable"] and face is None


def test_runner_checks_pending(tmp_path):
    s = store(tmp_path)
    first, _ = s.submit("m1", "fraud_hold", {"id_front": fake_img([ALICE]), "selfie": fake_img([ALICE])})
    assert run_l3(s, FakeEngine()) == 1
    rec = s.get(first)
    assert rec["status"] == "checked" and rec["scores"]["match"]["same"]
    # the same face under another account is flagged
    second, _ = s.submit("m2", "lost_access", {"id_front": fake_img([ALICE], tag="2"), "selfie": fake_img([ALICE], tag="2")})
    run_l3(s, FakeEngine())
    assert "face_seen_on_other_account" in s.get(second)["scores"]["hints"]
    assert s.get(second)["scores"]["sameFaceOtherPeople"][0]["ref"] == "m1"
    # a check that crashes still marks the request checked
    third, _ = s.submit("m3", "fraud_hold", {"id_front": fake_img(tag="3"), "selfie": fake_img(tag="3")})

    class Boom(FakeEngine):
        def quality(self, img):
            raise RuntimeError("x")
    run_l3(s, Boom())
    assert s.get(third)["status"] == "checked" and s.get(third)["scores"]["hints"] == ["check_failed"]
    # a decision made before the check is kept
    fourth, _ = s.submit("m4", "fraud_hold", {"id_front": fake_img(tag="4"), "selfie": fake_img(tag="4")})
    s.decide(fourth, "refused", "agent1", "Refus avant contrôle")
    assert run_l3(s, FakeEngine()) == 0 and s.get(fourth)["status"] == "refused"


# ---------------------------------------------------------------- API
def client(tmp_path, l3_key=KEY):
    return TestClient(create_app(secret=SECRET, db_path=str(tmp_path / "k.sqlite"), lookup=lambda d: True, l3_key=l3_key))


def post(c, path, body, raw=None):
    raw = raw if raw is not None else json.dumps(body).encode()
    ts = str(int(time.time()))
    sig = hmac.new(SECRET.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return c.post(path, content=raw, headers={"x-kyc-timestamp": ts, "x-kyc-signature": sig, "content-type": "application/json"})


def b64(data):
    return base64.b64encode(data).decode()


def test_api_flow(tmp_path):
    c = client(tmp_path)
    body = {"ref": "m1", "purpose": "fraud_hold", "images": {"id_front": b64(fake_img([ALICE])), "selfie": b64(fake_img([ALICE], tag="s"))}}
    assert c.post("/v1/l3/submit", json=body).status_code == 401  # unsigned
    r = post(c, "/v1/l3/submit", body)
    assert r.status_code == 200
    rid = r.json()["id"]
    assert post(c, "/v1/l3/submit", body).status_code == 409
    got = post(c, "/v1/l3/get", {"ids": [rid, "0" * 32]}).json()["items"]
    assert list(got) == [rid] and got[rid]["status"] == "pending" and "selfie" in got[rid]["images"]
    img = post(c, "/v1/l3/image", {"id": rid, "kind": "selfie"})
    assert img.status_code == 200 and img.content == fake_img([ALICE], tag="s") and img.headers["content-type"] == "image/jpeg"
    assert img.headers["cache-control"] == "no-store"
    assert post(c, "/v1/l3/image", {"id": rid, "kind": "id_back"}).status_code == 404
    assert post(c, "/v1/l3/decide", {"id": rid, "decision": "approved", "by": "agent1", "reason": "court"}).status_code == 400
    d = post(c, "/v1/l3/decide", {"id": rid, "decision": "approved", "by": "agent1", "reason": "Pièce et selfie concordants"})
    assert d.status_code == 200 and d.json()["status"] == "approved" and d.json()["decidedBy"] == "agent1"
    assert post(c, "/v1/l3/decide", {"id": rid, "decision": "refused", "by": "a", "reason": "again again again"}).status_code == 409
    assert post(c, "/v1/l3/decide", {"id": "f" * 32, "decision": "refused", "by": "a", "reason": "unknown unknown"}).status_code == 404
    st = post(c, "/v1/status", {}).json()
    assert st["level3"]["byStatus"] == {"approved": 1} and st["level3"]["images"] == 2


def test_api_refuses_bad_images(tmp_path):
    c = client(tmp_path)
    good = b64(fake_img([ALICE]))
    base = {"ref": "m1", "purpose": "fraud_hold"}
    assert post(c, "/v1/l3/submit", {**base, "images": {"id_front": good}}).status_code == 400  # no selfie
    assert post(c, "/v1/l3/submit", {**base, "purpose": "x", "images": {"id_front": good, "selfie": good}}).status_code == 400
    assert post(c, "/v1/l3/submit", {**base, "images": {"id_front": good, "selfie": good, "passport": good}}).status_code == 400
    pdf = b64(b"%PDF-1.7".ljust(2048, b" "))
    assert post(c, "/v1/l3/submit", {**base, "images": {"id_front": good, "selfie": pdf}}).status_code == 400  # not an image
    assert post(c, "/v1/l3/submit", {**base, "images": {"id_front": good, "selfie": "@@not base64@@"}}).status_code == 400
    big = b64((b"\xff\xd8\xff").ljust(4 * 1024 * 1024 + 10, b"x"))
    assert post(c, "/v1/l3/submit", {**base, "images": {"id_front": good, "selfie": big}}).status_code == 413
    # a declared body over the level 3 limit is refused before it is read; other routes keep 512 KB
    ts = str(int(time.time()))
    r = c.post("/v1/l3/submit", content=b"{}", headers={"content-length": str(40 * 1024 * 1024), "x-kyc-timestamp": ts, "x-kyc-signature": "x"})
    assert r.status_code == 413
    assert post(c, "/v1/l3/get", {"ids": ["a" * 32]}, raw=json.dumps({"ids": ["a" * 32], "pad": "x" * 600_000}).encode()).status_code == 413


def test_api_off_without_key(tmp_path):
    c = client(tmp_path, l3_key="")
    assert post(c, "/v1/l3/get", {"ids": ["a" * 32]}).status_code == 503
    assert post(c, "/v1/status", {}).json()["level3"] is None


# ---------------------------------------------------------------- real models (skipped unless present)
MODELS = os.environ.get("KYC_MODELS_DIR", "")


@pytest.mark.skipif(not (MODELS and os.path.isfile(os.path.join(MODELS, "face_recognition_sface_2021dec.onnx"))), reason="models not here")
def test_real_engine_loads_and_reads_a_blank_image():
    import cv2
    import numpy as np
    e = load_engine(MODELS)
    assert e is not None
    ok, jpg = cv2.imencode(".jpg", np.full((480, 640, 3), 128, np.uint8))
    s, face = analyse({"id_front": jpg.tobytes(), "selfie": jpg.tobytes()}, e)
    assert s["engine"] == "opencv-yunet-sface" and "selfie_no_face" in s["hints"] and face is None
