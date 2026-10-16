---
type: adr
status: accepted
id: ADR-0043
created: 2026-10-16
amends: [ADR-0008, ADR-0042]
---

# ADR-0043: A size change is a print change, confirmed, and every view follows it

## Context

The owner's audit list (2026-10-16, item 1): «Unificar el tamaño del tatuaje. "Más grande", los
controles del editor y "Ocupar toda la zona" deben actualizar de forma coherente mockup, 3D y
plantilla, confirmando las nuevas medidas» (INTENT).

What the studio did (OBSERVED in `app/studio.py`, `mockup/placement.py`, 2026-10-16):

- The live editors (2D and 3D) and «Ocupar toda la zona» already change the printed millimetres,
  after a confirmation that names them; the stencil, the PDFs and the 3D view follow (TASK-0107,
  TASK-0073, ADR-0042).
- A typed size nudge («hazlo más grande», «un poco más pequeño», or `coverage: larger|smaller`)
  scaled the mockup's projection by 1.35 or 0.75 and kept the millimetres (ADR-0008). Since
  ADR-0042 the 3D view draws a design at its millimetres, so after a nudge the mockup showed one
  size and the 3D view and the stencil another. ADR-0042 recorded this gap under *Consequences*.
- A whole-zone phrase mixed with a drawing change («añade rosas y que ocupe todo el gemelo») was
  redrawn and then projected to fill the zone on the mockup, while the millimetres stayed (TASK-0073):
  the same disagreement.

## Decision

1. **One size.** The printed millimetres are the only size. No request changes the size drawn on
   the skin without changing them, and every view (mockup, 3D, stencil, PDF) is laid at them.
2. **«Más grande» / «Más pequeño» resize the print** by a fixed step, ×1.25 and ×0.8 (inverse of
   each other, so one undoes the other up to whole-millimetre rounding), keeping the proportions.
   The new millimetres are `floor(mm × step + 0.5)` on each axis, the same rule in the browser and the
   worker, within 5–600 mm. The vector master is rescaled exactly and the stencil and PDFs
   re-exported (ADR-0008 §3); nothing is redrawn and no provider is called. On a plate with a frame
   the mockup is laid at the new millimetres where the design was (ADR-0042); elsewhere the previous
   projection is scaled by the same step. A design without a stored vector (before TASK-0024) is
   refused rather than enlarged on the picture alone. A calibrated photo is refused, as before.
3. **Confirmed first.** The result view recognises a change request that is only a size nudge and
   opens the same confirmation as the editors and «Ocupar toda la zona»: the current and the new
   millimetres, and that the stencil and PDFs will be re-exported. A confirmed nudge is sent as
   `coverage: larger|smaller`. The worker refuses a nudge written without that control
   (`SIZE_NEEDS_CONTROL`), as it already refuses a bare whole-zone phrase (`ZONE_NEEDS_CONTROL`).
   No buttons return: the live editor remains the main size control (ADR-0036).
4. **A phrase in a drawing change does not move the size.** A whole-zone or size phrase mixed with
   a drawing change keeps the millimetres (TASK-0073) and the new drawing is laid at them; the
   notice says to use the size controls.

## Alternatives considered

- **Keep nudges visual and label them.** Rejected: it is the disagreement the owner reported.
- **Restore the «Más grande» / «Más pequeño» buttons.** Rejected for now: ADR-0036 replaced them with
  the live editor, which does the same with a visible result before saving.
- **Resize the print silently on a typed nudge.** Rejected: TASK-0073 requires a size change to be
  shown and confirmed before it is applied.

## Consequences

- A typed «más grande» now produces a stencil 25 % larger, after a confirmation; before, the PDF was
  untouched. The step differs from the old projection factors (1.35 / 0.75).
- A version made before TASK-0024 cannot be nudged; it can still be redrawn or placed in the editor.
- Versions created by a nudge before this decision keep their mismatched mockup; a new save fixes it.

## Affected specs/modules

`mockup` (`Coverage`, `fit_coverage`, `nudged_size`), `platform` (`Studio.reposition`, the jobs
endpoint), `web` (result view), `product-behavior` (size survives end to end).
