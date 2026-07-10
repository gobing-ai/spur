# System Events Producer Audit

> Verified 2026-07-09 against production source after tasks 0221, 0226, 0233, 0236, 0237.
> **Supersedes** the scattered producer-wiring findings in task 0226
> (`docs/tasks2/0226_system-events-real-producer-wiring-review-findings.md`) and
> the task-0221 emit-site inventory (`docs/inventory/0221-emit-sites.md`).
> This is the single source of truth for producer reachability as of feature L.

## Status legend

| Status | Symbol | Meaning |
| --- | --- | --- |
| reachable | ✅ | The canonical server `EventBus` (`eventsBus` in `createServerContext`) receives the emit via an injected `events`/`eventBus`/`observabilityBus` accessor. The `system_events` tap persists it; SSE streams it. |
| nested-CLI deferred | ⚠️ | The event fires only inside a child agent process (e.g. `sp:dev-*` auto-mode child running `spur workflow run`). The child's `EventBus` is process-local and does not cross the process boundary. This is an intentional v1 scope limit (`serve.ts:137–145`), not a wiring gap. |
| diagnostic-only | 🔬 | Emitted on a separate internal `lifecycleBus`, not the main server bus. Not captured by the tap unless a forwarder bridges it. By design. |
| conditional | ◐ | The producer exists but `spur serve` does not perform the registration needed to activate it. |
| unwired | ❌ | No production emit path reaches the server bus. |

## Audit table — all 58 catalog entries

Source of truth: `SYSTEM_EVENT_CATALOG` in `packages/app/src/services/event-names.ts`.

### Planning (task.\*, feature.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 1 | `task.created` | `planning-events.ts:50` | `LazyPlanningEventEmitter` → `eventsBus` (`context.ts:313–328`) | ✅ reachable |
| 2 | `task.updated` | `planning-events.ts:50` | same | ✅ reachable |
| 3 | `task.transitioned` | `planning-events.ts:50` | same | ✅ reachable |
| 4 | `feature.created` | `planning-events.ts:50` | same | ✅ reachable |
| 5 | `feature.updated` | `planning-events.ts:50` | same | ✅ reachable |
| 6 | `feature.transitioned` | `planning-events.ts:50` | same | ✅ reachable |

### Queue (queue.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 7 | `queue.consumer.started` | `db-job-queue.ts:87` | `ctx.queueConsumer()` → `config.events: eventsBus` | ✅ reachable |
| 8 | `queue.consumer.stopped` | `db-job-queue.ts:102` | same | ✅ reachable |
| 9 | `queue.job.enqueued` | `db-job-queue.ts:30,39` | `ctx.jobQueue()` → `events: eventsBus` | ✅ reachable |
| 10 | `queue.job.completed` | `db-job-queue.ts:189` | `ctx.queueConsumer()` → `config.events: eventsBus` | ✅ reachable |
| 11 | `queue.job.failed` | `db-job-queue.ts:206` | same | ✅ reachable |
| 12 | `queue.job.retrying` | `db-job-queue.ts:218` | same | ✅ reachable |
| 13 | `queue.stats` | `scheduler/action.ts:113` | `QueueStatsAction` requires `queueStatsDaoProvider`; `registerSchedulerEntries` does NOT register it | ◐ conditional |

### Scheduler (scheduler.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 14 | `scheduler.job.executed` | `serve.ts:85` (`registerSchedulerEntries`) | emits on `ctx.eventBus()` directly | ✅ reachable |

> **Payload note (task 0233).** The emit site now produces `{ name, durationMs, error? }` — `name` (not `kind`), no `cron`, and `error` is captured via try/catch and re-thrown. Matches the catalog type contract.

### Message (message.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 15 | `message.sent` | `team-service.ts:171` (`emitMessageEvent`) | `ctx.teamService()` → `eventBus: eventsBus` | ✅ reachable |
| 16 | `message.replied` | `team-service.ts:171` | same | ✅ reachable |

> Payload is metadata-only (`MessageEventPayload`); body is never included.

### Process (process.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 17 | `process.spawned` | `supervisor-service.ts:167` | `ctx.supervisor()` → `eventBus: eventsBus` | ✅ reachable |
| 18 | `process.exited` | `supervisor-service.ts:179` | same | ✅ reachable |
| 19 | `process.stopped` | `supervisor-service.ts:209` | same | ✅ reachable |
| 20 | `process.started` | `process-executor.ts:138,202,271` (ts-runtime) | `ctx.agentService()` → `processEvents: bridgeAgentEvents(eventsBus)` → `NodeProcessExecutor` | ✅ reachable |

### Agent (agent.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 21 | `agent.invoke.start` | `ai-runner.ts:138` | `ctx.agentService()` → `events: bridgeAgentEvents(eventsBus)` → `AiRunner` | ✅ reachable (parent-level; child-internal is ⚠️) |
| 22 | `agent.invoke.exit` | `ai-runner.ts:156` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 23 | `agent.started` | `team-orchestrator.ts:73` | `ctx.teamService()` → `events: eventsBus` → `TeamOrchestrator({ events })` (task 0237) | ✅ reachable |
| 24 | `agent.stopped` | `team-orchestrator.ts:86` | same | ✅ reachable |
| 25 | `agent.message.sent` | `team-orchestrator.ts:98` | same | ✅ reachable |

> **Task 0237 wiring.** `TeamServiceContext` now carries `events?: EventBus<AgentEvents>`; the server passes `events: eventsBus` in the `teamService()` accessor (`context.ts:349–353`). `TeamService.orchestrator()` forwards `{ events: this.ctx.events }` to the `TeamOrchestrator` constructor (`team-service.ts:379–384`). All three `agent.*` lifecycle events now reach the tap.
>
> **Nested-CLI residual.** `agent.invoke.*` fires at the parent `AiRunner` level (reachable). When the parent spawns a child agent process for `sp:dev-* --auto`, the child's own `AiRunner`/`TeamOrchestrator` instances emit on their process-local bus — those emissions are ⚠️ nested-CLI deferred (see footer).

### Rule (rule.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 26 | `rule.run.start` | `rule-engine/engine.ts:135` | `ctx.ruleService()` → `events: eventsBus` → `RuleEngine` | ✅ reachable (parent-level; child-internal is ⚠️) |
| 27 | `rule.eval.start` | `rule-engine/engine.ts:158` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 28 | `rule.eval.done` | `rule-engine/engine.ts:187` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 29 | `rule.eval.error` | `rule-engine/engine.ts:178` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 30 | `rule.run.done` | `rule-engine/engine.ts:251` | same | ✅ reachable (parent-level; child-internal is ⚠️) |

### Workflow (workflow.\*) — engine-native names

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 31 | `workflow.run.started` | `run-lifecycle.ts:150`; also `observability.ts:112` | `ctx.workflowService()` → `events: () => eventsBus` (engine bridge) AND `observabilityBus: () => eventsBus` (adapter, task 0236) | ✅ reachable (dual-emit; see note) |
| 32 | `workflow.run.done` | `run-lifecycle.ts:226` | engine bridge | ✅ reachable |
| 33 | `workflow.run.failed` | `run-lifecycle.ts:240` | engine bridge | ✅ reachable |
| 34 | `workflow.run.finalized` | `observability.ts:121` | adapter via `observabilityBus` (task 0236) | ✅ reachable |
| 35 | `workflow.run.paused` | `run-lifecycle.ts:256`; `service.ts:143` | engine bridge | ✅ reachable |
| 36 | `workflow.run.resumed` | `run-lifecycle.ts:268`; `service.ts:143` | engine bridge | ✅ reachable |
| 37 | `workflow.run.reseeded` | `service.ts:117` | engine bridge | ✅ reachable |
| 38 | `workflow.node.enter` | `run-lifecycle.ts:195` | engine bridge | ✅ reachable |
| 39 | `workflow.phase` | `observability.ts:126` | adapter via `observabilityBus` (task 0236) | ✅ reachable |
| 40 | `workflow.node.transition` | `run-lifecycle.ts:211` | engine bridge | ✅ reachable |
| 41 | `workflow.transition` | `observability.ts:131` | adapter via `observabilityBus` (task 0236) | ✅ reachable |
| 42 | `workflow.transition.requested` | `service.ts:265` | engine bridge | ✅ reachable |
| 43 | `workflow.transition.denied` | `service.ts:288` | engine bridge | ✅ reachable |
| 44 | `workflow.action.start` | `run-lifecycle.ts:274` | engine bridge | ✅ reachable |
| 45 | `workflow.action.started` | `observability.ts:136` | adapter via `observabilityBus` (task 0236) | ✅ reachable |
| 46 | `workflow.action.done` | `run-lifecycle.ts:280` | engine bridge | ✅ reachable |
| 47 | `workflow.action.finished` | `observability.ts:151` | adapter via `observabilityBus` (task 0236) | ✅ reachable |
| 48 | `workflow.action.failed_continue` | `run-lifecycle.ts:297` | engine bridge | ✅ reachable |
| 49 | `workflow.guard.evaluated` | `run-lifecycle.ts:308` | engine bridge | 🔬 diagnostic-only (high-volume) |
| 50 | `workflow.hitl.ask` | `run-lifecycle.ts:320`; app `hitl-confirm.ts:29`, `hitl-select.ts:35`, `hitl-input.ts:29` | engine bridge | ✅ reachable (redacted payload) |
| 51 | `workflow.hitl.response` | `run-lifecycle.ts:325`; app `hitl-*.ts:41,48,41` | engine bridge | ✅ reachable (redacted payload) |
| 52 | `workflow.hitl.note` | `host.ts:113` | engine bridge → host `context.events` | ✅ reachable (redacted: `message`) |
| 53 | `workflow.custom` | `host.ts:130` | engine bridge | ✅ reachable |

> **Task 0236 wiring.** The server `workflowService()` accessor (`context.ts:396–410`) now passes both `events: () => eventsBus` (engine bridge → engine-native names) AND `observabilityBus: () => eventsBus` (→ `ObservableWorkflowAdapter` → verb-form names). This activates the 6 adapter-emitted verb-form events (`workflow.run.finalized`, `workflow.phase`, `workflow.transition`, `workflow.action.started`, `workflow.action.finished`, plus a second `workflow.run.started`). `workflow.run.started` fires from both paths — accepted as harmless v1 duplication; dedup deferred.

### API (api.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 54 | `api.request.error` | `error-handler.ts:176` (`globalErrorHandler`) | `c.get('ctx')?.eventBus()?.emit(...)` | ✅ reachable |

### Bus diagnostics (bus.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 55 | `bus.emit.done` | `event-bus.ts:272` | internal `lifecycleBus` only | 🔬 diagnostic-only |
| 56 | `bus.emit.noop` | `event-bus.ts:282` | internal `lifecycleBus` only | 🔬 diagnostic-only |
| 57 | `bus.handler.error` | `event-bus.ts:293` | internal `lifecycleBus` only | 🔬 diagnostic-only |
| 58 | `bus.handler.async.enqueued` | `event-bus.ts:304` | internal `lifecycleBus` only | 🔬 diagnostic-only |

## Summary

| Classification | Count | Events |
| --- | --- | --- |
| ✅ reachable | 52 | All planning, queue (except `queue.stats`), scheduler, message, process, agent, rule (parent-level), workflow (default tier), `api.request.error` |
| ◐ conditional | 1 | `queue.stats` |
| 🔬 diagnostic-only | 5 | `workflow.guard.evaluated`, `bus.emit.done/noop`, `bus.handler.error`, `bus.handler.async.enqueued` |
| ⚠️ nested-CLI deferred | 0 (residual) | `rule.*` and `agent.invoke.*` fire at parent level (✅); child-internal emissions are process-local (see footer) |
| ❌ unwired | **0** | — |

**All default-tier catalog entries now have a confirmed production emit path to the server bus**, except `queue.stats` (conditional — requires scheduler-registry wiring that `spur serve` does not perform) and the `bus.*` family (diagnostic-only by design — separate internal bus).

## Systemic Observability Gaps

Three architectural constraints affect observability completeness but are **not bugs** — they are deliberate scope boundaries. Documented here so operators interpret "missing" events correctly.

### Gap 1 — CLI event-tap gap (CLI-driven work is invisible to the Board)

The `system_events` persistence tap (`registerSystemEventTap`) is registered **only** in `apps/server/src/serve.ts:274`, gated by `bootConfig.events.enabled`. The CLI runtime (`apps/cli/src/context.ts`) constructs no tap — it builds only `agentService`, `ruleService`, and `hitlResponder` on a CLI-local bus that is never persisted.

**Consequence:** when an operator runs `spur task create`, `spur feature update`, `spur rule run`, `spur workflow run` directly from the shell, the services emit events on a process-local `EventBus` that dies with the process. Those events never appear in Board system_events. The Board is a **server-side observability surface**; CLI-driven work operates outside it by design.

**Affected prefixes:** all catalog entries, but only when driven from the CLI rather than the Board's server-side API. The events themselves are correctly emitted — there is simply no persistent tap on the CLI path.

**Observability path classification:**

| Prefix family | Path | Board-visible? |
| --- | --- | --- |
| `task.*`, `feature.*` | server API → `planningBus` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `rule.*` | server API → `RuleService.events` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `workflow.*` | server API → engine bridge + `observabilityBus` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `message.*` | server API → `TeamService.eventBus` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `agent.*` | server API → `TeamOrchestrator.events` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `process.spawned/exited/stopped` | server API → `SupervisorService.eventBus` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `process.started` | agent-run side-channel → `NodeProcessExecutor.processEvents` → tap | ◐ only during agent runs (see Gap 3) |
| `queue.*` | config-gated (see Gap 2) | ◐ |

### Gap 2 — Queue config gating (`queue.*` events require `jobqueue.enabled: true`)

All seven `queue.*` catalog entries are wired through `createQueueConsumer` (`context.ts:458–468`), which passes `{ events: eventsBus }`. But both `jobQueue()` and `queueConsumer()` throw `NotConfiguredError` when `jobQueueEnabled` is false (`context.ts:441–442`, `459–460`). The flag defaults to **false** (`context.ts:265`) and is only set true when `bootConfig.jobqueue.enabled` is true (`serve.ts:243`, `287`).

**Consequence:** with the default single-operator config (`jobqueue.enabled: false`), zero `queue.*` events fire — the queue consumer never starts, so no jobs are enqueued, completed, failed, or retried. This is correct: there is no queue to observe. The events become reachable only when an operator opts into the embedded job queue.

**To activate:** set `jobqueue.enabled: true` in `.spur/config.yaml` (or `SPUR_JOBQUEUE_ENABLED=true`). The serve bootstrap will then construct the consumer and the seven `queue.*` events will flow to the tap.

**`queue.stats`** remains ◐ conditional even with the queue enabled — it requires a separate `QueueStatsAction` registration in the scheduler registry that `registerSchedulerEntries` does not perform.

### Gap 3 — `process.started` is a side-channel (reachable only during agent runs)

`process.started` is emitted by `NodeProcessExecutor` in `ts-runtime` when wired with a `processEvents` bus. `AgentService.run()` wires this bus (`agent-service.ts:304–308` via `bridgeAgentEvents`), so `process.started` fires during agent invocations. But `SupervisorService` — the canonical process-lifecycle observer — uses `process.spawned`/`process.exited`/`process.stopped` as **its** lifecycle names, not `process.started`.

**Consequence:** `process.started` appears in system_events only when an agent run triggers a subprocess via `NodeProcessExecutor`. It does NOT fire for supervisor-managed agent spawns (those emit `process.spawned`). Operators filtering for "process started" should use `process.spawned` as the authoritative process-birth event; `process.started` is a secondary signal correlated to agent-run subprocesses.

### Gap 4 — Nested-CLI context (child agent internal events are process-local)

When the Board triggers a task action that runs `sp:dev-* --auto`, the parent process spawns a child agent. The **parent-level** lifecycle events (`agent.invoke.start/exit`, `process.started/exited`) ARE captured on the server bus. But events emitted **inside the child's own session** — e.g. if the child runs `spur workflow run` or `spur rule run` — fire on the child's process-local `EventBus` and do not cross the process boundary.

**Consequence:** `rule.*`, `workflow.*`, and `agent.*` events emitted inside a child agent subprocess are ⚠️ **nested-CLI deferred** — they are correctly emitted but never reach the Board. This is a documented v1 scope limit. Bridging child-internal events to the parent bus requires an explicit IPC channel (deferred).

## Footer notes

### 1. Nested-CLI context (⚠️ deferred scope limit)

Board-triggered task actions run `sp:dev-* --auto` as AI-driven slash commands via `ctx.agentService()` (`serve.ts:137–145`). The **parent-level** process/agent lifecycle events (`agent.invoke.start/exit`, `process.started/exited`) ARE captured. However, events emitted **inside the child agent's own session** — e.g. if the child itself runs `spur workflow run` or `spur rule run` — do NOT cross the process boundary. The child's `EventBus` is in-memory and process-local. This is a documented v1 scope limit: the Board observes parent-level agent/process lifecycle; child-internal events require an explicit IPC bridge (deferred).

### 2. Single-queue architecture (no `queueName` field)

There is exactly **one** `DBJobQueue` instance per server (`serve.ts:279–294`). No `queueName` field is threaded through queue events because there is nothing to discriminate at the queue level. The **`type`** field (job type) is the discriminator — it identifies the kind of work (e.g. `team-assign`, `workflow-run`, `agent-invoke`). Queue event payloads carry `{ jobId, type }`; adding a `queueName` would be dead data.

### 3. Supersede note

This document supersedes:
- Task 0221 emit-site inventory (`docs/inventory/0221-emit-sites.md`) — section I matrix.
- Task 0226 producer-wiring findings (`docs/tasks2/0226_system-events-real-producer-wiring-review-findings.md`) — findings F4/F6/F7 are resolved by tasks 0226 (rule/workflow/API wiring), 0233 (scheduler payload), 0236 (observabilityBus), and 0237 (agent lifecycle events). The `0221-emit-sites.md` inventory is retained as historical reference; this audit is current.
