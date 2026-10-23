---
type: global-spec
status: draft
last_reviewed: 2026-10-17
---

# Project Setup

## Purpose

Describe how the repository is laid out, how it is run locally, and how changes are verified.

## Current behavior with evidence status

- The repository is a Git repository on branch `main`. Evidence status: VERIFIED
  (`git init`, `git symbolic-ref HEAD refs/heads/main`, 2026-09-19).
- Toolchain present on the development machine: Git 2.51.0, Python 3.13.5, Node 22.16.0.
  Evidence status: VERIFIED (`git --version`, `python --version`, `node --version`, 2026-09-19).
- The Spec Anchor guard is installed at `scripts/check-spec-sync.py`, copied verbatim from the
  `sdd-spec-anchor` skill. Evidence status: VERIFIED — `--baseline` exits 0 with an empty unmapped
  list, and rejects a planted unmapped file with exit 1 (2026-09-19).
- The repository skeleton exists: a pnpm workspace with `apps/web` (Next.js) and a uv-managed
  Python worker at `services/worker`. Both install, lint, typecheck, test and build.
  Evidence status: VERIFIED (TASK-0001 evidence ledger, 2026-09-19).
- Toolchain versions in use: pnpm 12.4.2, uv 0.12.17, TypeScript 5.9.3, Next.js 15.5.25.
  Evidence status: VERIFIED (2026-09-19).
- The repository has a public remote at `https://github.com/Aurevanta/tattoo_studio`, transferred
  from `Miguelcp777/tattoo_studio` on 2026-10-17 (TASK-0132). Evidence status: VERIFIED
  (`git ls-remote origin` returned `refs/heads/main`; the GitHub API reports `public`, 2026-10-17).
- A GitHub Actions workflow at `.github/workflows/ci.yml` declares five jobs and **passes**.
  Evidence status: VERIFIED — run #1 at commit `652f938`: spec coverage, TypeScript,
  Python (contracts), Python (worker) and codegen all succeeded on `ubuntu-latest`.
- The `TattooBrief` contract exists and is verified in both runtimes (TASK-0002).
  Evidence status: VERIFIED — 81 tests across four packages.
- No engine code exists. There is no queue, storage, moderation or product surface.
  Evidence status: OBSERVED.

## Intended behavior

Layout, with `[x]` marking what exists today:

```
[x] contracts/              shared JSON Schemas, fixtures, both runtime packages
[x] apps/web/               Next.js UI and BFF
[ ] packages/consultation/  brief-building state machine
    services/worker/
[x]   app/                  FastAPI entrypoint, settings
[ ]   generation/           provider adapter over hosted image models
[ ]   flash/  stencil/  mockup/
[ ]   media/  safety/  jobs/
[x] scripts/                repository tooling, including the guard
[ ] infra/                  deployment configuration
[x] .github/workflows/      CI
[x] .specanchor/            specifications, decisions, tasks, evidence
```

Directories for modules whose tasks have not started are deliberately absent rather than filled
with placeholder packages. Their paths are declared in the module map ahead of the code, so the
first commit introducing them is already anchored.

Any new top-level source tree must be added to `.specanchor/module-map.json` in the same change.

## Constraints

- The guard requires Python 3.10+, Git, and at least one commit.
- `anchor.yaml` is JSON despite its extension, must be version 2, and must carry exactly the keys
  `version`, `spec_root`, `module_map`, `material_paths`, `exclude_paths`. Unknown keys fail.
- Guard path patterns use Python `fnmatch`, where `*` matches slashes and `**` has no special
  meaning. Module globs must therefore not nest, or a file acquires two owners.

## Invariants

- SETUP-INV-001: Every material file is owned by exactly one module in the map. `--baseline`
  reports an empty `unmapped` list.
- SETUP-INV-002: `scripts/check-spec-sync.py` is not modified locally. Guard behavior changes come
  from upgrading the skill.

## Conventions

TypeScript workspace, from the repository root (covers `apps/web` and `contracts`):

```sh
pnpm install
pnpm lint          # eslint + prettier --check
pnpm typecheck     # tsc --noEmit, strict
pnpm test          # vitest
pnpm --filter web build
```

Python — run in **both** `contracts/python` and `services/worker`:

```sh
uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy .      # strict
uv run pytest
```

Documentary coverage:

```sh
python scripts/check-spec-sync.py --baseline
python scripts/check-spec-sync.py --review .specanchor/evidence/impact-review.json
python scripts/check-spec-sync.py --base origin/main --review .specanchor/evidence/impact-review.json
```

`--base origin/main` works once `git fetch origin` has run. `--base HEAD~1` remains useful for
checking a single commit locally.

The guard proves documentary coverage only. It cannot produce a semantic verdict, so every task
additionally records a Spec to Code and a Code to Spec review.

## Non-goals

- Monorepo build orchestration (Nx, Turborepo) in v0.
- Containerized local development in v0.

## Evidence / sources

| Statement | Evidence status | Source / revision |
|---|---|---|
| Git repository on `main` | VERIFIED | `git init` 2026-09-19 |
| Toolchain versions | VERIFIED | Version commands 2026-09-19 |
| Guard rejects unmapped files | VERIFIED | Planted-file probe, exit 1, 2026-09-19 |
| Both runtimes install, lint, typecheck, test | VERIFIED | TASK-0001 EV-002, EV-003 |
| Web app builds | VERIFIED | `pnpm --filter web build` exit 0, 2026-09-19 |
| CI workflow structure | VERIFIED | 5 jobs, executed |
| CI actually passes | VERIFIED | GitHub Actions run #1, commit 652f938, 5/5 jobs success |
| Checks pass on Linux | VERIFIED | CI runs on `ubuntu-latest` |
| Remaining directory layout | INTENT | Planning session 2026-09-19 |

## Unknowns

- Target deployment platform and region are undecided. Region has GDPR residency consequences.
- Branch protection is not configured. `main` currently accepts direct pushes, so CI passing is
  advisory rather than enforced. Changing it is an external repository setting and needs its own
  authorization.
- The `--review` gate is not automated in CI. Generating an impact review at CI time from a task's
  recorded classification needs tooling that does not exist yet, so CI currently runs `--baseline`
  only. Review-based coverage is run locally per task.

Resolved 2026-09-19 in TASK-0001: CI provider is GitHub Actions; package managers are pnpm and uv.

## Change history

- 2026-09-19: Created during SDD bootstrap.
- 2026-09-19 (TASK-0001): Skeleton, toolchain and CI added. Layout, commands and guard behavior
  move from INTENT to VERIFIED for the parts that now exist. CI execution remains UNKNOWN.
- 2026-09-19 (TASK-0011): Remote added and CI executed for the first time, passing all five jobs.
  CI execution and Linux behavior move from UNKNOWN to VERIFIED.
