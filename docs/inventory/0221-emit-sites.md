# Task 0221 — System Events Emit-Site Inventory

> Checked-in companion to task 0221 (`docs/tasks2/0221_complete-system-events-upstream-coverage-and-bus-wiring.md`).
> Generated 2026-07-07 from production source only — tests, browser-local store notifications,
> CLI-only local buses, and `process.emit('SIGINT'/'SIGTERM')` are intentionally out of scope.

**Visibility legend**

| Tier       | Meaning                                                                     |
| ---------- | --------------------------------------------------------------------------- |
| `default`  | Board-observable event shown in `System Events` without extra config.      |
| `diagnostic` | High-volume / internal health event visible only when diagnostic toggle is on. |
| `out-of-scope` | Emit is not part of the board runtime contract (CLI local bus, browser store, raw Node signal). |

**Reachable-from-`spur serve`?** — *yes* when the canonical server `EventBus` reaches the
emitter either directly or via an injected `events`/`systemBus` argument on a server-executed
constructor; *partial* when the reach depends on a CLI/Workers-only code path; *no* when the
emit lives entirely outside the `spur serve` runtime.

## A. `@gobing-ai/ts-rule-engine`

Source: `~/xprojects/ts-libs/packages/rule-engine/src/`

| Event name            | Emit site                  | Bus owner                                 | Reachable from `spur serve`? | Desired tier   |
| --------------------- | -------------------------- | ----------------------------------------- | ---------------------------- | -------------- |
| `rule.run.start`      | `engine.ts:135`            | `RuleEngineEvents` (`events` arg of ctor) | yes (via R3)                 | `default`      |
| `rule.eval.start`     | `engine.ts:158`            | same                                      | yes (via R3)                 | `default`      |
| `rule.eval.error`     | `engine.ts:178`            | same                                      | yes (via R3)                 | `default`      |
| `rule.eval.done`      | `engine.ts:187`            | same                                      | yes (via R3)                 | `default`      |
| `rule.run.done`       | `engine.ts:251`            | same                                      | yes (via R3)                 | `default`      |

Notes: `RuleEngineEvents` uses `rule.run.start` / `rule.run.done` (verb-form),
`rule.eval.start` / `rule.eval.done`. The catalog will use the same names verbatim — no alias needed
because rule events are not yet exposed anywhere else.

## B. `@gobing-ai/ts-ai-runner` / `@gobing-ai/ts-runtime`

Sources:
`~/xprojects/ts-libs/packages/ai-runner/src/`,
`~/xprojects/ts-libs/packages/runtime/src/process-executor.ts`.

| Event name            | Emit site                       | Bus owner                                             | Reachable from `spur serve`? | Desired tier   |
| --------------------- | ------------------------------- | ----------------------------------------------------- | ---------------------------- | -------------- |
| `agent.invoke.start`  | `ai-runner.ts:138`              | `AiRunnerOptions.events` (`AgentEvents`)              | yes (via R3)                 | `default`      |
| `agent.invoke.exit`   | `ai-runner.ts:156`              | same                                                  | yes (via R3)                 | `default`      |
| `agent.started`       | `team-orchestrator.ts:73`       | `TeamOrchestrator.events` (`AgentEvents`)             | yes (via R3 + server team)   | `default`      |
| `agent.stopped`       | `team-orchestrator.ts:86`       | same                                                  | yes                          | `default`      |
| `agent.message.sent`  | `team-orchestrator.ts:98`       | same                                                  | yes                          | `default`      |
| `process.started`     | `process-executor.ts:138, 202, 271-273` | `ProcessExecutorConfig.events` (`ProcessEvents`) | yes (via injected executor)  | `default`      |
| `process.exited`      | `process-executor.ts:226, 258-272`     | same                                          | yes                          | `default`      |
| `process.stdout` / `process.stderr` (truncated) | runtime/process executor internals | various | out-of-scope                 | out-of-scope   |

Notes: `AiRunnerOptions.processEvents` (process-level) and `.events` (agent-level) are independent buses.
The server-side `AgentService` does NOT yet pass them — primary R3 fix for agents.

## C. `@gobing-ai/ts-dual-workflow-engine`

Source: `~/xprojects/ts-libs/packages/dual-workflow-engine/src/`

| Event name (engine native)   | Emit site                  | Bus owner                                            | Reachable from `spur serve`? | Desired tier   |
| ---------------------------- | -------------------------- | ---------------------------------------------------- | ---------------------------- | -------------- |
| `workflow.run.started`       | `run-lifecycle.ts:150`     | `WorkflowRunOptions.events` (`WorkflowEngineEvents`) | yes (via R3 — `runFile()`)   | `default`      |
| `workflow.run.done`          | `run-lifecycle.ts:226`     | same                                                 | yes                          | `default`      |
| `workflow.run.failed`        | `run-lifecycle.ts:240`     | same                                                 | yes                          | `default`      |
| `workflow.run.paused`        | `run-lifecycle.ts:256`     | same                                                 | yes                          | `default`      |
| `workflow.run.resumed`       | `run-lifecycle.ts:268`, `service.ts:143` | same                                | yes                          | `default`      |
| `workflow.run.reseeded`      | `service.ts:117`           | same (via `options.events`)                          | yes                          | `default`      |
| `workflow.node.enter`        | `run-lifecycle.ts:195`     | same                                                 | yes                          | `default`      |
| `workflow.node.transition`   | `run-lifecycle.ts:211`     | same                                                 | yes                          | `default`      |
| `workflow.action.start`      | `run-lifecycle.ts:274`     | same                                                 | yes                          | `default` (see R4 alias) |
| `workflow.action.done`       | `run-lifecycle.ts:280`     | same                                                 | yes                          | `default` (see R4 alias) |
| `workflow.action.failed_continue` | `run-lifecycle.ts:297` | same                                                 | yes                          | `default`      |
| `workflow.guard.evaluated`   | `run-lifecycle.ts:308`     | same                                                 | yes (high-volume)            | `diagnostic`   |
| `workflow.transition.requested` | `service.ts:265`        | same                                                 | yes                          | `diagnostic`   |
| `workflow.transition.denied`    | `service.ts:288`        | same                                                 | yes                          | `diagnostic`   |
| `workflow.hitl.ask`          | `run-lifecycle.ts:320`; emitted again by app `hitl-confirm.ts`, `hitl-select.ts`, `hitl-input.ts` | same | yes | `default` (redacted payload) |
| `workflow.hitl.response`     | `run-lifecycle.ts:325`; emitted again by app `hitl-*.ts` | same                                   | yes                          | `default` (redacted) |
| `workflow.hitl.note`         | `host.ts:113`              | same                                                 | yes                          | `default` (redacted: `message`) |
| `workflow.custom`            | `host.ts:130`              | same                                                 | yes                          | `default`      |

### C.alias — engine vs. observability names

`packages/app/src/workflow/observability.ts` defines a separate `WorkflowObservabilityEventMap`
with namespaced, present-tense verbs (`workflow.action.started`, `workflow.action.finished`,
`workflow.phase`, etc.). The engine itself emits past-tense verbs (`workflow.action.start`,
`workflow.action.done`). The board uses the engine names for the catalog (canonical).

**Alias policy (R4):** the canonical names are the **engine** names; the observability
adapter's names collapse onto the same board rows when both fire (one per logical moment —
the persistence adapter only emits when it actually commits, while the engine emits on the
in-memory lifecycle). The bridge emits each engine event on the server bus only; the
observability adapter continues to feed live consumers but no longer produces a separate
`system_events` row for the same moment.

## D. `@gobing-ai/ts-runtime`

Already covered in §B (`process.*`).

## E. `@gobing-ai/ts-infra`

Sources: `~/xprojects/ts-libs/packages/infra/src/`.

| Event name                  | Emit site                             | Bus owner                                | Reachable? | Desired tier   |
| --------------------------- | ------------------------------------- | ---------------------------------------- | ---------- | -------------- |
| `queue.job.enqueued`        | `db-job-queue.ts:30, 39`              | `DbJobQueue.events` (`QueueEvents`)      | yes        | `default`      |
| `queue.consumer.started`    | `db-job-queue.ts:87`                  | same                                     | yes        | `default`      |
| `queue.consumer.stopped`    | `db-job-queue.ts:102`                 | same                                     | yes        | `default`      |
| `queue.job.completed`       | `db-job-queue.ts:189`                 | same                                     | yes        | `default`      |
| `queue.job.failed`          | `db-job-queue.ts:206`                 | same                                     | yes        | `default`      |
| `queue.job.retrying`        | `db-job-queue.ts:218`                 | same                                     | yes        | `default`      |
| `scheduler.job.executed`    | `wrap-handler.ts:46`                  | `SchedulerEvents` (systemBus arg)        | partial    | `default` (already in catalog) |
| `queue.stats`               | `action.ts:113`                       | same                                     | yes        | `default` (already in catalog) |
| `api.request.error`         | `api-client.ts:149`                   | `APIClient.events`                       | partial    | `default`      |
| `bus.emit.done`             | `event-bus/event-bus.ts:272`          | EventBus internal `lifecycleBus`         | yes (Bus itself has it) | `diagnostic` |
| `bus.emit.noop`             | `event-bus/event-bus.ts:282`          | same                                     | yes        | `diagnostic`   |
| `bus.handler.error`         | `event-bus/event-bus.ts:293`          | same                                     | yes        | `diagnostic`   |
| `bus.handler.async.enqueued`| `event-bus/event-bus.ts:304`          | same                                     | yes        | `diagnostic`   |

## F. `packages/app` (Spur-side emitters)

| Event name            | Emit site                                       | Bus owner                                              | Reachable? | Desired tier   |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------ | ---------- | -------------- |
| `task.created` / `task.updated` / `task.transitioned` | `planning-events.ts:50`             | `EventBus<PlanningEventMap>` (server `eventsBus`)     | yes        | `default` (in catalog) |
| `feature.created` / `feature.updated` / `feature.transitioned` | same                       | same                                                    | yes        | `default` (in catalog) |
| `workflow.run.started` / `.run.finalized` / `.phase` / `.transition` / `.action.started` / `.action.finished` | `observability.ts:104-159` | `EventBus<WorkflowObservabilityEventMap>` (per-app local bus) | partial (CLI / local consumers) | `default` (already in catalog; engine-bridged events are identical moment, see R4) |
| `process.spawned` / `process.exited` / `process.stopped` | `supervisor-service.ts:167,179,209` | `SupervisorService.eventBus`                         | yes        | `default` (in catalog) |
| `message.sent` / `message.replied` | `team-service.ts:360`                              | server `eventsBus`                                     | yes        | `default` (in catalog) |

## G. `apps/cli` and `apps/web` (out-of-scope by design)

- CLI emits land on CLI-local buses (`apps/cli/src/commands/workflow.ts:66` builds `WorkflowAppService`
  with optional local `observabilityBus`, not the server bus). These are not wired into `spur serve`
  runtime paths today.
- Browser-local store notification emitters and Zustand store middleware are out-of-scope.

## H. Summary table — final classification

**`default` events added in this task (not previously cataloged):**

- `agent.invoke.start`, `agent.invoke.exit`
- `agent.started`, `agent.stopped`, `agent.message.sent`
- `process.started`, `process.exited` (already partially covered by `process.spawned` from supervisor — coexist; distinct moments)
- `rule.run.start`, `rule.eval.start`, `rule.eval.error`, `rule.eval.done`, `rule.run.done`
- `workflow.run.done`, `workflow.run.failed`, `workflow.run.paused`, `workflow.run.resumed`, `workflow.run.reseeded`
- `workflow.node.enter`, `workflow.node.transition`
- `workflow.action.start`, `workflow.action.done`, `workflow.action.failed_continue`
- `workflow.custom`
- `workflow.hitl.note`
- `api.request.error`

**`diagnostic` events added in this task:**

- `workflow.guard.evaluated`
- `workflow.transition.requested`, `workflow.transition.denied`
- `bus.emit.done`, `bus.emit.noop`, `bus.handler.error`, `bus.handler.async.enqueued`

**Already in catalog and unchanged:** `task.*`, `feature.*`, `queue.*`, `scheduler.*`, `message.*`, `process.spawned`/`process.exited`/`process.stopped`, `workflow.run.started`, `workflow.run.finalized`, `workflow.phase`, `workflow.transition`, `workflow.action.started`, `workflow.action.finished`, `workflow.hitl.ask`, `workflow.hitl.response`.
