---
type: adr
status: accepted
id: ADR-0038
created: 2026-10-15
amends: ADR-0037 (one neutral body), ADR-0033 and ADR-0035 (one reference limb)
---

# ADR-0038: The 3D views show a masculine or a feminine body, as the design was made for

## Context

The owner found the neutral reference body of ADR-0037 too plain. They asked for a masculine and
a feminine body, shown according to what was chosen (INTENT, owner, 2026-10-15). They decided:

- a «Hombre / Mujer» toggle in the view, starting from the design's own body;
- the lower leg and the forearm become masculine or feminine as well;
- no clothing, as now.

A brief already names a body (`placement.bodyType`, TASK-0041), and the plate library uses it for
the 2D skin. When none is named, the library picks one from the brief's hash
(`plate_body`). The lower leg's and the forearm's measured circumferences are what a sleeve's
stencil is unrolled on (ADR-0035). If the 3D limb changed and the stencil did not, the sleeve seen
in 3D would no longer be the one printed.

## Decision

1. **Bodies from MakeHuman's own targets, CC0 like the mesh.** A masculine or feminine adult is
   the base mesh plus the `{african,asian,caucasian}-{male,female}-young` macro targets at one
   third each. That is MakeHuman's default ethnic mix at gender 0 or 1, age 25, and average muscle,
   weight and height. The `universal-*-averagemuscle-averageweight` targets are empty.
   - The files are downloaded from the same repository and recorded by hash; they are not
     committed.
   - `body-{masculine,feminine}.glb`, `lower-leg-{…}.glb` and `forearm-{…}.glb` are built from
     them. The neutral limbs stay for the landing's example. The neutral body is removed.
2. **A limb keeps the reference length and takes the body's girth.** It is stretched only along its
   axis, and only above the ankle or the wrist, to the neutral band length. The sleeve's band, and
   the size a sleeve is asked at, do not change. MakeHuman's feminine forearm is 21 cm, and a
   uniform scale would have made it thicker than the masculine one.
3. **A sleeve's stencil follows the same limb.** `body-zones.json` gains, per wrap region,
   `bodies.{masculine,feminine}.circumferenceProfileMm`. Each is measured on its model by
   `scripts/measure-limb-profile.py`, which reproduces the neutral table exactly on the forearm and
   within 3.1 mm on the leg.
   - `WrapRegion.for_body` and `circumferenceAt(…, bodyType)` read them.
   - The worker unrolls and panels a sleeve on the body its plate shows.
   - On the client's own photograph it uses the neutral profile, since that body is not a reference
     body.
4. **The result names its body.** `placement.bodyType` is the brief's, or the plate library's choice
   (`plate_body`). It is absent on an own photo. An older result without it starts on the body
   `plate_body` would pick, computed in the browser from the same hash, so the 3D view agrees with
   the 2D skin.
5. **The client may switch** between «Hombre» and «Mujer» in both views. The design keeps its place,
   side and tone. The notices of ADR-0033 and ADR-0037 stay: a reference body, not theirs.

## Alternatives considered

- **Keep the limbs neutral.** It was recommended, because it would have left the sleeve stencil
  untouched. The owner chose consistency.
- **Scale each limb uniformly to its own length.** Rejected in point 2.
- **Clothing.** Declined by the owner.

## Consequences

- Six models of 1.2 to 1.9 MB, of which one is loaded per view.
- For the same brief, a sleeve's stencil changes with the body. A sleeve made before this change
  keeps the stencil it was given.
- The consultation still proposes a sleeve's size from the neutral circumference.
