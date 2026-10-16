---
type: global-spec
status: draft
last_reviewed: 2026-09-19
---

# Product Behavior

## Purpose

Define what the product promises the user and the tattooer, and — equally important — what it
must never appear to promise.

## Current behavior with evidence status

TASK-0019 implements reference search, up to three chat questions, explicit mm entry and
common-master black contour delivery. The realistic colour artwork and automatic anatomical
surface goal below remain INTENT, not accepted reductions of the user's goal. These open
requirements prevent declaring the whole product verified.

TASK-0032 (ADR-0016) activates the constrained AI blend for the on-body mockup, which pursues the
photorealistic-skin goal above. It changes how the mockup is produced, not what the product
promises: PROD-INV-001 (mockup and stencil are the same artwork) and PROD-INV-005 (every artifact
labelled a visualization) are unchanged and are enforced by the geometry check and the
geometric-only fallback. TASK-0040 (ADR-0018) switches the finish on for generated plates.

## Intended behavior

Two audiences, two artifacts:

1. **The wearer** gets a consultation, a reference render, and an on-body mockup on their own
   photo, with optional healed/aged illustrations.
2. **The tattooer** gets a handoff sheet: the stencil at true 1:1 physical size, the reference
   render, the intended dimensions in millimetres, and placement notes.

The handoff sheet is the product's terminal value. A session that cannot produce one has failed,
regardless of how good the mockup looked.

## Constraints

- The user must be able to specify size in real units (mm) and that size must survive end to end.
- The user must be able to iterate. First generations are rejected as a rule, not an exception.
- Designs are versioned; a mockup always names the design version it rendered.

## Invariants

- PROD-INV-001: The design shown in a mockup is geometrically the same artwork as the design in
  the corresponding stencil. The mockup pipeline may not alter design geometry.
- PROD-INV-002: Stencil exports carry true physical dimensions and are printable at 1:1.
- PROD-INV-003: Aging and healing outputs are labeled illustrative and never presented as a
  prediction of the user's own healing.
- PROD-INV-004: The system does not offer to imitate a named living tattoo artist's style.
- PROD-INV-005: Every generated artifact is accompanied by a visible statement that it is a
  visualization, not a guarantee of the final tattoo.

## Conventions

- Style vocabulary is a closed, curated list (American traditional, fine-line, black-and-grey
  realism, neo-traditional, irezumi, blackwork, illustrative, ornamental, lettering, surrealism).
  Free-text style input is mapped onto this list by the consultation, never passed through raw.

## Non-goals

- Booking, payments to artists, or a marketplace.
- Medical or aftercare advice.
- Guaranteeing that any artist will or can execute the design.

## Evidence / sources

| Statement | Evidence status | Source / revision |
|---|---|---|
| Dual-output delivery (stencil + mockup) | INTENT | User request 2026-09-19 |
| Handoff sheet as terminal deliverable | INTENT | Planning session 2026-09-19 |
| Aging is illustrative, not predictive | INTENT | Planning session 2026-09-19 |
| Style-mimicry of living artists excluded | INTENT | Planning session 2026-09-19 |

## Unknowns

- Whether unauthenticated users may generate at all, or only after account creation.
- Free-tier quota and whether stencil export is gated.
- Whether the curated style list is user-extensible in a later version.

## Change history

- 2026-09-19: Created during SDD bootstrap. Status draft, no implementation.
- 2026-10-16: TASK-0123 (ADR-0043): every size change is a print change, confirmed; mockup, 3D and stencil follow one size.
