---
name: "W2: spur feature move — cascade rename for hierarchy changes"
description: "W2: spur feature move — cascade rename for hierarchy changes"
status: done
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-14T22:20:54.841Z
folder: docs/tasks
type: task
feature-id: F3
priority: P2
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0061. "W2: spur feature move — cascade rename for hierarchy changes"

### Background

Design §2.4/DD-14: moves are renames (ID encodes position); rare, CLI-mediated. Surface addition — sync the delivery doc + 04_DESIGN when built.


### Requirements

R1. spur feature move <id> --parent <id>: re-allocates ID, renames file, cascades to all descendants.
R2. Updates every task feature_id edge; History entries appended on all touched files.
R3. Atomic under the lock domain; dry-run report.


### Q&A



### Design

Authority: design §2.4 + DD-14 (moves are renames because the ID encodes position; rare, CLI-mediated,
cascade: descendants re-IDed, files renamed, every task `feature_id` edge updated, History entries
appended on all touched files; atomic within the lock domain). Surface addition: the verb is
`spur feature move <id> --parent <id>` — sync the delivery doc §1.2 and `04_DESIGN §7.2` in the landing
commit (this task settles the doc drift it would otherwise create).


### Solution

1. FeatureService `move`: compute target ID (next free digit under new parent, ≤9 enforced), map old→new
   for the node + all descendants, then execute as one write-service batch: file renames + frontmatter id
   rewrites + task edge updates + History appends.
2. `--dry-run`: full old→new mapping + affected-task report, zero writes.
3. Atomicity: all-or-nothing under the create-lock + entity locks; failure mid-cascade rolls back via the
   dry-run plan (apply only after full plan validates).
4. Tests: multi-level subtree move with linked tasks; collision (target parent full) rejected; dry-run
   write-free. Same commit: delivery doc + `04 §7.2` surface sync. Gate: ≥90%.


### Plan

- [x] `FeatureService.move(id, newParentId, {dryRun})` — replaced the stub
- [x] R1: subtree old→new ID map (next free digit ≤9; descendants keep relative suffix); file renames + `id` frontmatter rewrite
- [x] R1: reject move-into-own-subtree + deep-id collision (validate before any write)
- [x] R2: update every task `feature_id` edge in the subtree; append move History line on touched feature files
- [x] R3: `--dry-run` (full map + affected tasks, zero writes); apply is best-effort atomic with mid-cascade rollback
- [x] CLI `spur feature move <id> --parent <id> [--dry-run] [--json]`
- [x] R3: run the whole allocate→validate→apply inside `acquireCreateLock(featuresDir)` (lock-domain atomicity)
- [x] Tests: multi-level cascade, task-edge, dry-run write-free, collision, into-own-subtree, rollback; CLI dry-run/apply/exit-1
- [x] R-doc: `04_DESIGN §7.2` move row + delivery doc §1.2 `move` row (the doc drift this task settles)


### Review

**SECU verdict: FAIL → PASS** (verified + fully implemented 2026-06-14 via `/rd3:dev-verify 0061 --force --fix all`)

As shipped, `FeatureService.move` was a **pure stub** (`return { movedCount: 0 }`) — no subtree re-ID, no
file renames, no task-edge updates, no CLI subcommand, no dry-run, no tests. All of R1/R2/R3 UNMET. Built
the full cascade-rename during the fix-pass.

**S — Security:** Feature/task ids validated (`^[A-Z][1-9]*$` / WBS); all writes via `atomicWriteAsync`
(DD-05 crash-safe); no injection surface.

**C — Correctness / architecture:**
- R1 ✓ `move(id, newParentId, {dryRun})`: target id = next free digit under the new parent (≤9 via
  `allocateId`); maps the node + ALL descendants preserving relative suffix (A1→B1, A11→B11); renames each
  file (atomic-write new path + delete old), rewrites `id` frontmatter. Validates first: rejects moving
  into own subtree, and a deep-id collision (mapped id already exists) before any write.
- R2 ✓ every task whose `feature_id` is in the moved subtree is rewritten to the new id; a move History
  line (`- {ts} moved A1 → B1 (system)`) is appended on every touched feature file.
- R3 ✓ The whole allocate→validate→apply runs **inside the create-lock** (`acquireCreateLock(featuresDir)`,
  released in `finally`) — the same lock `create` uses, so a concurrent create/move cannot allocate a
  colliding target id or interleave with the cascade (the Solution's "under the create-lock" requirement).
  `--dry-run` returns the full old→new map + affected-task wbs list with **zero writes**. Apply is
  best-effort atomic: the full plan validates before any write; a mid-cascade failure rolls back (created
  files deleted, originals restored from in-memory backup) and rethrows. Verified by an injected
  mid-cascade write failure test.
- CLI ✓ `spur feature move <id> --parent <id> [--dry-run] [--json]`, exit 0/1, wired into the feature command.

**U — Usability:** Human output lists the old→new map (dry-run) or a moved/updated count; `--json` returns
`{ movedCount, mapping, tasksUpdated, dryRun }`.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | `FeatureService.move` was a stub returning `{movedCount:0}` — R1 (cascade re-ID/rename), R2 (task-edge updates + History), R3 (atomic + dry-run) all unimplemented; no CLI subcommand; no tests. | Correctness | `feature-service.ts` move | P1 | **FIXED** — full cascade implementation + CLI + 6 service tests + 3 CLI tests; E2E-verified. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1088 pass / 0
fail · `feature-service.ts` 98.3% line / 93.9% func · `feature.ts` 96.3% func / 93.6% line · E2E `spur feature
move A1 --parent B` cascades A1→B1, A11→B11, updates the task edge; `--dry-run` writes nothing.


### Testing

Verified 2026-06-14. Real cascade tests (no stubs).

- `packages/app/tests/services/feature-service.test.ts` — 6 move tests over an isolated corpus (A, A1, A11,
  B + a task linked to A1):
  - R1: cascade A1→B1, A11→B11; files renamed, A/B untouched; `id` frontmatter rewritten + move History line.
  - R2: the linked task's `feature_id` edge updated (A1 → B1).
  - R3: `--dry-run` reports the map + affected tasks with zero writes (disk unchanged).
  - R1: rejects moving a feature into its own subtree.
  - R1: allocation skips taken sibling digits (B1 taken → moves to B2).
  - R3: a genuine deep-id collision (pre-seeded B11) is rejected before any write.
  - R3: a mid-cascade write failure (injected on the 2nd feature write) rolls back — B1 removed, A1/A11 restored.
- `apps/cli/tests/commands/feature.test.ts` — `feature move` `--dry-run --json` (map shape), apply
  (human summary + the source id gone from `list`), and move-into-own-subtree → exit 1.

E2E through the real CLI: `feature move A1 --parent B` → A1_sub.md→B1_sub.md, A11_deep.md→B11_deep.md, task
`feature_id: A1`→`B1`; `--dry-run` leaves all files unchanged.

Full suite: 1088 pass / 0 fail. `feature-service.ts` 98.3% line / 93.9% func.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


