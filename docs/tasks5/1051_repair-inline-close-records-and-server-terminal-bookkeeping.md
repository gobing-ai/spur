---
schema_version: 1
name: Repair inline close records and server terminal bookkeeping
status: done
template: issue
created_at: 2026-10-02T17:00:22.383Z
updated_at: "2026-10-05T18:22:32.256Z"
feature_id: D62

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1051-verdict.json
---

## 1051. Repair inline close records and server terminal bookkeeping

### Background

Consolidated from the 2026-10-02 reviews originally captured as tasks 1051, 1053 and 1055. Current source confirms stale inline run-record state, omitted default close reasons, silent server bookkeeping failures, and missing failed-file-publication regression coverage. These are follow-ups to completed tasks 0937, 0975 and 1047, not requests to implement those fixes again.

The D62 link follows the inline-driver and shared task-lifecycle bookkeeping owners. E7 remains the run-record contract and D64 owns the terminal-reason taxonomy; neither needs a scope change. Acceptance scenarios are task-local regressions rather than new feature ship criteria.

Original 1051 overstated the effect of the stale sidecar: workflow trace remains the completion authority (`packages/app/src/services/workflow-service.ts:2323`), and the Board receives traceStatus separately. Confirmed impact is inconsistent run-record inspection; no evidence established incorrect history import or resume eligibility.

### Requirements

- [x] R1. Resolve an omitted inline close reason to `done` for status done and `paused-operator` for status paused; failed close still requires an explicit closed-enum reason, invalid reasons are rejected before writes, and an explicit valid reason is preserved.
- [x] R2. After the inline close delegate commits the DB outcome, atomically project its actual status into an existing run-record state file without losing run identity, provenance or startedAt. Cover done, failed and paused, including the terminal DB outcome reported with NO_ACTION_ROWS. Repeating the close repairs a stale state file; a state-publication failure is reported and remains replayable without rolling back the DB or fabricating actions.
- [x] R3. The server task-transition path reports a post-commit bookkeepingError through the existing server error logger with task identity and guidance to repair through the existing CLI task-record replay, while retaining the successfully committed task state and existing response DTO. Resolve the real seam through `apps/server/src/modules/task/handlers.ts` and `ServerContext.transitionTask`.
- [x] R4. Add the missing failed-task-file-publication regression at the shared PlanningWriteService boundary: a failed atomic publication leaves the task file and lifecycle row unchanged and never calls the post-commit reconciliation hook. Keep the existing successful-file/failed-bookkeeping replay checks from task 1047.

### Acceptance Criteria

- [x] AC1 — Inline close writes declared default reasons and preserves explicit reasons (req: R1)
  Given a fixture run, done and paused closes without a reason store done and paused-operator respectively; failed or invalid reason input fails before any write; an explicit valid reason is retained.
- [x] AC2 — Run-record state agrees with the committed close outcome and can be repaired (req: R2)
  Given an existing record pair, done, failed, paused and zero-action done closes expose the actual DB status and preserve identity/provenance/startedAt; repeat-close repairs a stale sidecar, and injected state-publication failure is visible and safely retryable.
- [x] AC3 — Server reports post-commit bookkeeping failure without reversing the task write (req: R3)
  Given a terminal server transition with injected reconciliation failure, the file remains committed and the existing server logger receives task identity and replay guidance without changing the transport schema.
- [x] AC4 — Failed task-file publication never finalizes bookkeeping (req: R4)
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

Implemented. Tests were written before the implementation fixes (red phase reproduced for every new AC1/AC2/AC3 test; the AC4 publication-boundary guard was green pre-change by design — it pins existing correct behavior against regression).

Change map (production):

- `packages/app/src/services/inline-run-setup.ts:1012-1055` — new `projectInlineRunClose(runId, status)`: atomically projects the committed close status into `<runId>.state.json` (merge-preserving setup identity/provenance and `startedAt`, dropping any stale `error`, same-directory temp + rename per the 0925 R1 pattern) and RETURNS a replay-guided failure detail instead of swallowing the write failure.
- `packages/app/src/services/inline-run-setup.ts:1124-1146` — AC1 boundary guard at the top of `runInlineRunTrace`: a non-enum reason, or a `failed` close without one, exits 1 with `code: 'INVALID_CLOSE_REASON'` BEFORE any write (no run-row mutation, no sidecar change, no log line).
- `packages/app/src/services/inline-run-setup.ts:1149-1152` — omitted reasons resolve their defaults at the same shared boundary: `done` → `done`, `paused` → `paused-operator`; explicit valid reasons pass through unchanged (`classifyTerminalReason` is idempotent on both).
- `packages/app/src/services/inline-run-setup.ts:1175` — `writer.closeRun(...)` now forwards the resolved `closeReason` instead of the raw optional input.
- `packages/app/src/services/inline-run-setup.ts:1194-1219` — post-commit state projection: the committed status is projected into the sidecar before reporting; a zero-action done close (0975 R2 preserved) still finalizes then exits 1/`NO_ACTION_ROWS` (its error now appends the projection failure when both fail); any other projection failure exits 1 with `code: 'RUN_RECORD_STATE_FAILED'` + replay guidance; a repeat close repairs a stale sidecar (the engine's unfenced `finalizeRun` re-UPDATE is idempotent — verified in @gobing-ai/ts-dual-workflow-engine `src/persistence.ts` line 108).
- `apps/server/src/context.ts:144-150` + `apps/server/src/context.ts:425-427` — `ServerContext.logger` member (ts-infra `Logger`) wired from the boot `ApplicationRuntime`; no transport/schema change.
- `apps/server/src/modules/task/handlers.ts:101-114` — the transition handler captures the guarded result and reports `result.bookkeepingError` via `ctx.logger.error` with task wbs, target status, the underlying error and `spur task record <wbs> --transition <status>` replay guidance (mirrors the CLI 1047 R3 warning); the committed write stands and the response DTO is unchanged.
- `plugins/sp/scripts/inline-run-setup.ts:27` — usage documents the AC1 close defaults; the argv guard (0937 R2) is unchanged.
- `plugins/sp/lib/inline-run.generated.mjs` — installed twin regenerated (`bun run build:plugin-lib`); twin parity exercised end-to-end under bare Node by `plugins/sp/tests/inline-run-installed.test.ts`.

Test map (written before implementation):

- `packages/app/tests/services/inline-run-driver.test.ts:555-806` — new 1051 describe: AC1 defaults/refusals/preservation and AC2 identity preservation, zero-action projection, stale-sidecar repair, injected state-failure retry; `:354-366` updated the pre-existing missing-row close to carry a valid reason (the boundary now rejects reason-less failed closes before row lookup).
- `plugins/sp/tests/inline-run-close-reason.test.ts:68-160` — spawn-level AC1 defaults through the source script with DB `terminal_reason` assertions.
- `plugins/sp/tests/inline-run-installed.test.ts:191-215` — installed-delegate assertions: `terminal_reason: 'done'` and state projection after close.
- `apps/server/tests/modules/task/handlers.test.ts:10-13,85,214-272` — `makeCtx` ctx-level overrides plus the AC3 logger tests (failure reported with identity/guidance; silent on clean transitions).
- `packages/app/tests/services/planning-write-service.test.ts:829-858` — AC4 boundary guard: an injected `fs.writeFile` failure rejects the transition, leaves the previous file untouched, and never calls the post-commit hook.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:1124-1150` boundary guard re-read (1051 AC1 comment verbatim); tests `packages/app/tests/services/inline-run-driver.test.ts:604,639,661,686,709` + spawn `plugins/sp/tests/inline-run-close-reason.test.ts:100-167` + twin `plugins/sp/tests/inline-run-installed.test.ts:191-196` — green this run. |
| R2 | MET | `projectInlineRunClose` re-read at `packages/app/src/services/inline-run-setup.ts:1037` (export confirmed, merge-preserving `{...prior}` + atomic publish, replay-guided failure return); driver tests :604/:728/:751/:776 + twin :199-215 — green this run. |
| R3 | MET | `apps/server/src/modules/task/handlers.ts:101-115` re-read: bookkeepingError block verbatim with 1051 R3 comment, wbs/status/error + `spur task record` replay guidance, DTO unchanged; `apps/server/tests/modules/task/handlers.test.ts:217-272` green this run (22/22). |
| R4 | MET | `packages/app/tests/services/planning-write-service.test.ts:825-858` — "failed atomic publication (1051 R4)" test passed this run (reject + previous file intact + hook never called). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Targeted suite re-run green this run (see per-requirement evidence); task Testing rows re-validated against current tree. |
| AC2 | MET | test | Targeted suite re-run green this run (see per-requirement evidence); task Testing rows re-validated against current tree. |
| AC3 | MET | test | Targeted suite re-run green this run (see per-requirement evidence); task Testing rows re-validated against current tree. |
| AC4 | MET | test | Targeted suite re-run green this run (see per-requirement evidence); task Testing rows re-validated against current tree. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

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

#### Implementation review — 2026-10-02 (fresh session, run 6d88543e, report-only)

Verdict: PASS — AC1–AC4 implemented and evidenced; no blockers. 1 × P3, 6 × P4. Full report with evidence: `.spur/run/6d88543e-0e49-4c64-bc66-800a0495d030-review-answer.txt`.

- **AC1 satisfied** — defaults/refusals enforced at the shared app boundary before any write: `packages/app/src/services/inline-run-setup.ts:1125-1146` (`INVALID_CLOSE_REASON`), defaults `:1149-1152`, forwarded `:1175`; passthrough idempotent via `packages/app/src/workflow/action-trace.ts:301-308`; tests `packages/app/tests/services/inline-run-driver.test.ts:578,610,639,670,697`, spawn-level `plugins/sp/tests/inline-run-close-reason.test.ts:68-167`, installed twin `plugins/sp/tests/inline-run-installed.test.ts:191-196`.
- **AC2 satisfied** — `projectInlineRunClose` merge-preserving + atomic rename (`inline-run-setup.ts:1012-1046`), ordered after commit before report (`:1194`), 0975 zero-action preserved (`:1196-1207`), stale-sidecar repair and `RUN_RECORD_STATE_FAILED` retry tested (`inline-run-driver.test.ts:755-780,783-806`); repeat-close DB safety via unfenced idempotent finalizeRun (@gobing-ai/ts-dual-workflow-engine `src/persistence.ts` lines 104-115).
- **AC3 satisfied** — `ServerContext.logger` (`apps/server/src/context.ts:144-150,427`); handler reports `bookkeepingError` with wbs, target status, error, and `spur task record` replay guidance; DTO unchanged (`apps/server/src/modules/task/handlers.ts:101-115`); tests `apps/server/tests/modules/task/handlers.test.ts:218-272`.
- **AC4 satisfied** — failed-publication pin `packages/app/tests/services/planning-write-service.test.ts:826-858`; injection point valid (temp write through `fs.writeFile` before rename, `packages/domain/src/planning/locks.ts:272-287`); hook fires only post-publication by construction (`packages/app/src/services/planning-write-service.ts:500-512`).
- **F1 · P3 — stale `error` survives a successful close projection.** The `...prior` spread at `packages/app/src/services/inline-run-setup.ts:1028` keeps a prior `error`, contradicting the function comment (`:1000-1002`) and the Solution change map ("dropping any stale error"). Reproduced read-only: prior `{ok:false,error:"stale attach mismatch"}` → after a done close `{status:"done", ok:true, error:"stale attach mismatch"}`. Same staleness class 0948 R7 fixed for re-setup (`:945-948`); the new test's `error` assertion is vacuous (`inline-run-driver.test.ts:601` — the prior state never carries an error). No AC violated; one-line fix plus an error-bearing-prior test recommended for triage.
- **F2 · P4** — the projection catch (`inline-run-setup.ts:1040-1045`) leaves `${statePath}.tmp` residue on a failed rename; `writeInlineRunOutcome` cleans up per 0926 R1 (`:966-971`). The injected-failure test itself creates the residue.
- **F3 · P4** — `ok:true` is hard-coded for failed/paused projections (`inline-run-setup.ts:1030`); the sidecar `ok` semantics change for non-done terminals (0948 R7 defined it as the setup outcome, `:945-948`) is undocumented and unversioned. No production consumer of `state.ok` found outside raw E7 inspection.
- **F4 · P4** — a missing prior sidecar yields `startedAt` = projection time (`inline-run-setup.ts:1033`) although the open DB at the call site could supply the authoritative `runs.started_at`; rebuild-from-nothing fabricates a start time. AC2's letter (existing pair) is still met.
- **F5 · P4** — the server transition handler still drops `closeAuditError` (`packages/app/src/services/task-transition.ts:99-101`) while the CLI reports it (`apps/cli/src/commands/task.ts:680,1258`); pre-existing, out of 1051 scope, natural symmetry follow-up.
- **F6 · P4** — write-side run-id shape enforcement remains argv-only (`SAFE_RUN_ID_RE` in the plugin script); `projectInlineRunClose` (`inline-run-setup.ts:1013-1016`) inherits the seam's existing trust model like `writeInlineRunOutcome`. Hardening note, no regression.
- **F7 · P4** — `apps/web/tests/modules/composed-board-browser.test.ts:344-355` (child-frame bounded-wait flake fix) rides in this task's diff but is absent from the Solution/Testing record. Test-only and justified (same CDP race class the adjacent assertion bounds), but the durable task record should account for every changed file.
- **Validation (reviewer re-run)** — focused suites green: inline-run-driver 22 pass, planning-write-service 44 pass, apps/server task 27 pass, plugin inline-run trio 18 pass, bundle parity 16 pass; Biome clean on the 10 changed source/test files; gate artifact PASS 9728/9728 with all-workspace typechecks (`.spur/run/1051-test-gate.log`). Reviewer edits: none; commits: none.

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
- 2026-10-02T18:51:46.068Z todo → wip (system)
- 2026-10-02T19:55:45.972Z wip → testing (system)
- 2026-10-02T19:57:06.186Z testing → done (system)

