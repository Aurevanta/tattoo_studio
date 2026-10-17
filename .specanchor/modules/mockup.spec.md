---
type: module-spec
module: mockup
status: draft
source_paths:
  - services/worker/mockup/*
last_reviewed: 2026-09-19
---

# Module: mockup

TASK-0132: `mockup.corpus` draws its lettering in Pillow's bundled font, the font `min_tile_iou` 0.21 was calibrated on, on every machine (a system DejaVu made CI measure another letter). A changed letter in a heavy font escapes the tile limit: FINDING-0006, open.

TASK-0123 (ADR-0043): a nudge resizes the print. `Coverage.nudges`, `NUDGE_STEP` (×1.25 larger, ×0.8 smaller) and `nudged_size` (whole millimetres, half up, within 5–600 mm, else `SIZE_LIMIT`). `fit_coverage` scales a previous projection by the same step. This supersedes «Nudge coverage stays visual-only» (TASK-0024, below).

TASK-0120 (ADR-0042): `convention_frame` (the 82 % framing, for a plate without a calibration) and `frame_placement` (a design's visible millimetres on a plate, as an editor placement). `parent_placement` and `manual_layout` take `size` and `skin`: on a skin with a frame the start is the printed size, the centre and turn the result's.

TASK-0107 (ADR-0036): `composite(..., manual=True)` renders a placement chosen in the live editor: centre, width and height before rotation as frame fractions, and an angle in degrees clockwise. The design is resized, turned, wrapped on the cylinder (the same order the browser uses), clipped to the frame and the silhouette, and never re-centred or shrunk. The transform records `placement`. `placement.manual_layout` and `parent_placement` derive the per-axis factors from the parent's visible artwork, bound the accumulated stretch to [0.75, 1.25] and refuse a size change on a calibrated photo. `coverage_request` maps `edit.placement` to `Coverage("manual", True)`. Geometric only (MOCKUP-INV-001).

TASK-0104 (ADR-0034): `anatomy` re-exports the sleeve rule (`WRAP_REGIONS`, `wrap_region`, `is_sleeve`) from `tattoo_contracts.sleeve`, so the consultation and the worker cannot disagree. The composite is unchanged; a sleeve's visible half is chosen by the platform.

TASK-0087 (audit ARQ-02, ADR-0018 amended): `worst_tile_iou` over a 4 × 4 grid and `min_tile_iou` (0.21 in `BLEND_TOLERANCE`); `mockup.corpus` is the synthetic validation corpus (`python -m mockup.corpus`).

TASK-0063: the fresh-ink composite separates the skin's surface light (`skin_light`: pore sparkle
and broad gloss, `SPARKLE` 0.45, `GLOSS` 0.6) from the diffuse light, darkens only the latter with
the pigment and adds the former back, so pores and gloss continue over the ink. Even skin gets the
previous result; the bare geometric composite stays a plain multiply. Like the surface term it moves
nothing (MOCKUP-INV-001).

TASK-0041: `MAX_SPILL` is 0.06 (was 0.02). A limb wraps, so the outermost ink of a whole-zone
design continues around its side out of view; the wider margin lets it fill the zone while the
feathered silhouette clip keeps the edge clean (checked on a real render to 12 %).

TASK-0040 (ADR-0018): `geometry.BLEND_TOLERANCE` (p95 ≤ 0.018 of the diagonal, ink IoU ≥ 0.62) is
the first decided tolerance, measured on the live Mestalla composite: GPT-Image 4/4 inside, FLUX.2
2/2 outside. It supersedes the TASK-0008 statement below that no tolerance is decided.

TASK-0039: `limb.py` reads the body's silhouette (chroma against a plain backdrop; `None` when not
confident). `composite(..., fit_body=True)` centres the design on it, takes the taper from it,
shrinks until at most `MAX_SPILL` (2 %) of the ink is off the body (floor `MIN_FIT_SCALE` 0.6),
then clips ink and fresh-ink redness to the silhouette, recording `bodyFit` in the transform. A
calibrated photo keeps its scale. Geometric only; the master and stencil are untouched
(MOCKUP-INV-001). This supersedes the TASK-0022 statement below that placement is not measured
body segmentation: it now is, for the silhouette, while `SKIN_FRAME_FRACTION` remains the fallback.

TASK-0035: whole-zone recognition (`placement.whole_zone_intent`) tolerates a one-letter slip in
the zone noun ("gemlo") and accepts "ocupe todo el <noun>" for any noun that is not an artwork
word ("todo el modelo"). A live request "que ocupe todo el gemlo" had been run as an artwork edit
at the old millimetres. ADR-0008 is unchanged: the noun is still never mapped onto `bodyPart`.

TASK-0008 (preparation): `geometry.py` is the MOCKUP-INV-002 method. It compares only the design
region recorded by `composite`, normalises each image against a heavy blur of itself so lighting
and tone changes do not count, finds ink as pixels darker than the surrounding skin, and reports
the 95th-percentile symmetric outline displacement (pixels and relative to the design diagonal)
plus ink-mask IoU. Anything unverifiable fails closed. `GeometryTolerance` has no default: its
values are TASK-0008's output. `GeometryCheck` implements the orchestration graph's geometry port.
Displacement is the primary criterion — IoU misses a removed element and is harsh on thin lines.

TASK-0032 (ADR-0016): the constrained AI blend is activated, lifting ADR-0007's interim
"no generative pass after placement" freeze for this module. `blend` becomes a real image-*editing*
pass over the geometric warp, run in the `orchestration` graph's `ai_blend` node through
`generation`. The geometric warp stays authoritative (MOCKUP-INV-001) and the geometry check
(MOCKUP-INV-002) fails the render when post-blend landmarks move beyond the ADR-0002/TASK-0008
tolerance. The body photo reaches the blend provider only with a `SafetyClearance`, under adult
consent, EXIF-stripped, over TLS, and only to a no-training/no-retention provider (ADR-0006). The
generated output passes the safety output gate before storage/display. The stencil is unaffected:
it stays the native centerline vector of the master (ADR-0003), never derived from the blended
render. Until a provider passes TASK-0008, the module keeps the geometric-only path as the
labelled fallback (PROD-INV-005) — the blend does not ship unguarded.

The creator's finish target (user request 2026-09-26) is an on-body result that reads
**hyperrealistic and freshly applied** — crisp saturated ink with the sheen and surrounding redness
of just-tattooed skin. The "freshly applied" look is already produced geometrically by the
`fresh=True` composite (ADR-0014 fresh-ink halo); the blend deepens the realism as its editing
instruction (`orchestration.FRESH_TATTOO_FINISH`) without altering the design (MOCKUP-INV-001). It
is a finish target, not a prediction of healing: outputs stay labelled illustrative
(PROD-INV-005, MOCKUP-INV-004).

TASK-0031 (ADR-0014): the fresh-ink halo is a ring — the ink coverage is subtracted from the
dilated mask — because the warmth belongs on skin, not pigment. Without it, mid-grey shading
lets the tint through and the whole design goes warm. `DEFAULT_FRESHNESS = 2.0`.

Surface form is expressed as **attenuation, never displacement**: where the photograph's own
blurred luminance says the body turns away, the ink's opacity is reduced. `DEFAULT_SURFACE =
0.35`, applied to every zone rather than only the cylinder's limbs, because it is read from the
photograph rather than assumed. A displacement field was built and measured first and is
rejected: any strength that reads as curvature also deforms the subject, which MOCKUP-INV-001
forbids. This is not recovered depth, and a flatly lit photograph yields no form and therefore
no effect.

TASK-0027 (ADR-0011): `anatomy.py` no longer declares the reference spans. They are canonical in
`contracts/reference/body-zones.json` and read from the packaged copy, so the consultation and
this module resolve a size from the same numbers rather than two tables that can drift. The
module gains `SIZE_SCALES`, the fraction of a zone a qualitative size claims.

TASK-0024 (ADR-0008): a coverage request naming a whole body zone is resolved in millimetres
from `anatomy.ZONE_SPAN_MM`, declared reference adult anatomy covering every `bodyPart` enum
member. The artwork's visible aspect is fitted inside the zone span, preserving aspect — which
enlarges a design the zone can hold and shrinks one it cannot, because distorting the artwork
would break MOCKUP-INV-001. `fit_coverage` no longer caps `auto` and `full` against a shared
frame fraction: for both, the projection is a function of the resolved millimetres alone, so a
zone request can no longer collapse onto `auto`. Nudge coverage stays visual-only and never
touches the brief. The reference table is a stated convention, identical for every user
regardless of build; a calibrated photograph supersedes it.

TASK-0023 corrects TASK-0022's canvas-only coverage: automatic/full uncalibrated placement
fits visible nonwhite artwork, preserving its aspect ratio. Exterior white padding is
cropped only in the projection, with sourceCropPx recorded. Original master and print
assets remain unchanged. Calibrated/manual physical projection retains the full canvas.

TASK-0022: coverage presets fit a centered placement within 82% of the uncalibrated image
frame, retaining aspect ratio. Automatic generated-calf coverage responds to millimetres
using an illustrative 400 mm vertical frame, capped to image bounds. It is not measured
body segmentation or a real-scale guarantee. Calibrated photos reject visual-only scaling.
Bounded Spanish whole-calf coverage phrases and explicit controls resolve local placement;
mixed content changes retain image editing. Pure coverage reuses exact master/print assets.

TASK-0020/REQ-004 extends the active renderer with deterministic pigment blending,
subpixel edge softness, restrained warmth/sheen and a recorded cylindrical approximation
on limbs (1.05 radians), with a 0.25 quadratic taper for calves and curved transverse
rows. A dilated/blurred ink mask creates localized surrounding redness, while pigment
retains the photograph's illumination and texture. These are explicit illustrative
presets, not recovered anatomy. Own photos stay local. No generative redraw. Hyperrealism needs
visual acceptance; no claim of recovered anatomy from a flat photograph.

## Responsibility

Place an accepted design onto a body — a user photograph or an anatomical preset — so it reads as
ink under skin rather than a sticker. Also produces the healed and aged illustrations.

## Source ownership

`services/worker/mockup/`

## Public interfaces

- `estimate_surface(photo) -> SurfaceModel` (depth, normals, segmentation mask)
- `warp_design(design, surface, placement) -> WarpedDesign`
- `blend(warped, photo, options) -> Mockup` — constrained AI pass for skin integration
- `simulate_age(mockup, stage) -> Mockup` — stage is one of fresh, healed, aged

## Inputs and outputs

Input: an accepted `Design`, a `Placement`, and either a screened user photo or a preset.
Output: a `Mockup` naming the design version and placement it rendered.

## Domain invariants

- MOCKUP-INV-001: The geometric warp is authoritative for design shape. The AI blend pass is
  constrained to skin integration, lighting and texture; it may not alter design geometry
  (PROD-INV-001).
- MOCKUP-INV-002: Design geometry in the final mockup stays within the tolerance defined in
  ADR-0002 when measured against the pre-blend warp. Exceeding it fails the render.
- MOCKUP-INV-003: Placement respects the brief's millimetre size relative to the body part.
- MOCKUP-INV-004: Aging and healing outputs are labeled illustrative, never predictive
  (PROD-INV-003).
- MOCKUP-INV-005: A user photo reaches this module only after passing the safety input gate.

## Data / persistence

Mockups derived from a user photo share that photo's retention lifecycle and are deleted with it
(SEC-INV-004).

## Dependencies

`contracts`, `generation`, `media`, `safety`, `jobs`.

Sequenced by the `orchestration` module at generation time (TASK-0032): this module exposes the
same callables and orchestration owns their ordering. That is an inbound edge (orchestration
depends on mockup, not the reverse), so it is stated here as prose rather than as a dependency.

## External integrations

Depth and segmentation models (candidates: Depth Anything class, SAM class), run locally.
The blend pass goes through `generation`.

## Error semantics

Typed errors for: surface estimation failed, no suitable skin region found, placement outside the
detected region, geometry tolerance exceeded, blend rejected by the output safety gate.

## Security and permissions

This module handles sensitive personal data. Photo bytes are held only for the duration of the
job. Logs never contain image data or signed URLs (SEC-INV-008).

## Observability

Tolerance-failure rate, surface-estimation failure rate, blend latency, stage usage.

## Performance / operational constraints

The most expensive path in the system: local depth estimation plus a hosted blend call.
Asynchronous, with a job budget set alongside the queue choice.

## Tests / verification

Geometry-tolerance tests comparing pre- and post-blend landmarks on a fixed photo corpus.
Warp tests are deterministic and offline. The corpus uses consented or synthetic imagery only —
never retained user uploads.

## Known uncertainties and debt

- ADR-0002 is unvalidated. TASK-0008 is a spike that may overturn it in favour of geometric-only
  blending. This is the largest architectural risk in the project.
- The numeric geometry tolerance is not yet defined; TASK-0008 must define it.
- Aging simulation is a filter stack, not a physical model, and is understood as such.
- Hair, scars, existing tattoos and extreme poses are unhandled cases.

## Alignment notes

`engine.composite` implements a deterministic planar resize/placement and multiply blend of
the shared master. It records pixel bounds and calibration status, and rejects out-of-frame
placement. There is no AI redraw after placement. Depth, segmentation, cylinder/surface warp,
realistic shading, healing and aging remain INTENT. This is a geometry-preserving proposal,
not evidence that the full anatomical/photorealistic target has been achieved (ADR-0007).

## Change history

- 2026-09-26 (TASK-0032, ADR-0016): Activated the constrained AI blend, lifting ADR-0007's interim
  geometric-only freeze; geometry check and the geometric-only fallback remain mandatory. Sequenced
  by the new `orchestration` module. No implementation yet.
- 2026-09-19: Created during SDD bootstrap.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| Hybrid warp-then-blend pipeline | INTENT | ADR-0002; user decision 2026-09-19 | NOT_RUN |
| AI blend preserves geometry within tolerance | UNKNOWN | Spike TASK-0008 pending | NOT_RUN |
| Geometry method separates skin integration from moved/redrawn designs | VERIFIED (synthetic only) | `tests/test_geometry.py` 8 tests; TASK-0008 self-test `SEPARATES` | PASS |
| Aging is illustrative only | INTENT | Planning session 2026-09-19 | NOT_RUN |

## TASK-0019 current implementation and remaining intent

engine.composite performs planar resize/placement and multiply compositing only; transform bounds and whether photo-width calibration was supplied are recorded. There is no generative geometry change after placement. The current path does NOT implement surface curvature, depth/segmentation or realistic tattoo shading. Keep those original product requirements open.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.
