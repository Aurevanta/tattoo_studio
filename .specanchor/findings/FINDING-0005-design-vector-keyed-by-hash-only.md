---
type: finding
id: FINDING-0005
created: 2026-10-16
status: resolved
raised_by: TASK-0116
affects: [platform]
resolved_by: TASK-0126
---

# FINDING-0005: `design_vector` is keyed by the design hash alone

## What was noticed

During TASK-0116's browser check, a harness seeded three designs with the test provider, which
draws the same picture for every idea. All three had the same `designId` (the hash of the artwork at
its size). Afterwards one vector file was stored but referenced by nothing. Evidence: OBSERVED
(harness database, 2026-10-16).

`design_vector` has `design_id` as its primary key and `Studio.store_vector` writes with
`INSERT OR REPLACE` (`services/worker/app/studio.py`). Storing the same physical design again —
for another version, or another account — replaces the row and leaves the previous vector file
unreferenced. The key does not include the owner, so in principle two accounts producing the same
hash would overwrite each other's row; `load_vector` filters by owner, so the other account would
then find no vector and fall back as for a design made before TASK-0024. Evidence: OBSERVED (code);
cross-account collision INFERRED, since identical artwork bytes from a real provider are unlikely.

## Why it matters

- The orphaned vector file is not erased when its design is deleted (TASK-0116), only when the
  account erases everything. A small storage leak, not a privacy one: a vector shows no person.
- Not caused by TASK-0116: it predates it. TASK-0116's deletion keeps a vector row while any
  remaining version shows that design, which is correct under the current key.

## Suggested resolution

Key `design_vector` by `(owner, design_id)` and, on a repeated store, either reuse the existing
vector or erase the replaced file. Needs a migration of the table.

## Resolution (TASK-0126, 2026-10-16)

`design_vector` is keyed by `(owner, design_id)`; an existing table is migrated on start
(`migrate_design_vector`), keeping its rows. `store_vector` reuses the vector the account already
keeps for that design (its identity is the hash of that geometry) and stores a new one only when
there is none or its file is gone, dropping the dead ownership row. Because one vector now serves
several versions, erasing the version that stored it first re-homes it under a remaining
version's reference (`_rehome_vectors`), or the cascade from the erased reference would take it. Rows already overwritten by
another account before the migration cannot be recovered; those designs keep falling back as before.
Orphan vector files left before TASK-0126 are not swept; they are erased with the account.
