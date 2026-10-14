---
type: adr
status: accepted
id: ADR-0034
created: 2026-10-14
---

# ADR-0034: A sleeve goes all the way round a lower leg or a forearm

## Context

The owner asked for wrap-around pieces, «un tatuaje que cubra toda la pierna izquierda desde la
rodilla hasta abajo», seen from every side. ADR-0033 added the 3D view on a reference lower leg.
For phase 2 the owner decided three things (INTENT, 2026-10-14):

- **Measurements:** reference measurements only. The client is not asked to measure.
- **Seam:** an extra generator pass repairs the seam, and the sleeve counts as one more design.
- **Zones:** the lower leg and the forearm.

Before this decision, `orientation: "wrapping"` existed in the brief, but nothing downstream used it.
A design was a flat motif of at most a zone's front span, and the 2D mockup covers about 180° of a
limb (OBSERVED).

## Decision

1. **A sleeve is wrapping and wide enough to go round.**
   - Its zones and its size come from the reference anatomy (`body-zones.json`, `wraps`):
     - Lower leg (`calf`, `shin`): 344 × 310 mm.
     - Forearm (`inner_forearm`, `outer_forearm`): 255 × 215 mm.
   - A brief is a sleeve when its orientation is `wrapping`, its zone is in a region, and its width
     is at least 90 % of that circumference. Both runtimes apply this rule: `isSleeve` in
     TypeScript and `tattoo_contracts.sleeve.is_sleeve` in Python.
   - A band «alrededor del tobillo» wraps too, but it is narrow, so it is drawn as any other design.
   - The measurements are those of the 3D view's reference limbs (ADR-0033). The forearm is scaled
     uniformly to a 265 mm elbow-to-wrist length, a typical adult's.
2. **Only the client's words make a sleeve.**
   - The consultation reads «manga», «de la rodilla al tobillo», «todo el antebrazo», «que rodee…»
     and similar phrases. It then sets the orientation and the zone (the calf or the outer forearm
     by default) and gives the sleeve its size.
   - «Estilo manga» is the comic style. The upper arm has no sleeve yet.
   - The size is the limb's, not the client's choice. A later «grande» does not change it, and the
     coverage controls do not apply to it.
3. **The design is the skin unrolled.**
   - The prompt asks for the whole width edge to edge, with the right edge continuing into the left.
   - It is drawn on a square canvas, and the height is then cut to the sleeve's proportions (never
     the width).
   - The seam is repaired by rolling the design half a turn and editing a masked band in the middle.
     Only that band is taken from the answer, and the design is rolled back.
   - A measured check (`generation.seam`) allows one more repair. A join that still shows ships with
     a note: the tattooer closes it by hand.
   - Only `generation` calls the editor (ARCH-INV-001). It receives generated artwork and never a
     photograph.
4. **What the client sees.**
   - The 2D mockup shows the half facing the camera: the middle of the design on the zone's own
     side. The 3D view shows the whole turn, centred on the band.
   - The stencil is the unrolled skin at 1:1, with the A4 pieces of TASK-0088. A stencil in panels
     is phase 3.
5. **It counts as two designs.**
   - A sleeve takes two paid images, the drawing and the seam, so it counts as 2 against the daily
     limits.
   - The summary says so before it starts. With one design left, the client is told that a sleeve
     needs two.

## Consequences

- The brief's contract keeps its shape: the change is additive reference data, one new `stage`
  (`seam`) and the sleeve helpers.
- A client's own limb is not measured. The design fits the reference limb; on a thinner limb it
  overlaps and on a wider one it falls short. The result and the 3D view say so.
- A leg is not developable, so a design drawn straight curves where the calf bulges, and the
  stencil shares that limit until phase 3.
- The seam check is calibrated on synthetic line art and gradients. On real generator output it is
  UNKNOWN until sleeves are generated in production.
