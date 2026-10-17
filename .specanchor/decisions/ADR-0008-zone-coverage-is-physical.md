---
type: adr
status: proposed
id: ADR-0008
created: 2026-09-22
---

# ADR-0008: A whole-zone coverage request sets physical size, not preview zoom

> **Amended by TASK-0073 (2026-10-01, audit UX-01).** The accepted millimetres are authoritative.
> A whole-zone phrase covers the zone on the skin only; the print size changes only through the
> explicit «Ocupar toda la zona» control, after the client confirms the new size.
>
> **Amended by ADR-0043 (2026-10-16, TASK-0123).** Nudges are no longer visual-only: «más grande» /
> «más pequeño» resize the print by ×1.25 / ×0.8 after a confirmation, and a phrase inside a redraw
> no longer changes the size on the picture alone.

## Context

TASK-0022 introduced coverage controls and decided they are *visual only*: they change how large
the artwork is drawn on the mockup and explicitly leave the millimetres in the brief, and therefore
the printed stencil, untouched. The notice the user receives says so in as many words:
`"las medidas del PDF siguen siendo las originales"`.

That decision is correct for the nudge controls (*smaller* / *larger*). It is wrong for a request
that names a body zone, and the failure is measurable.

### Measured behaviour (VERIFIED, 2026-09-22)

`mockup.placement.fit_coverage` caps coverage at `min(0.82, 0.82 * aspect / ratio)` — 82 % of the
*image frame*. `auto` is capped by the same ceiling. Run against the background geometry the system
actually requests (1024x1536, `generation/studio.py:206`):

| Requested height | `auto` height | `full` height | Change |
|---|---|---|---|
| 200 mm | 0.500 | 0.820 | +32 % |
| 300 mm | 0.750 | 0.820 | +7 % |
| **360 mm** | **0.820** | **0.820** | **0 %** |

At a realistic calf size the two branches return the identical number, for every artwork aspect
ratio tested (1.0, 1.5, 2.0, 2.5, 3.0). "Que ocupe todo el gemelo" is then a literal no-op. The
better the user states their size, the more completely the request is ignored.

Three distinct defects sit behind the reported symptom:

1. **The ceiling is a frame fraction.** There is no body segmentation, so 82 % is of the
   photograph, not of the calf. On a generated background this is roughly calibrated by accident —
   the background prompt asks for skin filling "the central 80 percent of the frame". On a user's
   own uncalibrated photograph it means nothing: the calf may occupy 40 % of the frame or 95 %.
2. **The millimetres never move.** The user's sentence is a statement about their body. It is
   routed to a control that by construction cannot change the deliverable.
3. **Phrase detection is a whitelist.** `que cubra el gemelo entero`, `que me coja todo el gemelo`,
   `de la rodilla al tobillo`, `que ocupe toda la pierna de arriba a abajo` and `que ocupe todo el
   brazo` all resolve to `None` (VERIFIED). `pierna` appears in the strict pattern but is missing
   from the fallback; arms are absent from both.

## Decision

**A coverage request that names a whole body zone is a statement about physical size and is
resolved in millimetres. The nudge controls remain visual-only and are unchanged.**

1. **Reference anatomy becomes an explicit, declared table.** `mockup/anatomy.py` holds a usable
   ink span in millimetres per `bodyPart` enum member. The artwork's aspect ratio is fitted inside
   that span, preserving aspect and maximising coverage, clamped to the contract's 5–600 mm bounds.
   The table is *reference adult anatomy*, labelled illustrative. It is not the user's measurements
   and is not presented as such.

2. **The brief's `size` changes, and therefore so does the stencil.** A zone request increments the
   brief revision and re-exports the stencil SVG and PDF at the new millimetres. The user is told
   the new size explicitly, in millimetres.

3. **The vector master is persisted as a vector.** ADR-0007 makes the shared vector master
   authoritative, but today only a 150 dpi raster of it is stored. Resizing therefore had no exact
   path. The `Master` (paths, mm, stroke) is persisted alongside the raster so a resize is an exact
   vector scale.

4. **The visual projection follows the millimetres wherever a scale reference exists**, and only
   falls back to a frame fraction when the framing is genuinely unknown — where it is labelled an
   estimate rather than a fit.

5. **Zone phrases are matched by vocabulary, not by a whitelist of sentences.** The Spanish noun is
   *not* mapped onto the `bodyPart` enum: the brief already declares the body part, and guessing
   whether "pierna" means `calf` or `thigh_front` would invent an answer the brief already holds.
   The phrase only has to establish *whole-zone intent*.

## Alternatives considered

**Leave it visual and merely raise the ceiling.** Cheapest, and it would make the control visibly
do something. Rejected: it does not change what the tattooer prints, so the user's actual request —
a tattoo that covers their calf — still goes unmet. It would replace a no-op with a cosmetic
change, which is arguably worse because it looks like it worked.

**Re-trace the stored master raster at the new millimetres.** Avoids persisting a vector. Rejected:
re-tracing an already-traced raster re-applies skeletonisation to lines that are already thin. That
is the same family of defect ADR-0003 rejected edge detection for, and it would degrade the stencil
on every resize.

**Segment the body and fit the real zone.** The only approach that makes "todo el gemelo" literally
true on an arbitrary photograph. Deferred, not rejected: it needs a segmentation model, it is the
subject of the existing depth/segmentation intent in `mockup.spec.md`, and it does not block
correcting the millimetres, which is the part the user actually receives.

**Ask the user for their calf measurement.** Most accurate. Rejected as the default because it puts
a tape measure between the user and a preview. It remains the right escape hatch, and calibrated
photographs (`photoWidthMm`) already take precedence over the table wherever present.

## Consequences

- **The printed deliverable changes as a result of a chat sentence.** This is the point of the
  decision, and it is the main risk. The new size is stated explicitly in the response and the
  operation is a new version, so the previous result stays available (TASK-0021).
- TASK-0022's "leaving PDF millimetres unchanged" no longer holds for zone requests. That clause is
  narrowed to the nudge controls rather than deleted, and the notice text must stop claiming the
  PDF is unchanged when it is not.
- A resize is still free of any generation call. No paid API call, no AI redraw, ADR-0007 intact.
- The reference table is a stated convention. Two users with the same body part get the same
  millimetres regardless of their actual build, which is wrong in the individual case and honest
  only because it is labelled.
- Storage grows by one small artifact per design.

## Affected specs/modules

`mockup`, `stencil`, `platform`, `web`. No change to `contracts`: `size` and `bodyPart` already
carry everything required.

## Validation / revisit conditions

- **Revisit if** a tattooer reports the reference spans are wrong in practice. The table is the
  cheapest thing in this decision to correct.
- **Revisit if** segmentation lands: the table then becomes the fallback for uncalibrated input
  rather than the primary source.
- **This decision is wrong if** users experience the size change as the system overriding them.
  Measure: the rate at which a zone request is immediately followed by a manual size correction.
  A high rate means the sentence should have opened a question instead of taking an action.
