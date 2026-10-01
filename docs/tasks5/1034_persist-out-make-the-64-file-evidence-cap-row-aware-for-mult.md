---
schema_version: 1
name: "Persist-out: make the 64-file evidence cap row-aware for multi-task batches"
status: wip
template: feature-impl
created_at: 2026-10-01T00:47:12.647Z
updated_at: "2026-10-01T01:19:56.091Z"
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

Root defect: 1012 R1 checks run-owned files against `MAX_CITED_RUN_FILES = 64` (`packages/app/src/services/inline-run-setup.ts:208`), which 0984 R3 sized for citations only. Owned enumeration grows linearly with run rows, so any batch of about 3+ tasks overflows the union. Real shape (runall-A9-485e persistOut): 6 owners, 10–19 files each, 157 in total, and no single owner above 19.

Chosen design: per-owner budgets, with no new constants.
- Citations keep their own 64 cap, as before (0984 R3 blast-radius intent).
- Each owner prefix (`<wbs>-` or `<runId>-`) gets its own `MAX_CITED_RUN_FILES` budget. A file counts against the first prefix it matches. The total bound scales with row count by construction, and the real batch has about 3× headroom per owner.
- Overflow throws before any invoking-tree write (zero-writes contract), and the error names the offending owner prefix, which makes it diagnosable without re-running.

Rejected alternatives:
- `OWNED_BASE + OWNED_PER_ROW × rows` union budget: it adds two tuning constants, a hot owner can still starve the others, and its error cannot name the culprit.
- Scaling the single union cap: it inflates the citation blast radius.

Adjacent, not duplicated: 1025 moves verdict/receipt evidence out of `.spur/run`, which may later shrink what persist-out forwards; 1024 owns run-storage audit/cleanup. This task stays a narrow cap fix.

### Plan

Status: implemented and committed in e8dbc9aa9. What remains is gate → verify → record → done.

1. Red (done): `packages/app/tests/services/persist-worktree-runs.test.ts:613` adds a 6-row batch with 72 owned files. It failed on the old union cap.
2. Implement (done): an owned loop with per-owner counters (`packages/app/src/services/inline-run-setup.ts:334`), with the doc comment updated. The citation loop is unchanged.
3. Contract text (done): `plugins/sp/skills/spur-dev/references/execution-batch.md:520`, plus the regenerated `plugins/sp/lib/inline-run.generated.mjs`.
4. Remaining: run the quality gate (`bun run spur-check`) outside the sandbox. Five env-only tests fail in the sandbox: git hooks in fixtures, and Chromium CDP. Then run inline verify → `task record --solution-from-diff --transition testing` → done.

### Solution

- `packages/app/src/services/inline-run-setup.ts:334`: the owned-evidence loop replaces the single union cap with per-owner counters. Each name is charged to the first `<wbs>-` / `<runId>-` prefix it matches. An owner over `MAX_CITED_RUN_FILES` throws, naming the owner, before any invoking-tree write (zero-writes contract kept). The citation loop keeps its own 64 cap, and the function doc comment is updated to match.
- `packages/app/tests/services/persist-worktree-runs.test.ts:613`: new regression test. A 6-run-row batch with 72 owned files persists mechanically, and every row's record and owned file transfers.
- `packages/app/tests/services/persist-worktree-runs.test.ts:581`: the 1012 union test is rewritten to the per-owner contract. A cited-only file plus 64 owned files now persists; a 65th file for one owner refuses with zero writes.
- `plugins/sp/skills/spur-dev/references/execution-batch.md:520`: the persist-out reference now describes per-owner budgets. `plugins/sp/lib/inline-run.generated.mjs` was regenerated via `bun run build:plugin-lib`.

### Testing

Pending. `task record` will render this section from the verify verdict artifact.

Planned evidence: `(cd packages/app && bun test tests/services/persist-worktree-runs.test.ts tests/services/inline-run-setup.test.ts)`. It covers the 6-row regression (:613), the per-owner overflow throw with zero writes (:581), the citation cap, and the record-conflict skip in the existing suite.

### Review

Pending. The review coordinator writes this. Checks to cover:
- the citation cap is unchanged, and both throw paths precede any write;
- the error names the owner prefix;
- `rg -n "64-file" plugins/sp docs` finds no stale union-cap wording;
- the existing 1–2-task batch tests pass untouched.

### References

- `packages/app/src/services/inline-run-setup.ts:208` (cap), `:334` (per-owner loop)
- `packages/app/tests/services/persist-worktree-runs.test.ts:581`, `:613`
- `plugins/sp/skills/spur-dev/references/execution-batch.md:520`
- Commit e8dbc9aa9 (implementation)
- Related: 0984 R3 (citation cap), 1012 R1 (owned transfer), 1025 (evidence relocation, adjacent), 1024 (run-storage cleanup, adjacent)
- Evidence: `.spur/run/worktree-runall-A9-485e.json`, persistOut: 6 runs, 157 archived files, max 19 per owner

### History

- 2026-10-01T01:08:22.487Z backlog → todo (system)
- 2026-10-01T01:08:22.753Z todo → wip (system)

