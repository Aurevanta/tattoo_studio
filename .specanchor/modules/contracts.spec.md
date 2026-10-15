---
type: module-spec
module: contracts
status: draft
source_paths:
  - contracts/*
last_reviewed: 2026-09-19
---

# Module: contracts

TASK-0110 (ADR-0038): each wrap region in `body-zones.json` gains `bodies.{masculine,feminine}.circumferenceProfileMm`, measured on the masculine and feminine limbs (same band and step). `circumferenceAt(region, depth, bodyType?)` (TS) and `WrapRegion.circumference_at(depth, body_type)` / `for_body` (Python) read them and fall back to the neutral profile. `BodyType` is exported. The artifact's `placement` admits `bodyType`; the fixture `zone-with-body-type` becomes `zone-with-subject`. Additive.

TASK-0108: the artifact in `studio-status` gains an optional `placement`, `{bodyPart, orientation, side?}`, which is where the design goes and nothing else from the brief. The change is additive. Fixtures: `with-zone` and `zone-with-body-type`.

TASK-0107 (ADR-0036): `studio-job.edit.placement` and the result's `edit.placement` are `{centreX, centreY, width, height, angle}`, with centres in [0, 1], sizes in (0, 2] and the angle in [-180, 180]. `studio-status.transform` gains `placement` (same shape) and `stretch` (0.75–1.25). All of it is additive (CONTRACTS-INV-004). Fixtures: `edit-manual-placement` and `edit-placement-angle` (studio-job), and `manual-placement` and `stretch-too-far` (studio-status).

TASK-0105 (ADR-0035): each `wraps` region gains `circumferenceProfileMm` (every `profileStepMm`, 10 mm, down its band, measured on the reference models), `views` and `zoneAround`. `circumferenceAt` (TypeScript) and `WrapRegion.circumference_at`/`side` (Python) read them alike. `studio-status.artifact` and `shared-design` gain optional `panels` and `panelsMirror`; the `shared-design` fixture `sleeve-panels` is added.

TASK-0104 (ADR-0034): `reference/body-zones.json` gains `wraps` (`lower_leg`: calf and shin, 344 × 310 mm; `forearm`: inner and outer forearm, 255 × 215 mm) and `wrapNotes`. `WRAP_REGIONS`, `wrapRegionOf`, `wrapSize`, `SLEEVE_SHARE` and `isSleeve` (TypeScript) and `tattoo_contracts.sleeve` (Python) apply the same rule: wrapping, a zone in a region, a width of at least 90 % of its circumference. `studio-status.stage` gains `seam`. All of it is additive (CONTRACTS-INV-004).

TASK-0097 (ADR-0032): `shared-design.schema.json` — what a link shows a tattooer; never a body photo, capture, body type or account; the skin view null unless on generated skin. Corpus 6 valid / 16 invalid; registered in both runtimes.

TASK-0086 (audit ARQ-03): `studio-status` artifact may carry `stencilReview` {method: lineart | colour_contours, simplification: 0–3}. Fixtures `stencil-review`, `stencil-review-unknown`.

TASK-0076 (audit UX-03): `studio-status` has optional `stage` (references, skin, drawing, stencil, placing, finishing) and `queuePosition` (≥ 1). Fixtures `running-stage`, `queued-position`, `unknown-stage`, `queue-position-zero`.

TASK-0065 (ADR-0029): `subject.refined` (optional string, 1–1200) in `tattoo-brief` and in the brief
`studio-job` embeds. Fixtures `valid/subject-refined.json`, `invalid/subject-refined-too-long.json`.

TASK-0058 (ADR-0026): `studio-job.referenceIds` may be empty; a generic idea is drawn from the
brief. The former `invalid/empty-refs.json` is now `valid/no-references.json`.

TASK-0057: `studio-job`'s embedded `styleName` gains the six styles TASK-0027 added to
`tattoo-brief` only. Until then every job in those styles was refused by the web tier with "Revisa
las referencias, la posición y las medidas." A corpus test now requires the embedded brief and its
shared definitions to equal `tattoo-brief`'s. Fixture `studio-job/valid/widened-style.json`.

TASK-0050 (ADR-0022): `studio-status` artifacts admit an optional `capture` —
`{ parentJobId, photo: { assetId, designId, mimeType: image/jpeg | image/png } }` — for a camera
try-on photograph kept as a version of an unchanged design. `photo` has its own definition because
own-body photographs are stored as JPEG, which the shared `asset` type does not admit; widening
`asset` would have admitted JPEG for stencils and masters too. Fixtures `valid/camera-capture.json`
and `invalid/capture-without-photo.json`. Additive: every existing artifact stays valid.

TASK-0041: `placement.bodyType` ("masculine"|"feminine", optional) in both `tattoo-brief` and
`studio-job` (the job embeds its own copy of the brief). Fixtures `placement-body-type` (valid) and
`body-type-outside-vocabulary` (invalid).

TASK-0040 (ADR-0018): in `studio-status`, `transform.generativePostprocess` becomes a boolean that
may be true only with `finish: "accepted"`; `finish` and `bodyFit` (TASK-0039) are admitted.
Fixtures: `valid/blended-finish.json`, `invalid/generative-without-accepted-check.json`;
`invalid/redrawn-geometry.json` stays invalid.

TASK-0036: `edit.referenceIds` (1–3 asset IDs) in `studio-job` and `studio-status`: photos a
client attaches to a change request. Only IDs travel; the worker checks ownership.

TASK-0031 (ADR-0014): the studio-status `transform` records `freshness` and `surface` beside
`curvature` and `taper`, for the same reason those are recorded: a render should say what was
done to it. `surface` is an attenuation in 0..1, explicitly not a displacement.

TASK-0028 (ADR-0012): `contracts/reference/style-library.json` holds the style catalogue — one
visual-characteristics phrase per style and three described variants — copied byte-identically
into the Python package and exported to TypeScript as `STYLE_CATALOGUE`. The phrase is held here
rather than in `flash/prompt.py` so the string shown to a client, the string that generated the
catalogue image, and the string sent for their tattoo are the same one.

TASK-0027 (ADR-0011): `styleName` grows from ten entries to sixteen with `tribal`, `geometric`,
`watercolour`, `new_school`, `chicano` and `biomechanical`. The vocabulary stays closed;
`tribal_freehand` remains the out-of-vocabulary fixture. `contracts/reference/body-zones.json`
is new canonical data — the reference spans of ADR-0008 plus the fractions a qualitative size
claims — copied byte-identically into the Python package by its generator and imported by
TypeScript, so the consultation and the worker cannot resolve a size from different numbers.
Three tests cover it: byte identity, one span per `bodyPart`, and spans within the contract's
millimetre bounds.

TASK-0023: transform optionally records sourceCropPx {left, top, width, height} for the
uncalibrated mockup projection, in original master pixels; legacy results stay valid.

TASK-0022: optional edit coverage enum larger/smaller/full and mode artwork/placement
are shared by studio-job and artifact provenance. Existing edit requests remain valid.

TASK-0020/REQ-004: studio-status adds fresh-ink-composite to the transform method enum
and optional bounded curvature (0..1.2 radians) and taper (0..0.35). Existing geometric-multiply remains valid.
Generated TS/Python copies and runtime validation share this canonical schema.

TASK-0021: studio-job optionally carries edit {parentJobId, instruction}; instructions are
3..1000 characters, trimmed at HTTP entry. Studio-status artifacts optionally carry edit
provenance and a retained background asset. Legacy results without these fields stay valid.
Parent brief revision increments per branch; design IDs continue to identify visual masters.

## Responsibility

Own every schema that crosses a module boundary. `TattooBrief` is the system's central contract:
the consultation produces it, and all three engines consume it.

## Source ownership

`contracts/` — JSON Schema files, the shared fixture corpus, and generated type artifacts.

## Public interfaces

Schemas:
- `schemas/tattoo-brief.schema.json` — the brief. **Exists** (TASK-0002), version `1.0.0`.
  Placement and size are embedded rather than extracted, until a second consumer exists.
- `schemas/design.schema.json` — generated artwork and its lineage. **Exists**
  (TASK-0004), version `1.0.0`. Records the brief revision that produced it
  (CONTRACTS-INV-003) and carries raster pixels without ever carrying millimetres.
- `job.schema.json`, `consent.schema.json` — planned, not built.

TypeScript (`@tattoo/contracts`):
- `validateTattooBrief(payload)` — returns every issue rather than throwing.
- `assertTattooBrief(payload)` — validates or throws `TattooBriefValidationError`.
- `TattooBrief`, `StyleName`, `BodyPart` — generated types.

Python (`tattoo-contracts`):
- `validate_tattoo_brief(payload)`, `is_valid_tattoo_brief(payload)`,
  `assert_tattoo_brief(payload)`, `tattoo_brief_schema()`.

**Authority versus ergonomics.** The validating authority in both runtimes is the schema
document itself, run through `ajv` in TypeScript and `jsonschema` in Python. Generated
artifacts — TypeScript interfaces and pydantic models — are for editor support and FastAPI
and are never consulted for a verdict. They cannot express the schema's conditional colour
rules, so a generated validator would silently accept payloads the schema rejects.

## Inputs and outputs

Inputs: none at runtime. Outputs: a validation verdict in either runtime, plus generated
types for editor support. See the authority note above; `zod` was considered and rejected in
the ADR-0004 refinement.

## Domain invariants

- CONTRACTS-INV-001: `TattooBrief` carries size in millimetres. Pixel dimensions are derived, never
  authoritative.
- CONTRACTS-INV-002: `style` is drawn from the closed curated vocabulary in the product-behavior
  spec; free text is not accepted in this field.
- CONTRACTS-INV-003: A `Design` records the brief revision that produced it.
- CONTRACTS-INV-004: Schema changes are additive, or carry an explicit version bump and migration.

## Data / persistence

None. This module defines shape, not storage.

## Dependencies

None (ARCH-INV-002).

## External integrations

None.

## Error semantics

Validation failures raise a typed error naming the schema, the failing path and the received type.

## Security and permissions

No secrets. Schemas must not require free-text fields that invite personal data where a
structured field would do.

## Observability

Validation failure counts by schema and field, to detect drift between the two runtimes.

## Performance / operational constraints

Validation is on every boundary crossing; it must stay negligible relative to a queued job.

## Tests / verification

One shared fixture corpus (valid and invalid cases) executed by both the TypeScript and the
Python validator. Divergence between them fails the build (ARCH-INV-005).

## Known uncertainties and debt

- `TattooBrief` now has a real consumer: the flash engine reads every field it defines.
  That closed the "no consumer" gap but surfaced a new one — see FINDING-0002, where a
  brief can validate and still be unrenderable because dimension bounds say nothing about
  the ratio between them.
- `Design` has no consumer yet. Whether its fields are the right fields is untested until
  the stencil and mockup engines read it.
- The vocabulary lists (10 styles, 26 body parts) were assembled without a practising tattooer's
  review. They are plausible, not authoritative.
- Size bounds of 5mm to 600mm are a judgement call, not a measured constraint.
- `design`, `job` and `consent` schemas do not exist.
- Fixture parity is asserted on accept-or-reject, not on which rule fired. Two runtimes could in
  principle reject the same payload for different reasons without the corpus noticing.

Resolved in TASK-0002: the generation mechanism (`json-schema-to-typescript` and
`datamodel-code-generator`, both committed) and the field-level content of `TattooBrief`.

## Alignment notes

Aligned as of TASK-0002 for `TattooBrief`. The remaining schemas named under *Public interfaces*
are declared ahead of the code that will own them.

Two parity hazards were found while implementing and are handled in the schema rather than left
to chance. `format` is assertive only when a format checker is wired up, and the ecosystems wire
it differently, so patterns are used instead. Python's `re` matches Unicode digits with `\d`
while JavaScript's does not, so every pattern spells out `[0-9]` — otherwise a timestamp with
Arabic-Indic digits would validate in Python and fail in TypeScript.

## Change history

- 2026-09-19: Created during SDD bootstrap.
- 2026-09-19 (TASK-0002): `TattooBrief` 1.0.0 defined; dual-runtime validation against the one
  schema document; 28-case shared corpus; generated artifacts committed with a reproducibility
  check.
- 2026-09-19 (TASK-0004): `Design` 1.0.0 added with a 24-case corpus. Validation generalised
  over a schema registry, so a new schema is covered by the corpus the moment it is
  registered. `py.typed` added — without it mypy treated this package as untyped in every
  consumer, silently disabling checking across the system's most important boundary.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| Schema is valid JSON Schema 2020-12 | VERIFIED | Metaschema test | PASS |
| Both runtimes agree on all 28 fixtures | VERIFIED | 33 TS tests, 36 Python tests | PASS |
| Packaged schema copy is byte-identical | VERIFIED | Byte-comparison test | PASS |
| Codegen is reproducible | VERIFIED | Regenerate, then `git diff --quiet` exit 0 | PASS |
| Divergence is detected, not assumed | VERIFIED | Injected drift failed 2 tests | PASS |
| Design corpus agrees across runtimes | VERIFIED | 24 cases, both runtimes | PASS |
| Brief is the central contract | OBSERVED | Flash engine consumes every field | PASS |
| Brief dimension bounds imply renderability | **FALSE** | FINDING-0002 | FAIL |
| Design field set is the right field set | UNKNOWN | No consumer yet | NOT_RUN |

## TASK-0019 current implementation and remaining intent

studio-job.schema.json and studio-status.schema.json now own studio request and result boundaries. TS and Python run their canonical schemas; generated types do not decide validity. Shared positive/negative corpora include readiness, ownership ID shapes, physical size, status/result consistency and no automatic fidelity certification.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.

TASK-0019/REQ-010: Palette is optional for colour and accents. Missing palette delegates selection to the design process using the idea and reviewed references; it is not a missing client answer. Empty panel input is omitted. Explicit palettes remain bounded and validated. Colour rendering remains pending.
