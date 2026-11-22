"""KYC level 3 (ID document + selfie), on the secondary server (decided 2026-11-22).

Asked when: a fraud-engine hold, an authenticator reset (lost phone), a member who lost access
to their account details. Any support agent decides; the automatic checks (l3_checks.py) are
hints only.

SQLite (same file as level 1, KYC_DB_PATH):
  l3_requests  one row per submission: who (`ref`: member id, or `guest:<ticket>` for a person
               who cannot sign in), why (`purpose`), status (pending → checked → approved /
               refused), the check results (no image), who decided and why. Kept 12 months after
               the decision (KYC_L3_RECORD_DAYS), then deleted.
  l3_images    the images, ENCRYPTED (Fernet, key from KYC_L3_KEY, which never leaves this
               server's .env), and l3_faces the selfie's face vector (encrypted too). Deleted KYC_L3_IMAGE_DAYS (30) after the decision; a request never
               decided loses its images after KYC_L3_UNDECIDED_DAYS (60).
"""
from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import threading
import time
import uuid
from typing import Optional

from cryptography.fernet import Fernet

DAY = 86_400
PURPOSES = ("fraud_hold", "authenticator_reset", "lost_access")
KINDS = ("id_front", "id_back", "selfie")
MAX_IMAGE = 4 * 1024 * 1024

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS l3_requests (
        id TEXT PRIMARY KEY, ref TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL,
        created_at REAL NOT NULL, checked_at REAL, scores TEXT,
        decided_at REAL, decided_by TEXT, decision_reason TEXT,
        images_delete_at REAL NOT NULL, record_delete_at REAL NOT NULL, images_deleted_at REAL)""",
    "CREATE INDEX IF NOT EXISTS l3_ref ON l3_requests(ref, created_at)",
    "CREATE INDEX IF NOT EXISTS l3_status ON l3_requests(status, created_at)",
    """CREATE TABLE IF NOT EXISTS l3_images (
        request_id TEXT NOT NULL, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
        sha256 TEXT NOT NULL, blob BLOB NOT NULL, PRIMARY KEY (request_id, kind))""",
    # The selfie's face vector (encrypted), to spot one face behind several accounts. Deleted with the images.
    """CREATE TABLE IF NOT EXISTS l3_faces (
        request_id TEXT PRIMARY KEY, ref TEXT NOT NULL, feature BLOB NOT NULL)""",
]


def sniff(data: bytes) -> Optional[str]:
    """The image type from its first bytes (never trust a declared type)."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class L3Store:
    def __init__(self, path: str, key: str, image_days: float = 30, record_days: float = 365, undecided_days: float = 60):
        if len(key) < 32:
            raise RuntimeError("KYC_L3_KEY is required (32+ characters)")
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, timeout=10)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=10000")
        self._db.execute("PRAGMA secure_delete=ON")  # deleted images leave nothing readable in the file
        for s in SCHEMA:
            self._db.execute(s)
        self._db.commit()
        self._f = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"kyc-l3:" + key.encode()).digest()))
        self.image_days, self.record_days, self.undecided_days = image_days, record_days, undecided_days

    # ------------------------------------------------------------ submit
    def submit(self, ref: str, purpose: str, images: dict[str, bytes], now: Optional[float] = None,
               per_day: int = 3) -> tuple[Optional[str], Optional[str]]:
        """Stores one submission (images checked by the caller): (id, None), or (None, 'open' | 'limit').
        The checks and the insert are one IMMEDIATE transaction, so two API workers cannot both pass."""
        now = now or time.time()
        rid = uuid.uuid4().hex
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                if self._db.execute("SELECT 1 FROM l3_requests WHERE ref=? AND status IN ('pending','checked') LIMIT 1", (ref,)).fetchone():
                    self._db.rollback()
                    return None, "open"
                if self._db.execute("SELECT COUNT(*) FROM l3_requests WHERE ref=? AND created_at>=?", (ref, now - DAY)).fetchone()[0] >= per_day:
                    self._db.rollback()
                    return None, "limit"
                self._db.execute(
                    "INSERT INTO l3_requests(id, ref, purpose, status, created_at, images_delete_at, record_delete_at) VALUES(?,?,?,?,?,?,?)",
                    (rid, ref, purpose, "pending", now, now + self.undecided_days * DAY, now + (self.undecided_days + self.record_days) * DAY))
                for kind, data in images.items():
                    self._db.execute("INSERT INTO l3_images(request_id, kind, mime, size, sha256, blob) VALUES(?,?,?,?,?,?)",
                                     (rid, kind, sniff(data), len(data), hashlib.sha256(data).hexdigest(), self._f.encrypt(data)))
                self._db.commit()
            except Exception:
                self._db.rollback()
                raise
        return rid, None

    # ------------------------------------------------------------ checks (runner)
    def next_pending(self) -> Optional[str]:
        with self._lock:
            row = self._db.execute("SELECT id FROM l3_requests WHERE status='pending' AND images_deleted_at IS NULL ORDER BY created_at LIMIT 1").fetchone()
        return row[0] if row else None

    def images(self, rid: str) -> dict[str, bytes]:
        with self._lock:
            rows = self._db.execute("SELECT kind, blob FROM l3_images WHERE request_id=?", (rid,)).fetchall()
        return {k: self._f.decrypt(b) for k, b in rows}

    def same_image_elsewhere(self, rid: str) -> int:
        """Requests of OTHER people (refs) that sent one of this request's exact images."""
        with self._lock:
            return self._db.execute(
                """SELECT COUNT(DISTINCT r2.ref) FROM l3_images i JOIN l3_requests r ON r.id=i.request_id
                   JOIN l3_images i2 ON i2.sha256=i.sha256 AND i2.request_id<>i.request_id
                   JOIN l3_requests r2 ON r2.id=i2.request_id AND r2.ref<>r.ref WHERE i.request_id=?""", (rid,)).fetchone()[0]

    def other_faces(self, ref: str) -> list[tuple[str, str, bytes]]:
        """(request id, ref, feature bytes) of the selfies of other people still kept."""
        with self._lock:
            rows = self._db.execute("SELECT request_id, ref, feature FROM l3_faces WHERE ref<>?", (ref,)).fetchall()
        return [(r, f, self._f.decrypt(b)) for r, f, b in rows]

    def save_scores(self, rid: str, scores: dict, now: Optional[float] = None, face: Optional[bytes] = None, ref: Optional[str] = None) -> None:
        with self._lock:
            if face is not None and ref is not None:
                self._db.execute("INSERT OR REPLACE INTO l3_faces(request_id, ref, feature) VALUES(?,?,?)", (rid, ref, self._f.encrypt(face)))
            self._db.execute("UPDATE l3_requests SET scores=?, checked_at=?, status=CASE WHEN status='pending' THEN 'checked' ELSE status END WHERE id=?",
                             (json.dumps(scores), now or time.time(), rid))
            self._db.commit()

    # ------------------------------------------------------------ read
    def get(self, rid: str) -> Optional[dict]:
        with self._lock:
            row = self._db.execute("""SELECT id, ref, purpose, status, created_at, checked_at, scores, decided_at, decided_by,
                                      decision_reason, images_delete_at, images_deleted_at FROM l3_requests WHERE id=?""", (rid,)).fetchone()
            kinds = [r[0] for r in self._db.execute("SELECT kind FROM l3_images WHERE request_id=?", (rid,)).fetchall()]
        if not row:
            return None
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)) if t else None
        return {"id": row[0], "ref": row[1], "purpose": row[2], "status": row[3], "createdAt": iso(row[4]), "checkedAt": iso(row[5]),
                "scores": json.loads(row[6]) if row[6] else None, "decidedAt": iso(row[7]), "decidedBy": row[8], "decisionReason": row[9],
                "imagesDeleteAt": iso(row[10]), "imagesDeletedAt": iso(row[11]), "images": sorted(kinds)}

    def image(self, rid: str, kind: str) -> Optional[tuple[bytes, str]]:
        with self._lock:
            row = self._db.execute("SELECT blob, mime FROM l3_images WHERE request_id=? AND kind=?", (rid, kind)).fetchone()
        if not row:
            return None
        return self._f.decrypt(row[0]), row[1]

    # ------------------------------------------------------------ decide
    def decide(self, rid: str, decision: str, by: str, reason: str, now: Optional[float] = None) -> Optional[dict]:
        """Approve or refuse ONCE (a second decision is refused). Schedules the images' deletion."""
        now = now or time.time()
        with self._lock:
            cur = self._db.execute(
                """UPDATE l3_requests SET status=?, decided_at=?, decided_by=?, decision_reason=?, images_delete_at=?, record_delete_at=?
                   WHERE id=? AND status IN ('pending','checked')""",
                (decision, now, by[:64], reason[:500], now + self.image_days * DAY, now + self.record_days * DAY, rid))
            self._db.commit()
            changed = cur.rowcount == 1
        return self.get(rid) if changed else None

    # ------------------------------------------------------------ retention (runner, hourly)
    def purge(self, now: Optional[float] = None) -> dict:
        now = now or time.time()
        with self._lock:
            due = [r[0] for r in self._db.execute("SELECT id FROM l3_requests WHERE images_deleted_at IS NULL AND images_delete_at <= ?", (now,)).fetchall()]
            for rid in due:
                self._db.execute("DELETE FROM l3_images WHERE request_id=?", (rid,))
                self._db.execute("DELETE FROM l3_faces WHERE request_id=?", (rid,))
                self._db.execute("UPDATE l3_requests SET images_deleted_at=? WHERE id=?", (now, rid))
            gone = self._db.execute("SELECT id FROM l3_requests WHERE record_delete_at <= ?", (now,)).fetchall()
            for (rid,) in gone:
                self._db.execute("DELETE FROM l3_images WHERE request_id=?", (rid,))
                self._db.execute("DELETE FROM l3_faces WHERE request_id=?", (rid,))
                self._db.execute("DELETE FROM l3_requests WHERE id=?", (rid,))
            self._db.commit()
        return {"imagesDeleted": len(due), "recordsDeleted": len(gone)}

    def status(self) -> dict:
        with self._lock:
            rows = dict(self._db.execute("SELECT status, COUNT(*) FROM l3_requests GROUP BY status").fetchall())
            imgs = self._db.execute("SELECT COUNT(*) FROM l3_images").fetchone()[0]
        return {"byStatus": rows, "images": imgs}
