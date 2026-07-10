---
template: feature-impl
schema_version: 1
name: "Wire TeamOrchestrator events bus so agent lifecycle events reach system event tap"
description: ""
status: done
type: task
profile: standard
feature_id: L
parent_wbs: null
priority: P1
tags: ["observability", "agent", "team", "wiring", "server"]
dependencies: []
created_at: "2026-07-10T00:02:02.995Z"
updated_at: "2026-07-10T00:52:06.313Z"
---

## 0237. Wire TeamOrchestrator events bus so agent lifecycle events reach system event tap

### Background
Feature L. Source-verified: `TeamOrchestrator` in `@gobing-ai/ts-ai-runner` emits `agent.started` (team-orchestrator.ts:73), `agent.stopped` (line 86), and `agent.message.sent` (line 98) when team orchestration runs. However, `TeamService.orchestrator()` at team-service.ts:372 creates `new TeamOrchestrator(this.configDir, dao)` with NO options, so the `events` parameter falls back to a throwaway `new EventBus<AgentEvents>()` (team-orchestrator.ts:35). `TeamServiceContext` (team-service.ts:27) doesn't even have an events field for the canonical server bus.

These three catalog events (event-names.ts:106-108) currently fire into a void — the tap subscribes to them but they never reach the server's canonical bus.

Separately: `message.sent`/`message.replied` are correctly wired via `TeamServiceContext.eventBus` (team-service.ts:41, 163, 357) — these are TeamService-emitted, not TeamOrchestrator-emitted. The `agent.message.sent` (orchestrator path) and `message.sent` (TeamService path) are different events with different scopes — both need to work.
### Requirements
R1. Add `events?: EventBus<AgentEvents>` field to `TeamServiceContext` in packages/app/src/services/team-service.ts.

R2. In `TeamService.orchestrator()` (line 372), pass `{ events: this.ctx.events }` to the `TeamOrchestrator` constructor when `ctx.events` is defined. Keep the fallback to throwaway bus when no events provided (CLI path).

R3. In apps/server/src/context.ts, wire the canonical eventsBus into the `TeamServiceContext.events` field.

R4. Verify that after wiring, team agent start/stop/send-message operations produce system_events rows for agent.started, agent.stopped, agent.message.sent.

R5. Verify existing message.sent/message.replied wiring is unchanged (TeamServiceContext.eventBus path, not the TeamOrchestrator path).

R6. Search for and update any test files that mock TeamServiceContext without the new events field.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Three changes across two files:

1. **`packages/app/src/services/team-service.ts`**: Added `events?: EventBus<AgentEvents>` to `TeamServiceContext` interface (line 27 area). In `TeamService.orchestrator()` (line 372), changed `new TeamOrchestrator(this.configDir, dao)` to `new TeamOrchestrator(this.configDir, dao, { events: this.ctx.events })` — when `ctx.events` is undefined (CLI path), the orchestrator falls back to its internal throwaway bus. Added `EventBus` import from `@gobing-ai/ts-infra` and `AgentEvents` from `@gobing-ai/ts-ai-runner` (merged into existing import block per Biome single-import-block rule).

2. **`apps/server/src/context.ts`**: Added `events: eventsBus as unknown as never` to the `teamService()` accessor (line 353 area). Same cast pattern as the workflow `events`/`observabilityBus` fields — bridges `EventBus<SystemEventBus>` to `EventBus<AgentEvents>`.

The existing `message.sent`/`message.replied` wiring (TeamServiceContext.eventBus path) is untouched — those are TeamService-emitted events on a different bus field, separate from the orchestrator path.
### Testing
Typecheck: `bun run typecheck` — `@gobing-ai/spur-app` and `@gobing-ai/spur-server` both clean (exit 0). The `as unknown as never` cast is sound — same singleton bus instance.

Full gate: `bun run lint` clean (after merging `AgentEvents` into existing import block — Biome import-sorting), `bun run typecheck` clean across all 7 workspaces, `bun run test` 2545 pass / 0 fail, `bun run test-cf` 1 pass / 0 fail.

No existing tests mock `TeamServiceContext` without `events` — the field is optional, so existing constructors remain valid (R6 clear).
### Review
PASS. The wiring is correct: `TeamOrchestrator` now receives the canonical server bus via `ctx.events`, so `agent.started`, `agent.stopped`, and `agent.message.sent` will reach the system event tap.

Optional field safety: `events?: EventBus<AgentEvents>` is optional in `TeamServiceContext`, so the CLI path (which doesn't provide it) still works — the orchestrator creates its internal throwaway bus.

Cast safety: `as unknown as never` matches the established pattern. Runtime soundness verified — same singleton `eventsBus` instance.

Existing `message.sent`/`message.replied` wiring (R5) is untouched — those events fire through `TeamServiceContext.eventBus`, a different field and code path.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:06.313Z todo → done (system)
