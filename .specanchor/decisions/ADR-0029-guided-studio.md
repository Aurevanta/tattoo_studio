---
type: adr
status: accepted
id: ADR-0029
created: 2026-10-01
---

# ADR-0029: The studio is guided by pop-ups; a professional description is drafted and editable

## Context

The owner asked for the whole experience to be guided by pop-ups: first «¿qué quieres tatuarte?»;
the agent reads the idea and improves it "para adaptarlo al objetivo final de tener un prompt
profesional"; then one question for whatever is missing (style, zone, side, body, colour); then the
references found, each removable, with a way to add one; then a summary in which every value can be
changed; only then does the studio work, and the result shows the mockup, the stencil, the changes
and the camera. Asked, the owner chose: one grouped pop-up for what is missing, the professional
description visible and editable, the chat and panel kept as «Modo avanzado», and the choice of the
client's own skin photo in the summary.

## Decision

1. **Four pop-ups** on the shared `Confirm` dialog, each with «Paso N de 4» and «Atrás»: idea,
   details (only what is missing; every detail when revisited), references (remove, add, search
   again only when an essential one is missing, continue without any), and summary (each value
   editable, the professional description, «Piel de estudio / Mi foto», and «Esto es lo que
   quiero», which saves any change, accepts the brief as saved and generates). Then a progress
   pop-up, the existing result dialog (images, downloads, changes, camera), and «Tu diseño está
   listo» with «Nuevo diseño» and the account's earlier designs.
2. **The step is resumed from the server's state** (`lib/wizard.ts`), so a reload lands at the
   details or the references of the consultation in progress, or at «listo» after a design.
3. **«Nuevo diseño» forgets the consultation in this browser** (`DELETE /api/consultation`); the
   account's designs stay. Sending the idea again after «Atrás» starts a clean consultation.
4. **Professional description:** `tattoo-brief.subject.refined` (optional, ≤ 1200 characters, also
   in the brief `studio-job` embeds). The architect drafts it in Spanish from the idea, keeping
   every element the client named and adding none; `description` stays the client's own words
   (TASK-0033). The client's edit wins over a later draft. It is part of the accepted brief, and the
   worker's artwork prompt leads with it.
5. **«Modo avanzado»** shows the previous chat and panel unchanged; the choice is remembered in the
   browser.

**Amended by TASK-0099 (2026-10-13, at the owner's request):** step 2 always opens after the idea
and shows every detail, with what the idea set or the architect proposed already chosen, instead of
only what is missing. Style and zone read from the idea were hidden, so the client never saw a
style they had not picked. A reload with every detail answered still resumes at the references.

## Consequences

- The size is not asked; the studio proposes it and the summary lets the client change it.
- «Eliminar mis datos» stays in the advanced panel.
- The professional description is written by a model: the summary shows it next to the client's
  words precisely so that a drift can be seen and corrected before anything is generated.
