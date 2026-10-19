---
schema_version: 1
name: Bound project database growth from imported history tables
status: todo
template: issue
created_at: 2026-10-18T19:33:17.981Z
updated_at: "2026-10-19T06:37:49.119Z"

feature_id: E5
priority: P2
ac_altitude: task-local
estimate_hours: 3
dependencies: []
---

## 1258. Bound project database growth from imported history tables

### Background

The confirmed remaining issue is unbounded deletion in the existing retention pass: packages/domain/src/retention.ts:211-237 supplies three unrestricted DELETE statements to purgeRows at :266-273. One invocation can delete the entire expired backlog in one write transaction, despite the helper comment calling it bounded. Current read-only observation found approximately 9 GB and 4.4M ledger rows; size alone does not establish a retention defect or a scheduler/dispatch causal chain.

**Refine corrections (2026-10-18)**
- Retained: bound existing expired-row deletions and resume safely on subsequent daily passes.
- Removed: absence of retention. runRetention already ages rule evaluations at 90 days, terminal queue jobs at 30 days, ledger at 180 days, and backups at 30 days; HistoryService.daily already invokes it after import/analyze/report pruning. self maintain intentionally performs physical maintenance.
- Removed: new history prune verb, new history.retention configuration, raw-message/tool/rollup deletion, report-reference graph, extra checkpoint marker and migrations. They introduce destructive policy and public surface without an established contract or consent.
- Removed: missing incremental resume; history daily already uses importer checkpoints. Removed unproven claims that DB size causes 600-second scheduler kills, those kills leave a permanently wedged job, or scheduler saturation blocks the detached async worker. Existing custom-job timeout and queue visibility mechanisms must not be replaced here.
- Title still names broad database growth; retained scope is bounded execution of existing expiry policy, not an absolute byte/row bound on all imported history. CLI cannot rename the task. Estimate unset → 3h. Feature E5 link is preserved; AC is task-local.

### Requirements

- [ ] R1. Each existing SQL retention store deletes at most 1000 expired rows per runRetention invocation, using a bounded key-selection DELETE. Keep the existing age predicates, cutoff inclusivity and terminal-queue status predicate unchanged.
- [ ] R2. Repeated passes drain eligible backlog without a new persisted cursor. An interrupted pass leaves only committed deletions and the next pass safely continues. Fresh rows, pending/processing jobs, imported target history and task_run_links are preserved.
- [ ] R3. RetentionResult reports actual deletions per store; a store error remains best-effort and does not skip unrelated stores. Preserve backup policy and existing compaction gates/PASSIVE checkpoint semantics. A row cap is not a wall-clock or database-size guarantee.
- [ ] R4. Database-backed regressions exercise more than one batch, repeated passes, cutoff boundaries, live queue protection, no eligible rows and one-store failure. Keep the existing daily caller and result shape compatible.

Out of scope: raw history retention or reset, scheduler retry/lease changes, async dispatch, new CLI/config/schema, new maintenance schedule, parallel delete workers and automatic VACUUM policy changes.

### Acceptance Criteria

- [ ] AC1 — A backlog exceeding 1000 eligible rows drains across bounded repeatable retention passes (req: R1, R2, R4)
- [ ] AC2 — Cutoff and live/provenance rows remain intact while actual deletion counts agree (req: R1, R2, R3, R4)
- [ ] AC3 — Store failures stay isolated and daily/compaction contracts remain compatible (req: R3, R4)

### Q&A

- Closed: preserve current expiry windows and public surfaces; cap each existing store at 1000 rows per pass.
- Closed: no raw history deletion or promise that total DB size is bounded.
- Closed: no queue lease ownership or scheduler timeout policy change; alleged saturation-to-dispatch causality is unproven.
- Delegation: implement only the bounded-retention seam and its database-backed evidence.

### Design

Chosen: cap one DELETE per store per pass in the existing packages/domain/src/retention.ts helper/callers; no new API. Use an internal RETENTION_BATCH_SIZE = 1000 and the table's existing primary key in a limited subquery (verify migrated schema for each store before choosing id versus record_hash). Apply the same eligibility predicate to selection and deletion; parameterize cutoff and limit. No sleep loop, full-backlog loop, new cursor or count-all pre-scan. Subsequent existing daily calls provide continuation. Do not rely on optional SQLite DELETE LIMIT compilation.

Primary targets: packages/domain/src/retention.ts and packages/domain/tests/retention.test.ts. Caller to inspect/preserve: packages/app/src/services/history-service.ts daily. Integration evidence may extend the existing history daily fixture only if needed to observe result propagation. Owning contract: docs/design/history-cli-contracts.md daily retention paragraph, updated to state the batch cap and eventual expiry without promising a byte bound.

Tests use a migrated temporary database, fixed now, more than 1000 eligible rows and a protected-row sentinel set. Run each pass through runRetention and save counts before/after as a repeatable artifact. Use current compaction test seams or an in-memory DB so physical VACUUM timing does not become the assertion. Separate statements are atomic; a failed/interrupted pass requires no cursor repair. Preserve existing best-effort semantics and actual affected-row accounting.

Dependencies: none. 1259 owns detached registration diagnostics; do not add queue lookups there from this task. No live database purge, historical repair, new dependency or public command is needed. Budget 3h.

### Plan

- [ ] 1. Add a failing migrated-DB regression with 1001+ expired rows and protected cutoff/live/provenance sentinels; assert the first pass deletes at most 1000 per store (R1, R2, R4).
- [ ] 2. Replace the unrestricted DELETE inputs with bounded key subqueries and one shared internal batch size; preserve eligibility and best-effort error handling (R1, R3).
- [ ] 3. Repeat passes to prove eventual drain, accurate counts and safe restart from committed state; cover empty stores and one-store failure without mocking the SQL behavior (R2-R4).
- [ ] 4. Run domain retention tests inside packages/domain and existing app history daily tests inside packages/app; verify unchanged result shape and compaction semantics (R3, R4).
- [ ] 5. Update the existing daily retention contract, record reproducible fixture counts, run task-local gate and verify against these ACs. Do not run destructive cleanup against the operator database.

### Root Cause

purgeRows executes each caller's whole DELETE without LIMIT or a bounded key subquery. The existing retention policy and daily integration are present; the missing mechanism is a per-pass deletion cap, not another retention command or a new importer.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: retention.ts existing expiry policy/unrestricted purgeRows; history-service.ts daily; retention.test.ts.

Concurrency snapshot: git worktree list shows main only; task list --status wip returns []; one writer per tree. Recheck both before implementation. The tracked tree advanced to release 0.4.15 during the audit; preserve those external commits. Inspect installed versions/bundle at task start, then regenerate only artifacts affected by implementation.

Implement-ready checklist (specification, not an implementation PASS):

```json
[
  {
    "id": "requirements",
    "pass": true,
    "evidence": "Requirements contain bounded observable outcomes, scope exclusions and named current seams."
  },
  {
    "id": "design",
    "pass": true,
    "evidence": "Design freezes reused contracts, algorithm/precedence, files, negative cases and no-new-surface constraints."
  },
  {
    "id": "plan",
    "pass": true,
    "evidence": "Ordered Plan starts with failing fixtures, then minimal fix and named workspace/gate evidence."
  },
  {
    "id": "ac",
    "pass": true,
    "evidence": "Task-local checkbox ACs map every retained requirement to test-observable outcomes; implementation remains unchecked."
  },
  {
    "id": "decisions",
    "pass": true,
    "evidence": "Q&A closes original design choices; false premises and speculative APIs removed."
  },
  {
    "id": "dependencies",
    "pass": true,
    "evidence": "No unmet design prerequisites; boundaries to adjacent tasks explicit."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "retention.ts existing expiry policy/unrestricted purgeRows; history-service.ts daily; retention.test.ts"
  }
]
```

### History
