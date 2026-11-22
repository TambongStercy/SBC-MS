"""The KYC loop, on the secondary server (its own container, `python -m app.runner`).

Every second it takes up to KYC_PER_SECOND members from the queue (live ones first,
backfill ones only between KYC_NIGHT_FROM and KYC_NIGHT_TO, Douala time), runs
level 1, finds the other accounts whose address reaches the same mailbox, and
stores the result. Once a day it deletes results older than KYC_RETENTION_DAYS.
Level 3 (when KYC_L3_KEY is set): it runs the automatic checks (app/l3_checks.py) on new
ID + selfie submissions, and every hour deletes images past their date (30 days after the
decision) and records past 12 months.
The main server only submits members (POST /v1/enqueue) and reads results.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from .checks import level1
from .dns_cache import DomainCache
from .l3_checks import analyse, load_engine
from .l3_store import L3Store
from .store import Store, band

log = logging.getLogger("kyc-runner")
DAY_S = 86_400


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class Settings:
    def __init__(self):
        self.per_second = int(max(1, min(500, _num("KYC_PER_SECOND", 50))))
        self.night_from = int(_num("KYC_NIGHT_FROM", 2))
        self.night_to = int(_num("KYC_NIGHT_TO", 5))
        self.backfill_anytime = os.environ.get("KYC_BACKFILL_ANYTIME", "").lower() == "true"
        self.retention_days = _num("KYC_RETENTION_DAYS", 365)
        self.variant_points = int(_num("KYC_EMAIL_VARIANT_POINTS", 20))


def douala_hour(now: float) -> int:
    return (time.gmtime(now).tm_hour + 1) % 24


def in_night(now: float, s: Settings) -> bool:
    h, a, b = douala_hour(now), s.night_from, s.night_to
    return a <= h < b if a <= b else (h >= a or h < b)


def run_batch(store: Store, cache: DomainCache, s: Settings, now: Optional[float] = None,
              pool: Optional[ThreadPoolExecutor] = None, check: Callable = level1) -> dict:
    """One pass: claim, check, store. Returns counts (no member data)."""
    now = now or time.time()
    out = {"claimed": 0, "checked": 0, "failed": 0}
    rows = store.claim(s.per_second, s.backfill_anytime or in_night(now, s), now)
    out["claimed"] = len(rows)
    if not rows:
        return out
    good = [r for r in rows if isinstance(r["fields"], dict)]
    broken = [r for r in rows if not isinstance(r["fields"], dict)]
    if broken:
        store.done(broken)  # unreadable payload: dropped, the nightly sync submits it again
        out["failed"] += len(broken)

    domains = [str(r["fields"].get("email") or "").rpartition("@")[2] for r in good if "@" in str(r["fields"].get("email") or "")]
    if pool is not None:
        cache.warm(domains, pool)
    checked, failed = [], []
    for r in good:
        try:
            res = check({"ref": r["ref"], **r["fields"]}, cache.lookup)
            if res.get("error"):
                raise ValueError(res["error"])
            checked.append((r, res))
        except Exception as e:  # one bad member never stops the batch
            log.warning("check failed: %s", type(e).__name__)
            failed.append(r)

    keys = {r["ref"]: store.email_key(str(res["emailNormalized"])) for r, res in checked if res.get("emailNormalized")}
    holders = store.holders(list(set(keys.values())))
    for ref, k in keys.items():
        holders.setdefault(k, set()).add(ref)

    expires = now + s.retention_days * DAY_S
    rows_out = []
    for r, res in checked:
        k = keys.get(r["ref"])
        variants = max(0, len(holders.get(k, {r["ref"]})) - 1) if k else 0
        reasons = list(res.get("reasons") or [])[:20]
        worker_score = int(res.get("score") or 0)
        if variants:
            reasons.append("email_variant_shared")
        score = min(100, worker_score + (s.variant_points if variants else 0))
        rows_out.append((r["ref"], 1, r["fingerprint"], json.dumps(res.get("signals") or {}), json.dumps(reasons),
                         worker_score, score, band(score), k, variants, r["reason"] or None, now, expires))
    if rows_out:
        store.save_results(rows_out)
    store.done([r for r, _ in checked])
    if failed:
        store.failed(failed, "check_failed", now)
    out["checked"], out["failed"] = len(checked), out["failed"] + len(failed)
    return out


def run_l3(l3: L3Store, engine, limit: int = 2, now: Optional[float] = None) -> int:
    """Checks up to `limit` pending level 3 requests. Returns how many."""
    done = 0
    while done < limit:
        rid = l3.next_pending()
        if not rid:
            break
        rec = l3.get(rid)
        try:
            scores, face = analyse(l3.images(rid), engine, l3.other_faces(rec["ref"]), l3.same_image_elsewhere(rid))
        except Exception as e:  # never leaves a request pending forever
            log.warning("level3 check failed: %s", type(e).__name__)
            scores, face = {"engine": "error", "hints": ["check_failed"]}, None
        l3.save_scores(rid, scores, now, face=face, ref=rec["ref"])
        log.info("level3 request %s checked: %s", rid, ",".join(scores.get("hints") or []) or "no hint")
        done += 1
    return done


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(message)s")
    secret = os.environ.get("KYC_SHARED_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("KYC_SHARED_SECRET is required (32+ characters)")
    path = os.environ.get("KYC_DB_PATH", "/data/kyc.sqlite")
    store = Store(path, secret)
    cache = DomainCache(path, ttl_days=_num("KYC_DNS_TTL_DAYS", 7))
    pool = ThreadPoolExecutor(max_workers=int(_num("KYC_DNS_THREADS", 16)))
    l3, engine = None, None
    if len(os.environ.get("KYC_L3_KEY", "")) >= 32:
        l3 = L3Store(path, os.environ["KYC_L3_KEY"], image_days=_num("KYC_L3_IMAGE_DAYS", 30),
                     record_days=_num("KYC_L3_RECORD_DAYS", 365), undecided_days=_num("KYC_L3_UNDECIDED_DAYS", 60))
        engine = load_engine()
        log.info("level 3 on, face checks %s", engine.name if engine else "UNAVAILABLE (models missing)")
    s = Settings()
    stop = {"now": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(now=True))
    signal.signal(signal.SIGINT, lambda *_: stop.update(now=True))
    log.info("KYC runner started: %d/s, backfill %02d:00-%02d:00 Douala%s", s.per_second, s.night_from, s.night_to,
             " (anytime)" if s.backfill_anytime else "")
    last_expire = 0.0
    totals = {"checked": 0, "failed": 0}
    last_report = time.time()
    while not stop["now"]:
        t0 = time.time()
        try:
            if t0 - last_expire > 3600:
                gone = store.expire(t0)
                last_expire = t0
                if gone:
                    log.info("expired %d results past retention", gone)
                if l3:
                    p = l3.purge(t0)
                    if p["imagesDeleted"] or p["recordsDeleted"]:
                        log.info("level3 retention: %s", p)
            if l3:
                run_l3(l3, engine, now=t0)
            b = run_batch(store, cache, s, t0, pool)
            totals["checked"] += b["checked"]
            totals["failed"] += b["failed"]
        except Exception as e:
            log.warning("batch failed: %s", e)
        if time.time() - last_report > 300:
            log.info("last 5 min: %d checked, %d failed; %s", totals["checked"], totals["failed"], store.status())
            totals = {"checked": 0, "failed": 0}
            last_report = time.time()
        time.sleep(max(0.05, 1.0 - (time.time() - t0)))
    log.info("KYC runner stopped")


if __name__ == "__main__":
    main()
