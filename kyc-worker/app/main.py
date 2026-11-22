"""kyc-worker (Security plan Phase 8): KYC level 1, run entirely on the secondary server
(decided 2026-11-22). risk-service on the main server submits members and reads results;
the queue, the pacing, the checks and the results live here (app/store.py, app/runner.py).

POST /v1/enqueue  {"items": [{ref, fingerprint, priority: live|backfill, reason, fields:
                  {email, phone, country, ipCountry, geoCountry, momoNumber, momoOperator}}]}
                  → {"queued": n}           (≤ 500 items)
POST /v1/needed   {"items": [{ref, fingerprint}]} → {"refs": [...]}  (≤ 2000) the members
                  never checked, checked with other fields, or expired: the nightly sync
                  then submits only those
POST /v1/results  {"refs": [...]} → {"results": {ref: {level, score, band, reasons, signals,
                  variantAccounts, checkedAt}}}  (≤ 200; never an email, number or key)
POST /v1/status   {} → queue and result counts (no member data)
POST /v1/level1   {"items": [...]} → scores now, stores nothing (kept for checks and tests)
GET  /health      → {"status": "ok", ...} (no member data)

KYC level 3 (ID document + selfie, app/l3_store.py, app/l3_checks.py), same signature:
POST /v1/l3/submit  {ref, purpose: fraud_hold|authenticator_reset|lost_access, images: {id_front,
                    id_back?, selfie} as base64 JPEG/PNG/WebP, ≤ 4 MB each} → {"id"}; 409 while
                    the same ref has an open request, 429 after 3 in 24 h
POST /v1/l3/get     {"ids": [...]} → {"items": {id: request}} (≤ 100; status, check results,
                    decision; no image)
POST /v1/l3/image   {id, kind} → the image bytes (deleted 30 days after the decision)
POST /v1/l3/decide  {id, decision: approved|refused, by, reason} → the request; 409 if decided

Signed requests only: X-KYC-Timestamp (unix seconds) and X-KYC-Signature =
hex HMAC-SHA256(KYC_SHARED_SECRET, "<timestamp>.<raw body>"), at most 5 min old.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from .checks import level1
from .dns_cache import DomainCache
from .l3_store import KINDS, MAX_IMAGE, PURPOSES, L3Store, sniff
from .store import FIELDS, Store

MAX_ITEMS = 500
MAX_NEEDED = 2000
MAX_RESULTS = 200
MAX_BODY = 512 * 1024
L3_MAX_BODY = 3 * (MAX_IMAGE * 4 // 3 + 16) + 4096  # three base64 images
L3_PER_DAY = 3
SKEW_S = 300

log = logging.getLogger("kyc-worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(message)s")


def _l3_store(path: str, l3_key: str | None) -> L3Store | None:
    key = l3_key if l3_key is not None else os.environ.get("KYC_L3_KEY", "")
    if len(key) < 32:
        log.warning("KYC_L3_KEY missing: level 3 is off")
        return None
    num = lambda n, d: float(os.environ.get(n, d))
    return L3Store(path, key, image_days=num("KYC_L3_IMAGE_DAYS", 30), record_days=num("KYC_L3_RECORD_DAYS", 365),
                   undecided_days=num("KYC_L3_UNDECIDED_DAYS", 60))


def create_app(secret: str | None = None, db_path: str | None = None, lookup=None, l3_key: str | None = None) -> FastAPI:
    secret = secret if secret is not None else os.environ.get("KYC_SHARED_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("KYC_SHARED_SECRET is required (32+ characters)")
    key = secret.encode()
    cache_kwargs = {"ttl_days": float(os.environ.get("KYC_DNS_TTL_DAYS", "7"))}
    if lookup is not None:
        cache_kwargs["lookup"] = lookup
    path = db_path or os.environ.get("KYC_DB_PATH", "/data/kyc.sqlite")
    cache = DomainCache(path, **cache_kwargs)
    store = Store(path, secret)
    l3 = _l3_store(path, l3_key)
    pool = ThreadPoolExecutor(max_workers=int(os.environ.get("KYC_DNS_THREADS", "16")))
    stats = {"items": 0, "batches": 0, "refused": 0, "started": time.time()}

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    def refuse(status: int, msg: str):
        stats["refused"] += 1
        return JSONResponse({"error": msg}, status_code=status)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "kyc-worker", "domains": cache.size(), "items": stats["items"],
                "batches": stats["batches"], "refused": stats["refused"], "dnsHits": cache.hits, "dnsMisses": cache.misses,
                "uptimeS": int(time.time() - stats["started"])}

    async def signed_body(request: Request, limit: int = MAX_BODY):
        """The parsed body of a correctly signed request, or the refusal to send."""
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            return None, refuse(413, "body too large")
        raw = await request.body()
        if len(raw) > limit:
            return None, refuse(413, "body too large")
        ts = request.headers.get("x-kyc-timestamp", "")
        sig = request.headers.get("x-kyc-signature", "")
        if not ts.isdigit() or abs(time.time() - int(ts)) > SKEW_S:
            return None, refuse(401, "unsigned")
        expected = hmac.new(key, ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return None, refuse(401, "unsigned")
        try:
            body = json.loads(raw or b"{}")
            assert isinstance(body, dict)
            return body, None
        except Exception:
            return None, refuse(400, "json object expected")

    def ref_ok(v) -> bool:
        return isinstance(v, str) and 0 < len(v) <= 64

    @app.post("/v1/enqueue")
    async def enqueue(request: Request):
        body, err = await signed_body(request)
        if err:
            return err
        items = body.get("items")
        if not isinstance(items, list) or not 0 < len(items) <= MAX_ITEMS or not all(
                isinstance(i, dict) and ref_ok(i.get("ref")) and isinstance(i.get("fields"), dict)
                and isinstance(i.get("fingerprint"), str) and len(i["fingerprint"]) <= 64 for i in items):
            return refuse(400, f"items: 1 to {MAX_ITEMS} objects with ref, fingerprint and fields")
        for i in items:  # only the known fields, as short strings
            i["fields"] = {k: (str(v)[:200] if v is not None else None) for k, v in i["fields"].items() if k in FIELDS}
        return {"queued": store.enqueue(items)}

    @app.post("/v1/needed")
    async def needed(request: Request):
        body, err = await signed_body(request)
        if err:
            return err
        items = body.get("items")
        if not isinstance(items, list) or not 0 < len(items) <= MAX_NEEDED or not all(
                isinstance(i, dict) and ref_ok(i.get("ref")) and isinstance(i.get("fingerprint"), str) for i in items):
            return refuse(400, f"items: 1 to {MAX_NEEDED} objects with ref and fingerprint")
        return {"refs": store.needed(items)}

    @app.post("/v1/results")
    async def results(request: Request):
        body, err = await signed_body(request)
        if err:
            return err
        refs = body.get("refs")
        if not isinstance(refs, list) or not 0 < len(refs) <= MAX_RESULTS or not all(ref_ok(r) for r in refs):
            return refuse(400, f"refs: 1 to {MAX_RESULTS} ids")
        return {"results": store.results(refs)}

    @app.post("/v1/status")
    async def status(request: Request):
        _, err = await signed_body(request)
        if err:
            return err
        return {**store.status(), "level3": l3.status() if l3 else None}

    # ------------------------------------------------------------ level 3
    def l3_off():
        return refuse(503, "level 3 is off") if l3 is None else None

    def id_ok(v) -> bool:
        return isinstance(v, str) and len(v) == 32 and all(c in "0123456789abcdef" for c in v)

    @app.post("/v1/l3/submit")
    async def l3_submit(request: Request):
        body, err = await signed_body(request, L3_MAX_BODY)
        if err or (err := l3_off()):
            return err
        ref, purpose, imgs = body.get("ref"), body.get("purpose"), body.get("images")
        if not ref_ok(ref) or purpose not in PURPOSES or not isinstance(imgs, dict):
            return refuse(400, "ref, purpose and images expected")
        if "id_front" not in imgs or "selfie" not in imgs or any(k not in KINDS for k in imgs):
            return refuse(400, "images: id_front and selfie required, id_back optional")
        decoded = {}
        for kind, b64 in imgs.items():
            if not isinstance(b64, str) or len(b64) > MAX_IMAGE * 4 // 3 + 16:
                return refuse(413, f"{kind}: too large")
            try:
                data = base64.b64decode(b64, validate=True)
            except (binascii.Error, ValueError):
                return refuse(400, f"{kind}: base64 expected")
            if len(data) > MAX_IMAGE:
                return refuse(413, f"{kind}: too large")
            if len(data) < 1024 or sniff(data) is None:
                return refuse(400, f"{kind}: a JPEG, PNG or WebP image expected")
            decoded[kind] = data
        rid, why = l3.submit(ref, purpose, decoded, per_day=L3_PER_DAY)
        if why == "open":
            return refuse(409, "a request is already open")
        if why == "limit":
            return refuse(429, "too many requests today")
        log.info("level3 request %s (%s, %d images)", rid, purpose, len(decoded))
        return {"id": rid}

    @app.post("/v1/l3/get")
    async def l3_get(request: Request):
        body, err = await signed_body(request)
        if err or (err := l3_off()):
            return err
        ids = body.get("ids")
        if not isinstance(ids, list) or not 0 < len(ids) <= 100 or not all(id_ok(i) for i in ids):
            return refuse(400, "ids: 1 to 100 request ids")
        return {"items": {i: r for i in ids if (r := l3.get(i))}}

    @app.post("/v1/l3/image")
    async def l3_image(request: Request):
        body, err = await signed_body(request)
        if err or (err := l3_off()):
            return err
        if not id_ok(body.get("id")) or body.get("kind") not in KINDS:
            return refuse(400, "id and kind expected")
        got = l3.image(body["id"], body["kind"])
        if not got:
            return refuse(404, "no such image (never sent, or deleted)")
        return Response(got[0], media_type=got[1], headers={"Cache-Control": "no-store"})

    @app.post("/v1/l3/decide")
    async def l3_decide(request: Request):
        body, err = await signed_body(request)
        if err or (err := l3_off()):
            return err
        by, reason = body.get("by"), body.get("reason")
        if not id_ok(body.get("id")) or body.get("decision") not in ("approved", "refused") \
                or not isinstance(by, str) or not by or not isinstance(reason, str) or len(reason.strip()) < 10:
            return refuse(400, "id, decision approved|refused, by and a reason of 10+ characters expected")
        if not l3.get(body["id"]):
            return refuse(404, "no such request")
        done = l3.decide(body["id"], body["decision"], by, reason.strip())
        if not done:
            return refuse(409, "already decided")
        log.info("level3 request %s %s", body["id"], body["decision"])
        return done

    @app.post("/v1/level1")
    async def level1_batch(request: Request):
        body, err = await signed_body(request)
        if err:
            return err
        try:
            items = body["items"]
            assert isinstance(items, list) and 0 < len(items) <= MAX_ITEMS
            assert all(isinstance(i, dict) and isinstance(i.get("ref"), str) for i in items)
        except Exception:
            return refuse(400, f"items: 1 to {MAX_ITEMS} objects with a ref")

        t0 = time.time()
        domains = [str(i.get("email") or "").rpartition("@")[2] for i in items if "@" in str(i.get("email") or "")]
        cache.warm(domains, pool)
        results = []
        for item in items:
            try:
                r = level1(item, cache.lookup)
            except Exception as e:  # one bad item never fails the batch
                log.warning("item failed: %s", type(e).__name__)
                r = {"error": "check_failed"}
            results.append({"ref": item["ref"], **r})
        stats["items"] += len(items)
        stats["batches"] += 1
        log.info("level1 batch: %d items, %d ms", len(items), int((time.time() - t0) * 1000))
        return {"results": results}

    return app


app = None
if os.environ.get("KYC_SHARED_SECRET"):
    app = create_app()
