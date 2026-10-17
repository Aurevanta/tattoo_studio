---
type: finding
id: FINDING-0006
created: 2026-10-17
status: open
raised_by: TASK-0132
affects: [mockup]
---

# FINDING-0006: A changed letter in a heavy font escapes the local tile limit

## What was noticed

The geometry check's local limit (`min_tile_iou` 0.21, TASK-0087) was calibrated on the synthetic
corpus drawn with Pillow's bundled font: «AMOR» → «AMAR» gives a worst tile IoU of 0.20, caught.
The corpus preferred DejaVu Sans Bold when the system had it; on CI's Linux it does, and there the
same change gives 0.39 (ink IoU 0.78), which passes. The lowest faithful finish is 0.231, so the
limit cannot simply be raised to catch it. Evidence: VERIFIED by execution, 2026-10-17, cloud
session, all three skin tones:

| Font | `letter_changed` worst tile IoU | lowest faithful | at 0.21 |
|---|---|---|---|
| Pillow bundled (Aileron Regular) | 0.200–0.202 | 0.231 | rejected |
| DejaVu Sans Bold | 0.385–0.389 | 0.231 | **accepted** |

## Why it matters

An AI finish that changes one letter of bold lettering on a generated plate may pass the geometry
check and ship in the mockup (ADR-0018). The stencil is unaffected (it comes from the vector
master), and the mockup is labelled a visualization, but the check's promise is that a redraw is
refused. INFERRED: heavy, wide glyphs share most of their tiles with the original letter.

## Suggested resolution

Measure a text-aware or finer local metric (smaller tiles over ink, or edge-based tile matching)
against the corpus with several fonts, including bold ones, and real finishes sampled from
production. Until then, TASK-0132 keeps the corpus on the calibration font so CI tests the decided
tolerance deterministically; it does not claim the miss is fixed.
