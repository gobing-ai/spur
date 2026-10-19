---
schema_version: 1
name: Bound project database growth from imported history tables
status: todo
template: issue
created_at: 2026-10-18T19:33:17.981Z
updated_at: "2026-10-19T02:41:29.259Z"

feature_id: E5
---

## 1258. Bound project database growth from imported history tables

### Background

The D66 batch (2026-10-18) surfaced two coupled symptoms of the unbounded history plane in one project tree.

**1. Size.** `~/xprojects/spur-new/.spur/spur.db` = **8.9 GB** while the same project's fresh worktree DB was 3.3 MB. Row counts in the main tree: `history_import_ledger` 4,413,985 · `history_message` 3,494,990 · `history_tool_call` 911,856 · `history_board_tool_5m` 269,654 · `history_board_message_5m` 227,519 · `history_board_rollup_bucket` 104,561 · `rule_eval_runs` 288,272 · `queue_jobs` 86,849. `spur self maintain` offers optimize / WAL-checkpoint / VACUUM but nothing prunes.

**2. Scheduler saturation.** `queue_jobs` held 8 `failed` rows of type `scheduler.custom` for the `history-refresh` job, every one `timed out after 600000ms (killed after 600015ms elapsed)`, plus one row stuck in `processing`. During that window `spur workflow run --async` could not start anything: it reported "async worker failed to start or register the run" and only a synchronous run made progress (task 1259 tracks the dispatch surface; this task tracks the job lifetime and table growth).

**Mechanism.** `packages/app/src/services/scheduler-custom-job-service.ts:153` documents a 15-minute `history-refresh` cadence with "its short" budget; the observed 600 s kills mean the job's own work now exceeds the scheduler's timeout, and a killed job leaves the ledger/message tables to grow by another import pass. The importer writes into `history_import_ledger` + `history_message` with no retention predicate.

**Boundary with E5.** E5 owns *import* retention (raw tool args, derived variables). This task owns *storage* retention and job lifetime for the same plane.

### Requirements

- [ ] R1. A documented retention policy exists for the imported-history tables with a prune verb (age- and/or row-bounded), applied by `spur self maintain` or an explicit `spur history prune`.
- [ ] R2. The prune preserves `task_run_links` and run provenance (the `history reset` contract), and any row a report/artifact still references by id.
- [ ] R3. A prune of the D66 shape (4.4M ledger rows) runs bounded and resumable — no single unbounded `DELETE` that holds the write lock for minutes.
- [ ] R4. `history-refresh` either finishes inside the scheduler budget or is chunked/checkpointed so a kill resumes instead of redoing the pass; a kill must not leave a `processing` row wedged.
- [ ] R5. A wedged `processing` row is reclaimable (lease expiry) rather than requiring manual SQL — the same reclaim rule `project_claims`/`queue_jobs` already carry.
- [ ] R6. A test seeds more rows than the bound and asserts a bounded table with provenance intact; a second test kills a chunked refresh mid-pass and asserts it resumes.

### Acceptance Criteria

- [ ] AC1 — A prune command bounds the imported-history tables and keeps run provenance (req: R1, R2, R3)
- [ ] AC2 — `history-refresh` resumes after a mid-pass kill and never wedges a `processing` row (req: R4, R5)
- [ ] AC3 — Seeding above the bound and killing a refresh are both covered by tests (req: R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Chosen: bounded storage + resumable job.**
1. Retention (R1-R3): per-table bounds (e.g. `history_message` by day + count, `history_import_ledger` by checkpoint watermark) expressed in config with defaults, applied by a prune verb that deletes in chunks (`DELETE … WHERE rowid IN (SELECT rowid … LIMIT n)` looped with a sleep budget) and reports what it kept.
2. Job lifetime (R4-R5): make `history-refresh` chunked with an importer checkpoint (the importer already has `history_import_checkpoint`), so a 600 s kill resumes from the watermark; on start, reclaim a `processing` row whose `lease_expires_at` has passed.
3. Report the numbers: prune and refresh both emit rows/duration so the 8.9 GB shape is visible before it recurs.

**Rejected.**
- `VACUUM` as the fix: it reclaims free pages, never removes rows; after a prune it is the right *follow-up*, not the mechanism.
- A blanket `history reset` on a schedule: it destroys the forensic plane E5/I81 depend on.
- Raising the scheduler timeout: it postpones the kill and doubles the lost work.

**Frozen names.** `spur history prune --older-than <dur> --max-rows <n> [--dry-run]`; `history.refresh.checkpoint` marker; retention keys under `history.retention`.

**File targets.** `packages/app/src/services/history-refresh-service.ts`; `packages/app/src/services/scheduler-custom-job-service.ts:140-170`; `apps/cli/src/commands/history/*` (new `prune`); `apps/cli/src/commands/self/maintain*`; migrations only if a watermark column is needed; tests `packages/app/tests/services/history-*.test.ts`, `apps/cli/tests/commands/history/*`.

**Anti-patterns.** No unbounded `DELETE`; do not prune rows a task/verdict artifact still cites; do not touch `task_run_links`; do not silence the scheduler's timeout — make the job fit it.

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
