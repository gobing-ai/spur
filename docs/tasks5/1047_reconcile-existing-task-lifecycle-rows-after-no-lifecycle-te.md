---
schema_version: 1
name: Reconcile existing task lifecycle rows after no-lifecycle terminal writes
status: done
template: issue
created_at: 2026-10-02T05:46:34.440Z
updated_at: "2026-10-05T18:22:32.249Z"
feature_id: D62

priority: P2
ac_altitude: task-local
ac_numbering: task-local
dependencies: ["1040"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1047-verdict.json
---

## 1047. Reconcile existing task lifecycle rows after no-lifecycle terminal writes

### Background

Session review since task 1041 verification found completed tasks with stale running task-lifecycle rows. Main contains run_44d6e2fe-a36c-4fef-8ce6-eb8b08298dc7 (task:1043), run_0506a407-0ef9-41cd-bf54-abe7c0c56df2 (task:1044), and run_4eef3cdf-291d-43ed-9629-00f0e55d9c33 (task:1046), all status running with null terminal_reason although their task files are done. packages/app/src/workflow/lifecycle-adapter.ts:193 creates/attaches bookkeeping; apps/cli/src/commands/task.ts:1816 omits that adapter for --no-lifecycle. TaskService.record invokes PlanningWriteService.transition directly at packages/app/src/services/task-service.ts:1567, so an updateStatus-only fix misses record completion.

Task 1046's stale Solution/Testing prose was corrected during triage; this task does not repeat that documentation repair. Task 1040's verdict refresh and close-audit behavior are prerequisites to preserve. These are task-local consistency regressions under D62, not replacements for its graduating measurements.

### Requirements

- [x] R1. After a successful terminal task-file transition, reconcile an existing task-lifecycle row for external_key task:<wbs> to done/done or failed/cancelled, with a completion timestamp; never create a bookkeeping row for --no-lifecycle.
- [x] R2. Apply the reconciliation at the shared post-write boundary used by both task update and task record, including idempotent re-record of a terminal task. Guard rejection or failed file publication must not finalize a row as completed.
- [x] R3. Preserve existing pipeline identity, action records, task run links, verify/review guards and close-audit fields. Report a bookkeeping reconciliation failure explicitly and allow safe replay without reverting a successfully published task file.

### Acceptance Criteria

- [x] AC1 — Existing bookkeeping follows guarded no-lifecycle completion (req: R1, R2).
  Given an in-memory project with an existing running task-lifecycle row and a task eligible for done, when guarded task record --no-lifecycle completes it, then the same row becomes done with terminal_reason done and a completion timestamp, without a new lifecycle run.
- [x] AC2 — Update and record share terminal bookkeeping (req: R1, R2).
  Given an existing named row, when each of task update and task record commits a terminal status, then both reconcile it; an already-done re-record repairs a stale row idempotently.
- [x] AC3 — Rejection leaves ownership intact (req: R2, R3).
  Given a failing verify/review guard or file-write failure, when completion is attempted, then no row is falsely finalized and no guard or close-audit check is bypassed.
- [x] AC4 — No row is created and replay is safe (req: R1, R3).
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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/task.ts:1263` |
| `apps/cli/src/commands/task.ts:1841` |
| `apps/cli/src/commands/task.ts:28` |
| `apps/cli/src/commands/task.ts:685` |
| `apps/server/src/context.ts:39` |
| `apps/server/src/context.ts:42` |
| `apps/server/src/context.ts:447` |
| `packages/app/src/index.ts:912` |
| `packages/app/src/services/planning-write-service.ts:165` |
| `packages/app/src/services/planning-write-service.ts:224` |
| `packages/app/src/services/planning-write-service.ts:249` |
| `packages/app/src/services/planning-write-service.ts:256` |
| `packages/app/src/services/planning-write-service.ts:496` |
| `packages/app/src/services/planning-write-service.ts:530` |
| `packages/app/src/services/task-record.ts:102` |
| `packages/app/src/services/task-service.ts:1547` |
| `packages/app/src/services/task-service.ts:1576` |
| `packages/app/src/services/task-service.ts:1605` |
| `packages/app/src/services/task-service.ts:1620` |
| `packages/app/src/services/task-service.ts:1643` |
| `packages/app/src/services/task-service.ts:34` |
| `packages/app/src/workflow/lifecycle-adapter.ts:62` |
| `packages/app/tests/services/planning-write-service.test.ts:745` |
| `packages/app/tests/services/task-record.test.ts:13` |
| `packages/app/tests/services/task-record.test.ts:15` |
| `packages/app/tests/services/task-record.test.ts:2344` |
| `packages/app/tests/services/task-record.test.ts:41` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:10` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:3` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:357` |
| `packages/app/tests/workflow/lifecycle-adapter.test.ts:5` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | lifecycle-adapter.ts:77-91 (terminal-only mapping done/done, failed/cancelled + completion ts; absent row no-op); hook wired regardless of --no-lifecycle task.ts:1838-1845; tests: lifecycle-adapter.test.ts R1×2, "AC4: an absent row allocates nothing" |
| R2 | MET | Hook fires only post-commit on statusChanged: planning-write-service.ts:496-509 (after atomicWriteAsync; guard denial :466-472 throws pre-write); update seam task-service.ts:796-801; record hops :1573-1613; already-terminal replay :1549-1551 + :1651-1664; server seam apps/server/src/context.ts:447-463; idempotent re-record tests AC2×2 |
| R3 | MET | Pipeline identity/links preserved (AC4 test: links == seeded pipeline row, runs=1); bookkeepingError carried not thrown (planning-write-service.ts:503-508, task-service.ts:1651-1664); CLI explicit warnings task.ts:688-692, 1265-1269 + envelope :695/:1249; guards untouched; tests AC3×2 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | task-record.test.ts "AC1: guarded no-lifecycle record to done finalizes the existing running row (no new run)": row done/done, completed_at set, runs=1/links=0 |
| AC2 | MET | test | "AC2: the update seam reconciles an existing named row too"; "AC2: an already-done re-record repairs a stale running row idempotently (replay)"; lifecycle-adapter "AC2: an already-final row is left untouched" |
| AC3 | MET | test | "AC3: a denied structural gate leaves the running row untouched"; "AC3: a denied done hop (port denial after a committed earlier hop) leaves the row untouched" — row stays running/null |
| AC4 | MET | test | lifecycle-adapter "AC4: an absent row allocates nothing"; task-record "AC4: an injected reconciliation failure is visible and replay repairs only the existing row" — pipeline link preserved, runs=1 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- packages/app/src/workflow/lifecycle-adapter.ts:193
- apps/cli/src/commands/task.ts:1816
- packages/app/src/services/task-service.ts:1567
- packages/app/src/services/planning-write-service.ts:338
- Task 1040; D62; observed run IDs in Background.

### History

- 2026-10-02T10:19:07.452Z todo → wip (system)
- 2026-10-02T16:01:46.447Z wip → testing (system)
- 2026-10-02T16:02:28.147Z testing → done (system)

