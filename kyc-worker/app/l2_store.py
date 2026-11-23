"""KYC level 2 queue and results (same SQLite file as level 1, KYC_DB_PATH).

  l2_queue    one row per member waiting, with the address to look up. The row (and so the
              address) is deleted once looked up (secure_delete: freed pages are zeroed).
  l2_results  the member's latest level 2: which services said "registered", how many were
              asked and answered, Gravatar yes / no, the trigger, an HMAC of the address (to
              reuse a recent result for another account with the same address). No address,
              no service answer. Deleted KYC_L2_RETENTION_DAYS (365) after the lookup.
  l2_usage    lookups per Douala day (the daily cap) and per module per hour (rate limits).

Modes (KYC_L2_MODE): off (default: nothing queued, nothing looked up) | log (looked up,
recorded, shown to support; no decision reads it).
KYC_L2_ONLY_EMAILS (comma list): when set, only those addresses are ever accepted, the
others are refused without being stored (preprod holds copies of real members).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from typing import Iterable, Optional

DAY_S = 86_400
EMAIL = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS l2_queue (
        ref TEXT PRIMARY KEY, email TEXT NOT NULL, trigger TEXT, enqueued_at REAL NOT NULL, next_at REAL NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, claimed_until REAL, claim_token TEXT)""",
    "CREATE INDEX IF NOT EXISTS l2_queue_due ON l2_queue(next_at)",
    """CREATE TABLE IF NOT EXISTS l2_results (
        ref TEXT PRIMARY KEY, email_key TEXT NOT NULL, found TEXT NOT NULL, asked INTEGER NOT NULL, answered INTEGER NOT NULL,
        gravatar INTEGER, trigger TEXT, checked_at REAL NOT NULL, expires_at REAL NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS l2_results_email ON l2_results(email_key, checked_at)",
    "CREATE INDEX IF NOT EXISTS l2_results_expiry ON l2_results(expires_at)",
    "CREATE TABLE IF NOT EXISTS l2_usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL, until REAL NOT NULL)",
]


def mode() -> str:
    m = os.environ.get("KYC_L2_MODE", "off").strip().lower()
    return m if m in ("off", "log") else "off"


def only_emails() -> set[str]:
    return {e.strip().lower() for e in os.environ.get("KYC_L2_ONLY_EMAILS", "").split(",") if e.strip()}


def douala_day(now: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(now + 3600))


class L2Store:
    def __init__(self, path: str, secret: str, recheck_days: float = 90, retention_days: float = 365):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, timeout=10)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=10000")
        self._db.execute("PRAGMA secure_delete=ON")
        for s in SCHEMA:
            self._db.execute(s)
        self._db.commit()
        self._key = hashlib.sha256(b"kyc-l2-email:" + secret.encode()).digest()
        self.recheck_s = recheck_days * DAY_S
        self.retention_s = retention_days * DAY_S

    def email_key(self, email: str) -> str:
        return hmac.new(self._key, email.strip().lower().encode(), hashlib.sha256).hexdigest()[:40]

    def _q(self, sql: str, args: Iterable = ()) -> list:
        with self._lock:
            return self._db.execute(sql, tuple(args)).fetchall()

    # ------------------------------------------------------------ intake
    def enqueue(self, items: list[dict], now: Optional[float] = None) -> dict[str, str]:
        """Per ref: queued | fresh (a recent result for this address exists) | off |
        not_allowlisted | invalid. Only `queued` stores the address."""
        now = now or time.time()
        m, allow = mode(), only_emails()
        out: dict[str, str] = {}
        with self._lock:
            for it in items:
                ref, email = it["ref"], str(it.get("email") or "").strip().lower()
                if m == "off":
                    out[ref] = "off"
                    continue
                if not EMAIL.match(email):
                    out[ref] = "invalid"
                    continue
                if allow and email not in allow:
                    out[ref] = "not_allowlisted"
                    continue
                key = self.email_key(email)
                mine = self._db.execute("SELECT 1 FROM l2_results WHERE ref=? AND email_key=? AND checked_at > ?",
                                        (ref, key, now - self.recheck_s)).fetchone()
                if mine:
                    out[ref] = "fresh"
                    continue
                other = self._db.execute(
                    "SELECT found, asked, answered, gravatar, checked_at FROM l2_results WHERE email_key=? AND checked_at > ? ORDER BY checked_at DESC LIMIT 1",
                    (key, now - self.recheck_s)).fetchone()
                if other:  # same address on another account, looked up recently: reused, no new lookup
                    found, asked, answered, grav, at = other
                    self._db.execute(
                        """INSERT INTO l2_results(ref, email_key, found, asked, answered, gravatar, trigger, checked_at, expires_at)
                           VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET email_key=excluded.email_key, found=excluded.found,
                           asked=excluded.asked, answered=excluded.answered, gravatar=excluded.gravatar, trigger=excluded.trigger,
                           checked_at=excluded.checked_at, expires_at=excluded.expires_at""",
                        (ref, key, found, asked, answered, grav, str(it.get("trigger") or "")[:32], at, at + self.retention_s))
                    out[ref] = "fresh"
                    continue
                self._db.execute(
                    """INSERT INTO l2_queue(ref, email, trigger, enqueued_at, next_at, attempts) VALUES(?,?,?,?,?,0)
                       ON CONFLICT(ref) DO UPDATE SET email=excluded.email, trigger=excluded.trigger, next_at=MIN(l2_queue.next_at, excluded.next_at)""",
                    (ref, email, str(it.get("trigger") or "")[:32], now, now))
                out[ref] = "queued"
            self._db.commit()
        return out

    def forget(self, refs: list[str]) -> int:
        """The member's address changed: drop the old result and any waiting lookup."""
        n = 0
        with self._lock:
            for i in range(0, len(refs), 500):
                chunk = refs[i:i + 500]
                ph = ",".join("?" * len(chunk))
                n += self._db.execute(f"DELETE FROM l2_results WHERE ref IN ({ph})", chunk).rowcount
                n += self._db.execute(f"DELETE FROM l2_queue WHERE ref IN ({ph})", chunk).rowcount
            self._db.commit()
        return n

    # ------------------------------------------------------------ pacing
    def used_today(self, now: float) -> int:
        row = self._q("SELECT n FROM l2_usage WHERE k=?", (f"day:{douala_day(now)}",))
        return row[0][0] if row else 0

    def module_used(self, name: str, now: float) -> int:
        row = self._q("SELECT n FROM l2_usage WHERE k=?", (f"mod:{name}:{int(now // 3600)}",))
        return row[0][0] if row else 0

    def count(self, now: float, modules: list[str]) -> None:
        hour = int(now // 3600)
        with self._lock:
            rows = [(f"day:{douala_day(now)}", now + 3 * DAY_S)] + [(f"mod:{m}:{hour}", now + 2 * 3600) for m in modules]
            for k, until in rows:
                self._db.execute("INSERT INTO l2_usage(k, n, until) VALUES(?,1,?) ON CONFLICT(k) DO UPDATE SET n=n+1", (k, until))
            self._db.execute("DELETE FROM l2_usage WHERE until < ?", (now,))
            self._db.commit()

    # ------------------------------------------------------------ the runner's side
    def claim(self, now: Optional[float] = None) -> Optional[dict]:
        now = now or time.time()
        token = uuid.uuid4().hex
        with self._lock:
            row = self._db.execute(
                "SELECT ref FROM l2_queue WHERE next_at <= ? AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY next_at LIMIT 1",
                (now, now)).fetchone()
            if not row:
                return None
            self._db.execute("UPDATE l2_queue SET claimed_until=?, claim_token=? WHERE ref=?", (now + 600, token, row[0]))
            self._db.commit()
            got = self._db.execute("SELECT ref, email, trigger, attempts FROM l2_queue WHERE claim_token=?", (token,)).fetchone()
        if not got:
            return None
        return {"ref": got[0], "email": got[1], "trigger": got[2], "attempts": got[3], "token": token}

    def save(self, row: dict, res: dict, now: Optional[float] = None) -> None:
        """Stores the result and deletes the queue row (and the address with it)."""
        now = now or time.time()
        key = self.email_key(row["email"])
        grav = None if res.get("gravatar") is None else int(bool(res["gravatar"]))
        with self._lock:
            self._db.execute(
                """INSERT INTO l2_results(ref, email_key, found, asked, answered, gravatar, trigger, checked_at, expires_at)
                   VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(ref) DO UPDATE SET email_key=excluded.email_key, found=excluded.found,
                   asked=excluded.asked, answered=excluded.answered, gravatar=excluded.gravatar, trigger=excluded.trigger,
                   checked_at=excluded.checked_at, expires_at=excluded.expires_at""",
                (row["ref"], key, json.dumps(list(res.get("found") or [])[:50]), int(res.get("asked") or 0),
                 int(res.get("answered") or 0), grav, row.get("trigger"), now, now + self.retention_s))
            # deleted only if the address is still the one looked up; a new one stays queued
            self._db.execute("DELETE FROM l2_queue WHERE ref=? AND claim_token=? AND email=?", (row["ref"], row["token"], row["email"]))
            self._db.execute("UPDATE l2_queue SET claimed_until=NULL, claim_token=NULL WHERE ref=? AND claim_token=?", (row["ref"], row["token"]))
            self._db.commit()

    def failed(self, row: dict, now: Optional[float] = None) -> None:
        """Retried later; after 5 failures the row (and the address) is dropped."""
        now = now or time.time()
        with self._lock:
            if row["attempts"] >= 4:
                self._db.execute("DELETE FROM l2_queue WHERE ref=? AND claim_token=?", (row["ref"], row["token"]))
            else:
                self._db.execute("UPDATE l2_queue SET claimed_until=NULL, claim_token=NULL, attempts=attempts+1, next_at=? WHERE ref=? AND claim_token=?",
                                 (now + 1800 * 2 ** row["attempts"], row["ref"], row["token"]))
            self._db.commit()

    def release(self, row: dict, next_at: float) -> None:
        """Not run now (daily cap reached): back in the queue for later, untouched."""
        with self._lock:
            self._db.execute("UPDATE l2_queue SET claimed_until=NULL, claim_token=NULL, next_at=? WHERE ref=? AND claim_token=?",
                             (next_at, row["ref"], row["token"]))
            self._db.commit()

    # ------------------------------------------------------------ reading
    def results(self, refs: list[str], now: Optional[float] = None) -> dict[str, dict]:
        now = now or time.time()
        out = {}
        for i in range(0, len(refs), 500):
            chunk = refs[i:i + 500]
            ph = ",".join("?" * len(chunk))
            for ref, found, asked, answered, grav, trig, at in self._q(
                    f"SELECT ref, found, asked, answered, gravatar, trigger, checked_at FROM l2_results WHERE ref IN ({ph}) AND expires_at > ?",
                    [*chunk, now]):
                out[ref] = {"found": json.loads(found), "asked": asked, "answered": answered,
                            "gravatar": None if grav is None else bool(grav), "trigger": trig or None,
                            "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at))}
        return out

    def expire(self, now: Optional[float] = None) -> int:
        with self._lock:
            n = self._db.execute("DELETE FROM l2_results WHERE expires_at <= ?", (now or time.time(),)).rowcount
            self._db.commit()
        return n

    def status(self, now: Optional[float] = None) -> dict:
        now = now or time.time()
        one = lambda sql, a=(): self._q(sql, a)[0][0]
        return {"mode": mode(), "allowlist": len(only_emails()), "queued": one("SELECT COUNT(*) FROM l2_queue"),
                "results": one("SELECT COUNT(*) FROM l2_results"), "today": self.used_today(now)}
