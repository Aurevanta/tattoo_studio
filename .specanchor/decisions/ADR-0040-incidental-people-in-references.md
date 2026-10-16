---
type: adr
status: accepted
id: ADR-0040
created: 2026-10-16
amends: TASK-0013 (the input gate refuses any visible person in a reference), ADR-0039 (images with people are refused)
---

# ADR-0040: A reference may show people who cannot be identified; an identifiable person is refused

## Context

The input gate refuses a reference image if any real person is visible anywhere, even partly or in
the background, and refuses when unsure (`CLASSIFY_PROMPT`, TASK-0013). The reason is sound: a
client cannot consent for a third person.

The owner tried to attach a photograph of the Torres de Serranos for a design. It was refused
because two or three passers-by, a few pixels tall, stand by the gate (OBSERVED, owner,
2026-10-16). Almost every photograph of a monument, street or landscape has someone in it, so
the rule refuses the references the studio needs most. The owner decided to refuse only people
who can be identified (INTENT, owner, 2026-10-16).

## Decision

1. **The gate asks whether a person is identifiable.** The moderation verdict becomes
   `{"identifiable_person", "explicit"}`. `identifiable_person` is true when:
   - a real person is a subject of the image, or is prominent, close or in the foreground;
   - or their face is large and clear enough to recognise;
   - or a body part is shown close up as a subject (a hand, an arm, a face).

   It is false for small, distant, incidental figures whose faces cannot be made out, such as
   passers-by at a monument or a crowd far away. Drawings, statues and cartoon figures are false.
   When unsure whether someone is identifiable, the answer is true. `explicit` is unchanged.
2. **Incidental people are not drawn.** The architect's prompt, the generator's reference analysis
   and the artwork prompt say that people who appear incidentally in a reference are not part of
   the design, unless the client explicitly asks for a figure, which is then drawn as a generic
   figure, never as the person in the photograph.
3. **The refusal says what to do.** An identifiable person is refused with a message that suggests
   cropping the person out.
4. **Unchanged:** an own body photo (`own_body_consented`) still allows a person, a person that can
   be recognised is still refused, and explicit content is still refused. The gate still denies on
   any provider failure (SAFETY-INV-007). Its version becomes `input-gate-2`, so a clearance
   records which rule passed the image.

## Consequences

- An admitted image may still contain a tiny figure. It is screened, stored encrypted without
  EXIF, and reaches Claude, the moderation provider and the image generator, like any reference.
  The risk accepted is a person who is not recognisable in it.
- Where a figure stops being "incidental" is a model's judgement. It is tuned to refuse when unsure.
  That a real monument photo now passes and a portrait is still refused is UNKNOWN until checked
  live.

## Alternatives considered

- **Accept any person.** Offered and declined: it admits portraits of third parties.
- **Keep the rule and ask the client to crop.** Offered and declined: it fails on most monument and
  landscape photographs.
- **Blur detected people before storing.** Not offered: it needs a person detector in the worker,
  and blurred figures would still be drawn.
