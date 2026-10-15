---
type: module-spec
module: jobs
status: draft
source_paths:
  - services/worker/jobs/*
last_reviewed: 2026-09-19
---

# Module: jobs

TASK-0108: `body_zone` reads the brief's zone (`bodyPart`, `orientation`, `side`) from a job's stored payload, and `JobQueue.public` adds it to every result it serves as `placement`, old ones included. A result already carrying one, or a payload without a zone, is served unchanged.

TASK-0104 (ADR-0034): `design_cost` counts a sleeve as 2 designs, a design as 1 and a re-placement as 0. `billable` stores that weight, and the limits sum it. With one design left, a sleeve is refused with `SLEEVE_NEEDS_TWO`.

TASK-0095: `JobQueue.designs_today` and `TurnLedger.used` expose the counts the limits apply; `designs_left` is the account's allowance within the studio's. `enqueue` uses the same query, so the counter and the refusal agree.

TASK-0085 (audit REN-01): each job event records `detail.waitMs`, the time between creation and start.

TASK-0078 (audit SEG-02): `jobs/quota.py` — `Limits`, `TurnLedger`, `QuotaExceededError`. `enqueue` checks the per-account and studio daily design limits before inserting; `billable` marks jobs that call a paid provider (not coverage re-placements nor kept photos).

TASK-0076: `JobQueue.stage` records the step of the job running in this thread (a context variable set by `tick`); `get` adds `stage` to a running job and `queuePosition` to a queued one. Steps live in memory only.

TASK-0072: a failed job stores `for_client(cause)` (`jobs/client_messages.py`): plain words, never a
status code or vendor; the job event keeps the cause for the panel.

TASK-0054 (ADR-0024): `tick` runs each job inside `telemetry.activity(owner, job)`, so every call it
makes is attributed, and records a `job` event with its outcome, duration and brief summary.

TASK-0047: `history(owner)` is no longer windowed to 24 hours; it returns the owner's 50 newest
successful versions. Designs do not expire (ADR-0023), so neither does the list of them.

TASK-0050 (ADR-0022): `record(owner, payload, result)` stores work finished outside the queue — a
kept camera photograph — as a succeeded job, so it lives in the owner's history under the same
retention and deletion as every other version. The result is validated against `studio-status`
before it is written, and the key is idempotent per owner like `enqueue`. `find(owner, key)` lets a
caller detect a retry before doing any paid work.

TASK-0021: owner-scoped successful history (latest 20 within 24 hours) and source_payload
support branching revisions. HTTP validates a completed owned parent's master and reuses its
brief/references/body/placement before enqueue. Edited master feeds all derived outputs;
stored backgrounds are reused when available, otherwise legacy jobs generate a new one.
Parent jobs are immutable. Failed edits remain visible and leave earlier results available.

## Responsibility

Own asynchronous execution: enqueue, run, report status, enforce quotas. Every generation in the
system is a job, because every generation takes seconds to minutes.

## Source ownership

`services/worker/jobs/`

## Public interfaces

- `enqueue(kind, payload, user) -> JobRef`
- `status(job_ref) -> JobState` — one of queued, running, succeeded, failed, cancelled
- `cancel(job_ref) -> None`
- Worker registration for each job kind

## Inputs and outputs

Inputs: a validated payload referencing assets by `ImageRef`, never by inline bytes.
Outputs: job state transitions and a result reference on success.

## Domain invariants

- JOBS-INV-001: No image bytes travel through the queue; payloads carry references only.
- JOBS-INV-002: Job execution is idempotent per job id. A redelivered job does not duplicate
  billable generation calls.
- JOBS-INV-003: Per-user quotas are enforced at enqueue time, before any provider cost is
  incurred.
- JOBS-INV-004: A failed job records a typed failure reason that the UI can render without
  exposing provider internals.
- JOBS-INV-005: Jobs referencing a deleted asset fail closed rather than operating on a stale
  reference.

## Data / persistence

A job record per submission: kind, state, timestamps, user, payload reference, result reference,
failure reason, attempt count. Records outlive the assets they reference for audit.

## Dependencies

`contracts`, `telemetry`.

## External integrations

SQLite single-worker for the local studio (ADR-0007). Multi-host backend remains undecided.

## Error semantics

The current studio makes failures terminal and visible; paid calls are not automatically retried.
Restarted running jobs fail explicitly. A future distributed retry/dead-letter policy remains intent.

## Security and permissions

A job may only be read or cancelled by the user who enqueued it. Payloads carry no secrets.

## Observability

Queue depth, wait time, execution time and failure rate per job kind; retry and dead-letter
counts; quota rejection counts.

## Performance / operational constraints

Queue wait is the dominant component of perceived latency. Job budgets per kind are defined
alongside the backend choice and are currently undefined.

## Tests / verification

Idempotency is tested by redelivering the same job id and asserting a single generation call.
Quota enforcement is tested at the enqueue boundary. Backend-specific behavior is tested against
a real instance, not a mock, in an integration suite.

## Known uncertainties and debt

- Queue backend is undecided.
- Job budgets and timeouts per kind are undefined.
- Whether users may run concurrent jobs, and how many, is undecided.

## Alignment notes

No implementation exists; nothing to align yet.

## Change history

- 2026-09-19: Created during SDD bootstrap.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| All generation is asynchronous | INTENT | ADR-0005 | NOT_RUN |
| References, not bytes, in the queue | INTENT | Planning session 2026-09-19 | NOT_RUN |
| Queue backend | UNKNOWN | Undecided | NOT_RUN |

## TASK-0019 current implementation and remaining intent

queue.py implements one SQLite worker, one active job per owner and eight globally. Idempotency binds owner+key to the entire payload. Startup fails interrupted running jobs, never replays paid calls. No automatic retry or dead-letter engine exists in this local version. Shared studio-status validation protects emitted results. All generation is off HTTP request execution; media screening remains synchronous on a threadpool.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.
