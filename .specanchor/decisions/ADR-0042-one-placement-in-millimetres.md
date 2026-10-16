---
type: adr
status: accepted
id: ADR-0042
created: 2026-10-16
amends: [ADR-0036, ADR-0027]
---

# ADR-0042: The mockup and the 3D views place a design by the same millimetres

## Context

The owner, with two screenshots of one design on the upper back: on the mockup it sat on the right
shoulder blade at a modest size; the 3D view showed it centred and much larger. «Se ha de
representar igual en mockup y 3D en la primera propuesta y en las modificaciones posteriores; si
modifico el mockup se traslada la misma modificación a 3D y viceversa» (INTENT, 2026-10-16).

The two views measured differently (OBSERVED):

- The 3D views draw the design at its printed millimetres on a reference body (TASK-0109, ADR-0037).
- The mockup's plate was assumed to frame its zone so that the zone's reference height is 82 % of
  the picture (`SKIN_FRAME_FRACTION`), centred. The reviewed plates (ADR-0027) do not: the masculine
  upper-back plate shows the back from the hair to the waist, about 650 mm, where the rule assumed
  366 mm. Every offset read from the mockup was roughly halved in 3D, and the automatic fit to the
  silhouette (TASK-0039) re-centred and shrank designs further.
- An editor change was saved as a new version and only then read by the other view.

Asked, the owner chose: real millimetres rule (the stencil's and the 3D's), the plates calibrated
automatically and reviewed, the two editors in step live, and older designs keep their stencil.

## Decision

1. **Every library plate has a frame in millimetres**: the picture's width and height in
   millimetres of the reference body, and the zone's centre in it. It is measured once per plate
   (`app.build_plate_calibration`): the body's width profile along the zone on the 3D reference body
   of the plate's sex is matched to the silhouette's width row by row, for a scale and a centre
   row; where that fit is wrong (a hanging arm joins the torso) the silhouette's width at a reviewed
   row is matched to an adult reference width; one plate is estimated from its reviewed sibling. A
   plate framed tightly on a small zone (hand, finger, foot, wrist, ankle, neck, behind the ear,
   collarbone; the feminine sternum) keeps the 82 % convention, which is right for it. Every plate
   was reviewed on a contact sheet with its zone's rectangle drawn at the measured scale; the
   values are committed in `generation/plates/calibration.json` with the method used.
2. **Results are served with it**: `skinFrame` in `studio-status`, read from the current
   calibration when the status is served, for a generated skin (not an own photo, a camera capture
   or a sleeve). An uncalibrated plate's frame is the convention, marked `calibrated: false`.
3. **The worker lays a design at its millimetres**: on a plate with a frame, a first proposal is
   drawn at its visible artwork's millimetres on the zone's centre; a change that redraws it is drawn
   where its parent was; «Ocupar toda la zona» fills the zone in millimetres on the zone's centre.
   It is drawn as placed, clipped to the body's silhouette, and no longer re-centred or shrunk to
   it. The result records the placement (`transform.placement`) as an editor placement does.
4. **One starting placement, worker and browser alike**: on a skin with a frame, a result's
   placement starts from its printed millimetres (its centre and turn are its own). So a design
   composed before calibration opens at its printed size; saving that placement changes nothing
   printed (the owner's «respetar su plantilla»). The mockup's picture of such a version shows the
   old size until a new version is saved.
5. **The two editors share one placement**: while the mockup editor and a 3D view are open, they
   share one placement in the mockup's fractions, converted to millimetres from the zone's centre by
   the skin's frame. Moving, sizing or turning in either moves the other at once; either «Guardar»
   saves the same placement. On a limb, the 3D view's position round the limb is its own; the
   height, turn and size are shared.

## Consequences

- New mockups on large zones are smaller than before on the picture, because they are now at their
  millimetres on a picture that shows more of the body than was assumed. That is the point.
- A large design on a tightly framed plate can run past the picture's edge; it is clipped there in
  the mockup, and whole in 3D.
- The calibration is approximate: it measures the plate's person against the reference body, not
  anyone's body. Both views remain illustrative; the stencil's millimetres are the deliverable.
- A pre-library result (a generated skin from before TASK-0060) is read with today's library frame;
  it may not match its own skin. Such results are few and old.
- The nudge requests («más grande», «ampliar la cobertura») still change only the projection
  (ADR-0008), so on those versions the mockup's picture and the millimetres differ, as before.
  **Closed by ADR-0043 (TASK-0123):** a nudge now changes the millimetres and every view.

## Revisit conditions

- A new or regenerated plate needs its calibration re-run and reviewed (`--sheet`).
- If the reference bodies change (TASK-0110 models), re-run the calibration.
