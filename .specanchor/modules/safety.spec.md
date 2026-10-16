---
type: module-spec
module: safety
status: draft
source_paths:
  - services/worker/safety/*
last_reviewed: 2026-09-19
---

# Module: safety

TASK-0114 (ADR-0040, amends TASK-0013's scope): the input gate refuses an **identifiable** person, not every visible one. `CLASSIFY_PROMPT` asks for `{"identifiable_person", "explicit"}`. A person counts as identifiable when they are the subject, prominent, close or in the foreground; when their face is recognisable; or when a body part is shown close up. Small, distant, incidental figures do not count. Unsure means identifiable. `ModerationOutcome.identifiable_person` replaces `contains_person`, and a verdict under the old key is malformed, so it is refused. The reason code stays `contains_person`. `GATE_VERSION` is `input-gate-2`. An own body photo still allows a person.

TASK-0100: `ProviderExhaustedError` names a provider without credit; `InputGate` denies it as `ReasonCode.PROVIDER_EXHAUSTED` (still a denial, SAFETY-INV-007). `OpenAIModerationProvider` raises `ModerationExhaustedError` when `out_of_credit` reads 402/429 with `error.type`/`error.code` in `insufficient_quota`, `credit_balance_exhausted`, `billing_hard_limit_reached`; it never reads the message.

TASK-0064 (ADR-0028): SAFETY-INV-003's record is the `sign_in` event, which carries the accepted
terms and image-consent versions with its time; the consent is given at sign-in for the session.

TASK-0032 (ADR-0015/0016): two obligations become load-bearing. (1) Scouted open-web candidates
(the Claude Sonnet 5 scout's fallback) are screened before they can become references — a candidate
depicting a real person is rejected, as ordinary references already are. (2) Activating the mockup
blend makes `screen_output` a hard prerequisite: generated imagery is screened before it is stored
or shown (SAFETY-INV-001, SEC-INV-006), and the body photo reaches the blend provider only carrying
a `SafetyClearance` bound to the screened bytes (SAFETY-INV-002, SEC-INV-007). No gate is loosened;
`screen_output`, still unbuilt, moves onto this task's critical path.

## Responsibility

Enforce the consent, moderation and content-policy gates defined in the quality-and-security
global spec. This module is the reason photo upload can be in v0 at all.

## Source ownership

`services/worker/safety/`

## Public interfaces

- `record_consent(user, consent_version) -> ConsentRecord`
- `revoke_consent(user) -> DeletionRequest`
- `screen_upload(bytes) -> GateResult` — mandatory input gate, over bytes rather than a
  stored reference, because nothing is stored until it passes
- `screen_output(bytes) -> GateResult` — mandatory output gate (not yet built)
- `screen_brief(brief) -> GateResult` — text-level policy, including style mimicry
- `assert_age_affirmed(user) -> None` (not yet built)
- `mint_clearance(bytes, ...) -> SafetyClearance` — internal; the only way a clearance
  comes into existence

## Inputs and outputs

Inputs: images, briefs, user identity. Outputs: a pass or reject result carrying a stable reason
code. Reasons are specific enough to act on and never echo the offending content.

## Domain invariants

- SAFETY-INV-001: Both gates are active wherever real user data is handled and cannot be disabled
  by configuration in production (SEC-INV-006).
- SAFETY-INV-002: No photo is persisted or sent to a provider before passing the input gate
  (SEC-INV-007).
- SAFETY-INV-003: Consent is recorded before the first upload, with timestamp and consent-text
  version, and is revocable.
- SAFETY-INV-004: Revocation triggers deletion of the photo and every derived artifact
  (SEC-INV-004).
- SAFETY-INV-005: Upload requires age affirmation (SEC-INV-005).
- SAFETY-INV-006: Briefs naming a living tattoo artist as a style target are rejected
  (PROD-INV-004).
- SAFETY-INV-007: A gate failure, including provider unavailability, denies. It never falls open.

## Data / persistence

Consent records persist independently of photos and outlive them, as the evidence that processing
was lawful. They contain no image data.

## Dependencies

`contracts`.

Performs its own outbound moderation calls, which ARCH-INV-001 permits since TASK-0013.
The HTTP transport is a deliberate small duplicate of `generation`'s rather than a shared
import, so the gate cannot be disabled by a change or failure in the module it constrains.

**Not `media`.** The gate screens *bytes*, before anything is stored and before anything
reaches a provider (SEC-INV-007), so at the moment it runs there is nothing in `media` to
look at. The earlier declaration was both circular and contradicted the invariant it
existed to serve; see FINDING-0003.

## External integrations

A content-moderation provider, undecided. Must support both image and text classification.

## Error semantics

Gate results are values, not exceptions. Provider failure raises, and the caller must treat it as
a denial (SAFETY-INV-007).

## Security and permissions

Handles the most sensitive flows in the system. Reason codes and logs never contain image bytes,
signed URLs, or consent identifiers (SEC-INV-008).

## Observability

Gate pass and reject rates by reason code, provider latency and failure rate, consent and
revocation counts, deletion completion times. Rejection spikes are an alerting signal.

## Performance / operational constraints

The input gate is on the critical path of every upload; it must be fast enough not to dominate
perceived upload time, while never being skipped.

## Tests / verification

Every SEC-INV in the global spec maps to at least one automated test here. Fail-closed behavior is
tested by simulating provider outage. Test corpora use synthetic or licensed imagery only.

## Known uncertainties and debt

- **Classification accuracy is unmeasured.** Three synthetic images were screened
  correctly (TASK-0013). That is a smoke test, not a measurement. Unchecked cases include
  a drawing or statue of a person, a person reflected or partially in frame, a crowd in
  the background, and a pet photographed with its owner's hand visible.
- The prompt instructs the model to answer `true` when genuinely unsure, biasing toward
  refusal. Nothing measures how often that produces a false refusal of a legitimate pet
  photograph, and there is no appeal path when it does.
- Moderation cost is incurred per upload and is unbudgeted.
- `own_body_consented` bypasses the person check when the caller asserts consent. Nothing
  verifies that assertion; the guarantee is only as strong as whoever sets the flag.
- Consent records, age verification and the third-party-photograph question are not built.
  The agreed scope is pets and objects, where a user consents only for themselves.
- `screen_output` and `screen_brief` are specified but not implemented.
- Moderation provider is unselected; accuracy on body imagery is unmeasured.
- False-positive handling, such as a legitimate torso photo rejected as explicit, has no appeal
  path designed.
- The living-artist blocklist has no agreed source or maintenance process.
- Age affirmation is self-declared and therefore weak.

## Alignment notes

Partially aligned as of TASK-0012: the gate structure, the clearance type and
deny-by-default behaviour exist. Moderation itself does not.

`SafetyClearance` lives here, and this is the only module that may mint one. It sat in
`generation` during TASK-0004 purely because this module did not exist.

A clearance is bound to a SHA-256 digest of the exact bytes screened. A token meaning
merely "something passed" would let a caller screen a harmless image and then ingest a
different one, satisfying the type system while defeating SEC-INV-007 completely.

Forgery is blocked by a context flag set only inside `mint_clearance`, not by a field on
the dataclass. The field approach was tried first and was wrong: `dataclasses.replace`
copies fields, so a valid clearance could be cloned onto different bytes. A test covers
that specific attack.

## Change history

- 2026-09-26 (TASK-0032, ADR-0015/0016): Scouted open-web candidates must pass screening; the
  output gate and photo-egress-under-clearance become prerequisites for the mockup blend. No
  implementation yet.
- 2026-09-19: Created during SDD bootstrap.
- 2026-09-19 (TASK-0012): Gate structure, clearance type and deny-by-default
  implementation. Dependency on `media` removed, resolving FINDING-0003.
- 2026-09-19 (TASK-0013): OpenAI vision moderation provider and its transport. The gate
  can now pass a pet or object photograph and refuses one containing a person, verified
  against the real API.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| Gate denies without a provider | VERIFIED | 16 gate tests | PASS |
| Gate denies when a provider raises | VERIFIED | Exploding-provider test | PASS |
| No rejection ever carries a clearance | VERIFIED | Parametrised over every reject path | PASS |
| Clearance is bound to the screened bytes | VERIFIED | Digest-binding tests | PASS |
| Clearance cannot be forged or retargeted | VERIFIED | Direct construction and `replace` | PASS |
| Input gate actually moderates | VERIFIED | Live: pet and object passed, person refused | PASS |
| Every provider failure becomes a denial | VERIFIED | 4 failure modes through the gate | PASS |
| Malformed verdicts raise rather than default | VERIFIED | 9 malformed verdict shapes | PASS |
| Credential absent from logs and exceptions | VERIFIED | Log capture and exception strings | PASS |
| Classification accuracy | UNKNOWN | 3 synthetic images is a smoke test | NOT_RUN |
| Output gate exists | **NO** | Not built | NOT_RUN |
| Moderation accuracy on body imagery | UNKNOWN | Unmeasured | NOT_RUN |

## TASK-0019 current implementation and remaining intent

TASK-0019 adds an explicit own_body_consented input-gate exception for non-explicit body photographs, enabled only by the studio after adult/consent validation. Ordinary references still reject real people. Missing/moderation failures deny input. Provider-generated outputs are moderated before derivation. Provider data-retention contractual guarantees remain unverified and are not asserted by tests.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.
