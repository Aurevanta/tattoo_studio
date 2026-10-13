"""What the administrator sees, computed from events (TASK-0055).

Pure functions over the rows `EventStore.events` returns. A demo's volume makes computing from
rows the simplest honest option; views or rollups replace this when volume grows.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from typing import Any

Row = dict[str, Any]


def _percentile(values: list[int], share: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(share * len(ordered)) - 1)]


def _durations(rows: Iterable[Row]) -> dict[str, int | None]:
    values = [int(r["duration_ms"]) for r in rows if r.get("duration_ms") is not None]
    return {
        "avg": round(sum(values) / len(values)) if values else None,
        "p50": _percentile(values, 0.5),
        "p95": _percentile(values, 0.95),
    }


def _cost(rows: Iterable[Row]) -> float | None:
    priced = [float(r["cost_usd"]) for r in rows if r.get("cost_usd") is not None]
    return round(sum(priced), 6) if priced else None


def _reason(row: Row) -> str | None:
    detail = row.get("detail") or {}
    value = detail.get("error") or detail.get("reason")
    return str(value) if value else None


def _emails(rows: list[Row]) -> dict[str, str]:
    """The address each account last signed in with. Rows are newest first."""
    found: dict[str, str] = {}
    for row in rows:
        account, text = row.get("account"), row.get("text")
        if row["kind"] == "sign_in" and row["outcome"] == "ok" and account and text:
            found.setdefault(account, text)
    return found


#: TASK-0100: error codes with which a provider says its account has no credit.
_OUT_OF_CREDIT = re.compile(
    r"\b(?:insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached)\b|HTTP 402\b"
)


def alerts(rows: list[Row]) -> list[dict[str, Any]]:
    """Providers whose latest call failed for lack of credit, and since when (TASK-0100).

    Rows are newest first. An alert lasts until the provider answers a call again; `since` is the
    oldest failure of the unbroken run, `calls` how many calls it has refused.
    """
    runs: dict[str, list[Row]] = {}
    settled: set[str] = set()
    for r in rows:
        provider = r.get("provider")
        if r["kind"] != "provider_call" or not provider or provider in settled:
            continue
        error = str((r.get("detail") or {}).get("error") or "")
        if r["outcome"] != "ok" and _OUT_OF_CREDIT.search(error):
            runs.setdefault(provider, []).append(r)
        else:
            settled.add(provider)
    return [
        {
            "kind": "out_of_credit",
            "provider": provider,
            "since": refused[-1]["ts"].isoformat(),
            "calls": len(refused),
        }
        for provider, refused in sorted(runs.items())
    ]


def overview(rows: list[Row]) -> dict[str, Any]:
    """Totals, per-model and per-day series, per-account summaries and recent errors."""
    jobs = [r for r in rows if r["kind"] == "job"]
    calls = [r for r in rows if r["kind"] == "provider_call"]
    done = [r for r in jobs if r["outcome"] == "ok"]

    def count(kind: str, outcome: str | None = None, operation: str | None = None) -> int:
        return sum(
            1
            for r in rows
            if r["kind"] == kind
            and (outcome is None or r["outcome"] == outcome)
            and (operation is None or r["operation"] == operation)
        )

    totals = {
        "generations": len(jobs),
        "succeeded": len(done),
        "failed": len(jobs) - len(done),
        "successRate": round(len(done) / len(jobs), 4) if jobs else None,
        "durationMs": _durations(done),
        # TASK-0085 (audit REN-01): time in the queue before a job started, every outcome.
        "waitMs": _durations({"duration_ms": (r.get("detail") or {}).get("waitMs")} for r in jobs),
        "calls": len(calls),
        "callErrors": sum(1 for r in calls if r["outcome"] != "ok"),
        "inputTokens": sum(r.get("input_tokens") or 0 for r in calls),
        "outputTokens": sum(r.get("output_tokens") or 0 for r in calls),
        "images": sum(r.get("images") or 0 for r in calls),
        "costUsd": _cost(calls),
        "unpricedCalls": sum(1 for r in calls if r.get("cost_usd") is None),
        "accounts": len({r["account"] for r in rows if r.get("account")}),
        "signIns": count("sign_in", "ok"),
        "signInRefusals": count("sign_in", "refused"),
        "uploads": count("upload", "ok"),
        "uploadRefusals": count("upload", "refused"),
        "captures": count("capture", "ok"),
        "messages": count("consultation_turn", operation="message"),
        "erasures": count("deletion"),
    }

    models: dict[tuple[str, str, str], list[Row]] = defaultdict(list)
    for call in calls:
        models[(call.get("provider") or "", call.get("model") or "", call["operation"])].append(
            call
        )
    # Busiest first; ties by provider and operation, so the order is stable between reloads.
    ranked = sorted(models.items(), key=lambda item: (-len(item[1]), item[0][0], item[0][2]))
    by_model = [
        {
            "provider": provider,
            "model": model,
            "operation": operation,
            "calls": len(group),
            "errors": sum(1 for r in group if r["outcome"] != "ok"),
            "inputTokens": sum(r.get("input_tokens") or 0 for r in group),
            "outputTokens": sum(r.get("output_tokens") or 0 for r in group),
            "images": sum(r.get("images") or 0 for r in group),
            "costUsd": _cost(group),
            "durationMs": _durations(group),
        }
        for (provider, model, operation), group in ranked
    ]

    days: dict[str, list[Row]] = defaultdict(list)
    for row in rows:
        days[row["ts"].date().isoformat()].append(row)
    by_day = [
        {
            "day": day,
            "generations": sum(1 for r in group if r["kind"] == "job"),
            "failed": sum(1 for r in group if r["kind"] == "job" and r["outcome"] != "ok"),
            "calls": sum(1 for r in group if r["kind"] == "provider_call"),
            "tokens": sum(
                (r.get("input_tokens") or 0) + (r.get("output_tokens") or 0)
                for r in group
                if r["kind"] == "provider_call"
            ),
            "costUsd": _cost(r for r in group if r["kind"] == "provider_call"),
            "accounts": len({r["account"] for r in group if r.get("account")}),
        }
        for day, group in sorted(days.items())
    ]

    emails = _emails(rows)
    people: dict[str, list[Row]] = defaultdict(list)
    for row in rows:
        if row.get("account") and row["kind"] != "admin":
            people[row["account"]].append(row)
    by_account = sorted(
        (
            {
                "account": account,
                "email": emails.get(account),
                "lastSeen": max(r["ts"] for r in group).isoformat(),
                "generations": sum(1 for r in group if r["kind"] == "job"),
                "failed": sum(1 for r in group if r["kind"] == "job" and r["outcome"] != "ok"),
                "messages": sum(
                    1
                    for r in group
                    if r["kind"] == "consultation_turn" and r["operation"] == "message"
                ),
                "uploads": sum(1 for r in group if r["kind"] == "upload" and r["outcome"] == "ok"),
                "tokens": sum(
                    (r.get("input_tokens") or 0) + (r.get("output_tokens") or 0)
                    for r in group
                    if r["kind"] == "provider_call"
                ),
                "costUsd": _cost(r for r in group if r["kind"] == "provider_call"),
            }
            for account, group in people.items()
        ),
        key=lambda item: item["lastSeen"],
        reverse=True,
    )

    errors = [
        {
            "ts": r["ts"].isoformat(),
            "kind": r["kind"],
            "operation": r["operation"],
            "provider": r.get("provider"),
            "model": r.get("model"),
            "account": r.get("account"),
            "reason": _reason(r),
        }
        for r in rows
        if r["outcome"] in ("error", "refused") and r["kind"] != "sign_in"
    ][:25]

    return {
        "totals": totals,
        "byModel": by_model,
        "byDay": by_day,
        "byAccount": by_account,
        "errors": errors,
        "alerts": alerts(rows),
    }


def activity(rows: list[Row], account: str) -> dict[str, Any]:
    """One account's recorded activity, newest first, and its address if it has signed in."""
    mine = [r for r in rows if r.get("account") == account and r["kind"] != "admin"]
    return {
        "account": account,
        "email": _emails(mine).get(account),
        "events": [
            {
                "ts": r["ts"].isoformat(),
                "kind": r["kind"],
                "operation": r["operation"],
                "outcome": r["outcome"],
                "job": r.get("job"),
                "provider": r.get("provider"),
                "model": r.get("model"),
                "durationMs": r.get("duration_ms"),
                "inputTokens": r.get("input_tokens"),
                "outputTokens": r.get("output_tokens"),
                "costUsd": r.get("cost_usd"),
                # Sign-in rows carry the address in `text`; it is shown once, above, not per row.
                "text": None if r["kind"] == "sign_in" else r.get("text"),
                "detail": r.get("detail") or {},
            }
            for r in mine
        ],
    }


def window(days: int, now: datetime) -> tuple[datetime, datetime]:
    from datetime import timedelta

    return now - timedelta(days=days), now
