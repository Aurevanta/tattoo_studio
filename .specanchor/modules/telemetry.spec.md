---
type: module-spec
module: telemetry
status: draft
source_paths:
  - services/worker/telemetry/*
last_reviewed: 2026-09-30
---

# Module: telemetry

TASK-0100: `overview` adds `alerts`: each provider whose latest calls failed for lack of credit, with `since` (oldest of the unbroken run) and `calls`, until a call answers again.

TASK-0085: the overview reports `totals.waitMs` (avg, p50, p95) over every job.

TASK-0059: a failed provider call records the provider's short error code beside the status
("HTTP 400 moderation_blocked"), validated as `[a-z0-9_]{1,40}`; the provider's message is never
kept.

TASK-0055: `report.py` computes the administrator's views from rows: totals and timings,
consumption by model, activity by day, per-account summaries with the last sign-in address, recent
errors, and one account's activity. Administrator events are audit, not use, and are left out.

TASK-0054: created. An append-only record of what the studio did, for whom, how long it took and
what it cost, so the service can be monitored and an administrator can see its use (TASK-0055).

## Responsibility

Record events — paid provider calls with their tokens, duration and estimated cost; generations
with their outcome; uploads, kept photos and erasures; consultation turns and sign-ins reported by
the web tier — and keep them in a store that can be queried. It makes no decision: nothing in the
studio reads an event to decide what to do.

## Source ownership

`services/worker/telemetry/*`.

## Public interfaces

- `record(kind, operation, **fields)` — never raises.
- `activity(account, job)` — a context in which every event is attributed to that account and job.
- `provider_call(provider, operation, model)` — meters one paid call; records on success and on
  failure and re-raises unchanged.
- `forget(account)` — strips an erased account's identity and text from its events.
- `EventStore.events(since, until, limit)` — the read side, for TASK-0055.
- `open_store(dsn, data_dir)` — Postgres when a connection string is configured, SQLite otherwise.
- `Prices.parse(TATTOO_PRICES)` — USD per model, configured by the owner.

## Inputs and outputs

Inputs: calls from `generation`, `jobs` and `app`, and web-tier events accepted by
`POST /studio/events`. Output: rows in `events` (SQLite) or `inkcraft.events` (Postgres).

## Domain invariants

- TEL-INV-001: Recording never fails or delays a request. Writes are buffered and flushed by a
  background thread; a store that is down drops events and counts them.
- TEL-INV-002: No event holds an image. Events carry ids, sizes, counts, durations, token counts
  and short bounded text.
- TEL-INV-003: A cost is computed only from prices the owner configured. With no price, the cost is
  null; it is never estimated from anything else, and never accepted from the web tier.
- TEL-INV-004: Erasing an account's data removes its identity and text from its events; the numbers
  remain, unattributed.
- TEL-INV-005: The account of a web-reported event comes from the authenticated header, never from
  the event body.

## Data / persistence

One table, fifteen columns (`ts`, `kind`, `operation`, `outcome`, `account`, `job`, `provider`,
`model`, `duration_ms`, `input_tokens`, `output_tokens`, `images`, `cost_usd`, `text`, `detail`).
The statements are written once and run on both databases; only placeholders differ. Production's
schema, role and grants are in `infra/supabase/telemetry.sql`. Events older than
`TATTOO_TELEMETRY_RETENTION_DAYS` (365 by default) are deleted hourly.

## Dependencies

None among the worker's modules.

Its only outbound connection is to its own event database, declared as an exception in the
architecture test's egress allowlist. It never calls a model.

## External integrations

Postgres (Supabase), through `psycopg`, with a role that may only insert, select, update and
delete on `inkcraft.events`.

## Error semantics

A misconfigured Postgres connection stops the worker at startup with a message that names the
error's type and nothing from the connection string (PLAT-INV-005, SEC-INV-008). At runtime every
failure is swallowed and counted.

## Security and permissions

The database credential lives only in the worker. The web tier, which faces the internet, reports
events to the worker over the existing service token and never holds it.

## Observability

This module is the observability. `EventStore.dropped` counts events lost to a full buffer or a
failed write.

## Performance / operational constraints

At most 10,000 events are buffered in memory. Flushes are batched every two seconds.

## Tests / verification

`telemetry/tests/test_telemetry.py` runs the store's real SQL against SQLite;
`app/tests/test_studio.py` covers attribution, refusals, erasure and the web route.

## Known uncertainties and debt

- The Postgres path has not been executed against a Postgres server: no server is available in the
  development environment. Its SQL is the SQLite path's, and its connection failure is tested.
- Aggregates are computed by the reader from rows, which suits a demo's volume; views or rollups
  are the fix when volume grows.
