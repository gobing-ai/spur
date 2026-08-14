---
template: issue
schema_version: 1
name: "Prevent migration-number collisions between parallel features"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:15.298Z"
updated_at: "2026-08-14T19:34:32.464Z"
---

## 0562. Prevent migration-number collisions between parallel features

### Background
During the E6 batch (2026-08-14), two features in parallel claimed the same incremental migration number: task 0553 (E5-adjacent) shipped `0012_spur_cli_history_tool_call_args_raw`, while E6 task 0557 shipped `0012_spur_cli_history_run_session`. Both lived in `packages/domain/src/migrations.ts` CLI_SCHEMA_SQL. The duplicate only surfaced at integration: the E6 worktree branch could not fast-forward (main had advanced), and the manual merge required renumbering E6's migration to `0013_spur_cli_history_run_session` (commit fa41669c). A collision check at planning time would have caught this before any implementation ran. Evidence: migrations.ts (both ids present), git log `fa41669c`, report §2 RC5.
### Requirements
- [ ] R1. Two migrations can never share a numeric prefix — a check over `CLI_MIGRATIONS` (`packages/domain/src/migrations.ts:288-322`) fails when two entries carry the same four-digit prefix, naming both colliding ids. String-id uniqueness is not sufficient: the incident's two entries (`0012_spur_cli_history_tool_call_args_raw`, `0012_spur_cli_history_run_session`) are distinct strings colliding only on the prefix.
- [ ] R2. Prefixes stay strictly ascending — the same check fails on a non-monotonic sequence, so a renumber that lands out of order (or a gap-filling reuse of a retired number) is caught rather than silently applied in array order.
- [ ] R3. The check runs in the standard gate — it lives in `packages/domain/tests/dao/migrations.test.ts` under the existing `CLI_MIGRATIONS` describe block, so `bun run test` (and therefore `spur-check`) fails on a collision with no new command, script, or CLI surface.
- [ ] R4. The allocation rule is written down — `CLAUDE.md`'s Database/migrations section states that a new migration takes `max(prefix)+1` and that a merge surfacing a duplicate prefix is renumbered on the incoming branch (the E6 precedent, commit `fa41669c`).
### Acceptance Criteria
```gherkin
Scenario: R1 — two migrations sharing a numeric prefix fail the check
  Given a CLI_MIGRATIONS array holding 0012_spur_cli_history_tool_call_args_raw and 0012_spur_cli_history_run_session
  When the migration-id check runs
  Then it fails
  And the failure message names both colliding ids

Scenario: R2 — a non-ascending prefix sequence fails the check
  Given a CLI_MIGRATIONS array whose prefixes are not strictly ascending
  When the migration-id check runs
  Then it fails and names the offending position

Scenario: R2 — the current array passes
  Given CLI_MIGRATIONS as shipped (0000 through 0013)
  When the migration-id check runs
  Then it passes

Scenario: R3 — the check runs inside the standard gate
  Given the migration-id check lives in packages/domain/tests/dao/migrations.test.ts
  When bun run test runs
  Then the check executes without any new command or script being invoked

Scenario: R4 — the allocation rule is documented
  Given CLAUDE.md's Database / migrations section
  When an author needs a new migration number
  Then it states max(prefix)+1 and that a duplicate surfaced at merge is renumbered on the incoming branch
```
### Q&A
**Q1 — Test or runtime guard?** Test. A duplicate prefix is an authoring mistake caught while both
entries are in one tree; `applyCliMigrations` throwing on it would fail an end user's migrate for a
developer's merge error, and the migrations still apply correctly today (the journal keys on the full
id). **Closed: test-only**, in the file that already owns `CLI_MIGRATIONS` coverage.

**Q2 — Why not prevent the collision before the merge?** It cannot be done without a shared
allocator both branches write to — a registry service or a reserved-number file — which is more
machinery than a renumber-at-merge costs. **Closed: detect at merge, document the allocation rule
(R4).**

**Q3 — Does `drizzle/*.sql` need the same check?** Not here. Its `_spur_cli_` files are already a
partial mirror of `CLI_MIGRATIONS` (0004, 0010, 0012, 0013 have no file), so the two sets disagree
today for reasons predating this defect. **Deferred** — reconciling the drizzle mirror is separate
work and should not be smuggled into this task.

**Q4 — `feature_id` is unset.** This is E6-batch remediation and E6 is already `done`, so linking a
backlog task under it would leave a done feature holding unfinished work. **Deferred to the
operator** — link to a remediation feature if one is opened, otherwise leave unset (the L4 advisory
is expected and non-blocking).
### Design
**Fix target: a prefix uniqueness + strict-ascent assert over `CLI_MIGRATIONS`, added to the existing `describe('CLI_MIGRATIONS')` block in `packages/domain/tests/dao/migrations.test.ts`. No new command, script, CLI surface, or production code.**

#### Why not where it was filed

The originally-filed target (batch-create / feature-check in `packages/app`) is the wrong layer and
was rejected on inspection. Those are task/feature *corpus* surfaces; nothing in them reads source
code, and no migration-id allocation exists there or anywhere else — `CLI_MIGRATIONS`
(`packages/domain/src/migrations.ts:288-322`) is a hand-written array with no guard of any kind.
Teaching `batch-create` to scan `migrations.ts` would fire on every task batch in the repo,
regardless of whether the batch touches the database, to catch a defect that a short assert in the
package owning the array catches deterministically.

#### What the check must actually compare

`applyCliMigrations` (`migrations.ts:326-345`) keys its journal on the full id string, so the two
colliding entries both applied cleanly — there was no runtime failure, only merge friction. A plain
`new Set(ids).size === ids.length` assert would therefore have **passed**. The collision is on the
leading four digits.

#### Frozen rule

- Parse: `const prefix = Number.parseInt(id.slice(0, 4), 10)` over each `CLI_MIGRATIONS[i].id`. Every
  shipped id is `NNNN_spur_cli_*`; a non-numeric prefix is itself a failure.
- Assert 1 (R1): no two entries share a prefix. Failure names **both** ids, e.g.
  `duplicate migration prefix 0012: 0012_spur_cli_history_tool_call_args_raw, 0012_spur_cli_history_run_session`.
- Assert 2 (R2): prefixes are strictly ascending in array order. Failure names the offending index
  and the two ids around it. Strict ascent subsumes uniqueness, but both are asserted so the failure
  message says *which* defect occurred.
- Contiguity (no gaps) is **not** asserted — a retired migration would make a gap legitimate, and
  gaps are harmless where duplicates are not.

#### Timing — what this can and cannot prevent

Two branches each adding a locally-valid `0012` cannot be detected before they meet: preventing that
needs a shared allocator (a registry service or a reserved-number file both branches write), which is
more machinery than the defect is worth. The assert fires the moment both entries coexist in one tree
— the merge — which is exactly when renumbering is cheapest and unambiguous. That is the
deterministic backstop; R4's written rule is the prevention half.

#### Anti-patterns — do not implement

- Do **not** put the check in `batch-create` / `feature-check`, or in any corpus surface.
- Do **not** throw from `applyCliMigrations` at runtime. This is a development-time authoring
  mistake; failing a user's migrate on it converts a merge annoyance into a broken install.
- Do **not** add a `spur` CLI verb or a `scripts/spur-dev.ts` command for it — `bun run test` already
  runs this file inside `spur-check`.
- Do **not** assert contiguity, and do **not** extend the check to `drizzle/*.sql`: those
  `_spur_cli_` files are already a partial mirror (0004, 0010, 0012, 0013 have no file), so any
  contiguity assert there fails today for reasons unrelated to this defect. Separate work.

**Aggravating factor, not the fix.** The collision was made possible by the one-writer-per-tree rule
being broken — a parallel session committed to main mid-batch. That is process, already covered in
`CLAUDE.md`; this task delivers the mechanical backstop only.

**Measurable target:** add a duplicate-prefix entry to `CLI_MIGRATIONS` locally, run
`bun test packages/domain/tests/dao/migrations.test.ts`, observe a failure naming both ids, revert.
### Plan
- [ ] 1. Add the prefix uniqueness + strict-ascent assert to the existing `CLI_MIGRATIONS` describe block in `packages/domain/tests/dao/migrations.test.ts` (R1, R2, R3)
- [ ] 2. Confirm it fails as designed — temporarily duplicate a prefix, observe the named-collision failure, revert (R1)
- [ ] 3. Confirm the shipped array (0000-0013) passes unchanged (R2)
- [ ] 4. Add the `max(prefix)+1` allocation rule and the merge-renumber precedent to `CLAUDE.md`'s Database / migrations section (R4)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Code (subject): `packages/domain/src/migrations.ts:288-322` (`CLI_MIGRATIONS`) · `:326-345` (`applyCliMigrations`, journals on the full id string)
- Code (fix target): `packages/domain/tests/dao/migrations.test.ts` — existing `describe('CLI_MIGRATIONS')` block
- Evidence: the two colliding ids at `migrations.ts:317` and `:321` (post-renumber) · merge commit `fa41669c` (`0012_spur_cli_history_run_session` → `0013_...`)
- Doc target: `CLAUDE.md` § Database / migrations
- Related process rule: `CLAUDE.md` § Conventions — one writer per working tree (task 0487 R5), the aggravating factor
- Report: `docs/report/2026-08-14-E6-batch-forensic-report.md` §2 RC5 / §4
### History
