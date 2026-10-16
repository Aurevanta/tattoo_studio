---
type: adr
status: accepted
id: ADR-0027
created: 2026-09-30
---

# ADR-0027: Skin plates come from a reviewed library

## Context

Every design without the client's own photograph needs a skin plate: a blank photograph of the
zone on which the tattoo is composed. Until now each one was generated for that design (TASK-0052
put the call first, so a failure costs no artwork). That was a paid call and a wait every time, and
OpenAI's safety system refused some of them: a woman's thigh failed a live generation, and the
clinical rewording of TASK-0059 still needs a second request for about four zones in ten.

The owner asked: "no sería mejor crear esas imágenes de las partes del cuerpo de hombre y mujer y
tenerlas guardadas sin necesidad de tener que crearlas cada vez?", and chose to build the library.

## Decision

1. **One plate per zone and body**, 26 zones × {man, woman}, generated once with the production
   plate call (OpenAI, `medium`, the TASK-0059 prompt), reviewed by a person, and committed under
   `services/worker/generation/plates/` as WebP. The style catalogue (ADR-0012) set the pattern.
2. **Right side only.** A left-side design uses the same photograph mirrored; zones on the centre
   line (chest, sternum, stomach, upper and lower back, spine) are never mirrored.
3. **No body named** picks one of the two from the brief id, so every version of a design sits on
   the same body.
4. **The library comes first**; the generated plate (with TASK-0059's retries) remains the fallback
   for a zone or body it lacks.
5. A library plate is a generated plate for every other rule: the constrained finish may run on it
   (ADR-0016, ADR-0018), it is design material rather than a photograph (ADR-0023), and it is never
   the client's body.

## Consequences

- No plate call, no wait and no safety refusal in normal use. The library cost is paid once.
- Every design on the same zone and body uses the same person and skin tone. A demo accepts that;
  more tones are more files, not a different design.
- The worker image carries the plates (about 52 × 150 KiB).
- Replacing a plate is regenerating that file and reviewing it again
  (`python -m app.build_plate_library --force --zone hip`).

## Validation / revisit conditions

- **Revisit if** clients ask to see their own skin tone without uploading a photo, which would mean
  several tones per zone and a way to choose one.

- **Amended by ADR-0042 (TASK-0120):** each plate also carries a reviewed frame in millimetres
  (`calibration.json`); a new or regenerated plate needs it re-measured and reviewed.
