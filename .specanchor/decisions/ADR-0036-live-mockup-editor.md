---
type: adr
status: accepted
id: ADR-0036
created: 2026-10-15
amends: ADR-0008, TASK-0073 (who may change the print size)
---

# ADR-0036: The client places, sizes, stretches and turns the design on the skin, live

## Context

The owner wants to edit the mockup in real time (INTENT, owner, 2026-10-15). The client should be
able to make the tattoo larger, wider or taller, move it over the zone and turn it, and see the
result at once in the studio's result.

Evidence: OBSERVED.

- The result shows `artifact.mockup`, a PNG with the design already composed into it.
  «Más pequeño» and «Más grande» each start a new job (`reposition`), which takes a while, may run
  the AI finish (ADR-0018) and changes the view only.
- «Ocupar toda la zona» is the only control that changes the print millimetres (TASK-0073). It
  rescales the vector uniformly (`stencil.engine.rescale`).
- The skin under the design is already stored as `artifact.background` (the generated plate or the
  client's own photo), next to the `master`. The browser can therefore compose the two itself.
- `lib/skin-blend.ts` is a port of the worker's ink treatment (ADR-0019). It lacks the cylinder
  warp and the taper of `mockup.engine._shape`.
- The worker's composite has no rotation, and `fit_body` re-centres and shrinks the design, which
  would undo a placement the client chose.

The owner decided (INTENT, 2026-10-15):

1. Enlarge, widen, lengthen, move and turn.
2. Saving creates a new version, **with** the AI finish.
3. When the design is enlarged, widened or lengthened and saved, **the stencil and the PDFs follow**.
4. Widening or lengthening may change the drawing's proportions by at most **±25 %**.
5. Free rotation, ±180°.
6. The editor **replaces** «Más pequeño» and «Más grande». «Ocupar toda la zona» stays.

## Decision

1. **A live editor in the result, on the client's device.** «Ajustar sobre la piel» composes the
   master over `background` in a canvas.
   - The client drags the design to move it, and uses sliders for size, width, height and angle.
   - The ink is `skin-blend` (multiply, surface and fresh-ink ring) over the same cylinder and taper
     the worker uses, ported as `lib/mockup-editor.ts`.
   - Nothing is sent while the client adjusts. An own photo stays on the device, as in ADR-0019.
2. **What the client sees is what is printed.** The millimetres follow the view proportionally on
   each axis: `widthMm × (new width / old width)`, and likewise for the height. The editor shows
   the result as «≈ W × H mm». These are the parent's millimetres scaled, so on a generated plate
   they are as orientative as the parent's projection was. The editor says so.
3. **Saving is an edit with an explicit placement.** `edit.placement` = `{ centreX, centreY, width,
   height, angle }`: fractions of the skin image, with width and height measured before rotation.
   The worker:
   - derives the millimetres itself from the parent's placement, and never takes them from the
     client;
   - composes at exactly that placement (rotate, then the cylinder, clipped to the frame and to the
     body silhouette, with no re-centring or shrinking);
   - runs the same AI finish graph (ADR-0018). An own photo still declines it.
4. **The stencil and the PDFs follow the millimetres.** The vector master is scaled per axis, which
   is exact and not a retrace (ADR-0003). `stroke_mm` scales by the geometric mean of the two
   factors. SVG, PDF and their mirrors are re-exported. When the proportions change, the raster
   master is resampled to the same proportions, so the 3D view, the overlay and the link agree.
   - The drawing is resampled, never redrawn (MOCKUP-INV-001). Mockup and stencil remain the same
     artwork (PROD-INV-001).
   - A design without a stored vector (before TASK-0024) cannot change size or proportions. Only
     its position and angle are saved.
5. **Stretch is bounded.** `transform.stretch` records how much the width-to-height ratio differs
   from the drawing as generated (1 = undeformed). It accumulates across versions and must stay
   within [0.75, 1.25]. The client limits it, and the worker refuses anything outside it.
6. **Rotation is not printed into the stencil.** The stencil and the PDFs stay upright. The result
   and the notice say «gírala N° al colocarla». `transform.placement` records the angle, so
   reopening the editor starts from the saved placement.
7. **Not offered on:** sleeves (already a full turn; ADR-0034), camera versions (the photograph is
   the composite; ADR-0022), a result without `background`, or a calibrated own photo. On a
   calibrated photo the size is the client's measurement, so only the position and angle may
   change there.
8. **Labelled.** «Vista orientativa: el tamaño sobre la piel es aproximado. Al guardar, la plantilla
   y los PDF pasan a las medidas que ves.» Saving with new millimetres asks for confirmation first,
   as TASK-0073 requires of any print-size change.

## Alternatives considered

- **View only, millimetres untouched.** Rejected by the owner. It also cannot hold with stretch,
  because a stretched mockup over an unstretched stencil breaks PROD-INV-001.
- **Server-rendered preview on every change.** Rejected: it is not live, and it would send an own
  photo's composite round trip for each slider move.
- **Porting the silhouette mask to the browser.** Deferred. The preview may show ink over the
  backdrop beside a limb, which the saved render clips. The editor says so.

## Consequences

- Each save is a version and costs one AI edit on a generated plate (about 80 s), as a re-placement
  already did.
- `studio-job.edit` gains `placement`. `studio-status.transform` gains `placement` and `stretch`.
  Both are additive and optional.
- Who may change the print size widens: «Ocupar toda la zona» and now the editor's confirmed save.
  A sentence still cannot (TASK-0073).
- A stretched design deforms circles, letters and faces. The ±25 % bound and a visible warning
  limit that; the tattooer must still review it.

## Validation / revisit conditions

- **Revisit the bound** if tattooers report stretched designs as unusable, or if clients hit it
  often.
- **Revisit the silhouette in the preview** if the gap between the preview and the saved render
  confuses clients.
- **This decision is wrong if** clients read the editor's millimetres as measured on their body.
  The label is mandatory.

- **Amended by ADR-0042 (TASK-0120):** on a library plate the editor starts from the printed
  millimetres and the plate's measured frame, and shares its placement live with the 3D view.
