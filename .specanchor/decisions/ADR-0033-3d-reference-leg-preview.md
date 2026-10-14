---
type: adr
status: accepted
id: ADR-0033
created: 2026-10-14
---

# ADR-0033: A design can be turned round a reference lower leg in 3D

## Context

The owner wants wrap-around pieces, such as a left lower-leg sleeve from the knee to the ankle, and
asked whether the studio could show them from every side by turning a 3D view. Evidence: INTENT
(owner, 2026-10-14). The owner chose to start with the viewer and with an anatomical reference
model rather than a parametric tube.

The studio cannot show such a piece today. Evidence: OBSERVED.

- A brief has one `bodyPart`. Its reference span (`body-zones.json`) is the surface seen from the
  front, not a circumference.
- The mockup is a 2D cylindrical warp on one photograph of skin (`mockup/engine.py`). `MAX_SPILL`
  assumes the camera sees about 180° of a limb, and ink past the silhouette is clipped.
- ADR-0002 rejected "3D body reconstruction with a rendered material" for the mockup. That was the
  reconstruction of the client's body from a photograph.

## Decision

1. **A preview in the browser, not a deliverable.** Next to the result of a lower-leg design (zone
   `calf`, `shin` or `ankle`), «Ver en 3D alrededor de la pierna» shows the design on a reference
   lower leg that the client turns, zooms and looks at from the front, outside, back and inside.
   The client may move the design round the leg and up or down it, choose the leg and pick one of
   three reference skin tones. It is not stored, not shared, and it neither replaces nor validates
   the 2D mockup or the stencil.
2. **A reference leg, never the client's.** The model is the MakeHuman base mesh `hm08`, released
   as CC0 1.0 (`evidence/TASK-0101/model-licence.md`). It is cut below the knee by
   `apps/web/scripts/build-leg-model.py` and served as `public/models/lower-leg.glb`. No photograph
   is read, no body is reconstructed, and no provider is called. This clarifies ADR-0002 without
   reversing it: the mockup still ships the 2D composite. Only CC0 or equivalent models may be
   added.
3. **The design keeps its size and its lines.** The model carries, per vertex, the height along the
   limb axis, the perimeter of the leg there and the arc-length fraction round it. The shader
   samples the design's own master at its real size in millimetres along the skin. The artwork is
   sampled, never redrawn (MOCKUP-INV-001); the stencil stays authoritative (PROD-INV-001).
4. **Said where it is shown.** «Vista orientativa sobre una pierna de referencia, no la tuya. Las
   medidas del diseño son reales; la forma de tu pierna no lo es.» goes with the view
   (PROD-INV-005, WEB-INV-003). Without WebGL the view says so, and the 2D mockup remains.
5. **Loaded on demand.** three.js (pinned) and the model load only when the view is opened. The
   model is a public static file outside the page gate, like `/ejemplos/`: it holds no client data.

## Consequences

- A lower leg can be judged from every side, including a design wider than the visible half.
- The leg's shape is one reference body. A client's leg differs, and the preview says so. Its
  measurements (about 34 cm round the calf, 20 cm at the ankle, 38 cm from ankle to knee) are not
  the client's.
- A full wrap made of a design that was not drawn to wrap shows a join where its edges meet. A
  seamless 360° design, a `wrap` coverage in the brief with the client's own measurements, and a
  sleeve stencil in panels are further decisions (phases 2 and 3 of the owner's plan).
- The tattooer's link (ADR-0032) does not show the 3D view until that is decided.
- A leg is not developable: lines drawn straight on the design curve where the calf bulges. That
  is how skin takes a flat drawing, not an error of the preview.
