---
type: adr
status: accepted
id: ADR-0035
created: 2026-10-15
---

# ADR-0035: A sleeve's stencil follows the limb and comes in four panels

## Context

ADR-0034 drew a sleeve as a rectangle as wide as the limb's widest circumference and printed it as
such. A lower leg is 34.4 cm round at the calf but 20.4 cm above the ankle (OBSERVED, measured on
the reference model). On the skin the rectangle runs out of room below the calf: the 3D view cut
the excess off, and the flat stencil could not be laid round the leg. A leg is also slightly
conical, so one unrolled sheet creases when it is wrapped round it.

The owner decided (INTENT, 2026-10-15) to use four panels, and to apply the same rule to the
stencil, the 3D view and the mockup.

## Decision

1. **Each row of a sleeve goes once round the limb at its own height.** The reference anatomy
   carries each sleeve region's circumference every 10 mm down its band
   (`circumferenceProfileMm`). It also carries the names of the limb's sides (`views`) and each
   zone's own side (`zoneAround`). These are measured on the 3D view's reference models.
   `circumferenceAt` (TypeScript) and `WrapRegion.circumference_at` (Python) interpolate the
   circumference in the same way.
2. **The stencil is the skin unrolled.** `stencil.sleeve.unroll` lays every row of the vector
   master at its height's circumference, centred. Strokes are densified so a long one bends with
   the limb. This unrolled skin is a sleeve's SVG and PDF.
3. **Four panels to transfer it.**
   - Each panel is a quarter turn, centred on a side of the limb, starting with the zone's own side.
   - Each overlaps its neighbours by at least 10 mm at the narrowest row.
   - Each carries dashed lines where its neighbours begin, a dotted centre line, ticks numbered
     «neighbour·n» every 50 mm, and its name («Panel 1 of 4: Detrás»).
   - On the right side the names are mirrored, as in the 3D view.
   - They come as one PDF (`panels`) and its mirror (`panelsMirror`): each panel at 1:1, then in
     A4 pieces (TASK-0088).
   - The result and the tattooer's link offer them.
   - Over a quarter turn the leg's conicity is about 1 mm, so a panel lies flat.
4. **The same rule everywhere.**
   - The 3D view maps a sleeve by its share of the turn (`wraps`) instead of by millimetres, so it
     shows what is printed.
   - The 2D mockup already tapers the visible half with the limb in the photograph (`fit_body`), so
     it needs no change.
   - The vector master is moved and cut, never redrawn (ADR-0003, PROD-INV-001).

This amends ADR-0034 (decision 4): the stencil is no longer the rectangle at 1:1.

## Consequences

- A sleeve's motifs narrow towards the ankle or wrist, as they do on the skin. A design drawn with
  even spacing shows it, and the tattooer adjusts by hand as with any sleeve.
- The panels belong to the reference limb, not the client's. On a different leg they need the
  tattooer's adjustment, and the PDF says the tattooer reviews it.
- The artifact and shared-design contracts gain two optional assets, which is additive.
