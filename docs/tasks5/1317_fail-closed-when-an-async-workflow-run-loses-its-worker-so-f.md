---
schema_version: 1
name: Fail closed when an async workflow run loses its worker so followers stop polling a dead run
status: todo
template: feature-impl
created_at: 2026-11-07T08:04:43.866Z
updated_at: "2026-11-07T08:14:05.550Z"
feature_id: D3

priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 5
---

## 1317. Fail closed when an async workflow run loses its worker so followers stop polling a dead run

### Background

During the 1294–1316 pi batch (2026-11-05 → 2026-11-07), async task-pipeline run `6a2b4bd8-5e4c-4713-922f-b47e6c7135b7` (task 1313, grok-4.7 implement) lost its worker:

- The worker recorded pid `98149` on the run row (`runs.pid`).
- Its `agent.run progress` heartbeat (every 30s) stops at `2026-11-06T17:11:51Z`, at elapsed 1 830s. The step's own `timeoutMs=2700000` would have fired at about 17:26 if the worker had still been alive, and nothing fired. So the worker process died at about 17:12, together with the parent pi bash call that ended at 17:12:18Z.
- The run row stayed `running`. The driver polled `trace` / `progress` for about 2.5h until an operator ran `spur workflow cancel` at 19:41:55Z, which is now the row's state (`failed`/`cancelled`).
- `.spur/memory/runs/6a2b4bd8….state.json` still reads `"status":"running"`. `cancel`, and likewise `clean`, finalize only the DB row and never project the terminal status into the run record.

Root cause: a run's status is whatever its worker last wrote. Nothing on the read path checks whether the recorded worker is alive, so followers cannot tell "slow" from "dead". `spur workflow clean` can reap only by age (≥30 min since start, explicit operator call), and the pid it would need is already on the row.

### Requirements

- [ ] R1. Reading one run through `WorkflowAppService.trace(runId)` or the `spur workflow progress` command reaps a `running`/`pending` run whose recorded `runs.pid` is not alive (`isPidAlive` false). A `running` run goes to `interrupted` through the engine's `interruptRun`, as `workflow clean` does. A `pending` run goes to `failed` through `RunDao.finalizeStale`. Either way the row gets `metadata.staleReason = "worker-lost: pid <n> not alive"`. Runs with no recorded pid, an alive pid, or a terminal or paused status are untouched.
- [ ] R2. Reaping is idempotent and race-safe: it uses only the existing guarded writes (`interruptRun`, `finalizeStale` WHERE-status guards). A run that completes between the liveness probe and the write keeps its terminal state.
- [ ] R3. `spur workflow trace <id> --follow` (DB timeline and `--output` run-log modes) stops at the poll after the worker dies, prints its normal `Run finalized: interrupted …` line with the `worker-lost` reason, and exits as a terminal follow, not a deadline timeout.
- [ ] R4. Every non-engine terminal write (`cancel`, `clean`, the R1 reap) also projects the new terminal status into `.spur/memory/runs/<id>.state.json` when that file exists, using the same atomic temp-and-rename write as `WorkflowRunLogSink`. An absent record stays absent. A projection failure is best-effort and never undoes the DB write.
- [ ] R5. Regression tests cover these cases. A running row whose pid belongs to a spawned-then-exited process is reaped on the first `trace` read, and `followTrace` returns terminal within one poll. Alive-pid, no-pid and already-terminal rows are unchanged. `cancel` updates an existing `.state.json` to the terminal status.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A dead worker's run is reaped on read (req: R1, R2, R5)
  Given a task-pipeline run row in status running whose recorded pid belongs to a process that has exited
  When WorkflowAppService.trace(runId) is called
  Then the returned run status is interrupted and its staleReason starts with "worker-lost: pid"
  And a second trace call leaves the row unchanged
```

```gherkin
Scenario: AC2 — Live, pid-less and terminal runs are never reaped (req: R1, R2, R5)
  Given one running row with the current test process pid, one running row with no pid and one done row with a dead pid
  When each run is read through trace and the progress command path
  Then all three rows keep their original status, terminal reason and metadata
```

```gherkin
Scenario: AC3 — A follower stops instead of polling a dead run (req: R3, R5)
  Given a running row whose worker pid is dead
  When followTrace polls it with a deadline of 10 poll intervals
  Then it returns not-timed-out after at most one poll and writes "Run finalized: interrupted" with the worker-lost reason
```

```gherkin
Scenario: AC4 — Terminal writes outside the engine update the run record (req: R4, R5)
  Given a running run with a .state.json reading status running
  When the run is cancelled, cleaned, or reaped as worker-lost
  Then .state.json reads the same terminal status as the DB row and stays valid JSON
  And a run with no .state.json gains none
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-07T08:13:52.900Z

- **Pid liveness or a new heartbeat?** Pid liveness. `runs.pid` is already recorded for every async worker (26 of the 37 batch runs; sync runs have none and run in the caller's own process). The 6a2b4bd8 evidence is a dead worker, not a hung one. A hung-but-alive worker is already bounded by `agent.run` `timeoutMs`. A heartbeat column is deferred until a live-but-wedged worker is observed.
- **`interrupted` or `failed` for a lost running worker?** `interrupted`. It mirrors `workflow clean`'s owner-lost path (0901 R2), keeps the run resumable with `spur workflow continue`, and is already in the closed `TERMINAL_REASONS` enum, so there is no schema or enum change. `worker-lost` is a `staleReason` string, not a new enum member.
- **Why reap on read instead of in a daemon?** No daemon exists, and every follower already routes through `WorkflowAppService.trace` (`followTrace` and `followRunLog` both call it). One guard there covers CLI followers, `--json` one-shots and the Board. The probe is `kill(pid, 0)`, which is local and cheap.
- **Pid reuse?** On EPERM or a recycled pid, `isPidAlive` errs toward alive, so the result is "not reaped" (fail safe). The step timeout still bounds it.
- **Worker survival when its parent dies:** out of scope. The worker is already a `setsid` group leader (`run.ts:463-470`), so no survival code is missing. Whatever killed it, detection is the fix.
- **Public surface:** none. No new noun, verb or flag.

### Design

**Seam: one reaper, in the app layer, called from the two single-run read paths.**

1. `packages/app/src/services/workflow-clean-ops.ts`: extract the per-run body of the `clean` loop (lines ~50-66) into `reapRun(db, run, staleReason)`. Running → `engine.interruptRun(id, 'interrupted')` plus `mergeMetadata({staleReason})`. Pending, or an engine that returns undefined → `dao.finalizeStale(id, staleReason)`. `clean` calls it with its existing age reason; behaviour unchanged.
2. Add an exported free function `reapIfWorkerLost(db, cwd, runId): Promise<boolean>` in the same module, so the service and the progress command (which calls `projectWorkflowProgress` with a raw `db`, `packages/app/src/workflow/progress-projection.ts:241`) share one implementation. Read the row through `RunDao.traceRowById` plus `getPid`. Act only when status ∈ {running, pending}, pid ≠ null and `!isPidAlive(pid)` (`packages/app/src/services/project-process.ts:130`, already in-package). Then call `reapRun` with `worker-lost: pid <n> not alive`.
3. `packages/app/src/services/workflow-service.ts` `trace(runId)` (string branch, ~line 550): `await reapIfWorkerLost(db, this.ctx.cwd, runId)` before `traceRun`. The list branch is untouched (no N probes per listing).
4. `apps/cli/src/commands/workflow/progress.ts`: call `reapIfWorkerLost(db, cwd, runId)` before `projectWorkflowProgress`. Do not put it inside the projection, which stays a pure read model.
5. R4 run-record projection: export a small `projectRunStateStatus(dir, runId, status, at)` from `packages/app/src/observability/workflow-run-log-sink.ts`. It reads the existing state file, sets `status` and `updatedAt`, and writes temp-then-rename. Have the sink's private `writeState` keep its own field assembly but share the atomic write helper. Call it after a successful DB write in `cancel` (`workflow-run-ops.ts:283`), in `reapRun` (so it covers both clean and the reaper), and nowhere else. Missing file → no-op. Errors are swallowed (best-effort, R8 of 0925).

Invariants: the DB row stays the lifecycle authority. The reaper only uses existing WHERE-guarded writes. No migration, no enum change, no new CLI surface. The follow loops need no edit beyond what flows through `trace` (`followTrace` already prints `Run finalized` for any non-running/pending status; `followRunLog` uses the same `isTerminalTraceStatus`, `trace.ts:309-311`).

### Plan

- [ ] 1. Write the failing tests first, in `apps/cli/tests/commands/workflow/trace.test.ts` (follow) and `packages/app/tests/services/workflow-clean-ops.test.ts` (reap matrix). Use an in-memory DB. Get a dead pid by spawning `bun -e ''` and awaiting `exited`. The alive control is `process.pid`. Cover the AC1–AC4 rows, including the cancel → `.state.json` case.
- [ ] 2. Extract `reapRun` from `clean` with no behaviour change, and run the existing `clean.test.ts`.
- [ ] 3. Add `reapIfWorkerLost` and wire it into `trace(runId)` and the progress projection.
- [ ] 4. Add `projectRunStateStatus` and call it from `cancel` and `reapRun`.
- [ ] 5. Focused checks: `(cd apps/cli && bun test tests/commands/workflow/trace.test.ts tests/commands/workflow/cancel.test.ts tests/commands/workflow/clean.test.ts tests/commands/workflow/progress.test.ts)` plus `(cd packages/app && bun test tests/services/workflow-clean-ops.test.ts tests/services/workflow-run-ops.test.ts)`. Then `bun run spur-check`.
- [ ] 6. Update `docs/design/run-record-contract.md` (`.state.json` projection owner) with the worker-lost reap and the run-record projection.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature D3 (workflow run reliability defects).
- Evidence: run `6a2b4bd8-5e4c-4713-922f-b47e6c7135b7`: `runs.pid=98149`; the log's last heartbeat is at 17:11:51Z; `.state.json` is still `running` after the cancel. Pi session `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-11-05T21-12-28-988Z_01a1ad8e-….jsonl`.
- Code: `packages/app/src/services/workflow-clean-ops.ts:36-74`, `workflow-run-ops.ts:283-310`, `workflow-service.ts:546-554`, `packages/domain/src/dao/run-dao.ts:234-305`, `packages/app/src/observability/workflow-run-log-sink.ts:200-240`, `apps/cli/src/commands/workflow/trace.ts:142-200,247-340`, `packages/app/src/services/project-process.ts:130`, `packages/app/src/workflow/terminal-reason.ts`.
- Sibling: 1318 (under `--auto`, a reaped run is a per-task failure that keep-going skips past).

### History

- 2026-11-07T08:14:05.550Z backlog → todo (system)

