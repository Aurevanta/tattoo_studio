---
type: adr
status: accepted
id: ADR-0023
created: 2026-09-29
refines: MEDIA-INV-006
---

# ADR-0023: Designs last; photographs of a body expire

## Context

Every file the studio stored was written with the photo retention class, so a design, its stencil
and its PDFs were erased 24 hours after they were made, and the history only showed the last day.
That contradicted MEDIA-INV-006, which already said that stencils, containing no likeness, follow
the design lifecycle. It also blocked the owner's next request: an administrator who can see what
users have made needs something that is still there.

Asked whether to move the design store into Supabase for this, the owner chose instead to fix the
lifecycle in place (TASK-0047): the worker's volume is already durable across deploys, and the
images are encrypted with a key only the worker holds, so moving them would not have given anyone
else access anyway.

## Decision

**Whether a file expires depends on whether it shows a person, not on where it came from.**

| Follows the photo lifecycle (24 h, then erased) | Follows the design lifecycle (kept until deleted) |
|---|---|
| The client's own body photograph | The master artwork and its vector geometry |
| A kept camera photograph (ADR-0022) | Stencils and mirrored stencils, PDFs |
| The composite and background made **on** that photograph | A generated skin plate, and the composite on it |
| | References, which the safety gate admits only if they show no person |

1. **Lineage follows likeness.** A composite on the client's photo descends from that photo, so the
   photo's expiry cascades into it (SEC-INV-004 unchanged). The design itself never contained the
   photo — ADR-0007 keeps it out of the generator — so it descends from the first reference instead,
   and no photograph's expiry can reach it.
2. **Versions are kept.** History is no longer limited to the last 24 hours. A version whose skin
   view went with its photo still opens, shows its design and stencil, and says plainly why the
   skin view is gone. A kept camera photo's version is removed with its photo: without it there is
   nothing left to show.
3. **Only runs that produced nothing are swept:** failed and cancelled jobs after 24 hours.
4. **Deletion is unchanged.** "Delete my data" erases everything, designs included, at once.

## Consequences

- Designs accumulate. There is no size cap per account yet; the ten-image limit still bounds
  uploads. Revisit when storage use is visible (the monitoring of TASK-0054 will show it).
- A change asked from a version whose photo has expired is refused with that reason, rather than
  quietly continuing on a generated plate the client did not choose.
- Files written before this change keep the expiry they were written with; designs made before the
  deploy still disappear on their original schedule.

## Revisit conditions

- A legal review of retention periods (ADR-0006 left it open) may set a limit on designs too.
- If kept camera photos should outlive 24 hours, that is a decision about body photographs and
  needs its own ADR.

- **Amended by ADR-0041 (TASK-0116):** besides «Delete my data», the client can delete one design
  or one version of it; files another version still uses are kept.
