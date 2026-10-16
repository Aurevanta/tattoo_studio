---
type: adr
status: accepted
id: ADR-0041
created: 2026-10-16
amends: ADR-0023
---

# ADR-0041: A client names, deletes and copies their designs one by one

## Context

«Tus diseños» listed every version of every design in one flat list, «Propuesta 11 · Ajuste de
tamaño, posición y giro en la vista 3D», numbered across the whole account. The only way to remove
anything was «Elimina tus datos», which erases the account's work at once (ADR-0023 §4). The owner
asked for the client to manage their designs: delete one, rename it, and edit it.

What a version is, as stored (OBSERVED, `jobs/queue.py`, `app/studio.py` at 86f40a7):

- Each version is a row in `jobs`. A change, a re-placement, a mockup or 3D edit is asked from a
  version and names it in `edit.parentJobId`; a kept camera photo names it in `capture.parentJobId`.
- **Versions share files.** A re-placement keeps its parent's artwork, stencils and PDFs, a kept
  photo keeps everything, and the vector master is keyed by the physical design, so several
  versions point at the same stored files.
- References are uploads, and the design's files descend from the first one in the media lineage:
  a cascade from a reference reaches every file made from it.
- The daily design limit sums the `jobs` rows of the day.
- A link for the tattooer opens one version (ADR-0032).

Asked, the owner chose (INTENT, 2026-10-16): deleting either a version or a whole design; the list
grouped by design; the default name being the client's idea, shortened; a confirmation before
deleting; and being able to start a new design from any version, besides opening it to change it.

## Decision

1. **A design is a family of versions.** Each version carries the design it belongs to (`jobs.family`,
   the id of the design's first version), set when it is made: a change or a kept photo joins the
   design of the version it was asked from; anything else starts one. It is a stored column, not
   recomputed from `parentJobId`, so deleting a version never cuts its children off. Versions stored
   before this are given theirs when the worker starts, oldest first.
2. **A design has a name.** The client may set one (one line, at most 60 characters); until then it
   is their idea — the first sentence of `subject.description` — shortened to about 48 characters at
   a word or clause boundary. An empty name gives the default back. The name is the client's label:
   it is not part of the link for the tattooer.
3. **`studio-status` carries `design: {id, name}`**, optional and additive. The web groups the
   history by it; versions are numbered within their design.
4. **Deleting a version or a whole design** erases those versions and every file that no remaining
   version of the account still uses: artwork first, then the uploads they were made from, and an
   upload only when no remaining version and no consultation in progress uses it, so a cascade from
   it can reach nothing that is kept (SEC-INV-004). The vector of a physical design goes when no
   remaining version shows that design. Every link to an erased version closes. The rows stay,
   emptied and cancelled, so the day's designs are still counted (TASK-0078); the usual sweep removes
   them after a day. A design with a version still being made is not deleted: the generation would
   read files deleted under it.
5. **A new design from a version** is a copy of that version as it is, recorded like a kept photo
   (no generation, nothing counted against the daily limit), starting a design of its own named
   «<name> (copia)». A kept camera photo is not carried over: it is a picture of the client's body
   and stays with the design it was taken for. Changes asked from the copy build the copy.
6. **The web asks first.** Deleting opens a confirmation in place that says what goes, that links
   stop opening, that it cannot be undone and that the day's count stays. Renaming and deleting need
   only the account; copying stores work and asks for the current consent.

## Consequences

- «Elimina tus datos» is unchanged and still the way to erase everything at once. ADR-0023 §4
  («Deletion is unchanged») is amended: a design or a version can now also be deleted on its own.
- Shared files make a version's deletion free up less than it seems: what a later version uses
  stays. The confirmation says so.
- A copy shares its source's files; deleting either leaves the other whole.
- The name lives in the worker's `jobs.sqlite` (`design_names`), beside the versions, and goes with
  «Elimina tus datos».
- Deleting a design does not refund the day's designs. The confirmation says that too.

## Revisit conditions

- If clients want to undo a deletion, a short delayed erase (a «Deshacer» for a few seconds) can be
  added without changing what is erased.
- If a copy should become a real fork with its own history of where it came from, record the
  source on the copy; today nothing reads it.
