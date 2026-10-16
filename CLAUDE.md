# Tattoo Creator

An application that takes a tattoo idea through a guided consultation and produces two artifacts:
a **studio-grade stencil** a tattooer can print and transfer at 1:1, and a **photorealistic
on-body mockup** on the user's own photograph.

## Read this first

1. `.specanchor/README.md` — the working protocol.
2. `.specanchor/spec-index.md` — every module, its spec, and who enforces which invariant.
3. `.specanchor/project-codemap.md` — intended structure and current state.

## Spec-driven development is mandatory here

For material changes in this project, apply the Spec Anchor protocol in `.specanchor/README.md`.
Use light or full tasks according to impact. Verify affected acceptance criteria and document the
two directional reviews. Report documentary coverage separately from semantic alignment.

Specifically:

- **Load the relevant global and module specs before editing.** Module ownership is in
  `.specanchor/module-map.json`.
- **Contract changes update the module spec before or alongside the code.** The guard enforces it.
- **Never rewrite a spec to legitimize an accidental implementation change.** If code and spec
  disagree, establish the intended behavior first, then correct the right artifact.
- **A guard pass is not proof of correctness.** It checks documentary coverage only.

## Current state

The studio is deployed with Coolify (ADR-0020) at `inkcraft.aurevanta.es`: Supabase accounts
(ADR-0021, created by the studio), consent at sign-in (ADR-0028), the guided studio (ADR-0029), the
Claude consultation with a scout over Commons, Openverse and optionally Brave (ADR-0026, ADR-0030),
colour and black-and-grey artwork, a geometric mockup with a constrained AI finish (ADR-0016,
ADR-0018), stencils as SVG/PDF, and daily spending limits (TASK-0078). The external audit of
2026-10-01 (`.specanchor/evidence/audit-2026-10-01/`) and the tasks from TASK-0072 record what was
done about it. Modules remain `draft`: realistic-colour stencils are approximate contours, and
anatomy is reference anatomy. Distinguish tested software from professional tattoo readiness.
Historical task claims are not current evidence.

## Evidence discipline

Mark every inferred statement with its status and source:

| Status | Meaning |
|---|---|
| `OBSERVED` | Supported by inspected code or configuration; execution unverified |
| `VERIFIED` | An executed check supports this precise statement; record command and result |
| `INFERRED` | Plausible interpretation requiring confirmation |
| `UNKNOWN` | Insufficient evidence |
| `INTENT` | Desired behavior explicitly requested or accepted |

Do not invent evidence, do not record a test as passing that was not run, and do not fabricate an
approver.

## Hard constraints

These come from the global specs and are not negotiable without an ADR:

- Only `services/worker/generation/` may call an external image model.
- The shared vector master is authoritative. The mockup may carry a constrained AI finish over
  the geometric composite, on generated skin plates only, delivered only when the geometry check
  accepts it against that composite (ADR-0016, ADR-0018); otherwise the composite ships. It is
  never a redraw, and own photos are not sent to it until GEN-INV-002 is verified.
- A line-art stencil is produced by a native line-art pass, never by edge-detecting the shaded
  render. A colour or shaded design's stencil is approximate contours of its flat artwork (never of
  skin), labelled approximate everywhere it appears, its PDF included (ADR-0044).
- No user photograph is persisted or sent to a generation provider before passing the safety
  input gate. Sanitized bytes necessarily reach the moderation provider to run that gate.
  Own-body uploads require adult consent; they never go to the image generator (ADR-0007).
- EXIF is stripped before durable persistence; photos are encrypted at rest.
- Deleting a photo deletes every artifact derived from it.
- Aging and healing outputs are labeled illustrative, never predictive.
- The product does not imitate the style of a named living tattoo artist.

## Conventions

- Code, comments, identifiers, specs and commit messages in English.
- Guard patterns use `fnmatch`: `*` matches slashes. Module globs must not nest.
- Any new top-level source tree must be added to `.specanchor/module-map.json` in the same change.
- `scripts/check-spec-sync.py` is copied verbatim from the `sdd-spec-anchor` skill. Do not edit it.

## Commands

```sh
python scripts/check-spec-sync.py --baseline
python scripts/check-spec-sync.py --review .specanchor/evidence/impact-review.json
```

Tests and checks (pnpm is user-scoped on the owner's machine: see the project memory):

```sh
pnpm test                    # contracts, consultation and web (vitest)
pnpm lint                    # eslint + prettier --check
pnpm typecheck
cd services/worker && ./.venv/Scripts/python.exe -m pytest -q   # worker
cd services/worker && ./.venv/Scripts/python.exe -m ruff check . && ./.venv/Scripts/python.exe -m mypy .
cd contracts/python && python -m uv run pytest -q               # Python contract corpus
```
