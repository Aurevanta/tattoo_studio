"""Daily spending limits, per account and for the whole studio (TASK-0078, audit SEG-02).

The audit found authentication and one-job-at-a-time concurrency, but nothing stopping an account
from chaining paid requests all day; the consultation also spends (Claude, the reference search)
before anything is queued. Limits are checked and recorded before any provider is called, and a
retried request is counted once: a design by its idempotency key (the queue already returns the
stored job for a repeated key), a consultation turn by the id the web gives it.

A day is the UTC calendar day. Re-placing a design and keeping a camera photo cost no generation,
so they are not counted.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(frozen=True)
class Limits:
    designs_per_account: int = 20
    designs_total: int = 300
    turns_per_account: int = 100


class QuotaExceededError(ValueError):
    """A daily limit is reached. Its message is written for the client."""


def designs_reached(limit: int) -> str:
    return (
        f"Has llegado al límite de {limit} diseños por día. Podrás crear más mañana; tus "
        "diseños anteriores siguen disponibles."
    )


STUDIO_FULL = "El estudio ha llegado a su límite de diseños de hoy. Inténtalo de nuevo mañana."


def turns_reached(limit: int) -> str:
    return (
        f"Has llegado al límite de {limit} mensajes por día con el asistente. Podrás seguir "
        "mañana; tu propuesta se conserva."
    )


def day_start(now: float | None = None) -> float:
    """The start of the current UTC day, as a timestamp."""
    moment = datetime.fromtimestamp(time.time() if now is None else now, UTC)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


class TurnLedger:
    """Paid consultation work (a message to the assistant, a reference search), per account."""

    def __init__(self, path: Path, limits: Limits) -> None:
        self.path = path
        self.limits = limits
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS turns "
                "(id TEXT PRIMARY KEY, owner TEXT, kind TEXT, created REAL)"
            )

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=10)

    def reserve(self, owner: str, turn_id: str, kind: str, now: float | None = None) -> None:
        """Count one turn, or raise `QuotaExceededError`. The same id is counted once."""
        moment = time.time() if now is None else now
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM turns WHERE id=?", (turn_id,)).fetchone():
                return
            used = db.execute(
                "SELECT count(*) FROM turns WHERE owner=? AND created>=?",
                (owner, day_start(moment)),
            ).fetchone()[0]
            if used >= self.limits.turns_per_account:
                raise QuotaExceededError(turns_reached(self.limits.turns_per_account))
            db.execute("INSERT INTO turns VALUES (?,?,?,?)", (turn_id, owner, kind, moment))

    def used(self, owner: str, now: float | None = None) -> int:
        """Turns this account has used today (TASK-0095)."""
        with self.connect() as db:
            return int(
                db.execute(
                    "SELECT count(*) FROM turns WHERE owner=? AND created>=?",
                    (owner, day_start(now)),
                ).fetchone()[0]
            )

    def forget(self, owner: str) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM turns WHERE owner=?", (owner,))


__all__ = [
    "STUDIO_FULL",
    "Limits",
    "QuotaExceededError",
    "TurnLedger",
    "day_start",
    "designs_reached",
    "turns_reached",
]
