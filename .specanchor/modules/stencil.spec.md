---
type: module-spec
module: stencil
status: draft
source_paths:
  - services/worker/stencil/*
last_reviewed: 2026-09-19
---

# Module: stencil

TASK-0107 (ADR-0036): `rescale_axes` scales a vector master exactly per axis, with the stroke scaled by the geometric mean of the factors. At equal factors it equals `rescale`. It is used when the live editor widens or lengthens a design, so the stencil follows the mockup (PROD-INV-001). Never a retrace (ADR-0003).

TASK-0105 (ADR-0035): `stencil.sleeve`. `unroll` lays each row of a sleeve's master at the limb's circumference at its height, centred, with strokes densified. `panels` gives four quarter turns from the zone's own side (mirrored on the right), each overlapping its neighbours by at least 10 mm, with the neighbours' lines, a centre line and ticks numbered «n·k» every 50 mm. `export_panels_pdf` prints each panel at 1:1 and then in A4 pieces (TASK-0088). The master is moved and cut, never redrawn (ADR-0003).

TASK-0089: `backdrop.clear_backdrop` turns a smooth, light, border-connected backdrop covering ≥ 15 % of the artwork to white; white and dark grounds are untouched.

TASK-0088 (audit section 5): `export_pdf` adds A4 pieces (190 × 257 mm, 10 mm overlap, corner marks, position, calibration bar) after the full-size page when the design does not fit A4 (`tile_grid`).

TASK-0086: `Master.simplification` records the pass that succeeded; it is excluded from `design_hash`.

TASK-0071: a skeleton above `MAX_TRACE_POINTS` is traced again at coarser detail
(`LINEART_SIZES`, `COLOUR_PASSES`) before «Line-art demasiado complejo» is raised.

TASK-0024 (ADR-0008): the `Master` is persisted as a vector via `serialize_master` /
`deserialize_master`, and `rescale` performs an exact uniform scale to new millimetres. ADR-0007
makes the vector master authoritative, but only a 150 dpi raster of it was stored, so a resize
had no exact path. Re-tracing an already-traced raster is refused: it would re-apply
skeletonisation to lines that are already thin, which is the defect ADR-0003 rejected edge
detection for.

TASK-0019/REQ-011: colour artwork has deterministic RGB boundary extraction, centerline tracing
and physical fitting shared with its preview. The colour source digest joins the design identity.
This is an approximate review stencil, not verified exact semantic contour selection. AC-008 stays open.

## Responsibility

Produce the artifact a tattooer actually uses: clean, single-weight line art as vector, exportable
at true physical size for thermal transfer paper.

## Source ownership

`services/worker/stencil/`

## Public interfaces

- `render_linework(brief, design) -> LineArt` — a dedicated line-art generation pass
- `trace_to_vector(line_art) -> VectorStencil` — centerline tracing
- `export_stencil(vector, size_mm, mirrored, dpi) -> PrintAsset`

## Inputs and outputs

Input: the brief and its accepted design. Output: an SVG stencil and a print-ready PDF carrying
true physical dimensions.

## Domain invariants

- STENCIL-INV-001: Line art is produced by its own generation pass. It is NOT derived by edge
  detection or thresholding of the shaded flash render — that yields doubled contours and broken
  paths (ADR-0003).
- STENCIL-INV-002: Exports carry true physical dimensions and print at 1:1 with no scaling
  (PROD-INV-002).
- STENCIL-INV-003: Export resolution is at least 300 DPI at the stated physical size.
- STENCIL-INV-004: A mirrored variant is available for thermal transfer paper.
- STENCIL-INV-005: Traced output is single-weight centerlines. Open strokes are valid;
  forcibly closing them invents geometry (ADR-0007). Isolated fragments below 0.6 mm are
  filtered, while short junction edges remain connected. Reject if discarded length exceeds 10%.

## Data / persistence

Vector and print assets persist with the design version they belong to.

## Dependencies

`contracts`, `generation`, `media`, `jobs`.

## External integrations

Vector tracing library (candidates: vtracer, potrace with a centerline mode, or autotrace).
Selection is open; see uncertainties.

## Error semantics

Typed errors for: line-art generation failed, tracing produced degenerate geometry, requested
physical size outside supported bounds.

## Security and permissions

No user photographs. Stencils contain no personal likeness and therefore follow the design
retention lifecycle, not the photo lifecycle (see quality-and-security spec).

## Observability

Trace path counts, rejected-geometry rate, export size distribution.

## Performance / operational constraints

Tracing is CPU-bound and local; it must not require a GPU.

## Tests / verification

Golden-file tests over tracing with fixed inputs. Dimensional tests asserting that an exported PDF
measures exactly the requested millimetres. A physical print test is part of acceptance for
TASK-0005 and is human-run.

## Known uncertainties and debt

- Centerline vs outline tracing quality across styles is unproven; fine-line and blackwork will
  behave very differently.
- Whether hosted models can produce sufficiently clean line art is the key open risk.
- Minimum viable line weight for transfer paper has not been established with a real tattooer.

## Alignment notes

Implemented in `engine.py`: native line-art skeletonization and graph tracing, common master,
SVG/PDF in mm, mirror exports and 50 mm PDF calibration bar. The PDF page adds margins;
the stated design size is its canvas, not an assumption that ink fills every millimetre.
SVG/PDF are vector; the 150-DPI PNG is a preview, not the print master. Real transfer-paper
minimums and professional print acceptance remain NOT_VERIFIED.

## Change history

- 2026-09-19: Created during SDD bootstrap.

## Statement evidence
| Statement | Evidence status | Source / revision | Verification result |
|---|---|---|---|
| Native line-art pass, not edge detection | INTENT | ADR-0003 | NOT_RUN |
| 1:1 physical export at >=300 DPI | INTENT | Planning session 2026-09-19 | NOT_RUN |
| Tracing library suitability | UNKNOWN | Untested | NOT_RUN |

## TASK-0019 current implementation and remaining intent

engine.py skeletonizes dedicated native line art, retains graph junction connections, filters isolated paths under 0.6 mm, and rejects >10% discarded path length. SVG/PDF and the raster used by mockup share this authoritative geometry/hash. Fine/medium/bold widths are 0.25/0.35/0.6 mm proposals, not tattooer-approved thresholds. PDF page includes margins and a 50 mm calibration bar; physical printing remains NOT_VERIFIED.

Evidence: `.specanchor/evidence/TASK-0019/verification.md`. Earlier VERIFIED rows are historical.
The overall realistic-colour/anatomical product target remains PARTIAL; draft module status is retained.
