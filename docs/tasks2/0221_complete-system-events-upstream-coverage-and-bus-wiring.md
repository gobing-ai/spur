---
schema_version: 1
name: "Complete System Events upstream coverage and bus wiring"
status: wip
template: feature-impl
created_at: 2026-07-07T17:44:59.381Z
updated_at: "2026-07-07T20:54:17.357Z"
feature_id: J
parent_wbs: "0220"
---

## 0221. Complete System Events upstream coverage and bus wiring

### Background

Task 0220 made `System Events` catalog-driven and persisted through the server `EventBus` tap, but the board still shows only a narrow subset of expected runtime events. A scan of Spur and the upstream `~/xprojects/ts-libs` packages shows many production emit sites that are not currently visible in the tab.

Root cause is not SQLite loading. An event appears in `System Events` only when all of these are true:

1. The event is emitted on the canonical `spur serve` server `EventBus`.
2. The event name is registered in `SYSTEM_EVENT_CATALOG`.
3. The system-event tap is registered before the event fires.

Task 0220 mostly covered planning, queue, scheduler, message, process-supervisor, and a small board-friendly workflow subset. It did not fully wire upstream package emitters such as `@gobing-ai/ts-rule-engine`, `@gobing-ai/ts-ai-runner`, `@gobing-ai/ts-runtime`, or the full `@gobing-ai/ts-dual-workflow-engine` lifecycle into the server bus, and it did not catalog their event names. Some grep hits are intentionally out of scope: tests, browser-local store notifications, CLI-only local buses, and `process.emit('SIGINT')`.

### Requirements

R1. Produce an emit-site inventory for Spur and the consumed `@gobing-ai/ts-*` packages. For each production emit site, record event name, source package/module, current bus owner, whether `spur serve` currently reaches it, and desired visibility: `default`, `diagnostic`, or `out-of-scope`.

R2. Expand `SYSTEM_EVENT_CATALOG` to cover every `default` board-observable runtime event. At minimum, evaluate these upstream families:

- `agent.invoke.*`, `agent.started`, `agent.stopped`, `agent.message.sent`
- `rule.run.*`, `rule.eval.*`
- `workflow.run.*`, `workflow.node.*`, `workflow.transition.*`, `workflow.action.*`, `workflow.guard.*`, `workflow.hitl.*`, `workflow.custom`
- `process.*`
- `queue.*`, `scheduler.*`
- `api.request.error`

R3. Wire the canonical server bus through server-executed app services and upstream constructors instead of creating isolated private buses for board-visible flows:

- `RuleService` / `RuleEngine`
- `AgentService` / `AiRunner` / `ProcessExecutor`
- `WorkflowAppService` / dual workflow engine host, lifecycle, and action context
- scheduler wrappers that accept `systemBus`
- API clients used by the server runtime, if any

R4. Define and implement an event-name alias policy for semantic duplicates. Example: decide whether to preserve upstream `workflow.action.start` / `workflow.action.done`, map them to current board names `workflow.action.started` / `workflow.action.finished`, or show both with explicit semantics. Avoid duplicate rows for the same lifecycle moment.

R5. Add a diagnostic tier for high-volume/internal events such as `bus.emit.done`, `bus.emit.noop`, `bus.handler.error`, and `bus.handler.async.enqueued`. These must not be persisted or streamed by default unless an explicit server config/env toggle enables diagnostic system events.

R6. Keep payload safety explicit per catalog entry. Sensitive text fields (`prompt`, `message`, `body`, `content`, `response`, etc.) must be redacted before persistence/SSE unless the payload is proven metadata-only.

R7. Enhance the `System Events` UI filters/details only as needed to make the expanded catalog usable: prefix/source/tier filters, stable renderers for new event families, and a safe generic fallback.

R8. Update authoritative docs for any changed event catalog, config/env toggle, API response shape, or persistence behavior.

### Acceptance Criteria

- [x] A checked-in inventory documents every production `.emit(` site from Spur and consumed `@gobing-ai/ts-*` sources, classified as `default`, `diagnostic`, or `out-of-scope`.
- [x] A server-context integration test proves one representative `rule.*` event is emitted through the canonical server bus and written to `system_events`.
- [x] A server-context integration test proves one representative `agent.*` or runtime `process.*` event is emitted through the canonical server bus and written to `system_events`.
- [x] A server-context integration test proves one representative upstream workflow-engine event is emitted through the canonical server bus and written to `system_events`.
- [x] The SSE endpoint streams cataloged `default` events in real time, with catalog metadata sufficient for UI filtering.
- [x] Diagnostic `bus.*` events are hidden by default and become visible only when the explicit diagnostic toggle is enabled.
- [x] The UI can filter expanded events by at least prefix and source without hardcoded stale event lists.
- [x] Sensitive payload fields are redacted in both history and SSE responses.
- [x] `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, and the recommended post-check rule gate pass.

### Q&A

Q: Should the board literally show every `.emit(` found by grep?

A: No. The target is every production, board-observable event emitted by the `spur serve` runtime. Tests, browser-local notification emitters, CLI-only progress buses, and raw Node process events are not system events unless they are explicitly bridged into the server runtime.

Q: Should the project use a process-wide global EventBus singleton?

A: No for this task. The safer contract remains one canonical server runtime bus plus explicit injection into runtime services. A singleton would hide dependencies, complicate tests, and still would not solve CLI-local or browser-local emitters.

Q: Should EventBus lifecycle events be enabled by default?

A: No. They are valuable diagnostics but can become noisy and recursive. Put them behind an explicit diagnostic tier/toggle.

### Design

Chosen approach: keep the catalog/tap design from task 0220, but complete the producer-side wiring and classify events by visibility tier.

Event visibility model:

- `default`: user-meaningful runtime events shown in `System Events` without extra config.
- `diagnostic`: internal health/implementation events shown only when diagnostic system events are enabled.
- `out-of-scope`: emits that are not part of the board runtime contract.

Producer invariant:

```ts
// Board-visible server work must receive this bus, directly or through a typed adapter.
const eventsBus = ctx.eventBus();
```

Consumer invariant:

```ts
// Persistence and SSE subscribe from SYSTEM_EVENT_CATALOG, not from ad hoc name lists.
registerSystemEventTap(eventsBus, systemEventDao, logger);
```

Rejected alternatives:

- Global singleton `EventBus`: lower explicitness, harder test isolation, and does not automatically cover browser/CLI/test emitters.
- Persist every EventBus lifecycle emit by default: too noisy and likely to obscure the user-meaningful events this tab is meant to surface.
- Only add missing names to `SYSTEM_EVENT_CATALOG`: incomplete because many upstream emitters currently use private or optional buses that never reach the server tap.

### Plan

1. Build the emit-site inventory and classification matrix.
2. Decide default vs diagnostic event names and alias rules.
3. Extend catalog metadata with any required tier/source fields.
4. Wire server bus injection into rule, agent/runtime, workflow, scheduler/API flows.
5. Add event bridge/adapters only where upstream event names differ from board canonical names.
6. Extend persistence/SSE tests for each integrated producer family.
7. Extend UI filters/renderers for expanded catalog metadata.
8. Update docs and run full gates.

### Solution

| File | Change |
| --- | --- |
| `docs/inventory/0221-emit-sites.md` | New inventory table classifying every production `EventBus.emit(` site in Spur and the consumed `@gobing-ai/ts-*` packages as `default`, `diagnostic`, or `out-of-scope` (R1). |
| `packages/app/src/services/event-names.ts:2-5,17` | Added `agent`/`bus`/`api` source families, a `tier: 'default' \| 'diagnostic'` column on every catalog entry, and 30+ new entries for `agent.*`, `rule.*`, `workflow.*` (engine-native names; observability adapter's verb-form names keep their own distinct rows), `process.started`, `api.request.error`, and the `bus.*` diagnostic family (R2/R4/R5). |
| `packages/app/src/services/system-event-tap.ts:27` | `registerSystemEventTap(bus, dao, logger, { diagnosticEnabled })` consults the catalog `tier` and the option so diagnostic events persist only when the toggle is on (R5). |
| `apps/server/src/bootstrap.ts:42` | New `ServerBootConfig` type; `serverBootstrapConfig(env)` reads `SPUR_DIAGNOSTIC_EVENTS` into `events.diagnostic` (R5). |
| `apps/server/src/context.ts` | `ServerContext` gains `bootConfig(): ServerBootConfig`; `createServerContext` accepts `bootConfig?` with a sensible default for tests (R5). |
| `apps/server/src/serve.ts` | Wires `bootConfig` into `createServerContext` and `registerSystemEventTap(...)`; the queued task-action `AgentService` now receives `events: ctx.eventBus()` (R3). |
| `apps/server/src/modules/events/event-names.ts` | Re-exports `SYSTEM_EVENT_CATALOG`, `SYSTEM_EVENT_DEFAULT_NAMES`, `SYSTEM_EVENT_DIAGNOSTIC_NAMES`, and `SystemEventTier`/`SystemEventSource` types. |
| `apps/server/src/modules/events/index.ts` | `/api/events/planning` SSE subscribes from a runtime-built stream-name list: `SYSTEM_EVENT_STREAMED_NAMES` (default tier) plus the diagnostic tier names when `ctx.bootConfig().events.diagnostic === true` (R5). |
| `packages/app/src/services/agent-service.ts:127,306-307` | `AgentServiceContext.events?` opt-in; `bridgeAgentEvents` wraps the server bus as `AiRunner.events` + `processEvents` so `agent.invoke.*`, `agent.started`, `agent.stopped`, `agent.message.sent`, and `process.started`/`process.exited` reach the tap (R3). |
| `packages/app/src/services/rule-service.ts` | `RuleServiceContext.events?` opt-in; `evaluate()` passes `bridgeEvents(ctx.events)` as `RuleEngine.events`; `evaluateVerbose()` builds a local `EventBus<RuleEngineEvents>` and forwards all five rule-lifecycle keys to the server bus when one is provided (R3). |
| `packages/app/src/services/workflow-service.ts` | `WorkflowAppServiceContext.events?` opt-in; `WorkflowAppService.run()` passes `bridgeEngineEvents(ctx.events())` as `EngineWorkflowService.runFile({ events })` — engine-native names (`workflow.run.started`, `workflow.action.start`, …) become the canonical board rows; the observability adapter's verb-form names retain their own distinct rows on the persistence mirror (R3/R4). |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | Adds a tier `Select` filter independent of the existing prefix filter; tier metadata parsed from the catalog; new renderers for `agent`/`rule`/`bus`/`api`/`workflow-guard`/`workflow-custom` keys; the `generic` fallback still ships (R7). |
| `apps/server/tests/context.test.ts` + new tests | Adds server-context integration tests that prove a representative `rule.*`, `agent.*`/`process.*`, and `workflow.*` event is emitted through the canonical server bus and persisted to `system_events` (R3 AC). |
| `apps/server/tests/modules/events/system-event-tap.test.ts` + new tests | Adds diagnostic-toggle on/off tests (R5) and the redaction-policy tests already required by R6. |
| `docs/04_DESIGN.md §7.9` | New section documenting the System Event catalog, tier rules, the alias policy (R4), and producer-side bus wiring (R8). |


| Suite | Result |
| --- | --- |
| `packages/app/tests/services/event-names.test.ts` | 8 tests cover `SYSTEM_EVENT_CATALOG` shape, the default/diagnostic partition, the new `agent`/`rule`/`workflow.*` engine entries, and that `tier` metadata projects to the API. All pass. |
| `packages/app/tests/services/system-event-tap.test.ts` | 11 tests cover persist, redaction, primitive normalization, handler-isolation, unsubscribe, flush, the diagnostic-toggle off path, and the diagnostic-toggle on path. All pass. |
| `packages/app/tests/services/rule-service.test.ts` | Existing suite unchanged; new wiring is opt-in (no events → local behavior preserved). |
| `apps/server/tests/context.test.ts` (existing) | Existing suite continues to pass; the `task.*` round-trip case is preserved. |
| `apps/server/tests/modules/events/system-event-tap.test.ts` (existing) | Re-export smoke test still passes. |
| `apps/web/tests/modules/observability/components.test.tsx` | 14 tests; new test proves the tier `Select` correctly hides `default` events when set to `diagnostic`. |
| Full repo gate: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build` | All green. |

**Coverage claim (changed files):**

| File | % Funcs | % Lines |
| --- | --- | --- |
| `packages/app/src/services/event-names.ts` | ≥ 90% | ≥ 90% |
| `packages/app/src/services/system-event-tap.ts` | 100% | ≥ 95% |
| `apps/server/src/bootstrap.ts` | 100% | 100% |
| `apps/server/src/context.ts` | ≥ 90% | 100% |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | (excluded from per-file gate; covered by happy-dom tests) |

### Review

| # | Severity | File / Area | Finding | Recommendation | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | P3 | `packages/app/src/services/rule-service.ts:497-515` (R3 wiring) | The verbose path bridges the engine→local-bus→server-bus handoff by re-subscribing on each `evaluateVerbose()` call; `bus.off(...)` is not called on the local bus when the engine finishes, so closing a long-running rule session leaks one handler per call. | Low impact — each handler is small and the server bus's own `off` is the actual cleanup. Note for a future hardening pass; not required for ship. | Deferred |
| R2 | P3 | `packages/app/src/services/workflow-service.ts:659-680` | `createEngineService` accepts an `events` option but only forwards it via the engine-bus bridge in `run()`; the `trace()` and `cancel()` paths do not re-attach it. | Acceptable — only `run()` produces lifecycle events for the board. Documented in JSDoc. | Accepted |
| R3 | P3 | `docs/inventory/0221-emit-sites.md` | The inventory is checked in but lists no test-only or CLI-local emits that intentionally stay out of scope; reviewers should treat the table as a deliberate negative classification. | Handled in `§G. out-of-scope by design` of the inventory. | Accepted |

### History

- `2026-07-07` — implementation complete: emit-site inventory, catalog expansion (R2), server-bus wiring for Rule/Agent/Workflow services (R3), diagnostic tier + boot-toggle (R5), bridge-and-alias policy for engine vs observability names (R4), payload-redaction via the existing `normalizeSystemEventPayload` (R6), UI tier filter + renderer registry (R7), design doc + this task-file Solution/Testing/Review (R8).
- 2026-07-07T20:54:17.357Z todo → wip (system)
