---
type: adr
status: accepted
id: ADR-0044
created: 2026-10-16
amends: [ADR-0003]
---

# ADR-0044: Two stencil regimes — native line art, and approximate contours of a colour design

## Context

ADR-0003 decided that a stencil comes from a native line-art pass and is never derived by edge
detection of a shaded render, and `stencil.spec.md` turned that into STENCIL-INV-001. The code has
done something else for colour and shaded designs since TASK-0019/REQ-011 (OBSERVED,
`stencil/engine.py`):

- **Line art** (black contour designs, no shading): the provider draws a dedicated flat line-art
  image; `trace_native_lineart` thresholds it, skeletonises it and traces centrelines. This is
  ADR-0003.
- **Colour or shaded designs** (`colour`, black-and-grey realism, any shading technique): there is
  no line-art pass. `trace_colour_artwork` runs Canny edge detection on each RGB channel of the
  single flat artwork the provider drew, skeletonises the edges and traces them. The artwork is not
  the skin mockup, but it *is* the shaded render — exactly what ADR-0003 rejected, for the reasons
  it gives (doubled contours, gaps, shading noise).

TASK-0019 called the second «an approximate review stencil», TASK-0086 recorded it as
`stencilReview.method: colour_contours` and the result view, the tattooer's link and the notice say
«contornos aproximados». The specs, ADR-0003 and the project's hard constraints still claimed one
native regime. The owner's audit list (2026-10-16, item 8): «Alinear las especificaciones con el
stencil real. Diferenciar claramente line-art nativo y contornos aproximados derivados de diseños a
color» (INTENT).

## Decision

1. **Two regimes, named.** `lineart` — traced from a dedicated native line-art pass (ADR-0003,
   unchanged). `colour_contours` — approximate contours derived by RGB edge detection from the flat
   colour or shaded artwork, for a design that has shading or colour.
2. **Never from the skin.** Both are traced from the flat artwork only, never from a mockup, a
   plate or a photograph; the geometry they produce is the authoritative master both regimes share
   with the mockup (ADR-0007, PROD-INV-001).
3. **Always labelled, down to the sheet.** A `colour_contours` stencil is labelled approximate
   wherever it appears: the result (`stencilReview.method`), the result view and the tattooer's link
   (already), and now the printed PDF — every page, A4 pieces and sleeve panels included — and the
   SVG's `<desc>`. A `lineart` stencil carries no such label.
4. **A colour design never gets a "native" claim.** Edge detection stays out of the `lineart`
   regime. Producing a native line-art pass for colour designs (a second provider image conditioned
   on the accepted artwork, as ADR-0003 describes) is the open alternative; until then the
   approximation is the product, stated as such.

## Alternatives considered

- **Drop stencils for colour designs.** Rejected: the tattooer still needs a placement guide; an
  honest approximation is more useful than none.
- **A second, line-art provider pass for colour designs now.** Not rejected: deferred. It doubles
  the paid images per design and needs its own acceptance (TASK-0130 covers what a tattooer accepts).

## Consequences

- STENCIL-INV-001 is split; CLAUDE.md's hard constraint names both regimes.
- A colour stencil's PDF gains two lines at the top of each page.
- Professional usability of either regime is unverified until TASK-0130 runs.

## Affected specs/modules

`stencil` (owner), `platform` (CLAUDE.md), `web` (unchanged labels), `contracts` (unchanged
`stencilReview`).
