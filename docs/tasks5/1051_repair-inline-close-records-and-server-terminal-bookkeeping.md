---
schema_version: 1
name: Repair inline close records and server terminal bookkeeping
status: todo
template: issue
created_at: 2026-10-02T17:00:22.383Z
updated_at: "2026-10-02T18:04:29.347Z"
feature_id: D62

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 6
---

## 1051. Repair inline close records and server terminal bookkeeping

### Background

Consolidated from the 2026-10-02 reviews originally captured as tasks 1051, 1053 and 1055. Current source confirms stale inline run-record state, omitted default close reasons, silent server bookkeeping failures, and missing failed-file-publication regression coverage. These are follow-ups to completed tasks 0937, 0975 and 1047, not requests to implement those fixes again.

The D62 link follows the inline-driver and shared task-lifecycle bookkeeping owners. E7 remains the run-record contract and D64 owns the terminal-reason taxonomy; neither needs a scope change. Acceptance scenarios are task-local regressions rather than new feature ship criteria.

Original 1051 overstated the effect of the stale sidecar: workflow trace remains the completion authority (`packages/app/src/services/workflow-service.ts:2323`), and the Board receives traceStatus separately. Confirmed impact is inconsistent run-record inspection; no evidence established incorrect history import or resume eligibility.

### Requirements

- [ ] R1. Resolve an omitted inline close reason to `done` for status done and `paused-operator` for status paused; failed close still requires an explicit closed-enum reason, invalid reasons are rejected before writes, and an explicit valid reason is preserved.
- [ ] R2. After the inline close delegate commits the DB outcome, atomically project its actual status into an existing run-record state file without losing run identity, provenance or startedAt. Cover done, failed and paused, including the terminal DB outcome reported with NO_ACTION_ROWS. Repeating the close repairs a stale state file; a state-publication failure is reported and remains replayable without rolling back the DB or fabricating actions.
- [ ] R3. The server task-transition path reports a post-commit bookkeepingError through the existing server error logger with task identity and guidance to repair through the existing CLI task-record replay, while retaining the successfully committed task state and existing response DTO. Resolve the real seam through `apps/server/src/modules/task/handlers.ts` and `ServerContext.transitionTask`.
- [ ] R4. Add the missing failed-task-file-publication regression at the shared PlanningWriteService boundary: a failed atomic publication leaves the task file and lifecycle row unchanged and never calls the post-commit reconciliation hook. Keep the existing successful-file/failed-bookkeeping replay checks from task 1047.

### Acceptance Criteria

- [ ] AC1 — Inline close writes declared default reasons and preserves explicit reasons (req: R1)
  Given a fixture run, done and paused closes without a reason store done and paused-operator respectively; failed or invalid reason input fails before any write; an explicit valid reason is retained.
- [ ] AC2 — Run-record state agrees with the committed close outcome and can be repaired (req: R2)
  Given an existing record pair, done, failed, paused and zero-action done closes expose the actual DB status and preserve identity/provenance/startedAt; repeat-close repairs a stale sidecar, and injected state-publication failure is visible and safely retryable.
- [ ] AC3 — Server reports post-commit bookkeeping failure without reversing the task write (req: R3)
  Given a terminal server transition with injected reconciliation failure, the file remains committed and the existing server logger receives task identity and replay guidance without changing the transport schema.
- [ ] AC4 — Failed task-file publication never finalizes bookkeeping (req: R4)
  Given a failed atomic task-file publication, the previous task state and running lifecycle row remain unchanged and the hook is not called; existing post-commit failure/replay tests remain green.

### Q&A

- Preserve task 0975 R2: a zero-action done close finalizes the run, then returns exit 1 / NO_ACTION_ROWS. Original 1053 R1 and AC1 incorrectly proposed reversing this rule and are excluded. Clarify its error guidance; never backfill historical actions.
- Task 1048 fixed workflow cancellation, including paused/interrupted rows; it did not fix omitted inline-close reasons. Keep only this distinct gap from 1053.
- Task 1047 already implements generic reconciliation and successful-file/failed-bookkeeping replay. Keep only server reporting and the distinct failed-file-publication test. The getDb item is future-only: no current server caller or RPC invokes TaskService.record, so injection for a hypothetical server record replay is excluded until such a path exists.
- Fixes use existing surfaces and dependencies. This task does not authorize workflow YAML edits, historical run rewrites or transport/schema changes.

### Design

Keep the DB trace authoritative and use the existing close delegate and run-record publication seam. `writeInlineRunOutcome` rebuilds the state rather than merging all prior fields and swallows write failures (`packages/app/src/services/inline-run-setup.ts:933`); calling it with only a terminal status would drop provenance and hide publication failure. Preserve the full existing record identity when projecting a close, and report publication failure after the DB commit. This is ordered DB/file publication, not a cross-store transaction.

Default reasons belong at the shared inline close boundary so source and installed plugin callers agree. Preserve the finalize-then-report behavior for zero actions. Server reporting uses the existing logger instead of changing public DTOs. Reuse the existing post-commit reconciliation implementation and point repair guidance to CLI record replay. Do not add server record plumbing for a path that has no current caller.

Write the failure/regression checks before implementation. Use isolated fixture projects, DB rows and injected file failures; never mutate the real project run history. Regenerate the installed inline-run twin after source changes and exercise both source and installed delegates.

### Plan

1. Add fixture regressions for default close reasons, run-record preservation/publication failure, server error reporting and failed task-file publication. Keep the existing 0975 zero-action assertion unchanged.
2. Repair the shared close projection/default reasons and wire server error reporting using the existing owners.
3. Regenerate the inline-run bundle and run focused app, server and source/installed plugin checks; retain repeatable fixture evidence.
4. Run the required task gate and record verification through the normal task pipeline. Refresh affected feature rosters after completion.

### Root Cause

`runInlineRunTrace` closes the DB row through writer.closeRun without updating the record pair (`packages/app/src/services/inline-run-setup.ts:1098`). `WorkflowActionTraceWriter.closeRun` forwards undefined when reason is omitted (`packages/app/src/workflow/action-trace.ts:292`), so done/paused close can retain null terminal_reason.

The task transition handler discards the guarded transition result (`apps/server/src/modules/task/handlers.ts:96`), including its bookkeepingError. Generic app replay already exists and is covered at `packages/app/tests/services/task-record.test.ts:2600`; the missing publication test is failure before file commit, not failure after a successful commit.

### Solution

Implementation pending. The planned owner is `packages/app/src/services/inline-run-setup.ts:1098`; this is a scope citation, not an implementation change map. No runtime fix is claimed.

### Testing

Triage evidence on current source; implementation verification remains pending.

- Bundle regeneration baseline: `bun test ./scripts/commands/bundle-plugin-lib.test.ts` — 16 passed, 0 failed; `.spur/run/triage-1051-1056/bundle-check.log`.
- Plugin close/reason/handoff baseline: `(cd plugins/sp && bun test tests/job-handoff-contract.test.ts tests/inline-run-trace.test.ts tests/inline-run-close-reason.test.ts)` — 32 passed, 0 failed; `.spur/run/triage-1051-1056/plugin-check.log`.
- App write/record/lifecycle/proof baseline: `(cd packages/app && bun test tests/services/planning-write-service.test.ts tests/services/task-record.test.ts tests/workflow/lifecycle-adapter.test.ts tests/workflow/actions/proof-fingerprint.test.ts)` — 200 passed, 0 failed; `.spur/run/triage-1051-1056/app-check.log`.
- Live fixture reproduction (`bun .spur/run/triage-1051-1056/reproduce.ts`) confirms: done/paused closes omit terminal_reason, and done/paused/failed closes leave the sidecar status running. Zero-action done closes finalize the DB row then exit 1 / NO_ACTION_ROWS, as task 0975 intentionally requires. Results: `.spur/run/triage-1051-1056/reproduction.json`.
- Corrected task readiness: `bun run apps/cli/src/index.ts task check 1051 --as todo --strict --json` — passed with no findings after the approved title/file renames and removal of superseded tasks.

Coverage: N/A — corpus consolidation and baseline triage only. No production code changed, no pipeline completion is claimed, and final implementation verification remains outstanding. Original six task snapshots are retained in `.spur/run/triage-1051-1056/original-tasks.json` and in Git history.

### Review

#### Consolidation disposition — 2026-10-02

| Original finding | Priority | Disposition | Current evidence |
| --- | --- | --- | --- |
| 1051: stale run-record state | P3 | RETAIN as R2; narrow impact to run-record inspection and correct the close entrypoint | `packages/app/src/services/inline-run-setup.ts:1098`; `packages/app/src/services/workflow-service.ts:2323` |
| 1053: validate action rows before terminal mutation | P4 | REJECT: contradicts the intentional finalize-then-report contract | task 0975 R2; `plugins/sp/tests/inline-run-trace.test.ts:338` |
| 1053: missing default terminal reason | P3 | RETAIN as R1, including paused default | `packages/app/src/workflow/action-trace.ts:292`; task 0937 R2 |
| 1055: server drops bookkeepingError | P3 | RETAIN as R3; correct the location to the transition handler | `apps/server/src/modules/task/handlers.ts:96` |
| 1055: missing failure/replay test | P4 | SPLIT: post-commit replay already covered by 1047; retain only pre-commit publication failure as R4 | `packages/app/tests/services/task-record.test.ts:2600`; `packages/app/tests/services/planning-write-service.test.ts:747` |
| 1055: TaskService lacks injectable getDb | P4 | DEFER: the app seam already exists and the current server has no record caller/RPC; no present failure to fix | `packages/app/src/services/task-service.ts:268`; `apps/server/src/modules/task/handlers.ts:36`; `packages/contracts/src/task.ts` |
| 1055: inaccurate lifecycle doc comment | P4 | ALREADY FIXED; exclude from implementation | commit `c37bb0d86`; `packages/app/src/workflow/lifecycle-adapter.ts:70` |

This review assesses the follow-up records; it does not certify the pending implementation.

### References

- Related completed tasks: 0937 (terminal reasons), 0975 (zero-action close policy), 1047 (terminal task reconciliation), 1048 (conditional workflow cancellation), 1049 (persist-out conflict retention).
- Governing feature records: D62 (inline trace and task bookkeeping), E7 (run-record inspection), D64 (terminal reasons).
- `packages/app/src/services/inline-run-setup.ts`
- `packages/app/src/workflow/action-trace.ts`
- `packages/app/src/workflow/run-record.ts`
- `packages/app/src/services/task-service.ts`
- `packages/app/src/services/planning-write-service.ts`
- `apps/server/src/context.ts`
- `apps/server/src/modules/task/handlers.ts`

### History

- 2026-10-02: Consolidated the six simultaneous review captures into 1051–1052; corrected diagnoses and preserved each original finding's disposition. Removed superseded captures 1053–1056 so those IDs can be reused. The operator's "go ahead" authorized the narrow direct title/file rename and deletion exception because the task CLI lacks those operations; sections, metadata and roster refreshes used Spur. Implementation remains todo.

