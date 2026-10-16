---
type: adr
status: accepted
id: ADR-0022
created: 2026-09-29
amends: ADR-0019
---

# ADR-0022: One camera photograph may be kept, when the client takes it and chooses to

> **Amended by ADR-0028 (2026-10-01).** The consent for a kept camera photo is the one given at sign-in.

## Context

ADR-0019 made the camera try-on's central promise: **the frames never leave the device**. It was
enforced by a source scan that failed the suite if the page could send anything at all.

The owner, having used it on a phone: "cuando uso la opción de realidad aumentada necesito un botón
para que me haga foto y me la guarde en la app como una propuesta más de diseño". A person trying
a tattoo on wants to keep the picture that convinced them, next to the design it shows, and to find
it again on another device (TASK-0046 made designs follow the account).

That photograph is a picture of the client's body. Everything this project decided about body
photographs applies to it: ADR-0006's privacy posture, ADR-0007's rule that own photos never reach
the image generator, and the gate, EXIF, encryption and deletion invariants in `CLAUDE.md`.

## Decision

**The live stream still never leaves the device. A single photograph may, and only when the client
takes it with the shutter and then chooses to keep it, having confirmed they are an adult and that
they consent to it being stored.**

1. **Two separate acts.** The shutter composes one frame locally and shows it back; nothing is sent.
   Keeping it is a second, explicit act. Discarding it leaves no trace anywhere but the page's
   memory.
2. **Consent before the button works.** "Guardar como propuesta" stays disabled until both "Soy
   mayor de edad" and the storage consent are ticked. The page refuses before any request, the web
   route refuses without both, and the worker refuses without both (WEB-INV-004).
3. **It takes the own-photo path, not a new one.** The worker stores it through `ingest` as a
   `body` asset: the safety input gate with own-body consent, EXIF stripped, encrypted at rest,
   counted against the account's ten images, erased by "delete my data" with everything else.
   There is no second storage path to audit.
4. **It never reaches an image model.** The version it becomes keeps every field of its parent —
   master, stencil, background, mockup — and adds the photograph under `capture`. The generation
   and edit paths read the master and the references, never `capture`, so a change asked from the
   photo's version edits the design without sending the picture anywhere (tested). The only
   external service that sees it is the moderation provider, which is what running the gate means.
5. **The design does not change.** A kept photo is a version of the *same* design: same master,
   same stencil, same millimetres. "Lo que pruebas es lo que se tatúa" still holds; the photograph
   is evidence of a try-on, not a new drawing.
6. **One module can send, one route receives, and the source is checked.** `lib/capture.ts` is the
   only code on the try-on that can serialise a frame or make a request; it sends to
   `/api/captures` only and never on a timer. The page calls `snapshot` and `saveCapture` from
   exactly one place each. `probar/no-upload.test.ts` asserts all of it, so the exception cannot
   quietly grow into a stream.

## Alternatives considered

- **Keep the photo on the device only** (download it, or keep it in browser storage). Honours
  ADR-0019 literally. Rejected because it does not do what was asked: the owner wants it "en la
  app como una propuesta más", visible from another device, next to its design.
- **A new storage path for captures.** Rejected: a second way to store body photographs is a second
  thing to get wrong about retention, encryption and deletion.
- **Record a short clip.** Not asked for, and a stream is exactly what ADR-0019 exists to prevent.

## Consequences

- The try-on's privacy line changes from "Ninguna imagen se envía ni se guarda" to "Solo se guarda
  una foto si tú la haces y decides guardarla". It is still true, and still enforced by source
  scan.
- A kept photo is one of the account's ten images. Someone who keeps many will reach the limit and
  be told to delete their data to start again. Revisit if that proves too tight.
- Each kept photo costs one moderation call.
- Retention is the photo class's 24 hours until durable storage (TASK-0047), like every design.

## Validation / revisit conditions

- **Owed:** a real phone. The flow was exercised end to end against the local worker with a
  synthetic camera stream (TASK-0050/ev-002); a real camera, a real body and real light have not
  been through it.
- **This decision is wrong if** kept photos start being used as inputs to anything — a finish, an
  edit, a model. That would need its own ADR against ADR-0007, not a quiet extension of this one.
- **Amended by TASK-0115:** the account's ten images for life became a daily upload limit
  (`TATTOO_DAILY_UPLOADS`, 30 by default). A kept photo counts as one upload that day.
