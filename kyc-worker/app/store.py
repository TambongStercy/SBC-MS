"""The KYC queue and results, on the secondary server (decided 2026-11-22: KYC runs
entirely there; the main server only hands over the fields to check).

SQLite (WAL), the same file as the DNS cache (KYC_DB_PATH):
  queue    one row per member waiting (ref = member id) with the fields to check.
           The row is deleted once checked (secure_delete: the freed pages are
           zeroed). `v` grows with each new submission, so a submission arriving
           mid-check makes it run again with the newest fields.
  results  the member's latest level 1: signals, reasons, score, band, plus an
           HMAC of the mailbox (to find accounts sharing one) and the main
           server's fingerprint of the checked fields. No email, number or name.
           Deleted KYC_RETENTION_DAYS (365) after the check.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import sqlite3
import threading
import time
import uuid
from typing import Iterable, Optional

LIVE = 0
BACKFILL = 1

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS queue (
        ref TEXT PRIMARY KEY, payload TEXT NOT NULL, fingerprint TEXT NOT NULL, priority INTEGER NOT NULL,
        reason TEXT, v INTEGER NOT NULL DEFAULT 1, enqueued_at REAL NOT NULL, next_at REAL NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, claimed_until REAL, claim_token TEXT)""",
    "CREATE INDEX IF NOT EXISTS queue_due ON queue(priority, next_at)",
    """CREATE TABLE IF NOT EXISTS results (
        ref TEXT PRIMARY KEY, level INTEGER NOT NULL, fingerprint TEXT NOT NULL, signals TEXT NOT NULL,
        reasons TEXT NOT NULL, worker_score INTEGER NOT NULL, score INTEGER NOT NULL, band TEXT NOT NULL,
        email_key TEXT, variant_accounts INTEGER NOT NULL DEFAULT 0, trigger TEXT, checked_at REAL NOT NULL,
        expires_at REAL NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS results_email ON results(email_key)",
    "CREATE INDEX IF NOT EXISTS results_band ON results(band)",
    "CREATE INDEX IF NOT EXISTS results_expiry ON results(expires_at)",
]

FIELDS = ("email", "phone", "country", "ipCountry", "geoCountry", "momoNumber", "momoOperator")


def band(score: int) -> str:
    return "high" if score >= 50 else ("medium" if score >= 20 else "low")


class Store:
    def __init__(self, path: str, secret: str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, timeout=10)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=10000")
        self._db.execute("PRAGMA secure_delete=ON")  # deleted queue rows leave no readable fields behind
        for s in SCHEMA:
            self._db.execute(s)
        self._db.commit()
        self._email_key = hashlib.sha256(b"kyc-email:" + secret.encode()).digest()

    # ------------------------------------------------------------ helpers
    def email_key(self, normalized: str) -> str:
        return hmac.new(self._email_key, normalized.encode(), hashlib.sha256).hexdigest()[:40]

    def _x(self, sql: str, args: Iterable = ()):
        with self._lock:
            cur = self._db.execute(sql, tuple(args))
            self._db.commit()
            return cur

    def _q(self, sql: str, args: Iterable = ()) -> list:
        with self._lock:
            return self._db.execute(sql, tuple(args)).fetchall()

    # ------------------------------------------------------------ queue
    def enqueue(self, items: list[dict], now: Optional[float] = None) -> int:
        """Queue (or re-queue) members with their fields. A live item outranks a backfill one.
        A member whose current result was computed from the same fields (fingerprint) is skipped."""
        now = now or time.time()
        n = 0
        with self._lock:
            for it in items:
                same = self._db.execute("SELECT 1 FROM results WHERE ref=? AND fingerprint=? AND expires_at > ?",
                                        (it["ref"], str(it.get("fingerprint") or ""), now)).fetchone()
                if same:
                    continue
                fields = {k: it.get("fields", {}).get(k) for k in FIELDS}
                payload = json.dumps(fields)
                pr = LIVE if it.get("priority") == "live" else BACKFILL
                self._db.execute(
                    """INSERT INTO queue(ref, payload, fingerprint, priority, reason, v, enqueued_at, next_at, attempts)
                       VALUES(?,?,?,?,?,1,?,?,0)
                       ON CONFLICT(ref) DO UPDATE SET payload=excluded.payload, fingerprint=excluded.fingerprint,
                         priority=MIN(queue.priority, excluded.priority), reason=CASE WHEN excluded.priority=0 THEN excluded.reason ELSE queue.reason END,
                         v=queue.v+1, next_at=CASE WHEN excluded.priority=0 THEN excluded.next_at ELSE queue.next_at END, last_error=NULL""",
                    (it["ref"], payload, str(it.get("fingerprint") or ""), pr, str(it.get("reason") or "")[:20], now, now),
                )
                n += 1
            self._db.commit()
        return n

    def needed(self, items: list[dict]) -> list[str]:
        """Of {ref, fingerprint}, the members never checked, checked with other fields, or expired."""
        refs = [i["ref"] for i in items]
        have: dict[str, str] = {}
        queued: dict[str, str] = {}
        for i in range(0, len(refs), 900):
            chunk = refs[i:i + 900]
            ph = ",".join("?" * len(chunk))
            for ref, fp in self._q(f"SELECT ref, fingerprint FROM results WHERE ref IN ({ph}) AND expires_at > ?", [*chunk, time.time()]):
                have[ref] = fp
            for ref, fp in self._q(f"SELECT ref, fingerprint FROM queue WHERE ref IN ({ph})", chunk):
                queued[ref] = fp
        return [i["ref"] for i in items if have.get(i["ref"]) != i.get("fingerprint") and queued.get(i["ref"]) != i.get("fingerprint")]

    def claim(self, limit: int, allow_backfill: bool, now: Optional[float] = None) -> list[dict]:
        now = now or time.time()
        token = uuid.uuid4().hex
        with self._lock:
            prio = "(0,1)" if allow_backfill else "(0)"
            rows = self._db.execute(
                f"""SELECT ref FROM queue WHERE next_at <= ? AND priority IN {prio} AND (claimed_until IS NULL OR claimed_until < ?)
                    ORDER BY priority, next_at LIMIT ?""", (now, now, limit)).fetchall()
            if not rows:
                return []
            refs = [r[0] for r in rows]
            ph = ",".join("?" * len(refs))
            self._db.execute(f"UPDATE queue SET claimed_until=?, claim_token=? WHERE ref IN ({ph})", [now + 120, token, *refs])
            self._db.commit()
            got = self._db.execute(f"SELECT ref, payload, fingerprint, reason, v, attempts FROM queue WHERE claim_token=?", (token,)).fetchall()
        out = []
        for ref, payload, fp, reason, v, attempts in got:
            try:
                fields = json.loads(payload)
            except ValueError:
                fields = None
            out.append({"ref": ref, "fields": fields, "fingerprint": fp, "reason": reason, "v": v, "attempts": attempts, "token": token})
        return out

    def done(self, rows: list[dict]) -> None:
        """Delete checked rows unless a newer submission arrived meanwhile (then it runs again)."""
        with self._lock:
            for r in rows:
                cur = self._db.execute("DELETE FROM queue WHERE ref=? AND v=? AND claim_token=?", (r["ref"], r["v"], r["token"]))
                if cur.rowcount == 0:
                    self._db.execute("UPDATE queue SET claimed_until=NULL, claim_token=NULL WHERE ref=? AND claim_token=?", (r["ref"], r["token"]))
            self._db.commit()

    def failed(self, rows: list[dict], why: str, now: Optional[float] = None) -> None:
        now = now or time.time()
        with self._lock:
            for r in rows:
                delay = min(1800, 30 * 2 ** min(6, r["attempts"]))
                self._db.execute("UPDATE queue SET claimed_until=NULL, claim_token=NULL, attempts=attempts+1, last_error=?, next_at=? WHERE ref=? AND claim_token=?",
                                 (why[:80], now + delay, r["ref"], r["token"]))
            self._db.commit()

    # ------------------------------------------------------------ results
    def holders(self, keys: list[str]) -> dict[str, set[str]]:
        out: dict[str, set[str]] = {}
        for i in range(0, len(keys), 900):
            chunk = keys[i:i + 900]
            ph = ",".join("?" * len(chunk))
            for ref, k in self._q(f"SELECT ref, email_key FROM results WHERE email_key IN ({ph})", chunk):
                out.setdefault(k, set()).add(ref)
        return out

    def save_results(self, rows: list[tuple]) -> None:
        with self._lock:
            self._db.executemany(
                """INSERT INTO results(ref, level, fingerprint, signals, reasons, worker_score, score, band, email_key, variant_accounts, trigger, checked_at, expires_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(ref) DO UPDATE SET level=excluded.level, fingerprint=excluded.fingerprint, signals=excluded.signals,
                     reasons=excluded.reasons, worker_score=excluded.worker_score, score=excluded.score, band=excluded.band,
                     email_key=excluded.email_key, variant_accounts=excluded.variant_accounts, trigger=excluded.trigger,
                     checked_at=excluded.checked_at, expires_at=excluded.expires_at""", rows)
            self._db.commit()

    def results(self, refs: list[str]) -> dict[str, dict]:
        out = {}
        ph = ",".join("?" * len(refs))
        for row in self._q(f"""SELECT ref, level, score, band, reasons, signals, variant_accounts, checked_at FROM results
                               WHERE ref IN ({ph}) AND expires_at > ?""", [*refs, time.time()]):
            ref, level, score, bnd, reasons, signals, variants, at = row
            out[ref] = {"level": level, "score": score, "band": bnd, "reasons": json.loads(reasons), "signals": json.loads(signals),
                        "variantAccounts": variants, "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at))}
        return out

    def expire(self, now: Optional[float] = None) -> int:
        """Results past their retention (12 months by default) are deleted."""
        return self._x("DELETE FROM results WHERE expires_at <= ?", (now or time.time(),)).rowcount

    def status(self) -> dict:
        one = lambda sql: self._q(sql)[0][0]
        queued, live, results = one("SELECT COUNT(*) FROM queue"), one("SELECT COUNT(*) FROM queue WHERE priority=0"), one("SELECT COUNT(*) FROM results")
        bands = dict(self._q("SELECT band, COUNT(*) FROM results GROUP BY band"))
        failing = one("SELECT COUNT(*) FROM queue WHERE attempts > 0")
        return {"queued": queued, "live": live, "results": results, "bands": {"high": bands.get("high", 0), "medium": bands.get("medium", 0), "low": bands.get("low", 0)}, "retrying": failing}
