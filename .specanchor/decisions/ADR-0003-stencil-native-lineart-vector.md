---
type: adr
status: proposed
id: ADR-0003
created: 2026-09-19
---

# ADR-0003: Stencil from a native line-art pass and centerline vector tracing

> **Amended by ADR-0044 (2026-10-16, TASK-0129).** This decision governs the `lineart` regime. A
> colour or shaded design has, since TASK-0019, a second regime: approximate contours by edge
> detection of its flat artwork, labelled as such everywhere, including the printed sheet.

## Context

The original proposal derived the stencil from the finished artwork with OpenCV edge detection and
thresholding. This does not survive contact with what a stencil actually is.

A tattooer prints the stencil onto thermal transfer paper and applies it to skin. It must be
clean, continuous, single-weight linework at exact physical size. Running Canny or an adaptive
threshold over a shaded render produces:

- **Doubled contours** — an edge detector finds both sides of every drawn line, so each line
  becomes two.
- **Broken paths** — gradients and shading interrupt detection, leaving gaps a tattooer must
  guess across.
- **Shading artifacts** — smooth tonal areas produce contour noise that is not linework at all.
- **Resolution lock** — raster output cannot be rescaled to a different physical size without
  degrading.

Edge detection answers "where does brightness change", which is not the same question as "where
did the artist draw a line".

## Decision

Produce the stencil as its own artifact, not as a derivative of the shaded render:

1. **Native line-art generation.** A separate generation pass, prompted and parameterized for
   clean single-weight linework, conditioned on the same brief and the accepted design so the two
   stay the same artwork.
2. **Centerline vector tracing.** Trace to SVG using centerline tracing, which follows the stroke
   itself rather than outlining both of its sides.
3. **Physical export.** Emit SVG and a print-ready PDF carrying true physical dimensions, at
   minimum 300 DPI at the stated size, with a mirrored variant for thermal transfer paper.

## Alternatives considered

- **Edge detection on the shaded render.** The original proposal. Rejected for the reasons above.
- **Outline tracing instead of centerline.** Simpler and better supported (plain potrace). Rejected
  as the default because it reproduces the doubled-contour problem in vector form. It may still
  suit solid blackwork, where filled shapes rather than strokes are the subject — this is left
  open per style.
- **Asking the model for an SVG directly.** Rejected: current models produce unreliable vector
  structure, and path quality is the whole point.

## Consequences

- Two generation passes per design instead of one, roughly doubling generation cost for the
  artwork path.
- A consistency obligation: the line art and the shaded render must depict the same design. The
  line-art pass is conditioned on the accepted design rather than generated independently, and
  divergence is a defect.
- A vector tracing dependency enters the stack (vtracer, potrace with centerline, or autotrace).
  Selection is open.
- Stencils become resolution-independent, so a user changing their mind about size costs nothing.

## Affected specs/modules

`stencil` (owner), `flash`, `generation`, `product-behavior`.

## Validation / revisit conditions

Validated in TASK-0005, which must show:

1. Hosted models produce line art clean enough to trace across the curated style list. Fine-line
   and heavy blackwork are the extremes to test.
2. Centerline tracing yields closed, single-weight paths with no double contours and no fragments
   below the minimum path length.
3. An exported PDF measures exactly the requested millimetres when printed — verified against a
   physical print and a ruler, not only in software.
4. A working tattooer confirms the output is usable on transfer paper.

Item 4 is the real acceptance test. If it fails, no amount of passing the other three matters.
