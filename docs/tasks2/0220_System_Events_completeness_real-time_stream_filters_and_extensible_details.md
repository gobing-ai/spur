---
template: feature-impl
schema_version: 1
name: "System Events completeness, real-time stream, filters, and extensible details"
description: "System Events completeness, real-time stream, filters, and extensible details"
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-07T06:46:39.234Z"
updated_at: 2026-07-07T07:22:48.483Z
impl_progress:
  planning: completed
  design: completed
  implementation: completed
  review: completed
  testing: completed
---

## 0220. "System Events completeness, real-time stream, filters, and extensible details"

### Background

The current Observability > System Events tab is not guaranteed to show every event emitted in Spur. Current behavior is driven by a fixed `PLANNING_EVENT_NAMES` allowlist consumed by both the `system_events` tap and `/api/events/planning` SSE stream. The tap is registered during `spur serve` bootstrap and only captures events emitted on the server context's EventBus while `events.enabled` is true.

That means the table/query layer is not the root issue. Missing events are expected when an event is emitted on a different EventBus instance, when the event name is absent from the shared allowlist, when the CLI path emits into its own local bus, or when a service has no server-context bus injection. Examples to audit include task/feature planning events, queue/scheduler events, team/process/message events, workflow observability events, and rule-engine verbose events.

The accidental implementation already added some UI filtering and hardcoded detail rendering, but the design still needs a durable event-capture contract and an extensible presentation model. This task is for the next implementation/review pass: first prove the actual gaps, then close them with a registry-backed event pipeline, real-time SSE delivery, prefix filtering, and renderer registration.


### Requirements

- [x] R1 — Audit every production `emit(` / `eventBus.emit` site that should be visible in the Board, classify it by source bus, event name, payload shape, and whether it currently reaches `system_events` and SSE.
- [x] R2 — Replace the ad hoc allowlist semantics with a single System Event Catalog/Registry that owns event names, namespace/prefix, source, payload policy, redaction policy, and UI detail renderer key.
- [x] R3 — Guarantee capture for all board-observable server events: every registered event emitted on the server path must be persisted to `system_events` and delivered to live subscribers without requiring a second manual config list.
- [x] R4 — Define explicit out-of-scope/non-board events. If a code path emits events that cannot or should not appear in System Events, document why and add a regression guard so the omission is intentional.
- [x] R5 — Enhance the SSE stream so the System Events tab receives registered system events in real time. Keep history fetch as replay/backfill, avoid duplicate live/history rows, and preserve polling/fallback behavior where EventSource is unavailable.
- [x] R6 — Add prefix/namespace filtering that scales beyond a hardcoded category select. Filters derive from catalog metadata returned by the history response plus observed event prefixes, and event-name search remains bounded by the loaded history/live window.
- [x] R7 — Replace the monolithic hardcoded detail renderer with an extensible renderer registry: common fallback JSON/key-value renderer plus per-namespace or per-event summary renderers.
- [x] R8 — Preserve performance and safety: bounded history limit, capped table retention, redacted payloads for sensitive/body-heavy events, no message bodies in event payloads, and no UI crash on malformed/unknown payloads.
- [x] R9 — Tests cover catalog completeness, tap persistence, SSE live delivery, prefix filtering, renderer fallback, malformed payload handling, and at least one representative event per namespace.
- [x] R10 — Update authoritative docs in the same change if event surface, API route shape, config, schema, or module behavior changes.


### Acceptance Criteria

- Given a cataloged system event is emitted through the server runtime EventBus, it is persisted to `system_events` and streamed to connected System Events subscribers.
- Given the System Events tab loads history, prefix filters are derived from catalog/row metadata instead of hardcoded options.
- Given a known or unknown payload is selected, the tab renders a registry-backed detail view or generic fallback without crashing.
- Given sensitive/body-heavy payload keys are present, persistence and SSE output redact those keys before they reach the client.

### Q&A

Q: Should Spur unify every EventBus instance into a global singleton so every `.emit()` is observed?

A: No. The chosen direction is a canonical `SystemEventBus` per `spur serve` server runtime, not a process/global singleton. Generic `EventBus` remains a reusable primitive with many valid local instances for CLI progress, tests, library internals, and isolated workflows. Board-observable services must emit through the server-owned `SystemEventBus`/facade by dependency injection. The `system_events` observer/tap subscribes to that canonical server bus and derives persisted/streamed event names from the System Event Catalog.

Rationale: a global singleton would leak listeners across tests, erase cwd/db/runtime boundaries, publish CLI/library noise to the Board, and risk persisting unredacted payloads. The required guarantee is narrower and stronger: every cataloged system event emitted through the server runtime is persisted to `system_events` and streamed to SSE; every omitted emit site is intentionally classified by the audit.


### Design

Recommended approach: make `system_events` a registry-backed observability pipeline, not a hand-maintained side list.

### Current Findings

- `system_events` persistence is implemented by a tap that subscribes to `PLANNING_EVENT_NAMES`.
- `/api/events/planning` SSE subscribes to the same event-name list, so history and live streaming are aligned only for that list.
- The server context injects its EventBus into selected services (`TaskService`/`FeatureService` through `LazyPlanningEventEmitter`, `TeamService`, `SupervisorService`, queue helpers). CLI commands often create local EventBus instances; those are not visible to the board unless they act through the server.
- `RuleService.evaluateVerbose()` creates a private rule-engine EventBus for stderr progress; those events are not board events today.
- `SystemEventsTab` already has client-side category filtering and a hardcoded `EventDetails` function. That helps UX but does not solve event completeness or extensibility.

### Options

1. **Extend the allowlist.** Fastest, but fragile. Every new event requires touching a string list, persistence tests, SSE tests, and UI filter/render logic separately. This is the current failure mode.

2. **Monkey-patch/wrap every `EventBus.emit`.** Looks comprehensive, but too risky: many EventBus instances are local, test-only, CLI-only, or library-internal. Capturing all emits blindly would persist debug/progress noise and potentially sensitive payloads.

3. **Registry-backed SystemEventBus/Recorder facade.** Recommended. Define a catalog as the single source for board-observable events, expose a recorder/tap that subscribes from that catalog, and make server services emit through the server context bus/facade. Unknown events can be logged in development/test as catalog misses, but not silently persisted.

### Proposed Design

Create a System Event Catalog in the app/server boundary, close to `packages/app/src/services/event-names.ts` or a new `packages/app/src/services/system-events-catalog.ts`. Each entry should include:

- `name`: full event name, e.g. `task.updated`.
- `prefix`: namespace before the first dot, e.g. `task`.
- `source`: `planning`, `queue`, `scheduler`, `message`, `process`, `workflow`, `rule`, etc.
- `stream`: whether it is persisted, streamed, or both.
- `payloadPolicy`: `metadata-only`, `redacted`, or `raw-safe`.
- `renderer`: detail renderer id, e.g. `planning-transition`, `workflow-action`, `message-metadata`.

Then derive all consumer lists from that catalog:

- The persistence tap subscribes to `catalog.persistedNames`.
- The SSE route subscribes to `catalog.streamedNames`.
- The web filter options derive from `catalog.prefixes` returned by an API endpoint or embedded in the history response.
- The detail renderer registry maps `renderer` or event-name/prefix to a React component, with a compact generic fallback.

### Pipeline

1. Server boot registers one system-event tap against the server EventBus.
2. Every registered event emitted through that bus is normalized into `{ id, eventName, occurredAt, actor, payload }`.
3. The normalizer applies redaction/shape limits before persistence and streaming.
4. `system_events` remains the replay/history source. SSE is live-only and never the sole durable path.
5. The client loads recent history with filters, opens SSE, drops duplicate ids, and prepends live rows.

### Audit Rules

- Every production emit site must be classified in a table in the task Solution or a review artifact.
- If a site should be board-observable, it must either use the server context bus or a bridge explicitly documented in the catalog.
- If a site should not be board-observable, the task must document the exclusion reason.
- Tests should fail if a catalog event is neither subscribed by the tap nor covered by a representative fixture.

### UI Detail Rendering

Replace the long `EventDetails` conditional with a renderer registry:

- `EventSummaryRenderer`: compact, always visible summary lines.
- `RawPayloadView`: generic collapsible JSON, retained as fallback.
- namespace renderers: `planning`, `workflow`, `queue`, `scheduler`, `message`, `process`, later `rule`.
- event-specific overrides only when the payload merits it.

This keeps the UI open for new event families without editing one large function for every event.

### Acceptance Notes

The final implementation should not claim "all `emit()` calls" literally unless the audit proves they are all intended board events. The stronger production contract is: every event in the System Event Catalog is always persisted and streamed from the server path; every omitted emit site is intentionally classified.


### Solution
Implemented the registry-backed System Events pipeline.

Key changes:

- Added narrow app package exports for `system-events`, `system-event-tap`, and `feature-check`. This avoids pulling the full app barrel into Worker-loaded modules and fixed the Cloudflare test crash.
- Preserved the architectural decision from the brainstorm: no global EventBus singleton. The board contract is the canonical server-runtime EventBus plus catalog-backed tap/SSE; generic EventBus instances remain local primitives.

Change map:

| File | Line | Change |
| --- | ---: | --- |
| `packages/app/src/services/event-names.ts` | 49 | Added the System Event Catalog as the single source for event names, prefixes, source family, stream/persist flags, payload policy, and renderer id. |
| `packages/app/src/services/event-names.ts` | 115 | Added catalog-driven payload normalization/redaction before persistence or streaming. |
| `packages/app/src/services/system-event-tap.ts` | 35 | Updated the tap to subscribe from the catalog and persist normalized rows with capped retention. |
| `apps/server/src/modules/events/index.ts` | 83 | Updated SSE subscriptions to derive from catalog streamed names and emit normalized envelopes with prefix/renderer metadata. |
| `apps/server/src/modules/events/index.ts` | 158 | Extended history responses with catalog metadata for derived client filters. |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | 168 | Replaced monolithic detail rendering with a registry-backed renderer model and generic fallback. |

Audit classification:

| Emit site | Event family | Bus/source | Board observable? | Handling |
| --- | --- | --- | --- | --- |
| `PlanningWriteService` via `BusPlanningEventEmitter` | `task.*`, `feature.*` | Server `LazyPlanningEventEmitter` -> server EventBus | Yes on server path | Cataloged, persisted, streamed, legacy planning ledger retained |
| `TeamService` | `message.sent`, `message.replied` | Server context EventBus injection | Yes | Cataloged as redacted message metadata |
| `SupervisorService` | `process.spawned`, `process.exited`, `process.stopped` | Server context EventBus injection | Yes | Cataloged as process metadata |
| Domain queue helpers | `queue.job.*` | Server queue/consumer EventBus | Yes when queue enabled | Cataloged as queue metadata |
| Runtime scheduler | `scheduler.job.executed` | Application runtime events | Yes when scheduler emits on server bus | Cataloged as scheduler metadata |
| Workflow observability | `workflow.*` | Workflow observability bus | Yes when workflow is run with server bus | Cataloged with workflow renderer ids |
| Workflow HITL actions | `workflow.hitl.*` | Workflow action context events | Yes when workflow context carries server bus | Cataloged and redacted |
| CLI task/feature/workflow local buses | planning/workflow progress | CLI-local EventBus instances | No | Intentionally out of scope; CLI runs are not tied to the Board server DB/runtime |
| `RuleService.evaluateVerbose()` | rule engine progress | Private rule-engine EventBus | No | Intentionally excluded as stderr/progress telemetry; add later only with explicit rule-event catalog entries |
| Web `TaskStore.emit()` | React store notifications | Browser-local store | No | UI state only, not system telemetry |
| Plugin daily-summary logger `emit()` | script logging | Local logger helper | No | Plugin script output only, not system telemetry |

No schema migration was required. The existing `/api/events/planning/history` route shape was extended additively with `prefix`, `renderer`, and `catalog` metadata.
### Plan

- [x] Audit event emitters and produce the classification table.
- [x] Introduce the System Event Catalog and derive persisted/streamed names from it.
- [x] Update server tap and SSE route to consume the catalog.
- [x] Bridge server task/feature/message/process/queue/scheduler events through the server EventBus.
- [x] Add filter metadata support and update the System Events tab to use derived prefixes.
- [x] Refactor details into an event renderer registry with fallback raw payload rendering.
- [x] Add regression tests across app/server/web and run the full gate.


### Review

Self-review findings:

- The implementation does not promise to capture every literal `.emit()` in the repository. That would be the wrong contract because local CLI/test/browser/plugin buses are intentionally isolated. The implemented contract is cataloged server-runtime events only.
- Payload redaction is conservative but generic. It masks common sensitive/body-heavy keys; future event families with special payload risks should add explicit catalog policy/renderer tests before being exposed.
- SSE remains live-only and history remains the durable replay source. The client deduplicates by row id where available; generated live ids remain timestamp/random based because live events are emitted before DB row id assignment.
- The previous dirty feature-related changes remain in the worktree. I did not revert them; the only related adjustment I made was the Worker-safe narrow `feature-check` import/export needed to make `test-cf` pass.


### Testing

- `bun run lint` — passed.
- `bun run test` — passed: 2455 tests, 0 failures, 6489 assertions.
- `bun run test-cf` — passed: 1 Cloudflare Worker test, 0 failures.
- `bun run build` — passed for CLI, server, and web. Existing daisyUI CSS `@property` warning and Vite chunk-size warning remain non-blocking.
- Focused app/server/web tests were also run during development; they passed functionally, with expected nonzero exits under focused coverage thresholds before the full suite.
- Diagnostic-only `bun --cwd apps/server vite build --config vite.config.ts` still fails on the existing `npm-run-path` / `unicorn-magic` export mismatch. The official server build and `test-cf` gates pass, so this is not treated as a task blocker.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

### History

- 2026-07-07T07:22:44.950Z wip → done (system)

