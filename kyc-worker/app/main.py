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

Signed requests only: X-KYC-Timestamp (unix seconds) and X-KYC-Signature =
hex HMAC-SHA256(KYC_SHARED_SECRET, "<timestamp>.<raw body>"), at most 5 min old.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .checks import level1
from .dns_cache import DomainCache
from .store import FIELDS, Store

MAX_ITEMS = 500
MAX_NEEDED = 2000
MAX_RESULTS = 200
MAX_BODY = 512 * 1024
SKEW_S = 300

log = logging.getLogger("kyc-worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(message)s")


def create_app(secret: str | None = None, db_path: str | None = None, lookup=None) -> FastAPI:
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

    async def signed_body(request: Request):
        """The parsed body of a correctly signed request, or the refusal to send."""
        raw = await request.body()
        if len(raw) > MAX_BODY:
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
        return store.status()

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
