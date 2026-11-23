"""KYC level 2 loop, its own container (`python -m app.l2_runner`), so a site that hangs never
delays level 1 or level 3.

One address at a time, at least KYC_L2_MIN_GAP_S (60) apart, at most KYC_L2_PER_DAY (500)
lookups per Douala day; past the cap the queue waits for the next day. Each module runs at most
KYC_L2_MODULE_PER_HOUR (30) times an hour (skipped, not counted as an answer, beyond it) and
each has its own timeout (KYC_L2_MODULE_TIMEOUT_S, 15). Off unless KYC_L2_MODE=log.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import time
from typing import Callable, Optional

from .l2_checks import available_modules, chosen_modules, lookup
from .l2_store import DAY_S, L2Store, douala_day, mode

log = logging.getLogger("kyc-l2")


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class L2Settings:
    def __init__(self):
        self.per_day = int(max(0, _num("KYC_L2_PER_DAY", 500)))
        self.min_gap_s = max(1.0, _num("KYC_L2_MIN_GAP_S", 60))
        self.module_per_hour = int(max(1, _num("KYC_L2_MODULE_PER_HOUR", 30)))
        self.module_timeout_s = max(2.0, _num("KYC_L2_MODULE_TIMEOUT_S", 15))
        self.concurrency = int(max(1, min(20, _num("KYC_L2_CONCURRENCY", 6))))


def next_douala_midnight(now: float) -> float:
    """Unix time of the next 00:00 Douala (UTC+1)."""
    return (int((now + 3600) // DAY_S) + 1) * DAY_S - 3600


def run_one(store: L2Store, modules: dict, s: L2Settings, now: Optional[float] = None,
            do_lookup: Optional[Callable] = None) -> str:
    """One step: idle | capped | checked | failed. Never logs an address."""
    now = now or time.time()
    if mode() != "log":
        return "idle"
    row = store.claim(now)
    if not row:
        return "idle"
    if store.used_today(now) >= s.per_day:
        store.release(row, next_douala_midnight(now) + 60)
        return "capped"
    run = {n: f for n, f in modules.items() if store.module_used(n, now) < s.module_per_hour}
    store.count(now, list(run))
    try:
        if do_lookup is not None:
            res = do_lookup(row["email"], run)
        else:
            res = asyncio.run(lookup(row["email"], run, timeout=s.module_timeout_s, concurrency=s.concurrency))
        res["asked"] = len(modules)  # modules held back by their hourly limit count as asked, unanswered
    except Exception as e:
        log.warning("level2 lookup failed: %s", type(e).__name__)
        store.failed(row, now)
        return "failed"
    store.save(row, res, now)
    log.info("level2 %s: %d/%d services answered, %d registered, gravatar %s, %d ms", row["ref"], res["answered"],
             res["asked"], len(res["found"]), res.get("gravatar"), res.get("ms", 0))
    return "checked"


def selftest(domain: str = "sniperbuisnesscenter.com") -> dict:
    """Which modules answer today, asked about a made-up address on our own domain (no member
    data; a site that mailed it would bounce at our server). `python -m app.l2_runner --selftest`."""
    import secrets
    modules, refused = chosen_modules(available_modules())
    email = f"sbc-l2-selftest-{secrets.token_hex(4)}@{domain}"
    res = asyncio.run(lookup(email, modules, timeout=L2Settings().module_timeout_s))
    return {"modules": len(modules), "refused": refused, "answered": res["answered"], "falsePositives": res["found"],
            "gravatar": res["gravatar"], "ms": res["ms"]}


def main() -> None:
    import sys
    if "--selftest" in sys.argv:
        logging.disable(logging.WARNING)
        print(selftest())
        return
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # its request lines would carry addresses in URLs
    secret = os.environ.get("KYC_SHARED_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("KYC_SHARED_SECRET is required (32+ characters)")
    store = L2Store(os.environ.get("KYC_DB_PATH", "/data/kyc.sqlite"), secret,
                    recheck_days=_num("KYC_L2_RECHECK_DAYS", 90), retention_days=_num("KYC_L2_RETENTION_DAYS", 365))
    s = L2Settings()
    avail = available_modules()
    modules, refused = chosen_modules(avail)
    if refused:
        log.warning("level2 modules refused (unknown, or not a sign-up check, or a banned category): %s", ",".join(refused))
    log.info("KYC level 2 runner: mode %s, %d modules (%s), %d/day, gap %ds, allowlist %s", mode(), len(modules),
             ",".join(modules), s.per_day, int(s.min_gap_s), "on" if os.environ.get("KYC_L2_ONLY_EMAILS") else "off")
    stop = {"now": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(now=True))
    signal.signal(signal.SIGINT, lambda *_: stop.update(now=True))
    last_run, last_expire = 0.0, 0.0
    while not stop["now"]:
        now = time.time()
        try:
            if now - last_expire > 3600:
                gone = store.expire(now)
                last_expire = now
                if gone:
                    log.info("level2: %d results past retention deleted", gone)
            if now - last_run >= s.min_gap_s:
                r = run_one(store, modules, s, now)
                if r in ("checked", "failed"):
                    last_run = now
                elif r == "capped":
                    log.info("level2 daily cap reached (%d, %s Douala): waiting for tomorrow", s.per_day, douala_day(now))
                    last_run = now
        except Exception as e:
            log.warning("level2 loop: %s", type(e).__name__)
        time.sleep(2)
    log.info("KYC level 2 runner stopped")


if __name__ == "__main__":
    main()
