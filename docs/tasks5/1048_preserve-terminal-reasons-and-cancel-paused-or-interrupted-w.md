---
schema_version: 1
name: Preserve terminal reasons and cancel paused or interrupted workflow runs
status: done
template: issue
created_at: 2026-10-02T05:46:39.101Z
updated_at: "2026-10-02T10:13:52.778Z"
feature_id: D64

priority: P2
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["0937"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-dev-run-1048-c88b/.spur/memory/evidence/1048-verdict.json
---

## 1048. Preserve terminal reasons and cancel paused or interrupted workflow runs

### Background

During worktree cleanup, workflow cancel run_a3387db5-7f82-44a2-9705-392830c77537 returned finalized true/status failed, but the persisted row retained terminal_reason null. packages/app/src/services/workflow-service.ts:1179 selects only running/pending, and its cancel method calls RunDao.finalizeStale. packages/domain/src/dao/run-dao.ts:250 writes staleReason metadata without the terminal_reason column and guards only running/pending. Therefore explicit cancellation of paused/interrupted runs also cannot finalize them; this latter behavior is established by the guard, not by cancelling another live run in the review.

The one orphan imported during cleanup was already operationally cancelled; this task fixes the general cancellation owner. Task 1046's documentation drift was repaired inline and is excluded. This continues task 0937's D64 closed terminal-reason contract; ACs are task-local regressions.

### Requirements

- [x] R1. Existing workflow cancel must finalize running, pending, paused and interrupted runs as failed with terminal_reason cancelled, completion timestamp and the existing human-readable cancellation metadata.
- [x] R2. Use a conditional domain write so terminal rows cannot be clobbered by cancellation races; preserve trace, artifacts, checkpoints and task links.
- [x] R3. Keep automatic workflow clean's current stale-run selection and retention behavior unchanged. Preserve missing/terminal run return behavior and bounded process signalling for explicit cancellation.

### Acceptance Criteria

- [x] AC1 — All explicit non-terminal cancellations carry a reason (req: R1).
  Given one fixture run in each of running, pending, paused and interrupted, when WorkflowService.cancel is invoked, then each becomes failed/cancelled with a completion timestamp and retained records.
- [x] AC2 — Terminal runs and races are preserved (req: R2, R3).
  Given done/failed/missing rows or a run becoming terminal between lookup and write, then cancel reports the actual outcome without changing terminal metadata or signalling a terminal run.
- [x] AC3 — Cleanup still protects resumable work (req: R3).
  Given old paused/interrupted rows, when automatic workflow clean runs, then it does not newly cancel them because of this change.
- [x] AC4 — Cancellation reason reaches the normal consumer (req: R1, R2).
  Given a cancelled fixture, then trace and the existing D64 reason consumer report cancelled rather than unknown; action/artifact/link rows and checkpoint bytes are unchanged.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T05:46:43.027Z

Explicit cancellation includes resumable states because the operator named the run. Automatic workflow clean does not gain that authority. Task 0937's enum and consumer remain the owners of terminal reason; historical nulls are not guessed or backfilled.

### Design

Add the internal domain owner RunDao.cancelRun(runId) with an atomic conditional update covering exactly running, pending, paused and interrupted and writing terminal_reason = cancelled. Keep the existing cancellation message in metadata for compatibility. WorkflowService.cancel uses this explicit cancellation writer rather than finalizeStale and chooses process signalling only for eligible non-terminal rows. Reuse the installed status vocabulary; no new schema, public noun/verb/flag, cancellation service or engine facade workaround.

Targets: packages/domain/src/dao/run-dao.ts, packages/app/src/services/workflow-service.ts, packages/domain/tests/dao/run-dao.test.ts and packages/app/tests/services/workflow-service.test.ts. Verify existing terminal-reason/trace consumers under task 0937. Mock signalling or use inert fixture PIDs; never cancel real unrelated runs for a test.

Rejected: broadening finalizeStale in place, guessing cancellation from legacy null columns, or relabelling all old failed runs. Automatic orphan cleanup, legacy backfill and process identity redesign are out of scope.

### Plan

1. Reproduce the missing reason and paused/interrupted no-op in in-memory DAO/service tests.
2. Add the explicit conditional cancellation writer and route the existing service through it.
3. Cover terminal/missing/race cases, preserved checkpoints and unchanged stale sweep behavior.
4. Run focused domain/app tests and the task gate; verify cancellation through the normal trace/reason surface using fixtures.

### Root Cause

Explicit operator cancellation reuses the stale-run cleanup writer. That writer intentionally handles only running/pending and does not record the cancellation enum, whereas explicit cancellation owns all resumable non-terminal statuses. Its policy must be separate from the automatic stale sweep.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/services/workflow-service.ts:1154` |
| `packages/app/src/services/workflow-service.ts:1181` |
| `packages/app/src/services/workflow-service.ts:1191` |
| `packages/app/src/services/workflow-service.ts:1196` |
| `packages/app/tests/services/workflow-service.test.ts:3484` |
| `packages/domain/src/dao/run-dao.ts:263` |
| `packages/domain/tests/dao/run-dao.test.ts:135` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | RunDao.cancelRun (packages/domain/src/dao/run-dao.ts:275) writes status=failed, completed_at, terminal_reason='cancelled', staleReason metadata for exactly running/pending/paused/interrupted. Domain test.each x4 states + metadata preservation pass (packages/domain/tests/dao/run-dao.test.ts). |
| R2 | MET | Conditional UPDATE ... WHERE status IN (4 resumable) is the race fence; trace/artifacts/checkpoints/task-links untouched (single runs-row write). Terminal no-clobber x3 domain tests; service never reads pid for terminal rows (packages/app/src/services/workflow-service.ts:1181-1197). |
| R3 | MET | finalizeStale (run-dao.ts:236) and listStaleRuns unchanged (still running/pending, no terminal_reason); clean-path tests pass untouched; bounded ESRCH-tolerant signalling preserved via signalSubprocess. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Service tests pause/interrupt a real worker then cancel: each becomes failed/cancelled with completion timestamp; records retained. Domain x4-status tests pass. |
| AC2 | MET | test | Terminal rows (done/failed/cancelled) never clobbered nor signalled — service test holds a live pid on a done row and asserts killed=false and process survival; race covered by WHERE guard + finalized=after&&isNonTerminal derivation. |
| AC3 | MET | test | Existing finalizeStale/listStaleRuns suites pass unchanged; paused/interrupted rows are not newly cancelled by clean. |
| AC4 | MET | test | Cancel writes terminal_reason='cancelled' (0937 enum; TERMINAL_REASONS includes it); traceRowById reads the column (service test asserts); D64 consumers read runs.terminal_reason directly so cancellations report cancelled, never unknown; no action/artifact/link/checkpoint writes in the cancel path. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- packages/app/src/services/workflow-service.ts:1170
- packages/domain/src/dao/run-dao.ts:250
- packages/app/src/workflow/terminal-reason.ts:4
- Cleanup run run_a3387db5-7f82-44a2-9705-392830c77537; task 0937; D64.

### History

- 2026-10-02T09:59:05.139Z todo → wip (system)
- 2026-10-02T10:13:23.373Z wip → testing (system)
- 2026-10-02T10:13:52.775Z testing → done (system)

