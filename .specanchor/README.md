# Project Spec Anchor

This repository uses the `sdd-spec-anchor` protocol. Contracts live here; code is verified against
them in both directions.

## Layout

| Path | Contents |
|---|---|
| `global/` | Durable cross-cutting contracts |
| `modules/` | One spec per module in `module-map.json` |
| `decisions/` | ADRs |
| `tasks/` | Task specs, `TASK-NNNN.spec.md` |
| `evidence/` | Baselines and impact reviews |
| `findings/` | Out-of-scope discoveries |

## Choosing a task type

- **Light change** (`templates/task-lite.md`): localized, no change to an API, schema, permission,
  integration or architectural contract.
- **Full change** (`templates/task-spec.md`): new feature, cross-module work, or any contract
  change. Omit sections that do not inform a decision.

When in doubt, a change that touches anything listed under *Domain invariants* in a module spec is
a full change.

## Working protocol

1. Load the relevant global and module specs before editing.
2. Create a uniquely identified task. Record current behavior, desired behavior, scope and
   measurable acceptance criteria before implementing.
3. For contract changes, update the module spec before or alongside the code. The guard enforces
   this: a `contract` classification requires the affected module specs to have changed.
4. Implement, referencing IDs as `TASK-0007/REQ-001` and `TASK-0007/AC-001`.
5. Review the actual diff in both directions. Never rewrite a spec merely to legitimize an
   accidental implementation change.
6. Record a structured impact review and run the guard.
7. Close only when affected acceptance criteria pass and both reviews are complete.

## Commands

Local staged, unstaged and untracked changes:

```sh
python scripts/check-spec-sync.py --review .specanchor/evidence/impact-review.json
```

Committed branch changes against the target branch (`main`):

```sh
python scripts/check-spec-sync.py --base origin/main --review .specanchor/evidence/impact-review.json
```

Inventory and unmapped-file check:

```sh
python scripts/check-spec-sync.py --baseline
```

Project test suites run as **separate** checks, never bundled with the guard result:

```sh
# TypeScript, from the repository root
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build

# Python: run in BOTH contracts/python and services/worker
uv sync && uv run ruff check . && uv run ruff format --check . && uv run mypy . && uv run pytest
```

`--base origin/main` works after `git fetch origin`. The remote is
`https://github.com/Aurevanta/tattoo_studio` (public).

**The impact review is bound to one revision.** It carries the HEAD it was produced at, and the
guard rejects it against any other (`Review revision must match HEAD`). So the committed
`evidence/impact-review.json` is stale the moment another commit lands — that is the guard working
as designed, not a failure. Regenerate it at the current HEAD when verifying a change.

A document cannot contain its own commit hash, which is why the guard treats the review as an
execution-time artifact rather than a durable one. The copy kept in `evidence/` is a record of what
was reviewed, not a reusable gate.

**Known enforcement gap:** CI runs `--baseline` only. The `--review` gate needs an impact review
generated at CI time from the task's recorded classification, and that tooling does not exist.
Review-based coverage is currently a local, manual step per task.

**Follow-up worth doing:** a small script that regenerates the review from a task spec at the
current HEAD would close most of that gap and remove the hand-assembly step. Not yet written.

## What the guard does and does not prove

The guard checks documentary coverage: that changed files are classified, mapped to specs, and
linked to evidence that exists. It does **not** check whether the rationale is true, whether tests
actually ran, or whether code and spec agree in meaning.

Report the two results separately, always:

- Documentary coverage: `PASS` / `FAIL` / `NOT_RUN`
- Functional alignment: `ALIGNED` / `PARTIAL` / `DRIFT` / `NOT_VERIFIED`, in each direction

A guard pass is never evidence of correctness.

## Configuration notes

- `anchor.yaml` is JSON despite its extension. It must be version 2 and carry exactly the keys
  `version`, `spec_root`, `module_map`, `material_paths`, `exclude_paths`. Unknown keys fail.
- Patterns use Python `fnmatch`, where `*` matches slashes and `**` means nothing special.
  Module globs must not nest, or a file gets two owners and every change needs both specs.
- Adding a top-level source tree requires updating `module-map.json` in the same change.
