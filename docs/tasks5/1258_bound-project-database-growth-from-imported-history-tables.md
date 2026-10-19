---
schema_version: 1
name: Bound project database growth from imported history tables
status: done
template: issue
created_at: 2026-10-18T19:33:17.981Z
updated_at: "2026-10-19T17:47:01.439Z"

feature_id: E5
priority: P2
ac_altitude: task-local
estimate_hours: 3
dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1258-verdict.json
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

- [x] R1. Each existing SQL retention store deletes at most 1000 expired rows per runRetention invocation, using a bounded key-selection DELETE. Keep the existing age predicates, cutoff inclusivity and terminal-queue status predicate unchanged.
- [x] R2. Repeated passes drain eligible backlog without a new persisted cursor. An interrupted pass leaves only committed deletions and the next pass safely continues. Fresh rows, pending/processing jobs, imported target history and task_run_links are preserved.
- [x] R3. RetentionResult reports actual deletions per store; a store error remains best-effort and does not skip unrelated stores. Preserve backup policy and existing compaction gates/PASSIVE checkpoint semantics. A row cap is not a wall-clock or database-size guarantee.
- [x] R4. Database-backed regressions exercise more than one batch, repeated passes, cutoff boundaries, live queue protection, no eligible rows and one-store failure. Keep the existing daily caller and result shape compatible.

Out of scope: raw history retention or reset, scheduler retry/lease changes, async dispatch, new CLI/config/schema, new maintenance schedule, parallel delete workers and automatic VACUUM policy changes.

### Acceptance Criteria

- [x] AC1 — A backlog exceeding 1000 eligible rows drains across bounded repeatable retention passes (req: R1, R2, R4)
- [x] AC2 — Cutoff and live/provenance rows remain intact while actual deletion counts agree (req: R1, R2, R3, R4)
- [x] AC3 — Store failures stay isolated and daily/compaction contracts remain compatible (req: R3, R4)

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

- [x] 1. Add a failing migrated-DB regression with 1001+ expired rows and protected cutoff/live/provenance sentinels; assert the first pass deletes at most 1000 per store (R1, R2, R4).
- [x] 2. Replace the unrestricted DELETE inputs with bounded key subqueries and one shared internal batch size; preserve eligibility and best-effort error handling (R1, R3).
- [x] 3. Repeat passes to prove eventual drain, accurate counts and safe restart from committed state; cover empty stores and one-store failure without mocking the SQL behavior (R2-R4).
- [x] 4. Run domain retention tests inside packages/domain and existing app history daily tests inside packages/app; verify unchanged result shape and compaction semantics (R3, R4).
- [x] 5. Update the existing daily retention contract, record reproducible fixture counts, run task-local gate and verify against these ACs. Do not run destructive cleanup against the operator database.

### Root Cause

purgeRows executes each caller's whole DELETE without LIMIT or a bounded key subquery. The existing retention policy and daily integration are present; the missing mechanism is a per-pass deletion cap, not another retention command or a new importer.

### Solution

Bounded each existing retention store's per-pass deletion at 1000 rows, keeping the current expiry
policy, result shape and daily caller unchanged.

| File | Change |
| --- | --- |
| `packages/domain/src/retention.ts:217` | New internal `RETENTION_BATCH_SIZE = 1000` (no config key, no public surface). |
| `packages/domain/src/retention.ts:220,236,250` | Each store's `DELETE` becomes a bounded key-selection delete (`rowid IN (SELECT rowid … WHERE <age predicate> LIMIT 1000)`, intentionally unordered (no index backs these age columns; every eligible row is equally purgeable)), with the store's existing age predicate, `<` cutoff and terminal-queue status predicate preserved in both the selection and the deletion. `rowid` rather than the declared PK because SQLite allows a NULL TEXT primary key, which made the first `id IN (…)` attempt silently match nothing. |
| `packages/domain/src/retention.ts:293-302` | `purgeRows` takes variadic params so cutoff and limit bind as real statement parameters (no string interpolation), and still reports rows actually removed via `changes()`; a failing store is swallowed into `0` and never skips the others. |
| `docs/design/history-cli-contracts.md:192-200` | Owning daily-retention contract records the batch cap, the `rowid` selection rule, the absence of a cursor (committed deletions are the progress), preserved best-effort/result semantics, and that this is an execution bound rather than a byte/size guarantee. |
| `packages/domain/tests/retention.test.ts:203-274` | Migrated-DB regressions: a 1001+ expired-row backlog drains across repeated passes with exact per-store counts and protected sentinels; cutoff boundary (`<`); empty store; one failing store (dropped table) leaving the others successful. Verified red against the previous unrestricted deletes. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/retention.ts:220` bounds rule-eval deletion to the shared 1000-row batch with a key-selection DELETE (anchor re-read this run), `:236` does the same for terminal queue jobs keeping the status predicate, and `:250` for the ledger keeping the cutoff; `packages/domain/tests/retention.test.ts:203` asserts exactly 1000 rows removed on the first pass of a 1001-row backlog |
| R2 | MET | `packages/domain/tests/retention.test.ts:203` runs three passes over the same store (1000 → remainder → 0) with no persisted cursor, and asserts inside-window rows plus the pending job survive every pass |
| R3 | MET | `packages/domain/src/retention.ts:293` binds cutoff and limit as statement parameters and reports actual deletions; `packages/domain/tests/retention.test.ts:260` drops the queue table and asserts the other two stores still delete, with `RetentionResult` unchanged |
| R4 | MET | `packages/domain/tests/retention.test.ts:203-274` exercises multi-batch drain, cutoff boundary, live-queue protection, empty store and one-store failure on a migrated database with fixed `now`; the existing daily caller is unchanged |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/domain/tests/retention.test.ts:203` — 1001 eligible rows drain across bounded, repeatable passes; re-run this session: `bun test tests/retention.test.ts` 11 pass / 0 fail |
| AC2 | MET | test | `packages/domain/tests/retention.test.ts:240` (cutoff row intact) and `:203` (protected in-window rows and the live job survive; counts equal rows actually removed) |
| AC3 | MET | test | `packages/domain/tests/retention.test.ts:260` (one failing store isolated) plus the unchanged daily/compaction tests in the same suite |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1258
**Scope:** task 1258 diff — `packages/domain/src/retention.ts`, `packages/domain/tests/retention.test.ts`, `docs/design/history-cli-contracts.md`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | efficiency | The bounded selection is deliberately unordered: none of the three stores has an index on its age column (`rule_eval_runs.created_at`, `history_import_ledger.imported_at`), so an `ORDER BY` would add a sort over the eligible backlog for no benefit. The scan cost is the predicate scan the previous unrestricted `DELETE` already paid, now stopped after 1000 deletions. | `packages/domain/src/retention.ts:217-260` | ACCEPTED |
| 2 | P4 (advisory) | correctness | A store whose selection errors still reports `0` rather than distinguishing "nothing eligible" from "failed" — unchanged best-effort semantics (R3), and the failing-store regression asserts the other two stores still succeed. | `packages/domain/src/retention.ts:293` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/retention.ts:220,236,250` cap each store at `RETENTION_BATCH_SIZE` (1000) with a `rowid IN (SELECT rowid … LIMIT ?)` delete, keeping each store's age predicate, `<` cutoff and terminal-status predicate; `packages/domain/tests/retention.test.ts:203` asserts exactly 1000 removed on the first pass of a 1001+ backlog |
| R2 | MET | `packages/domain/tests/retention.test.ts:203` repeats passes (1000 → remainder → 0) with no cursor, and asserts the inside-window rule-eval/ledger rows and the `pending` queue job survive every pass |
| R3 | MET | `packages/domain/src/retention.ts:293-302` binds params (no interpolation) and reports `changes()`; `RetentionResult` keeps its shape; `packages/domain/tests/retention.test.ts:260` drops one store's table and asserts the other two still delete |
| R4 | MET | The regressions run on `createMigratedDb` with fixed `now` (`packages/domain/tests/retention.test.ts:203-274`): multi-batch drain, cutoff boundary, live-queue protection, empty store and one-store failure; `packages/app` history daily tests (70 pass) confirm the existing caller and result shape |

**Residual risk:** both findings are advisories; the pass is an execution bound, not a byte bound (documented in the owning contract).

**Next:** close 1258 (`record` writes Testing from the PASS verdict; no open P1-P3).
Confidence: MEDIUM

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

- 2026-10-19T15:43:08.038Z todo → wip (system)
- 2026-10-19T15:49:23.905Z wip → testing (system)
- 2026-10-19T15:49:25.741Z testing → done (system)

