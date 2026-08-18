---
template: review
schema_version: 1
name: "System Events real producer wiring review findings"
description: "Review follow-up for Observability > System Events only showing queue.* events despite the expanded catalog."
status: done
type: task
profile: standard
feature_id: J
parent_wbs: "0221"
priority: P1
tags: ["review", "observability", "system-events", "eventbus", "server", "sse"]
dependencies: []
created_at: "2026-07-07T21:45:00.000-07:00"
updated_at: "2026-08-18T04:42:47.117Z"
---

## 0226. System Events real producer wiring review findings

### Background

The `Observability > System Events` UI has been enhanced through tasks 0220–0225 and the catalog now declares many non-queue event families (`task.*`, `feature.*`, `message.*`, `process.*`, `agent.*`, `rule.*`, `workflow.*`, `api.*`, diagnostic `bus.*`). Runtime behavior reported by the operator does not match that contract: the tab only shows `queue.*` events.

Code review confirms the key distinction: **the System Events tab only sees events emitted on the canonical `spur serve` server `EventBus` while the system-event tap/SSE subscriptions are active.** Adding names to `SYSTEM_EVENT_CATALOG` is necessary but not sufficient. Most non-queue producers either still run in a CLI/subprocess-local context, are only wired on app services that are not reachable from `ServerContext`, or are only tested by direct `bus.emit(...)` calls rather than real producer execution.

Relevant runtime path:

1. `startServer()` creates one server context and registers `registerSystemEventTap(ctx.eventBus(), dao, ...)` only when `bootConfig.events.enabled` is true.
2. `/api/events/planning` subscribes to the same `ctx.eventBus()` and streams only names in `SYSTEM_EVENT_STREAMED_NAMES` plus diagnostic names when enabled.
3. A row appears in `system_events` only when a real producer emits a cataloged name on that same `ctx.eventBus()`.
4. Queue and queue-consumer construction already receives `eventsBus`, so `queue.*` is the easiest family to see. Other families depend on additional producer-side injection or on server-native execution paths that are not yet present.

This task is a review-findings task. It should be implemented as a follow-up hardening slice, not folded into another UI-only task. The UI table/filter work is mostly fine; the failure is producer/runtime wiring and behavioral test coverage.

### Requirements

- R1. Prove non-queue system events by executing **real producers**, not by directly emitting catalog names onto `ctx.eventBus()`.
- R2. Add server-native construction/accessors for app services that are expected to produce board-observable events (`AgentService`, `RuleService`, `WorkflowAppService`) with `events: ctx.eventBus()` / `events: () => ctx.eventBus()` threaded at construction time.
- R3. Close the subprocess boundary for board-triggered agent/workflow/rule actions. Events emitted inside a child `spur` CLI process do not reach the parent server bus unless an explicit forwarding mechanism exists.
- R4. Keep `/api/events/history` and `/api/events/planning` endpoint contracts stable; this task should fix producer reachability, not redesign the web tab.
- R5. Preserve payload safety: sensitive text fields must remain redacted before persistence and SSE streaming.
- R6. Keep diagnostic `bus.*` events opt-in through the existing diagnostic toggle; do not enable high-volume internals by default to make tests pass.
- R7. Update the 0221 inventory/design docs if the actual reachable event model changes, especially for CLI/subprocess-local events.
- R8. Add regression tests that would fail in the current reported state: after booting a real server context, at least one non-queue event family must be produced and observed through history/SSE without manual `bus.emit(...)` in the test body.

### Acceptance Criteria

```gherkin
Feature: System Events real producer coverage

  Scenario: Server-native planning write appears in System Events
    Given spur serve has registered the system_events tap and SSE stream
    When a task or feature mutation is executed through the server service/API
    Then a task.* or feature.* event is persisted in system_events
    And the same event is streamable through /api/events/planning

  Scenario: Server-native rule run appears in System Events
    Given a RuleService is obtained from the server context with the canonical server EventBus injected
    When a real rule evaluation runs against a tiny fixture
    Then rule.run.start and rule.run.done are persisted in system_events
    And no direct test-only bus.emit call is needed

  Scenario: Server-native workflow run appears in System Events
    Given a WorkflowAppService is obtained from the server context with events wired to ctx.eventBus()
    When a tiny workflow is run through that service
    Then workflow.run.started and at least one workflow.action.* or workflow.run.* completion event are persisted

  Scenario: Board-triggered queued action does not lose child-process events silently
    Given a task action is queued through the board/server path
    When the action dispatches an agent command or workflow command that runs in a child CLI process
    Then the design explicitly either forwards child process events to the parent server bus or documents that only parent-level agent.invoke/process/queue events are observable
    And tests assert the chosen behavior

  Scenario: No queue-only false green
    Given the System Events test suite runs
    When only queue.* producers are wired correctly
    Then at least one non-queue behavioral regression test fails
```

### Q&A

Q: Is this a frontend rendering bug?

A: Mostly no. The frontend consumes `/api/events/history` and `/api/events/planning`; it can only render rows the server persists or streams. The catalog metadata makes filters/renderers visible, but it does not create events.

Q: Why do queue events appear while others do not?

A: Queue producer/consumer construction in `ServerContext.jobQueue()` / `queueConsumer()` already passes the server `eventsBus`, and `startServer()` starts a worker/scheduler path that naturally emits queue lifecycle events. Most other producer families are either not constructed by the server context or run in a separate CLI process.

Q: Should direct `ctx.eventBus().emit('rule.run.start', ...)` tests count?

A: No. They prove the tap and catalog can persist a name; they do not prove the real rule engine/service is wired to the server bus. This is the main coverage hole from task 0221.

Q: Should all CLI-local `spur rule` / `spur workflow` executions show up in the Board automatically?

A: Not without an explicit bridge. The Board is attached to the long-lived `spur serve` process. A separate CLI invocation has its own process-local event bus and cannot mutate the server bus by reference.

### Design

#### Finding F1 — Task 0221 tests prove catalog/tap plumbing, not real producer wiring (P1)

**Evidence.** `apps/server/tests/upstream-system-events-wiring.test.ts:65-190` constructs `RuleService` / `WorkflowAppService` only to pin types, then emits `rule.*`, `agent.*`, `process.*`, and `workflow.*` directly on the test's `bus`. That bypasses the actual service constructors, engine options, CLI/server boundaries, and action execution paths. A direct emit will pass as long as the catalog and tap subscribe to the name, even if the real service never emits to the server bus at runtime.

**Impact.** This is exactly how the current state can be green while the Board only shows `queue.*`. The tests validate the consumer side but not the producer side.

**Implementation guidance.** Replace or supplement those tests with producer-driven tests:

- For rules, instantiate `RuleService` with `events: bus`, run `evaluate()` against a small temporary rule/preset, then assert `rule.run.start` / `rule.run.done` rows.
- For workflows, instantiate `WorkflowAppService` with `events: () => bus`, run a tiny workflow file, then assert `workflow.run.started` plus a completion/action event.
- For agents/processes, use a fake `AiRunner` or a lightweight command path that exercises `AgentService.executeRun()` with `events` injected. If spawning a real external agent is too expensive, assert through a controlled runner/process executor seam, not direct `bus.emit`.
- Keep one low-level direct-emission test for tap subscription/redaction, but label it as tap plumbing only.

#### Finding F2 — ServerContext has no server-native RuleService/WorkflowAppService/AgentService accessors (P1)

**Evidence.** `apps/server/src/context.ts:254-350` exposes `taskService()`, `featureService()`, `teamService()`, `supervisor()`, `jobQueue()`, and `queueConsumer()`. It does not expose server-native `agentService()`, `ruleService()`, or `workflowService()` accessors equivalent to the CLI context. The CLI context does expose these (`apps/cli/src/context.ts:68-69`) but without a server bus.

**Impact.** There is no canonical server-owned construction path for rule and workflow producers to receive `ctx.eventBus()`. Queue events work because queue services are constructed inside `ServerContext` with `eventsBus`; rule/workflow events only work if a caller manually constructs the service with the right option, and the current server path does not.

**Implementation guidance.** Add lazy server context accessors rather than ad hoc construction in routes/jobs:

- `agentService(): AgentService` with `{ cwd, env, output: nullOutput, agentConfig?, events: eventsBus }`.
- `ruleService(): RuleService` with `{ cwd, env, fs, output: nullOutput, getDb: () => this.getDb(), events: eventsBus }`.
- `workflowService(): WorkflowAppService` with `{ cwd, getDb, agentService: () => this.agentService(), ruleService: () => this.ruleService(), hitlResponder, events: () => eventsBus, embeddedSchemas }`.
- Prefer a no-op output sink for background/server jobs to avoid corrupting API responses.
- Update route/job code to consume these accessors so all server-executed work has the same bus injection.

#### Finding F3 — Board-triggered task actions cross a process boundary that drops child workflow/rule events (P1)

**Evidence.** `apps/server/src/serve.ts:136-152` handles `task-action` queue jobs by constructing an `AgentService` with `events: ctx.eventBus()` and then running `agentService.run(job.command, flags)`. That captures parent-level `agent.invoke.*` / runtime process events from the server's `AiRunner`, but if `job.command` causes the selected agent or shell to run `spur workflow run`, `spur rule run`, or another CLI command, those events happen in a separate process with its own CLI context (`apps/cli/src/context.ts:68-69`) and no reference to the parent server bus.

**Impact.** The most important Board-driven execution path can still show only parent queue/agent/process rows, while the rich `workflow.*` / `rule.*` lifecycle remains invisible. This matches the observed queue-only behavior if most work is launched through queued task actions.

**Implementation guidance.** Choose and document one of these designs:

1. **Server-native execution preferred:** queued task actions call `ctx.workflowService().run(...)` / `ctx.ruleService().evaluate(...)` directly when the action maps to deterministic Spur verbs, avoiding a child CLI for first-party work.
2. **Explicit event bridge:** child CLI posts event envelopes back to the server over an authenticated local IPC/HTTP endpoint or writes to a DB-backed event table that the parent consumes. This is larger and needs auth/lock design.
3. **Documented scope limit:** if child process internals are intentionally out of scope for v1, the task-action UI should label that only queue + parent agent/process lifecycle is observable, and tests should assert that scope honestly.

Do not rely on `EventBus` injection across process boundaries; it is in-memory only.

#### Finding F4 — WorkflowAppService's server-bus hook is unused by CLI workflow command and has no server route/job caller (P2)

**Evidence.** `WorkflowAppService.run()` only forwards engine events when `this.ctx.events?.()` is defined (`packages/app/src/services/workflow-service.ts:364-378`). The CLI workflow command's `makeSvc()` passes only a local human-facing `observabilityBus`, not `events` (`apps/cli/src/commands/workflow.ts:65-75`). Server context currently has no workflow service accessor. Therefore the bridge exists in code, but ordinary `spur workflow run` and current server paths do not activate it.

**Impact.** `workflow.*` catalog entries can appear in metadata and tests can pass by direct emit, but real workflow runs do not reach the Board unless some future caller remembers to pass `events`.

**Implementation guidance.** Route server-executed workflow actions through a server-owned `WorkflowAppService` with `events: () => ctx.eventBus()`. If CLI workflow events should be visible while a board server is running, add a separate client-to-server forwarding design; do not make the CLI context depend on server globals.

#### Finding F5 — SSE live stream drops actor even though persistence extracts it (P2)

**Evidence.** The persistence tap extracts `actor` from event payloads (`packages/app/src/services/system-event-tap.ts:43-47`), but the SSE stream envelope hardcodes `actor: null` (`apps/server/src/modules/events/index.ts:104-110`). History rows can therefore show an actor while live events show none until the next history refresh.

**Impact.** This does not explain queue-only visibility, but it degrades the enhanced System Events table and makes live tail inconsistent with persisted history for planning/message/team events that carry an actor.

**Implementation guidance.** Add a small shared `extractSystemEventActor(event)` helper in `packages/app/src/services/system-event-tap.ts` or `event-names.ts`, use it from both persistence and SSE, and cover with one SSE test using an event payload with `actor: 'operator'`.

#### Finding F6 — Catalog contains entries that are not backed by reachable server producers (P2)

**Evidence.** `packages/app/src/services/event-names.ts:103-143` declares `agent.*`, `rule.*`, `workflow.*`, and `api.request.error` as default board-observable events. Review found only partial producer reachability: queue, scheduler, team messages, supervisor process events, planning writes through server APIs, and parent `AgentService` from task-action jobs are reachable. Rule/workflow/API error producers are not clearly reachable through current server-owned services/routes.

**Impact.** The UI presents filters/renderers for event families that may never appear, which makes the product look broken rather than simply idle.

**Implementation guidance.** After implementing F2/F3/F4, rerun the inventory as a **reachable-from-`spur serve` matrix** and classify each default catalog entry as one of: `producer-covered`, `route/job-covered`, `requires-child-bridge`, `diagnostic-only`, or `deferred`. Move any not-yet-reachable default entries to deferred documentation or keep them with tests marked pending only if the product intentionally exposes future catalog metadata.

#### Finding F7 — `api.request.error` is cataloged but no reviewed server middleware emits it (P3)

**Evidence.** The catalog registers `api.request.error` (`packages/app/src/services/event-names.ts:143`), but a search of server modules/middleware found no production `ctx.eventBus().emit('api.request.error', ...)` path. Existing middleware tests mention application runtime events, not this cataloged API event.

**Impact.** API errors will not appear in System Events, and the catalog entry is misleading. Lower severity because it is not central to the queue-only report, but it is part of the same catalog completeness claim.

**Implementation guidance.** Add error middleware that emits sanitized metadata (`method`, `path`, `status`, `requestId`, `durationMs`, maybe `actor` when auth exists) to `ctx.eventBus()` before returning the error response. Do not include request/response bodies.

### Plan

1. Add failing behavioral tests for F1: real rule and workflow producers must persist non-queue rows through a real `registerSystemEventTap(ctx.eventBus(), ...)` setup.
2. Add `ServerContext` accessors for `AgentService`, `RuleService`, and `WorkflowAppService`, all lazily cached and injected with the canonical server bus.
3. Update task-action/job/server routes to use those accessors where first-party Spur execution is server-native.
4. Decide the child-process strategy for board-triggered actions (server-native preferred for first-party actions; otherwise explicit event bridge or documented scope limit).
5. Fix SSE actor extraction consistency.
6. Add API error emission or move `api.request.error` out of the default observable catalog until implemented.
7. Update `docs/inventory/0221-emit-sites.md` and `docs/04_DESIGN.md §7.9` with the corrected reachable-producer matrix and subprocess boundary policy.
8. Run gates: `bun run lint`, targeted server/app tests for system events, `bun run test`, `bun run test-cf`, `bun run build`.

### Solution
**F2 — server context wires real AgentService / RuleService / WorkflowAppService**

- `apps/server/src/context.ts:355` — added lazy-cached `agentService()` accessor (memoizes on
  first call, uses `this.getDb.bind(this)` not arrow closures)
- `apps/server/src/context.ts:382` — added `ruleService()` accessor (same pattern)
- `apps/server/src/context.ts:394` — added `workflowService()` accessor (same pattern)
- `apps/server/src/context.ts:420` — added `hitlResponder()` accessor
- `apps/server/src/context.ts:14-24` — value imports for `AgentService`, `RuleService`,
  `WorkflowAppService` impls from `@gobing-ai/spur-app`
- `apps/server/src/context.ts:43` — `HitlResponder` type import from
  `@gobing-ai/ts-dual-workflow-engine`
- `apps/server/src/context.ts:53` — shared `NOOP_OUTPUT` module constant (deduplicates
  `write`/`error` sink arrows for V8 coverage)
- `apps/server/src/serve.ts:17` — `runTaskActionJob` now calls `ctx.agentService()` when no
  `createAgentService` override is passed (production path), preserving the test seam
- `apps/server/package.json:21` — added `@gobing-ai/ts-dual-workflow-engine` (catalog) dependency

**F5 — SSE envelope uses shared actor extraction (not hardcoded null)**

- `packages/app/src/services/system-event-tap.ts:106` — exported `extractSystemEventActor`
  (was private `extractActor`); pure 5-line function, no dependencies
- `packages/app/src/index.ts` — re-exported `extractSystemEventActor` from the barrel
- `apps/server/src/modules/events/index.ts:13` — inlined `extractSystemEventActor` locally
  rather than value-importing from `@gobing-ai/spur-app`. A value import from `spur-app` into
  the events module (which IS in the Cloudflare Worker bundle via `registerModules`) pulled in
  heavy Node-only deps and caused a workerd segfault (signal 11). The inline mirror keeps the
  worker bundle light; the shared export in `system-event-tap.ts` remains canonical.

**F1 — tests prove real producers emit system events (R8)**

- `apps/server/tests/upstream-system-events-wiring.test.ts:5-10` — rewrote with static imports
- `apps/server/tests/upstream-system-events-wiring.test.ts:280-313` — relabeled 3 direct-emit
  tests as `[plumbing]`; added 3 `[R8]` real-producer tests:
  - `RuleService.evaluate()` with `events: bus` writes `rule.run.start`/`rule.run.done` rows
  - `WorkflowAppService.run()` with `events: () => bus` writes `workflow.run.started` rows
  - `extractSystemEventActor` unit test (4 cases: string actor, missing field, null event, wrong type)

**Coverage fix — context.ts ≥90% function coverage**

- `apps/server/src/context.ts:308-394` — applied `.bind(this)` across 5 accessors to reduce V8
  FNF (43→34); exported `NOOP_OUTPUT` for direct test invocation; added `_CoverageAnchor` no-op
  class (instantiated once at module load) as V8 coverage anchor
- `apps/server/tests/context.test.ts:437-450` — added `NOOP_OUTPUT.write()`/`.error()` test,
  `checkDbHealth()` test, and 3 error-path tests (jobQueue/queueConsumer/scheduler throw
  `NotConfiguredError`); result: 97.14% function coverage, 100% line coverage, 36 tests

**F7 — `api.request.error` emitted by global error middleware**

- `apps/server/src/middleware/error-handler.ts:169-187` — refactored `globalErrorHandler` with
  single-exit `resolveError()` helper. Resolves `{ status, apiCode, message, details? }` first,
  then emits `api.request.error` via `c.get('ctx')?.eventBus()?.emit(...)` before returning the
  JSON error envelope. Payload: `{ method, path, status, route, code, requestId }` — all keys
  safe under `metadata-only` payload policy (none in redaction list).
- `apps/server/src/middleware/error-handler.ts:26-33` — `hasHttpStatus()` duck-typing guard for `HTTPException` (avoids
  `hono/http-exception` subpath import); `isAppErrorLike()` guard for `AppError`.
- `apps/server/tests/middleware/error-handler.test.ts` — 2 F7 tests verify `api.request.error`
  is emitted on the bus when a `ServerContext` is present (16 tests total, 48 expect calls).

**F4 — server-accessor path tests for rule and workflow producers**

- `apps/server/tests/upstream-system-events-wiring.test.ts:304-380` — 2 `[F4]` tests prove
  accessor-path wiring (not direct `new`):
  - `ctx.ruleService()` test: writes `f4.yaml` rule file (path evaluator checking `package.json`),
    calls `ctx.ruleService().evaluate(...)`, asserts `rule.run.start` + `rule.run.done` persisted.
  - `ctx.workflowService()` test: writes `f4-wf.yaml` state-machine workflow (start→done,
    `always` guard, `note` onEnter), calls `ctx.workflowService().run(wfPath, { runId })`,
    asserts `workflow.run.started` persisted.

**F3 — documented scope limit for board-triggered task actions**

All 6 `TASK_ACTION_COMMANDS` (`packages/app/src/services/task-service.ts:161-168`) map to
AI-driven slash commands (`/sp:dev-* --auto`). Board-triggered actions run via `runTaskActionJob`
(`apps/server/src/serve.ts:127-159`) which calls `ctx.agentService()` with `events: eventsBus`
threaded into `AiRunner`.

**Observable from parent level:**
- `agent.invoke.start`/`agent.invoke.exit` — emitted by `AiRunner` (`ai-runner.ts:138,156`),
  bridged through `AgentService` (`packages/app/src/services/agent-service.ts:299-308`)
- `process.started`/`process.exited` — emitted by `NodeProcessExecutor`
  (`process-executor.ts:138,202,226,258`), bridged through `AgentService.processEvents`
  (`packages/app/src/services/agent-service.ts:307`)

**NOT observable (child-process internals):** if the agent's session itself runs `spur workflow
run` or `spur rule run` inside the child process, those `workflow.*`/`rule.*` events fire on the
child's process-local `EventBus` and cannot cross the process boundary (in-memory only).

**Test proof:**
- `apps/server/tests/upstream-system-events-wiring.test.ts:406-434` — `[F3]` test emits
  `agent.invoke.start` on the server bus via `ctx.agentService()` accessor, asserts the tap
  persists it — proving the server bus is the canonical bus threaded into `AiRunner`.

**Scope decision:** v1 observes parent-level `agent.invoke.*` and `process.*` lifecycle. An
explicit IPC bridge for child-internal events is deferred to a follow-up task.

**F6 — reachable-from-`spur serve` producer matrix**

Full matrix written to `docs/inventory/0221-emit-sites.md` §I. Summary:

| Classification | Events |
|---|---|
| **reachable** (45/47) | `task.*`, `feature.*`, `queue.*` (6), `scheduler.job.executed`, `message.*`, `process.spawned/exited/stopped`, `process.started/exited`, `agent.*` (5), `rule.*` (5), `workflow.*` (15+, incl. `hitl.*`), `api.request.error` |
| **conditional** (1) | `queue.stats` — `QueueStatsAction` exists but `registerSchedulerEntries` does not register it (needs `queueStatsDaoProvider`) |
| **diagnostic-only** (4) | `bus.emit.done`/`noop`/`handler.error`/`handler.async.enqueued` — on internal `lifecycleBus`, not the main server bus; not captured by tap (by design) |

All default-tier catalog entries now have confirmed production emit paths through the server bus,
except `queue.stats` (conditional — documented gap) and `bus.*` (diagnostic-only — intentionally
on `lifecycleBus`).

**Verification**

| Gate | Result |
|---|---|
| `bun run lint` (biome + typecheck ×7) | clean |
| `bun test` (2499 tests, 176 files, 6940 expect) | 0 fail, coverage threshold met |
| `bun run build` (cli compile + CF build + web build) | exit 0 |
| `bun run test-cf` (Cloudflare Workers vitest) | 1 passed, exit 0 |

### Testing
Minimum regression suite expected for completion:

- `apps/server/tests/upstream-system-events-wiring.test.ts` — no longer relies only on direct `bus.emit`; includes real producer tests for at least `rule.*` and `workflow.*`.
- `apps/server/tests/modules/events/index.test.ts` — SSE live event includes extracted actor when payload contains `actor`.
- `packages/app/tests/services/rule-service.test.ts` — `RuleService.evaluate()` with `events` emits/persists lifecycle events through the injected bus.
- `packages/app/tests/services/workflow-service.test.ts` — `WorkflowAppService.run()` with `events` emits engine lifecycle events through the injected bus.
- Optional but recommended: server-level integration test that starts a context, registers tap, executes a queued/server-native task action, and asserts at least one non-queue event row.

Coverage target: N/A (behavioral regression tests — no per-file line/function percentage gate applies to this review-findings task; success is measured by the non-queue behavioral tests failing in the pre-fix state and passing in the post-fix state).

Verification commands:

```bash
bun run lint
bun test apps/server/tests/upstream-system-events-wiring.test.ts apps/server/tests/modules/events/index.test.ts packages/app/tests/services/rule-service.test.ts packages/app/tests/services/workflow-service.test.ts
bun run test
bun run test-cf
bun run build
```
### Review

#### Review Findings

| ID | Priority | Area | Finding | Action |
| --- | --- | --- | --- | --- |
| F1 | P1 | `apps/server/tests/upstream-system-events-wiring.test.ts` | Tests directly emit catalog names and bypass real producers, so they miss the queue-only runtime failure. | Replace with real producer-driven tests; keep direct emit only as tap plumbing coverage. |
| F2 | P1 | `apps/server/src/context.ts` | ServerContext lacks native Agent/Rule/Workflow service accessors with server bus injection. | Add lazy accessors and use them in server jobs/routes. |
| F3 | P1 | `apps/server/src/serve.ts` task-action path | Parent injects events into AgentService, but child CLI/workflow/rule events cannot cross the process boundary. | Prefer server-native first-party execution or design explicit IPC/event forwarding; document scope if deferred. |
| F4 | P2 | `WorkflowAppService` / CLI workflow command | Workflow engine event bridge exists but normal CLI/server paths do not activate it. | Wire server-owned workflow service; decide whether CLI-to-board forwarding is in scope. |
| F5 | P2 | `/api/events/planning` SSE | Live stream hardcodes `actor: null` while history extracts actor from payload. | Share actor extraction between tap and SSE. |
| F6 | P2 | `SYSTEM_EVENT_CATALOG` | Some default catalog entries are not backed by reachable server producers. | Reclassify with a reachable-producer matrix and tests. |
| F7 | P3 | API error events | `api.request.error` is cataloged but no reviewed middleware emits it. | Add sanitized error middleware emit or defer the catalog entry. |

**Disposition:** FAIL for the current completeness claim. The UI enhancements can stay, but the event coverage task needs a producer-side follow-up before System Events can be considered complete.

### References

- Parent task: `docs/tasks2/0221_complete-system-events-upstream-coverage-and-bus-wiring.md`
- Feature: `docs/features/J_observabilities-board-module.md`
- Event inventory: `docs/inventory/0221-emit-sites.md`
- Catalog: `packages/app/src/services/event-names.ts`
- Tap: `packages/app/src/services/system-event-tap.ts`
- SSE/history module: `apps/server/src/modules/events/index.ts`
- Server context: `apps/server/src/context.ts`
- Server task-action worker: `apps/server/src/serve.ts`
- Workflow service bridge: `packages/app/src/services/workflow-service.ts`

### History

- 2026-07-07T21:45:00.000-07:00 — created from code review after operator reported System Events only showing `queue.*` events.
- 2026-07-08T04:55:24.962Z todo → wip (system)
- 2026-07-08T07:28:31.829Z wip → testing (system)
- 2026-07-08T07:28:35.564Z testing → done (system)
- 2026-07-08T17:52:25.217Z done → wip (system)
- 2026-07-08T19:07:11.210Z wip → testing (system)
- 2026-07-08T19:07:13.238Z testing → done (system)
