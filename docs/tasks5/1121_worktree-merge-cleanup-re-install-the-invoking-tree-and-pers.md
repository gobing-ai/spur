---
schema_version: 1
name: "Worktree merge/cleanup: re-install the invoking tree and persist the feature receipts"
status: wip
template: feature-impl
created_at: 2026-10-07T20:52:32.965Z
updated_at: "2026-10-07T23:21:30.468Z"

feature_id: H15
priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 1.5
---

## 1121. Worktree merge/cleanup: re-install the invoking tree and persist the feature receipts

### Background

Two gaps found 2026-10-07 while merging `sp/runall-g31-d3b771` back to `main` in knowledge-kit.

**1. A landed workspace package leaves the invoking tree unresolved.** The branch adds `packages/kk-store`. After the merge landed on `main`, the repo-wide gate failed with misleading errors:

```
@goberg-ai/kk-store typecheck: tests/helpers.ts: Cannot find module '@gobing-ai/kk-core'
@knowledge-kit typecheck: src/commands/store.ts: Cannot find module '@gobing-ai/kk-store'
@knowledge-kit typecheck: tests/store-label.test.ts: Parameter 'level' implicitly has an 'any' type
```

The last is pure knock-on from the first two. `bun install --frozen-lockfile --ignore-scripts` in the invoking tree linked the new workspace package and the typecheck went to **0 errors**. The green gate evidence produced inside the worktree does not transfer to the receiving tree until its `node_modules` is re-linked.

**2. Gitignored per-tree verification receipts are destroyed with the worktree.** `feature-verification` writes `.spur/memory/evidence/<feature>-feature-verification.json` (run-scoped + `feature-latest`). That plane is gitignored, so G71 and G31's receipts — produced inside the worktree — died when the worktree was removed, and both features' terminal gates immediately reported `L4.feature-receipt-missing`. The batch contract's persist-out obligation covers run rows, run records and cited artifacts; it does **not** name these receipts, so nothing copied them. They are re-runnable (a fresh foreground pass on a clean tree fixed G31), but the loss is invisible until the gate is next read.

Related, same session: the receipt is digest-bound, so any later tree change makes it `stale` (`L4.feature-receipt-stale`) even on the correct tree.

**Refine corrections (2026-10-07)**

- **R2 is invalid: it is already implemented.** `persistWorktreeRuns` in `packages/app/src/services/inline-run-setup.ts` (~`:356-400`, receipt branch at `:388`) copies every `.spur/memory/evidence/*-feature-verification.json`: both the run-scoped and the feature-latest copy (task 1026, commit 7e65692e0, 2026-10-01). It is tested in `packages/app/tests/services/persist-worktree-runs.test.ts:77,115`. The pre-removal guard `plugins/sp/scripts/persist-out-check.ts` (task 1067) refuses removal when evidence would be lost, and `execution-batch.md` documents it ("Durable planes ride it too", E71). The receipts were most likely lost because the teardown bypassed the WT-4a/WT-4 recipe (manual removal or an older build). The worktree is gone, so this cannot be confirmed. Knowledge-kit now holds fresh G31/G71 receipts.
- **R3 dropped.** Persist-out already names what landed (task 1090), and when the recipe is followed nothing on the durable planes is lost. A "re-runnable vs lost" report would describe a state the recipe prevents.
- **R4 rejected** (see Q&A). The feature-verification pass runs the repo-wide checks (ADR-119), so a change anywhere can invalidate them. The receipt is fail-closed by design, and the one-writer-per-tree rule covers the concurrent-writer case.
- **R1 confirmed and sharpened.** Neither the create-mode nor the reuse-mode WT-4 sequence in `plugins/sp/skills/spur-dev/references/execution-batch.md` (~`:960-1150`) relinks the invoking tree after `git merge --ff-only`. The worktree install convention is `bun install --frozen-lockfile --ignore-scripts` (`:769`); `--ignore-scripts` is required (task 0701 R2a, lefthook `prepare`). The trigger is any landed change to `bun.lock` or a `package.json`, not only an added/removed workspace package: a dependency bump has the same symptom.

### Requirements

- [ ] R1. The WT-4 landing sequence in `execution-batch.md`, in both create and reuse mode, gains a step WT-4d. After the landed verify and before the success-marker write (`write_marker`), if `git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock '*package.json'` is non-empty, it runs `bun install --frozen-lockfile --ignore-scripts` in the invoking tree.
- [ ] R2. A WT-4d install failure is a non-fatal, named warning, not a halt: the merge has already landed and the marker still records success. The batch report states "invoking tree workspace links are stale — run `bun install --frozen-lockfile --ignore-scripts`", so the next gate failure is not misread as a regression.
- [ ] R3. WT-4d is skipped silently when the landed diff touches no manifest or lockfile, so ordinary batches pay no install cost.
- [ ] R4. `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` pins WT-4d in both modes: present, placed after the landed verify and before the success-marker write (`write_marker`), with `--frozen-lockfile --ignore-scripts`, and with the manifest/lockfile diff condition.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A landed manifest change relinks the invoking tree before the success marker (req: R1, R3, R4)
  Given execution-batch.md create-mode and reuse-mode WT-4 sequences
  When the contract test reads each sequence
  Then each contains WT-4d after the landed verify and before the success-marker write (`write_marker`), guarded by a `git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock '*package.json'` check, running `bun install --frozen-lockfile --ignore-scripts`

Scenario: AC2 — A failed relink warns and names the stale workspace state without halting (req: R2)
  Given the WT-4d step text
  When the install command fails
  Then the recipe records a warning naming the stale invoking-tree workspace links and the remedy command in the batch report, and still performs the success-marker write (`write_marker`)
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:29:13.357Z

- **R4 (receipt digest tolerance) rejected.** The receipt certifies a repo-wide feature pass (ADR-119: the feature-scoped repo-wide check). A change to any file can break a check that pass ran, so scoping the digest to "the feature's own surfaces" would certify results the tree no longer has. Concurrent writers are handled by the one-writer-per-tree rule. A stale receipt is the correct, cheap signal: re-run `feature-verification` on the final tree.
- **R2 (persist receipts) closed as already done** by task 1026 and guarded by task 1067. No code change.
- **Relink unconditionally on manifest change, not only on added/removed workspaces.** Detecting "workspace set changed" needs a manifest parse. A lockfile/manifest diff is a strict superset, costs nothing to compute, and also covers dependency bumps that produce the same symptom.
- **Warn, don't halt.** At WT-4d the merge has landed and evidence is persisted. Halting would leave a `retained` marker for a tree that is correct in git and only needs an idempotent local install.
- **Single owner:** `cross-cutting.md:577` delegates worktree landing to `execution-batch.md`, so only that file changes.

### Design

**Surface:** `plugins/sp/skills/spur-dev/references/execution-batch.md` (create mode, after WT-4c and before the success-marker write (`write_marker`); reuse mode, after Step 5 persistence and before its the success-marker write (`write_marker`)), plus its contract test.

```bash
# WT-4d — relink the invoking tree when the landed diff touched a manifest or the lockfile (task 1121).
# The gate evidence came from the worktree's node_modules; the receiving tree still links the old
# workspace set until it is re-installed. --ignore-scripts mirrors the worktree convention (0701 R2a).
if git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock '*package.json' | grep -q .; then
  bun install --frozen-lockfile --ignore-scripts \
    || echo "WT-4d warning: invoking tree workspace links are stale — run 'bun install --frozen-lockfile --ignore-scripts'" \
       | tee -a ".spur/run/worktree-<marker-id>-batch-report.md" >&2
fi
```

**Invariants.**
- WT-4d runs per-call pinned to the invoking tree (task 1058 protocol), like every other WT-4 command.
- It reads only the captured `BASE_TIP`/`BATCH_TIP`, never a branch name (the branch may be gone).
- It never changes the marker status or halts.
- The git pathspec `'*package.json'` matches nested manifests (pathspec globs cross `/`).
- Add one sentence to the prose after each block naming WT-4d.

### Plan

1. Extend `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` with AC1/AC2 assertions for both modes; confirm they fail on the current spec.
2. Insert WT-4d into both WT-4 sequences in `execution-batch.md` and mention it in the halt/fallthrough prose.
3. Focused: `(cd plugins/sp && bun test tests/dogfood-testing/execution-batch-contract.test.ts)`.
4. E2E: in a scratch Bun workspace repo, cut a worktree branch that adds `packages/x`, land it with the WT-4 sequence, and show that the invoking tree's `bun run typecheck` passes without a manual install. Save the transcript as `.spur/run/1121-wt4d-e2e.log`.
5. `bun run spur-check`.

### Solution

Change map (WT-4d — relink the invoking tree when the landed diff touched a manifest/lockfile):

- AC1 (R1, R3, R4) — `plugins/sp/skills/spur-dev/references/execution-batch.md:1086-1093` (create-mode WT-4d): inserted after WT-4c (`:1084-1085`) and before the success-marker write `write_marker merged` (`:1096`), i.e. after the landed verify (`:998-1001`); guarded by `git diff --name-only "$BASE_TIP" "$BATCH_TIP" -- bun.lock '*package.json'` (`:1089` — silent skip when empty, R3) and runs `bun install --frozen-lockfile --ignore-scripts` in the invoking tree (`:1090`).
- AC1 (R1, R3, R4) — `plugins/sp/skills/spur-dev/references/execution-batch.md:1165-1172` (reuse-mode WT-4d): inserted after the Step 5 report persistence (`:1159-1164`) and before its success-marker write `write_marker merged` (`:1177`), likewise after the landed verify (`:1142-1145`); same guard and install command.
- AC2 (R2) — both blocks: a failed install only appends "WT-4d warning: invoking tree workspace links are stale — run 'bun install --frozen-lockfile --ignore-scripts'" to `.spur/run/worktree-<marker-id>-batch-report.md` via `tee -a` plus stderr (`:1091-1092` create, `:1170-1171` reuse) and execution continues to the success marker — never a halt, never a marker change. Prose naming the non-fatal contract: `:1101-1103` (create mode) and `:1180-1183` (reuse mode).
- R4 — `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1063-1114`: new describe pins WT-4d in both modes — presence, placement after the landed verify (and after WT-4c / Step 5 persistence respectively) and before the success-marker write (`:1074`, `:1089`), `--frozen-lockfile --ignore-scripts`, the manifest/lockfile diff guard exactly once per mode (`:1104`), and the non-fatal stale-links warning carried in the batch report (`:1108`). Pins confirmed red before the spec edit and green after.

Sanity: the exact WT-4d snippet was exercised in a scratch git repo — nested `packages/x/package.json` triggers one install; a docs-only diff skips silently (no install, no report); a failing install exits 0 and appends the stale-links warning line to the batch report.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `plugins/sp/skills/spur-dev/references/execution-batch.md:769` — worktree install convention; `:960-1150` — WT-4 create/reuse sequences.
- `packages/app/src/services/inline-run-setup.ts:388` — persist-out copies feature-verification receipts (task 1026).
- `packages/app/tests/services/persist-worktree-runs.test.ts:77,115` — receipt persistence tests.
- `plugins/sp/scripts/persist-out-check.ts` — pre-removal evidence guard (task 1067).
- `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` — WT-4 contract pins.
- Feature H15 (batch execution productization).

### History

- 2026-10-07T21:29:45.118Z backlog → todo (system)
- 2026-10-07T23:21:30.468Z todo → wip (system)

