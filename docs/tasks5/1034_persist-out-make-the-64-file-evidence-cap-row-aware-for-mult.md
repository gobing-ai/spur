---
schema_version: 1
name: "Persist-out: make the 64-file evidence cap row-aware for multi-task batches"
status: wip
template: feature-impl
created_at: 2026-10-01T00:47:12.647Z
updated_at: "2026-10-01T01:08:30.247Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1034. Persist-out: make the 64-file evidence cap row-aware for multi-task batches

### Background

Captured from the creation title: "Persist-out: make the 64-file evidence cap row-aware for multi-task batches".

### Requirements

- Background: batch runall-A9-485e had 6 run rows (5 tasks plus wrap). Its persist-out failed with the 64-file cap throw (`packages/app/src/services/inline-run-setup.ts:297`/`:336`). `MAX_CITED_RUN_FILES = 64` (:208) was sized by 0984 R3 for citations alone, but it is checked against the UNION of cited and owned files (1012 R1). Owned enumeration collects `<wbs>-*` and `<runId>-*` for EVERY run row, so 6 rows alone produced 68 files. That makes the cap structurally impossible to meet for batches of roughly 3+ tasks. The session workaround was a manual archive into a hidden subdirectory, recorded in `.spur/run/worktree-runall-A9-485e.json`.
- Adjacent, do not duplicate: 1025 owns the evidence-location redesign; 1024 owns run-storage audit/cleanup.

- [ ] R1. The 64-file cap applies to distinct literal citations alone (0984 R3, unchanged). Owned evidence is bounded per owner instead: each forwarded task WBS prefix and each worktree run-row id prefix gets its own budget of `MAX_CITED_RUN_FILES`. The overall bound therefore scales with the batch's row count.
- [ ] R2. Overflowing any bound (citations, or one owner's files) still throws before the first invoking-tree write. The zero-writes abort contract is preserved.
- [ ] R3. Cited-file resolution, run-row/record transfer, and the record-conflict skip are unchanged.
- [ ] R4. A regression test in `packages/app/tests/services/persist-worktree-runs.test.ts` persists a 6-run-row batch whose owned files exceed 64 in total.

### Acceptance Criteria

- [ ] AC1 — A simulated 6-run-row batch with more than 64 owned files in total persists mechanically, with no manual archive step (req: R1, R4)
- [ ] AC2 — Over-cap citations and one owner over its budget each throw with zero invoking-tree writes (req: R2)
- [ ] AC3 — Cited files resolve, and run rows and records transfer unchanged with the record-conflict skip intact; the existing persist-worktree-runs suite passes (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Root defect: 1012 R1 counts run-owned files against a cap that 0984 R3 sized for citations only. The union conflates two budgets with different purposes: cited-file blast radius (human-curated, small) vs owned-file transfer (mechanical, grows with run rows). At 6 run rows the owned set alone (~159 files in runall-A9-485e: ~68 runId-owned + ~91 wbs-owned) exceeds the 64 cap, so every batch of ~3+ tasks fails persist-out and needs a manual archive workaround.

Chosen design — split budgets (recommended):
- Cited files: keep MAX_CITED_RUN_FILES = 64 unchanged (preserves 0984 R3 blast-radius intent).
- Owned files: new budget ownCap = OWNED_BASE + OWNED_PER_ROW * runRowCount. Suggest OWNED_BASE=96, OWNED_PER_ROW=32 (6 rows -> 288 >= 159 observed; 1-2-task batches unaffected). Size the constants against the real batch and verify in tests.
- Both caps hard. Zero-writes abort preserved: any overage throws before any DB row or file is copied.

Alternative rejected: scale the single union cap by row count — inflates citation risk as owned files grow; the two budgets exist for different reasons.

Error ergonomics (1016 proof-ergonomics theme): the overage error must print a breakdown — cited N/cap, owned M/budget, per-row owned average — so overflow is diagnosable without re-running a session.

### Plan

1. Reproduce (red): extend the fixture in packages/app/tests/services/persist-worktree-runs.test.ts to the real batch shape (6 run rows, 12 records, ~159 owned files, 3 cited); assert current code throws.
2. Implement in packages/app/src/services/inline-run-setup.ts: add OWNED_BASE/OWNED_PER_ROW next to MAX_CITED_RUN_FILES (:208); replace the two throw sites (:297 cited, :336 owned) with budget-specific checks; thread runRowCount into the owned check.
3. Update both error messages to include the cited/owned breakdown.
4. Update persist-out contract text in plugins/sp/skills/spur-dev/references/execution-batch.md (:494-:537) in the same commit (T3).
5. Green: focused test passes; then bun run spur-check; bun run spur-check-feature once (ADR-119).

### Solution

- `packages/app/src/services/inline-run-setup.ts:334`: the owned-evidence loop replaces the single union cap with per-owner counters. Each name is charged to the first `<wbs>-` / `<runId>-` prefix it matches. An owner over `MAX_CITED_RUN_FILES` throws, naming the owner, before any invoking-tree write (zero-writes contract kept). The citation loop keeps its own 64 cap, and the function doc comment is updated to match.
- `packages/app/tests/services/persist-worktree-runs.test.ts:613`: new regression test. A 6-run-row batch with 72 owned files persists mechanically, and every row's record and owned file transfers.
- `packages/app/tests/services/persist-worktree-runs.test.ts:581`: the 1012 union test is rewritten to the per-owner contract. A cited-only file plus 64 owned files now persists; a 65th file for one owner refuses with zero writes.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:520`: the persist-out reference now describes per-owner budgets. `plugins/sp/lib/inline-run.generated.mjs` was regenerated via `bun run build:plugin-lib`.

### Testing

- Add to packages/app/tests/services/persist-worktree-runs.test.ts:
  1. 6-row batch, ~26 owned files/row + 3 cited -> persist-out succeeds; rows/records/files all transferred (regression for the real failure).
  2. cited-only 65 -> throws; message contains cited count and cap; zero rows written, zero files copied.
  3. owned > budget -> throws; message contains owned count, budget, per-row average; zero writes.
  4. hidden subdirectory (.evidence-*) in the run dir is skipped by owned enumeration.
  5. record-conflict skip still logs and continues; DB rows unchanged on abort paths.
- Run: (cd packages/app && bun test tests/services/persist-worktree-runs.test.ts)
- Gates: bun run spur-check (task-local), then bun run spur-check-feature once (ADR-119).
- Repeatability: test 1 encodes the runall-A9-485e batch shape, so the artifact reruns without a live worktree.

### Review

- Confirm the split preserves both contracts: 0984 citation cap unchanged; zero-writes abort on ANY overage (grep both throw paths).
- Confirm error messages carry the cited/owned breakdown.
- Confirm execution-batch.md cap text updated in the same commit; no stale "64-file cap" references remain (rg).
- Confirm 1-2-task batches unaffected (existing tests pass untouched).
- Cross-ref: foreign task 1025 (evidence-location redesign) is adjacent, not this fix — keep scopes disjoint and note the relationship in the record.

### References

- packages/app/src/services/inline-run-setup.ts:201,208,222,297,309,331,336
- packages/app/tests/services/persist-worktree-runs.test.ts
- plugins/sp/skills/spur-dev/references/execution-batch.md:494-537
- Related: 0984 R3 (citation cap), 1012 R1 (owned transfer), foreign 1025 (broader evidence-location redesign)
- Evidence: runall-A9-485e WT-4a persist failure 2026-09-30 ~17:22: 159 owned + 3 cited > 64.

### History

- 2026-10-01T01:08:22.487Z backlog → todo (system)
- 2026-10-01T01:08:22.753Z todo → wip (system)

