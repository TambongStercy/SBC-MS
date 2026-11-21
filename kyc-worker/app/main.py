"""kyc-worker (Security plan Phase 8): level 1 checks on request from risk-service.

POST /v1/level1  {"items": [{ref, email, phone, country, ipCountry, geoCountry, momoNumber, momoOperator}]}
                 → {"results": [{ref, signals, reasons, score, band, emailNormalized}]}
GET  /health     → {"status": "ok", ...} (no member data)

Signed requests only: X-KYC-Timestamp (unix seconds) and X-KYC-Signature =
hex HMAC-SHA256(KYC_SHARED_SECRET, "<timestamp>.<raw body>"), at most 5 min
old. The worker keeps no member data: the request is scored and forgotten;
only the per-domain DNS answers are stored.
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

MAX_ITEMS = 500
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
    cache = DomainCache(db_path or os.environ.get("KYC_DB_PATH", "/data/kyc.sqlite"), **cache_kwargs)
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

    @app.post("/v1/level1")
    async def level1_batch(request: Request):
        raw = await request.body()
        if len(raw) > MAX_BODY:
            return refuse(413, "body too large")
        ts = request.headers.get("x-kyc-timestamp", "")
        sig = request.headers.get("x-kyc-signature", "")
        if not ts.isdigit() or abs(time.time() - int(ts)) > SKEW_S:
            return refuse(401, "unsigned")
        expected = hmac.new(key, ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            return refuse(401, "unsigned")
        try:
            body = json.loads(raw)
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
