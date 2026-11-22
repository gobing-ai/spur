---
schema_version: 1
name: A2A CancelTask stops only the run behind the task
status: done
template: feature-impl
created_at: 2026-11-22T02:10:29.288Z
updated_at: "2026-11-22T07:13:32.648Z"
feature_id: A82
priority: P1
tags: ["integrations", "A82"]

dependencies: ["1421"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 1422. A2A CancelTask stops only the run behind the task

### Background

Implements: R6 — A2A CancelTask stops only the run behind that task.

Design satellite: docs/design/integrations-module.md §1.1. Today cancel calls supervisor().stop(member.instanceId), which kills the whole member loop. A member drains one keyed run at a time, and the supervisor learns the live runId from the [spur:run] marker (agent-loop-service, 1076 R2).

**Refine corrections (2026-11-21)**
- "The write-slot heartbeat checks the cancel file" → the heartbeat ticks every `WRITE_SLOT_TTL_MS / 3` = 10s (`packages/app/src/services/write-slot-service.ts:56`, `agent-loop-service.ts:40-59`), the same as the server's 10s wait bound. The heartbeat also stops when the slot is fenced. → the keyed drain gets its own 1s cancel poll, independent of the heartbeat.
- "Compare against SupervisorService.currentRunIds" → that map is private (`supervisor-service.ts:498`) and is only filled when *this* server supervises the member. → the task's run is the newest coordination row for the message (`latestRun`, `apps/server/src/modules/a2a/index.ts:74`). Cancel is allowed when that row is `running`, and the server waits for the same row to leave `running`. No supervisor accessor is added.
- "Abort the drain's child process" → `AgentService.run` takes no AbortSignal today (`packages/app/src/services/agent-service.ts`, NodeProcessExecutor at :401/:442). ts-runtime 0.7.1 already has `ProcessRunOptions.signal` with process-group kill (`@gobing-ai/ts-runtime/src/process-executor.ts:95`, `process-group.ts:144`). → plumb a `signal` through the run deps to that option. No new kill mechanism.
- "A stale cancel file from an earlier run" is not a failure mode: every keyed run mints a fresh UUID runId (`agent-loop-service.ts:593`), so the path is unique per run.
- A2A keys (`a2a:<instance>:<messageId>`) never take the `runFleetWorkItem` path (its key regex is `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$`, `packages/app/src/workflow/fleet-work-item.ts:24`). They drain through `svc.run` at `agent-loop-service.ts:690`.

### Requirements

- [x] R1. Cancel is accepted only when the task's newest coordination run is `running`. Otherwise it returns 400 `FAILED_PRECONDITION` / `TASK_NOT_CANCELABLE`, as today.
- [x] R2. Cancel aborts only that run's spawned child. The member loop keeps running and claims its next queued request.
- [x] R3. Cancel never calls `supervisor().stop`. If the run's coordination row does not leave `running` within 10s, the response and event report `runStopped: false`.
- [x] R4. The `a2a.task.cancelled` event carries `runId` beside its existing fields.
- [x] R5. Keyed runs with no cancel request, A2A and non-A2A alike, keep their current behavior and exit codes.

Out of scope: aborting a warm turn (persistent worker, nothing spawned); see Q&A. Also out: cancelling queued tasks, and any supervisor stdin control line.

### Acceptance Criteria

- [x] AC1 — A2A CancelTask stops only the run behind that task

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T03:59:36.610Z

- **Closed: warm turns.** A persistent member's warm turn spawns nothing (`agent-loop-service.ts:699`), so there is no child to signal. Cancel answers `runStopped:false` within the bound, which is the honest 1377 R3 semantics, and never stops the member. Aborting a warm turn needs a worker-protocol interrupt; that is a follow-up feature if A2A cancel on persistent members is needed.
- **Closed: run truth.** The coordination row, not the supervisor map, because it is durable and works whether or not this server supervises the member.
- **Closed: poll vs watch.** A 1s poll, not `fs.watch`: it is portable, bounded, and the cost is one stat per second only while a keyed run is live.

### Design

- **Request (server).** After the existing `a2a-canceled-<messageId>` marker, the server writes `<runDir>/<runId>/cancel-requested`, where `runId` is `latestRun(ctx, taskId).run_id` and its content is an ISO timestamp. Then it polls `latestRun` every 250ms for up to 10s until `status !== 'running'`. `runStopped` is true when the row cleared and false on timeout. It never escalates.
- **Abort (member, `agent-loop-service.ts`).** For a keyed drain with a `runId`:
  - Create an `AbortController`.
  - Start a 1s `setInterval` (unref'd) that checks `<projectPath>/.spur/run/<runId>/cancel-requested` and calls `abort()` when it exists.
  - Pass `signal` in the run deps given to `svc.run`.
  - Clear the interval in the existing `finally` (:713).
  - An aborted run settles as a failed drain (`drainFailed = true`); the A2A projection already reads `canceled` from the marker.
- **Plumbing.** The run-deps type gains `signal?: AbortSignal`. `AgentService` forwards it to `NodeProcessExecutor.run({ signal })` at both spawn sites (:401, :442), so ts-runtime's group kill does the termination.
- **Frozen names:** `cancel-requested` (file), `signal` (deps field), `runId` (event field). Interval constants: `CANCEL_POLL_MS = 1_000` in the member and `CANCEL_WAIT_MS = 10_000` / `250` in the server.
- **Anti-patterns:** no supervisor stdin line, no `supervisor().stop`, no new DB column, no piggybacking on the write-slot heartbeat, and no kill-by-pid in Spur code.
- **Depends on 1421:** it leaves `apps/server/src/modules/a2a/index.ts` with the public card and the shared drain-tree rule. This task touches only the cancel handler there. **Leaves for 1423/1425:** `runStopped` and `runId` on `a2a.task.cancelled`, which the Board and the E2E proof read.

### Plan

- [ ] 0. Precondition: confirm that the agent adapter path from `AgentService.run` down to `NodeProcessExecutor.run` can carry `signal`. If a released `@gobing-ai/ts-*` facade drops it, stop and fix the facade (AGENTS.md: fix the facade, do not add a Spur workaround), recording that in Solution.
- [ ] 1. Failure modes to test: cancel on a queued task (400); cancel when the newest run is not running (400); abort mid-settle (no double settle, loop continues); no clear before the timeout (`runStopped:false`, no stop call); a non-A2A keyed run without a file (unchanged); an unkeyed batch (no poll started).
- [ ] 2. (R2, R5) Write failing tests in `packages/app/tests/services/agent-loop-service*.test.ts` with an injected run service:
  - a keyed drain whose `cancel-requested` file appears mid-run sees `signal.aborted`, settles, and the loop claims its next request;
  - a keyed drain without the file runs as today.
- [ ] 3. (R2, R5) Implement the member-side poll and the `signal` plumbing per Design.
- [ ] 4. (R1, R3, R4) Write failing tests in `apps/server/tests/modules/a2a/routes.test.ts`:
  - cancel writes `<runDir>/<runId>/cancel-requested` and never calls `supervisor().stop` (spy);
  - a timeout yields `runStopped:false`;
  - the event has `runId`;
  - a queued task gives 400.
- [ ] 5. (R1, R3, R4) Rewrite the cancel handler (:318–:341) per Design and delete the `supervisor().stop` call.
- [ ] 6. Update the cancel section of `docs/design/a2a-member-transport.md`. Then run `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `packages/app/src/services/agent-loop-service.ts:80-110` | `CANCEL_POLL_MS`, `cancelRequestedPath`, `startCancelPoll` | The per-run cancel marker and its 1s unref'd poll, frozen names per Design |
| `packages/app/src/services/agent-loop-service.ts:635-650` | a keyed drain builds an `AbortController` and starts the poll for its own runId | R2: cancel targets THIS run; a fresh UUID per run means no stale file can abort a later drain |
| `packages/app/src/services/agent-loop-service.ts:838-848` | `svc.run` receives `{...runDeps, signal}`; the poll stops in the same `finally` as the supervisor-run clear | The abort reaches the spawned process; the interval never outlives the drain |
| `packages/app/src/services/agent-service.ts:53-59,524` | `AgentRunDeps.signal` forwarded onto `AgentExecutionOptions.signal` | Nothing new was needed below this: `agent-run-executor.ts:465` already turns an execution signal into `controller.abort()`, and ts-runtime's `signal` option is the process-group kill (Plan step 0 answered: the facade carries it) |
| `apps/server/src/modules/a2a/index.ts:118-155` | `CANCEL_WAIT_MS`/`CANCEL_POLL_MS`, `cancelRequestPath`, `requestRunCancel` | R3: write the run-scoped request, then wait (bounded, 250ms) for that coordination row to leave `running`; never `supervisor().stop` |
| `apps/server/src/modules/a2a/index.ts:352-383` | cancel handler: run must be `running`, writes both markers, reports `runStopped`, emits `runId` | R1/R3/R4 in one place; the member loop keeps draining |
| `packages/app/src/services/event-names.ts:2062-2071` | `a2a.task.cancelled` fields gain `runId`, description corrected | The catalog is the Board's rendering authority; an undeclared field is invisible |
| `packages/app/tests/services/agent-loop-service.test.ts` (`1422 cancel-a-run`) | abort-on-request test + no-request regression | Failing first: the loop must survive the abort and claim the next request |
| `apps/server/tests/modules/a2a/routes.test.ts` | cancel writes the marker, no stop call, `runStopped` true/false, `runId` on the event | R1–R4 pinned; the 10s bound is exercised for real in the timeout row |
| `docs/design/a2a-member-transport.md` (Cancel row) | new cancel contract | T3 |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/server/tests/modules/a2a/routes.test.ts:510 and :545 cover working and queued cancel requests. Terminal requests are also refused. |
| R2 | MET | packages/app/tests/services/agent-loop-service.test.ts:1123 proves the next queued request is drained. docs/reports/integrations-e2e-receipt.json:61 proves live child cancellation and continuation. |
| R3 | MET | apps/server/tests/modules/a2a/routes.test.ts:528 verifies the 10-second timeout returns runStopped:false and does not stop the member. |
| R4 | MET | apps/server/tests/modules/a2a/routes.test.ts:528 asserts the cancellation event runId. |
| R5 | MET | packages/app/tests/services/agent-loop-service.test.ts:1172 verifies a keyed drain completes normally without a cancel request. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — A2A CancelTask stops only the run behind that task | MET | test | packages/app/tests/services/agent-loop-service.test.ts:1123 proves the next queued request is drained. docs/reports/integrations-e2e-receipt.json:61 proves live child cancellation and continuation. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)
- 2026-11-22T05:20:11.995Z todo → wip (system)
- 2026-11-22T05:21:00.703Z wip → testing (system)
- 2026-11-22T05:21:03.055Z testing → done (system)

