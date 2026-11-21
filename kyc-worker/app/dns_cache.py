"""Does a domain accept mail? One DNS query per domain, cached in the worker's
own SQLite database (KYC_DB_PATH), so a backfill of 386,000 members asks about
a few thousand domains, not 386,000 addresses.

Answers: True (MX, or an A/AAAA record: RFC 5321 implicit MX), False (the
domain does not exist, or has a null MX / no record at all), None (DNS failed:
unknown, never scored). A definite answer is kept KYC_DNS_TTL_DAYS (7), a
failure only 1 hour.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from typing import Callable, Iterable, Optional

import dns.exception
import dns.resolver

SCHEMA = "CREATE TABLE IF NOT EXISTS domains (domain TEXT PRIMARY KEY, mx INTEGER, checked_at REAL NOT NULL)"


def dns_lookup(domain: str, timeout: float = 3.0) -> Optional[bool]:
    r = dns.resolver.Resolver()
    r.lifetime = timeout
    try:
        answers = r.resolve(domain, "MX")
        # A "null MX" (RFC 7505: preference 0, exchange ".") means the domain takes no mail.
        return not all(str(a.exchange) == "." for a in answers)
    except dns.resolver.NXDOMAIN:
        return False
    except dns.resolver.NoAnswer:
        for rtype in ("A", "AAAA"):
            try:
                r.resolve(domain, rtype)
                return True
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                continue
            except (dns.exception.Timeout, dns.resolver.NoNameservers):
                return None
        return False
    except (dns.exception.Timeout, dns.resolver.NoNameservers, dns.exception.DNSException):
        return None


class DomainCache:
    def __init__(self, path: str, ttl_days: float = 7, lookup: Callable[[str], Optional[bool]] = dns_lookup):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(SCHEMA)
        self._db.commit()
        self._ttl = ttl_days * 86400
        self._lookup = lookup
        self.hits = 0
        self.misses = 0

    def _get(self, domain: str) -> tuple[bool, Optional[bool]]:
        with self._lock:
            row = self._db.execute("SELECT mx, checked_at FROM domains WHERE domain = ?", (domain,)).fetchone()
        if not row:
            return False, None
        mx, at = row
        ttl = 3600 if mx is None else self._ttl
        if time.time() - at > ttl:
            return False, None
        return True, (None if mx is None else bool(mx))

    def _put(self, domain: str, mx: Optional[bool]) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO domains(domain, mx, checked_at) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET mx=excluded.mx, checked_at=excluded.checked_at",
                (domain, None if mx is None else int(mx), time.time()),
            )
            self._db.commit()

    def lookup(self, domain: str) -> Optional[bool]:
        domain = domain.lower().strip(".")
        found, mx = self._get(domain)
        if found:
            self.hits += 1
            return mx
        self.misses += 1
        mx = self._lookup(domain)
        self._put(domain, mx)
        return mx

    def warm(self, domains: Iterable[str], pool) -> None:
        """Resolve a batch's unknown domains in parallel before the items are scored."""
        todo = {d.lower().strip(".") for d in domains if d}
        todo = [d for d in todo if not self._get(d)[0]]
        if todo:
            list(pool.map(self.lookup, todo))

    def size(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM domains").fetchone()[0]
