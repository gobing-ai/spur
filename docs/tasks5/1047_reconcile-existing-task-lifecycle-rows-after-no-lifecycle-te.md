---
schema_version: 1
name: Reconcile existing task lifecycle rows after no-lifecycle terminal writes
status: todo
template: issue
created_at: 2026-10-02T05:46:34.440Z
updated_at: "2026-10-02T05:46:38.259Z"
feature_id: D62

priority: P2
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1040"]
---

## 1047. Reconcile existing task lifecycle rows after no-lifecycle terminal writes

### Background

Session review since task 1041 verification found completed tasks with stale running task-lifecycle rows. Main contains run_44d6e2fe-a36c-4fef-8ce6-eb8b08298dc7 (task:1043), run_0506a407-0ef9-41cd-bf54-abe7c0c56df2 (task:1044), and run_4eef3cdf-291d-43ed-9629-00f0e55d9c33 (task:1046), all status running with null terminal_reason although their task files are done. packages/app/src/workflow/lifecycle-adapter.ts:193 creates/attaches bookkeeping; apps/cli/src/commands/task.ts:1816 omits that adapter for --no-lifecycle. TaskService.record invokes PlanningWriteService.transition directly at packages/app/src/services/task-service.ts:1567, so an updateStatus-only fix misses record completion.

Task 1046's stale Solution/Testing prose was corrected during triage; this task does not repeat that documentation repair. Task 1040's verdict refresh and close-audit behavior are prerequisites to preserve. These are task-local consistency regressions under D62, not replacements for its graduating measurements.

### Requirements

- [ ] R1. After a successful terminal task-file transition, reconcile an existing task-lifecycle row for external_key task:<wbs> to done/done or failed/cancelled, with a completion timestamp; never create a bookkeeping row for --no-lifecycle.
- [ ] R2. Apply the reconciliation at the shared post-write boundary used by both task update and task record, including idempotent re-record of a terminal task. Guard rejection or failed file publication must not finalize a row as completed.
- [ ] R3. Preserve existing pipeline identity, action records, task run links, verify/review guards and close-audit fields. Report a bookkeeping reconciliation failure explicitly and allow safe replay without reverting a successfully published task file.

### Acceptance Criteria

- [ ] AC1 — Existing bookkeeping follows guarded no-lifecycle completion (req: R1, R2).
  Given an in-memory project with an existing running task-lifecycle row and a task eligible for done, when guarded task record --no-lifecycle completes it, then the same row becomes done with terminal_reason done and a completion timestamp, without a new lifecycle run.
- [ ] AC2 — Update and record share terminal bookkeeping (req: R1, R2).
  Given an existing named row, when each of task update and task record commits a terminal status, then both reconcile it; an already-done re-record repairs a stale row idempotently.
- [ ] AC3 — Rejection leaves ownership intact (req: R2, R3).
  Given a failing verify/review guard or file-write failure, when completion is attempted, then no row is falsely finalized and no guard or close-audit check is bypassed.
- [ ] AC4 — No row is created and replay is safe (req: R1, R3).
  Given no existing bookkeeping row, completion allocates none; injected reconciliation failure is visible and replay repairs only the existing row while preserving pipeline links and trace counts.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-02T05:46:37.939Z

The canonical task file remains authoritative. --no-lifecycle suppresses run creation, not reconciliation of an existing row. Any DB repair failure is reported after the committed file state and is retried through the same guarded owner. No operator approvals, run identity or historical timestamps are inferred.

### Design

Add one optional internal post-commit callback, onTransitionCommitted, to the existing PlanningWriteService options; configure it from the existing application/composition DB owner for task transitions. Its single reconciliation helper reads the existing task-lifecycle/task:<wbs> identity through the current workflow persistence owner and finalizes only that row after file publication. TaskService.record's already-terminal branch must invoke the same helper after its guards, so replay can repair drift. Reuse TASK_LIFECYCLE_PROFILE and existing terminal-reason values; add no public CLI flag, workflow or schema.

Targets: packages/app/src/services/planning-write-service.ts, packages/app/src/services/task-service.ts, packages/app/src/workflow/lifecycle-adapter.ts, and the task service construction in apps/cli/src/commands/task.ts; audit server composition for the same shared seam. Tests: packages/app/tests/services/planning-write-service.test.ts, task-record/task-service tests and lifecycle-adapter.test.ts. Keep DB access in app/domain owners, not raw transport SQL.

Rejected: allocating/replaying a lifecycle workflow inside a task pipeline; fixing only TaskService.updateStatus; bulk-cancelling every running row; rewriting historical pipeline evidence. Out of scope: automatic closure after a denied non-terminal transition, feature lifecycle redesign, and general orphan sweeps.

### Plan

1. Add failing fixture regressions for update, record and already-terminal replay using the observed mismatch.
2. Wire the shared post-commit callback and existing-row-only reconciliation, preserving all guards and 1040 close audit.
3. Cover cancellation mapping, absent-row no-op, failed file publication and failed-reconciliation replay.
4. Run focused app/CLI tests, lint/typecheck, the task gate and real task verification; do not modify real old rows as part of fixture tests.

### Root Cause

--no-lifecycle correctly avoids creating a second execution lifecycle, but also omits the only owner that finalizes a pre-existing named bookkeeping row. The shared corpus transition commits terminal file state without reconciling that row. The observed rows confirm the mismatch; do not infer that their real task-pipeline runs are still executing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- packages/app/src/workflow/lifecycle-adapter.ts:193
- apps/cli/src/commands/task.ts:1816
- packages/app/src/services/task-service.ts:1567
- packages/app/src/services/planning-write-service.ts:338
- Task 1040; D62; observed run IDs in Background.

### History
