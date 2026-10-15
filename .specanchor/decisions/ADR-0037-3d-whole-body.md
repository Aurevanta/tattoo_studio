---
type: adr
status: accepted
id: ADR-0037
created: 2026-10-15
extends: ADR-0033
---

# ADR-0037: Every tattooable zone can be seen in 3D, on one reference body

## Context

The 3D preview (ADR-0033, ADR-0034, ADR-0035) covers five zones: the calf, the shin and the ankle
on a lower leg, and the inner and outer forearm on a forearm. Those models carry each limb's
perimeter at every height, so a design is laid round them in true millimetres. The other 21
`bodyPart` zones have no 3D view.

The owner asked for it on the whole body, wherever a tattoo can go (INTENT, owner, 2026-10-15).
After the trade-offs were shown, they chose:

- one neutral reference body;
- the same CC0 MakeHuman base mesh;
- everything in one task.

The 21 zones do not share a shape:

- **Limbs:** the thigh, the upper arm, the wrist and the finger are limbs.
- **Broad surfaces:** the back, the chest, the stomach, the ribs, the hip, the shoulder and the
  collarbone curve gently.
- **Complex forms:** the neck, behind the ear, the hand and the foot bend in two directions.

## Decision

1. **One reference body, `public/models/body.glb`.** It is built by `scripts/build-body-model.py`
   from the `body` group of the MakeHuman `hm08` base mesh (CC0; source and hash as in TASK-0102),
   with one Catmull-Clark step, in millimetres, with the floor at y = 0. It has no genital helper
   and no clothing. Its scene extras carry, per zone, where the design goes and how it is laid.
2. **Two projections, each in millimetres, sampled and never redrawn** (MOCKUP-INV-001):
   - **Cylinder** (thigh, upper arm, wrist, finger): along a joint axis, with arc length measured
     at the skin's own distance from the axis. Across the skin it keeps millimetres to the extent
     that the limb is round.
   - **Plane** (all the others): from the zone's outward direction, as a decal. It is exact at the
     centre and stretches where the skin turns away. It is limited to skin facing the projector
     and to a depth slab round the zone, so it neither reaches the far side nor lands on an arm.
3. **The lower leg and the forearm keep their own viewer** (ADR-0033 to ADR-0035), because their
   sleeves and panels need the measured perimeter.
4. **The client may move the design over the zone and turn it.** The view starts on the zone, can
   be orbited, and offers the right or left side for paired zones and the three reference tones.
5. **Said where it is shown.**
   - Every zone: «Vista orientativa sobre un cuerpo de referencia, no el tuyo. El tamaño del diseño
     es real en el centro; donde la piel se curva, el dibujo se estira.»
   - The neck, behind the ear, the hand and the foot add a warning that the skin there bends more
     than any flat drawing.
6. **Loaded on demand, nothing sent.** The body is a public static file holding no client data.
   three.js and the model load only when the view opens. No photograph is read, and no provider is
   called.

## Alternatives considered

- **One model per zone, like the limbs.** Rejected: 21 builds and 21 files, with no gain for the
  surfaces that are not round.
- **UV-unwrapping the body and painting into the texture.** Rejected: the seams of a hand-made
  unwrap cut through zones, and millimetres would depend on the unwrap.
- **Masculine and feminine bodies.** Declined by the owner for now. This decision is revisited if
  clients ask for it.

## Consequences

- Every brief zone has a 3D view. Twenty-one use the body, and five keep the limb viewer.
- On strongly curved zones the preview is approximate, and it says so.
- The build depends on `base.obj`, downloaded and checked by hash, not committed.
