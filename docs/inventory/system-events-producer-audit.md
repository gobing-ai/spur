# System Events Producer Audit

> Verified 2026-07-09 against production source after tasks 0221, 0226, 0233, 0236, 0237; extended 2026-07-28 by task 0367 (`workflow.agent`, `workflow.steering`); extended 2026-07-28 by task 0370 (CLI → ledger bridge for `workflow.*` / `agent.*`); extended 2026-07-29 by task 0371 (`team.*` lifecycle family).
> **Supersedes** the scattered producer-wiring findings in task 0226
> (`docs/tasks2/0226_system-events-real-producer-wiring-review-findings.md`) and
> the task-0221 emit-site inventory (`docs/inventory/0221-emit-sites.md`).
> This is the single source of truth for producer reachability as of feature L / J3.

## Status legend

| Status | Symbol | Meaning |
| --- | --- | --- |
| reachable | ✅ | The canonical server `EventBus` (`eventsBus` in `createServerContext`) receives the emit via an injected `events`/`eventBus`/`observabilityBus` accessor. The `system_events` tap persists it; SSE streams it. |
| nested-CLI deferred | ⚠️ | The event fires only inside a child agent process (e.g. `sp:dev-*` auto-mode child running `spur workflow run`). The child's `EventBus` is process-local and does not cross the process boundary. This is an intentional v1 scope limit (`serve.ts:137–145`), not a wiring gap. |
| diagnostic-only | 🔬 | Emitted on a separate internal `lifecycleBus`, not the main server bus. Not captured by the tap unless a forwarder bridges it. By design. |
| conditional | ◐ | The producer exists but `spur serve` does not perform the registration needed to activate it. |
| unwired | ❌ | No production emit path reaches the server bus. |

## Audit table — all 65 catalog entries

Source of truth: `SYSTEM_EVENT_CATALOG` in `packages/app/src/services/event-names.ts`.

### Planning (task.\*, feature.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 1 | `task.created` | `planning-events.ts:50` | **Board:** `LazyPlanningEventEmitter` → `eventsBus` (`context.ts:313–328`). **CLI:** `SystemEventEmitter` → `SystemEventDao` (`task.ts:612`, `feature.ts:366`; emitter from `makePlanningEmitter` in `planning-emitter.ts`) — task 0249 | ✅ Board **and** CLI reachable |
| 2 | `task.updated` | `planning-events.ts:50` | same | ✅ Board **and** CLI reachable |
| 3 | `task.transitioned` | `planning-events.ts:50` | same | ✅ Board **and** CLI reachable |
| 4 | `feature.created` | `planning-events.ts:50` | same | ✅ Board **and** CLI reachable |
| 5 | `feature.updated` | `planning-events.ts:50` | same | ✅ Board **and** CLI reachable |
| 6 | `feature.transitioned` | `planning-events.ts:50` | same | ✅ Board **and** CLI reachable |

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
| 14 | `scheduler.job.executed` | `serve.ts:89` (`registerSchedulerEntries`) | emits on `ctx.eventBus()` directly | ✅ reachable |

> **Payload note (task 0233).** The emit site now produces `{ name, durationMs, error? }` — `name` (not `kind`), no `cron`, and `error` is captured via try/catch and re-thrown. Matches the catalog type contract.

### Message (message.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 15 | `message.sent` | `team-service.ts:177` (`emitMessageEvent` → `:371`) | `ctx.teamService()` → `eventBus: eventsBus` | ✅ reachable |
| 16 | `message.replied` | `team-service.ts:177` (`emitMessageEvent` → `:371`) | same | ✅ reachable |

> Payload is metadata-only (`MessageEventPayload`); body is never included.

### Process (process.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 17 | `process.spawned` | `supervisor-service.ts:174` | `ctx.supervisor()` → `eventBus: eventsBus` | ✅ reachable |
| 18 | `process.exited` | `supervisor-service.ts:186` | same | ✅ reachable |
| 19 | `process.stopped` | `supervisor-service.ts:216` | same | ✅ reachable |
| 20 | `process.started` | `process-executor.ts:138,202,271` (ts-runtime) | `ctx.agentService()` → `processEvents: bridgeAgentEvents(eventsBus)` → `NodeProcessExecutor` | ✅ reachable |

### Agent (agent.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 21 | `agent.invoke.start` | `ai-runner.ts:138` | **Board:** `ctx.agentService()` → `events: bridgeAgentEvents(eventsBus)` → `AiRunner`. **CLI:** `spur agent run` → `agentService({ events })` → `attachSystemEventLedger` → `SystemEventDao` (task 0370) | ✅ Board **and** CLI reachable (parent-level; child-of-child is ⚠️) |
| 22 | `agent.invoke.exit` | `ai-runner.ts:156` | same | ✅ Board **and** CLI reachable (parent-level; child-of-child is ⚠️) |
| 23 | `agent.started` | `team-orchestrator.ts:73` | `ctx.teamService()` → `events: eventsBus` → `TeamOrchestrator({ events })` (task 0237) | ✅ reachable |
| 24 | `agent.stopped` | `team-orchestrator.ts:86` | same | ✅ reachable |
| 25 | `agent.message.sent` | `team-orchestrator.ts:98` | same | ✅ reachable |

> **Task 0237 wiring.** `TeamServiceContext` now carries `events?: EventBus<AgentEvents>`; the server passes `events: eventsBus` in the `teamService()` accessor (`context.ts:349–353`). `TeamService.orchestrator()` forwards `{ events: this.ctx.events }` to the `TeamOrchestrator` constructor (`team-service.ts:379–384`). All three `agent.*` lifecycle events now reach the tap.
>
> **Task 0370 — CLI agent durability.** Direct `spur agent run` attaches a CLI-local EventBus and `registerSystemEventTap` (same DAO path as task 0249's `SystemEventEmitter`) so cataloged `agent.invoke.*` rows land in the shared ledger. Workflow-dispatched `agent.run` does **not** wire `AgentService.events` — its lifecycle is the single `workflow.agent` series (0365 R9 / 0370 R4 no double-count).
>
> **Child-of-child residual.** Parent-level CLI and Board emits are reachable. When a child agent process itself spawns a nested agent (or runs `spur workflow run` / `spur agent run` inside its session without the 0370 bridge surviving re-exec), those emissions are ⚠️ child-of-child deferred (see Gap 4).

### Team (team.\*) — task 0371

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 26 | `team.up` | `team-service.ts` (`materializeTeam`, written path only) | **Board:** `ctx.teamService()` → `eventBus: eventsBus`. **CLI:** `spur team up` → `attachSystemEventLedger` + `TeamService.eventBus` (task 0371 R6) | ✅ Board **and** CLI reachable |
| 27 | `team.down` | `team-service.ts` (`teardownTeam`) | same | ✅ Board **and** CLI reachable |
| 28 | `team.member.assigned` | `team-service.ts` (`assignTask`) | **Board:** same bus. **CLI:** `spur team assign` → ledger attach | ✅ Board **and** CLI reachable |
| 29 | `team.member.started` | `supervisor-service.ts` (`start`); also TeamService bridge from `agent.started` (TeamOrchestrator path) | **Board:** `ctx.supervisor()` → `eventBus: eventsBus`; orchestrator path via `teamService().events` + re-emit on `eventBus`. Member start via serve/API only on Board for supervisor | ✅ reachable (supervisor Board; orchestrator bridge when wired) |
| 30 | `team.member.stopped` | `supervisor-service.ts` (`stop` + natural exit); TeamService bridge from `agent.stopped` | same | ✅ reachable |

> **Task 0371 wiring.** Catalog entries use source/renderer `team`, default tier, `metadata-only` payloads (`teamId`, `memberId`/`memberCount`, `agentType`, `outcome` — no bodies or argv). `extractSystemEventActor` falls back to `memberId` after `actor`/`agentId` (R4). Unknown roster members persist with null unresolved fields (R5). Dry-run `materializeTeam({ check: true })` does **not** emit `team.up`.
>
> **CLI durability.** `apps/cli/src/commands/team.ts` attaches `attachSystemEventLedger` for `team up` / `down` / `assign` so rows land in the shared SQLite ledger without `spur serve` (R6). Supervisor-driven `team.member.started|stopped` remain Board-path (same as `process.*` — see Gap 1 residual).

### Rule (rule.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 31 | `rule.run.start` | `rule-engine/engine.ts:135` | `ctx.ruleService()` → `events: eventsBus` → `RuleEngine` | ✅ reachable (parent-level; child-internal is ⚠️) |
| 32 | `rule.eval.start` | `rule-engine/engine.ts:158` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 33 | `rule.eval.done` | `rule-engine/engine.ts:187` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 34 | `rule.eval.error` | `rule-engine/engine.ts:178` | same | ✅ reachable (parent-level; child-internal is ⚠️) |
| 35 | `rule.run.done` | `rule-engine/engine.ts:251` | same | ✅ reachable (parent-level; child-internal is ⚠️) |

### Workflow (workflow.\*) — engine-native names

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 36 | `workflow.run.started` | `run-lifecycle.ts:150`; also `observability.ts:112` | **Board:** `ctx.workflowService()` → `events` + `observabilityBus` → tap. **CLI:** `workflow run/continue` always builds a local bus + `attachSystemEventLedger` → `SystemEventDao` (task 0370) | ✅ Board **and** CLI reachable (dual-emit; see note) |
| 37 | `workflow.run.done` | `run-lifecycle.ts:226` | same | ✅ Board **and** CLI reachable |
| 38 | `workflow.run.failed` | `run-lifecycle.ts:240` | same | ✅ Board **and** CLI reachable |
| 39 | `workflow.run.finalized` | `observability.ts:121` | adapter via `observabilityBus` (task 0236 / 0370) | ✅ Board **and** CLI reachable |
| 40 | `workflow.run.paused` | `run-lifecycle.ts:256`; `service.ts:143` | same | ✅ Board **and** CLI reachable |
| 41 | `workflow.run.resumed` | `run-lifecycle.ts:268`; `service.ts:143` | same | ✅ Board **and** CLI reachable |
| 42 | `workflow.run.reseeded` | `service.ts:117` | same | ✅ Board **and** CLI reachable |
| 43 | `workflow.node.enter` | `run-lifecycle.ts:195` | same | ✅ Board **and** CLI reachable |
| 44 | `workflow.phase` | `observability.ts:126` | adapter via `observabilityBus` (task 0236 / 0370) | ✅ Board **and** CLI reachable |
| 45 | `workflow.node.transition` | `run-lifecycle.ts:211` | same | ✅ Board **and** CLI reachable |
| 46 | `workflow.transition` | `observability.ts:131` | adapter via `observabilityBus` (task 0236 / 0370) | ✅ Board **and** CLI reachable |
| 47 | `workflow.transition.requested` | `service.ts:265` | same | ✅ Board **and** CLI reachable (diagnostic tier) |
| 48 | `workflow.transition.denied` | `service.ts:288` | same | ✅ Board **and** CLI reachable (diagnostic tier) |
| 49 | `workflow.action.start` | `run-lifecycle.ts:274` | same | ✅ Board **and** CLI reachable |
| 50 | `workflow.action.started` | `observability.ts:136` | adapter via `observabilityBus` (task 0236 / 0370) | ✅ Board **and** CLI reachable |
| 51 | `workflow.action.done` | `run-lifecycle.ts:280` | same | ✅ Board **and** CLI reachable |
| 52 | `workflow.action.finished` | `observability.ts:151` | adapter via `observabilityBus` (task 0236 / 0370) | ✅ Board **and** CLI reachable |
| 53 | `workflow.action.failed_continue` | `run-lifecycle.ts:297` | same | ✅ Board **and** CLI reachable |
| 54 | `workflow.guard.evaluated` | `run-lifecycle.ts:308` | engine bridge | 🔬 diagnostic-only (high-volume) |
| 55 | `workflow.hitl.ask` | `run-lifecycle.ts:320`; app `hitl-confirm.ts:29`, `hitl-select.ts:35`, `hitl-input.ts:29` | same | ✅ Board **and** CLI reachable (redacted payload) |
| 56 | `workflow.hitl.response` | `run-lifecycle.ts:325`; app `hitl-*.ts:41,48,41` | same | ✅ Board **and** CLI reachable (redacted payload) |
| 57 | `workflow.hitl.note` | `host.ts:113` | engine bridge → host `context.events` | ✅ Board **and** CLI reachable (redacted: `message`) |
| 58 | `workflow.custom` | `host.ts:130` | engine bridge | ✅ Board **and** CLI reachable |
| 59 | `workflow.agent` | `agent-run.ts:144` (`AgentRunActionRunner`) — unified `AgentExecutionEvent` lifecycle (kind: started/output/heartbeat/dropped/finished) | **Board:** `observabilityBus` → tap. **CLI:** same bus + ledger attach (task 0370); diagnostic tier — needs toggle | ✅ Board **and** CLI reachable (diagnostic tier; high-volume `output`/`heartbeat` kinds) |
| 60 | `workflow.steering` | `steering.ts:295` (`WorkflowSteeringController.onAck` → `bus.emit('workflow.steering', ack)`) | CLI `workflow.ts` → local bus + `attachSystemEventLedger` (task 0370) | ✅ CLI reachable when `--steer` (default tier) |

> **Task 0236 wiring.** The server `workflowService()` accessor (`context.ts:396–410`) now passes both `events: () => eventsBus` (engine bridge → engine-native names) AND `observabilityBus: () => eventsBus` (→ `ObservableWorkflowAdapter` → verb-form names). This activates the 6 adapter-emitted verb-form events (`workflow.run.finalized`, `workflow.phase`, `workflow.transition`, `workflow.action.started`, `workflow.action.finished`, plus a second `workflow.run.started`). `workflow.run.started` fires from both paths — accepted as harmless v1 duplication; dedup deferred.
>
> **Task 0370 — CLI workflow durability.** `spur workflow run` / `continue` always construct a CLI-local EventBus (not only for human progress / `--trace-file` / `--steer`) and attach `registerSystemEventTap` → `SystemEventDao` via `attachSystemEventLedger`. Both `events` and `observabilityBus` share that bus, matching the server dual-emit. Sink failures are logged and swallowed (R5). Diagnostic-tier members (`workflow.agent`, `workflow.guard.evaluated`, `workflow.transition.requested|denied`) stay out of the ledger unless the diagnostic toggle is on (R6).

### API (api.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 61 | `api.request.error` | `error-handler.ts:176` (`globalErrorHandler`) | `c.get('ctx')?.eventBus()?.emit(...)` | ✅ reachable |

### Bus diagnostics (bus.\*)

| # | Catalog entry | Emit site | Bus path to tap | Status |
| --- | --- | --- | --- | --- |
| 62 | `bus.emit.done` | `event-bus.ts:272` | internal `lifecycleBus` only | 🔬 diagnostic-only |
| 63 | `bus.emit.noop` | `event-bus.ts:282` | internal `lifecycleBus` only | 🔬 diagnostic-only |
| 64 | `bus.handler.error` | `event-bus.ts:293` | internal `lifecycleBus` only | 🔬 diagnostic-only |
| 65 | `bus.handler.async.enqueued` | `event-bus.ts:304` | internal `lifecycleBus` only | 🔬 diagnostic-only |

## Summary

| Classification | Count | Events |
| --- | --- | --- |
| ✅ reachable | 59 | All planning, queue (except `queue.stats`), scheduler, message, process, agent, **team** (0371), rule (parent-level), workflow (default tier + diagnostic when toggle on; CLI + Board for workflow/agent via 0370), `api.request.error`, `workflow.steering` (CLI `--steer`) |
| ◐ conditional | 1 | `queue.stats` |
| 🔬 diagnostic-only | 5 | `workflow.guard.evaluated`, `bus.emit.done/noop`, `bus.handler.error`, `bus.handler.async.enqueued` |
| ⚠️ child-of-child deferred | 0 catalog rows (residual scope — see Gap 4) | Nested agent-inside-agent without surviving the 0370 bridge |
| ❌ unwired | **0** | — |

**All default-tier catalog entries now have a confirmed production emit path to the server bus and/or the shared CLI ledger**, except `queue.stats` (conditional — requires scheduler-registry wiring that `spur serve` does not perform) and the `bus.*` family (diagnostic-only by design — separate internal bus). `workflow.agent` is diagnostic-tier but reachable via `observabilityBus` (Board + CLI when the diagnostic toggle is on). Task 0370 closed the CLI gap for `workflow.*` and direct `agent.invoke.*`. Task 0371 closed the team lifecycle family (`team.up|down`, `team.member.*`) on Board + CLI mutation paths.

## Systemic Observability Gaps

Four architectural constraints affect observability completeness but are **not bugs** — they are deliberate scope boundaries. Documented here so operators interpret "missing" events correctly.

### Gap 1 — CLI event-tap gap (partially closed: planning by 0249, workflow/agent by 0370, team by 0371)

The server `system_events` persistence tap (`registerSystemEventTap`) is registered in `apps/server/src/serve.ts`, gated by `bootConfig.events.enabled`. The CLI no longer relies solely on that path for every family:

**Task 0249 — Planning CLI durability.** `task.*` / `feature.*` persist on the CLI mutation path via a durable `SystemEventEmitter` wired into `task.ts` / `feature.ts` (`makePlanningEmitter` in `planning-emitter.ts`) → `SystemEventDao`. Sink failures are logged and swallowed (R5).

**Task 0370 — Workflow/agent CLI durability.** `spur workflow run` / `continue` always build a CLI-local EventBus and attach `registerSystemEventTap` via `attachSystemEventLedger` (`apps/cli/src/system-event-ledger.ts`). Direct `spur agent run` does the same for `agent.invoke.*`. Same canonical serialization as the server tap; R5 failure isolation; diagnostic-tier gating (R6). Workflow-dispatched `agent.run` emits only the `workflow.agent` series (no `AgentService.events` on that path — R4).

**Task 0371 — Team CLI durability.** `spur team up` / `down` / `assign` attach the same ledger bridge so `team.up|down` and `team.member.assigned` persist without serve. Supervisor-driven `team.member.started|stopped` remain Board-path (alongside `process.*`).

**Still CLI-invisible (parent-process CLI only):** `rule.*`, `message.*`, `process.spawned/exited/stopped` (and supervisor `team.member.started|stopped`) when driven from the shell without a server bus. Those families remain Board-driven for durability.

**Observability path classification:**

| Prefix family | Path | Board-visible? |
| --- | --- | --- |
| `task.*`, `feature.*` | **Board:** server API → `planningBus` → tap. **CLI:** `SystemEventEmitter` → `SystemEventDao` (task 0249) | ✅ Board **and** CLI reachable |
| `rule.*` | server API → `RuleService.events` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `workflow.*` | **Board:** engine bridge + `observabilityBus` → tap. **CLI:** local bus + `attachSystemEventLedger` (task 0370) | ✅ Board **and** CLI reachable |
| `message.*` | server API → `TeamService.eventBus` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `team.up|down`, `team.member.assigned` | **Board:** `TeamService.eventBus` → tap. **CLI:** ledger attach (task 0371) | ✅ Board **and** CLI reachable |
| `team.member.started|stopped` | supervisor / orchestrator bridge → tap | ✅ when Board-driven; ❌ when CLI-driven (no serve) |
| `agent.*` | **Board:** `TeamOrchestrator` / `AiRunner` → tap. **CLI:** `spur agent run` → ledger (task 0370); workflow path uses `workflow.agent` only | ✅ Board **and** CLI reachable (direct agent + workflow) |
| `process.spawned/exited/stopped` | server API → `SupervisorService.eventBus` → tap | ✅ when Board-driven; ❌ when CLI-driven |
| `process.started` | agent-run side-channel → `NodeProcessExecutor.processEvents` → tap | ◐ only during agent runs (see Gap 3) |
| `queue.*` | config-gated (see Gap 2) | ◐ |

### Gap 2 — Queue config gating (`queue.*` events require `jobqueue.enabled: true`)

All seven `queue.*` catalog entries are wired through `createQueueConsumer` (`context.ts:472–474`), which passes `{ events: eventsBus }`. But both `jobQueue()` and `queueConsumer()` throw `NotConfiguredError` when `jobQueueEnabled` is false (`context.ts:450–451`, `468–469`). The flag defaults to **false** (`context.ts:265`) and is only set true when `bootConfig.jobqueue.enabled` is true (`serve.ts:243`, `287`).

**Consequence:** with the default single-operator config (`jobqueue.enabled: false`), zero `queue.*` events fire — the queue consumer never starts, so no jobs are enqueued, completed, failed, or retried. This is correct: there is no queue to observe. The events become reachable only when an operator opts into the embedded job queue.

**To activate:** set `jobqueue.enabled: true` in `.spur/config.yaml` (or `SPUR_JOBQUEUE_ENABLED=true`). The serve bootstrap will then construct the consumer and the seven `queue.*` events will flow to the tap.

**`queue.stats`** remains ◐ conditional even with the queue enabled — it requires a separate `QueueStatsAction` registration in the scheduler registry that `registerSchedulerEntries` does not perform.

### Gap 3 — `process.started` is a side-channel (reachable only during agent runs)

`process.started` is emitted by `NodeProcessExecutor` in `ts-runtime` when wired with a `processEvents` bus. `AgentService.run()` wires this bus (`agent-service.ts:312` via `bridgeEventBus` as `processEvents`), so `process.started` fires during agent invocations. But `SupervisorService` — the canonical process-lifecycle observer — uses `process.spawned`/`process.exited`/`process.stopped` as **its** lifecycle names, not `process.started`.

**Consequence:** `process.started` appears in system_events only when an agent run triggers a subprocess via `NodeProcessExecutor`. It does NOT fire for supervisor-managed agent spawns (those emit `process.spawned`). Operators filtering for "process started" should use `process.spawned` as the authoritative process-birth event; `process.started` is a secondary signal correlated to agent-run subprocesses.

### Gap 4 — Child-of-child residual (narrowed by task 0370)

**Before 0370:** any CLI-process `workflow.*` / `agent.*` emission was invisible to the ledger (Gap 1). That parent-CLI gap is closed: a child agent that runs `spur workflow run` or `spur agent run` as a real CLI invocation writes through `attachSystemEventLedger` into the shared SQLite ledger the Board reads — no server bus hop required.

**Residual (⚠️ child-of-child):** when a child agent process itself spawns a *further* nested agent (or embeds engine execution without going through the CLI attach points), those innermost emissions remain process-local unless they re-enter `spur workflow run` / `spur agent run`. Bridging arbitrary in-process child buses to a parent without the CLI entry surface still requires an explicit IPC channel (deferred; out of scope for J3).

**Also still deferred from Gap 1:** CLI-driven `rule.*` / `message.*` / supervisor `process.*` without a server bus.

## Footer notes

### 1. Child-of-child context (⚠️ deferred scope limit — narrowed by 0370)

Board-triggered task actions run `sp:dev-* --auto` as AI-driven slash commands via `ctx.agentService()` (`serve.ts:137–145`). Parent-level process/agent lifecycle events ARE captured. A child that re-enters the Spur CLI (`spur workflow run`, `spur agent run`) now persists its own `workflow.*` / `agent.invoke.*` rows via task 0370. Events that never re-enter those CLI attach points (embedded engine use, third-level nesting without CLI) remain process-local — explicit IPC bridge deferred.

### 2. Single-queue architecture (no `queueName` field)

There is exactly **one** `DBJobQueue` instance per server (`serve.ts:279–294`). No `queueName` field is threaded through queue events because there is nothing to discriminate at the queue level. The **`type`** field (job type) is the discriminator — it identifies the kind of work (e.g. `team-assign`, `workflow-run`, `agent-invoke`). Queue event payloads carry `{ jobId, type }`; adding a `queueName` would be dead data.

### 3. Supersede note

This document supersedes:
- Task 0221 emit-site inventory (`docs/inventory/0221-emit-sites.md`) — section I matrix.
- Task 0226 producer-wiring findings (`docs/tasks2/0226_system-events-real-producer-wiring-review-findings.md`) — findings F4/F6/F7 are resolved by tasks 0226 (rule/workflow/API wiring), 0233 (scheduler payload), 0236 (observabilityBus), and 0237 (agent lifecycle events). The `0221-emit-sites.md` inventory is retained as historical reference; this audit is current.
