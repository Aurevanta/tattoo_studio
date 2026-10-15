"""Links a client gives their tattooer (TASK-0097, ADR-0032).

The audit of 2026-10-08 found the product's key moment — taking the design to the tattooer — outside
the app: only loose downloads. A share is a link that opens one design, its stencils and what the
tattooer needs to read them, for a limited time, until the client withdraws it or erases their data.

What is kept is a digest of the token, never the token: a copy of the database opens nothing. The
token travels from the web in a header, not in the worker's path, so access logs do not hold it.
What a link shows is decided here, from the stored job, and never includes a photograph of the
client's body, a camera capture, the body type or the account.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

#: How long a link opens the design.
SHARE_DAYS = 30
#: Links an account may hold open at once: enough for every design in progress, not a broadcast.
MAX_ACTIVE = 20
#: The shape of a token as `create` issues it (24 random bytes, URL-safe base64).
TOKEN = re.compile(r"[A-Za-z0-9_-]{32}")
#: The parts of a result a tattooer may open.
SHARED_FILES = ("master", "stencil", "stencilMirror", "pdf", "pdfMirror")
#: TASK-0105: a sleeve's panels, shared when the result has them.
SHARED_IF_PRESENT = ("panels", "panelsMirror")

TOO_MANY = (
    "Tienes demasiados enlaces abiertos. Deja de compartir alguno de tus diseños antes de crear "
    "otro."
)


def iso(moment: float) -> str:
    return datetime.fromtimestamp(moment, UTC).isoformat().replace("+00:00", "Z")


class ShareLedger:
    def __init__(self, path: Path) -> None:
        self.path = path
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS shares (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, "
                "job TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL)"
            )

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    @staticmethod
    def digest(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def create(self, owner: str, job: str, now: float | None = None) -> tuple[str, float, float]:
        """A new link to this job: the token, when it was made and when it ends."""
        moment = time.time() if now is None else now
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute(
                "SELECT count(*) FROM shares WHERE owner=? AND expires>?", (owner, moment)
            ).fetchone()[0]
            if active >= MAX_ACTIVE:
                raise ValueError(TOO_MANY)
            token = secrets.token_urlsafe(24)
            expires = moment + SHARE_DAYS * 86400
            db.execute(
                "INSERT INTO shares VALUES (?,?,?,?,?)",
                (self.digest(token), owner, job, moment, expires),
            )
        return token, moment, expires

    def resolve(self, token: str, now: float | None = None) -> tuple[str, str, float, float] | None:
        """Owner, job, creation and expiry of an open link, or None."""
        if not TOKEN.fullmatch(token):
            return None
        moment = time.time() if now is None else now
        with self.connect() as db:
            row = db.execute(
                "SELECT owner, job, created, expires FROM shares WHERE digest=? AND expires>?",
                (self.digest(token), moment),
            ).fetchone()
        return None if row is None else (row[0], row[1], row[2], row[3])

    def open_links(
        self, owner: str, job: str, now: float | None = None
    ) -> tuple[int, float | None]:
        """How many links to this job are open, and when the last of them ends."""
        moment = time.time() if now is None else now
        with self.connect() as db:
            row = db.execute(
                "SELECT count(*), max(expires) FROM shares WHERE owner=? AND job=? AND expires>?",
                (owner, job, moment),
            ).fetchone()
        return int(row[0]), row[1]

    def revoke(self, owner: str, job: str) -> int:
        """Close every link to this job. Returns how many were open."""
        with self.connect() as db:
            return db.execute("DELETE FROM shares WHERE owner=? AND job=?", (owner, job)).rowcount

    def forget(self, owner: str) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM shares WHERE owner=?", (owner,))


def shared_design(
    result: dict[str, Any], payload: dict[str, Any], created: float, expires: float
) -> dict[str, Any]:
    """What the link shows, from a stored job (the `shared-design` contract)."""
    brief = payload["brief"]
    placement = {"bodyPart": brief["placement"]["bodyPart"]}
    if brief["placement"].get("side"):
        placement["side"] = brief["placement"]["side"]
    subject = brief["subject"]
    colour = brief["colour"]
    # A view composed on the client's own photograph is never shared: only generated skin is.
    on_generated_skin = result.get("backgroundKind") == "generated_anatomy"
    shared: dict[str, Any] = {
        "designId": result["designId"],
        "createdAt": iso(created),
        "expiresAt": iso(expires),
        "idea": subject["description"],
        "refined": subject.get("refined") or None,
        "size": dict(result["size"]),
        "placement": placement,
        "style": brief["style"]["primary"],
        "colourMode": colour["mode"],
        **{name: dict(result[name]) for name in SHARED_FILES},
        **{name: dict(result[name]) for name in SHARED_IF_PRESENT if result.get(name)},
        "mockup": dict(result["mockup"]) if on_generated_skin else None,
        "stencilMethod": (result.get("stencilReview") or {}).get("method"),
        "reviewRequired": True,
    }
    palette = [str(c)[:40] for c in colour.get("palette") or [] if str(c).strip()][:12]
    if palette:
        shared["palette"] = palette
    return shared


def shared_files(shared: dict[str, Any]) -> set[str]:
    """The asset ids a link may open."""
    names = (*SHARED_FILES, *SHARED_IF_PRESENT, "mockup")
    return {shared[name]["assetId"] for name in names if shared.get(name)}


__all__ = [
    "MAX_ACTIVE",
    "SHARE_DAYS",
    "TOO_MANY",
    "ShareLedger",
    "shared_design",
    "shared_files",
]
