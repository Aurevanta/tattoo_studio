---
type: adr
status: accepted
id: ADR-0039
created: 2026-10-15
amends: TASK-0033 (the architect is sent conversation text only)
---

# ADR-0039: Images attached to the idea are numbered and read by the prompt architect

## Context

Step 1 of the guided studio («¿Qué quieres tatuarte?», TASK-0065) takes text only. A client can add
their own reference images later, in step 3, and those images are screened, stored and passed to
the image generator as references (TASK-0014, TASK-0058). The prompt architect (Claude, TASK-0033)
never sees them: `agents/architect.ts` sends conversation text only, and the web spec says no image
leaves the BFF through the consultation path.

The owner wants to attach images in step 1 and write the idea against them, for example «como la
imagen 1 pero con las rosas de la imagen 2», so that the architect can draft the professional
description from what the images actually show (INTENT, owner, 2026-10-15). They decided:

- up to **five** images in step 1, the same cap as a design's references;
- the images are read by Claude **and** passed to the image generator as references, as step 3's
  are;
- an image showing a real person is **refused**, as today;
- the images are kept **as references are**: with the design, until the client erases their data,
  and an image removed before it is part of a design is deleted.

## Decision

1. **Same ingestion as any reference.** Each image is uploaded on its own, as it is attached, through
   the worker's `/media` ingestion: size check, sanitization, EXIF strip, PNG normalisation, the
   moderation gate (explicit content and any real person are refused), encryption at rest,
   `RetentionClass.DESIGN`. Nothing is sent anywhere before that gate passes (SEC-INV-007). The
   upload does not touch the consultation (`purpose: 'idea'`), like TASK-0036's change photos.
2. **Numbered by position.** The images are «Imagen 1» to «Imagen N» in the order attached. Removing
   one renumbers the rest, and the step says so beside the thumbnails.
3. **The architect reads them, once.** When the idea is sent, the BFF reads each image back from the
   worker as a bounded JPEG preview (longest side 1568 px), and the orchestrator attaches them to
   the client's turn for the architect, each preceded by its label. The prompt tells the architect
   to resolve the client's references to the images into words in `subject.refined`, to describe
   only what is visible, and never to name or imitate the author of an image (PROD-INV-004). Only
   the architect receives them: the scout, the content screen and later turns do not.
4. **They are the design's references.** The images join the session as `user_supplied` references,
   in their numbered order, labelled «Imagen N». From there they follow the existing path: shown in
   step 3, sent to the image generator by `services/worker/generation` only (ARCH-INV-001), and the
   scout does not search when the client supplied references.
5. **Removing an unused image deletes it.** `DELETE /studio/media/{id}` deletes a reference image the
   account owns, with its cascade, and refuses one any design job already uses (that one is erased
   with the account, as now). The BFF also drops it from the consultation.

## Consequences

- A client image now reaches a language-model provider (Anthropic). It is a screened image with no
  person in it, the same bytes the moderation provider and the image generator already receive.
  Whether Anthropic's retention terms for this organisation satisfy SEC-INV-001 ("not retained by
  providers beyond processing") is **UNKNOWN**: it depends on the account's commercial terms and
  must be confirmed by the owner. The OpenAI moderation call has the same open question.
- The account's ten-image cap on stored uploads (`_ingest`) is unchanged. Five images in step 1
  use half of it. Deleting unused images (point 5) is what keeps the cap from filling up with
  images the client dropped.
- The GPT-6 Astra backend already accepts images on a turn and gets them the same way. The fixture
  provider ignores them.

## Alternatives considered

- **Claude only, not the generator.** Offered and declined by the owner: the drawing would resemble
  the originals less.
- **Allow people with a declaration of permission.** Declined: the studio cannot obtain a third
  party's consent, and it would change the safety gate.
- **Send the full stored PNG to Claude.** Rejected: a 12 000 px image exceeds the API's limits and
  costs far more tokens than it adds.
