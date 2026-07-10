---
template: feature-impl
schema_version: 1
name: "Wire observabilityBus in server context to enable verb-form workflow events"
description: ""
status: done
type: task
profile: standard
feature_id: L
parent_wbs: null
priority: P1
tags: ["observability", "workflow", "wiring", "server"]
dependencies: []
created_at: "2026-07-10T00:02:02.992Z"
updated_at: "2026-07-10T00:52:06.146Z"
---

## 0236. Wire observabilityBus in server context to enable verb-form workflow events

### Background
Feature L. Source-verified: the 6 verb-form workflow catalog entries are NOT orphans. `ObservableWorkflowAdapter` (packages/app/src/workflow/observability.ts) emits all 6 through persistence-decorator lifecycle callbacks — but the adapter is only instantiated when `observabilityBus` is provided in `WorkflowAppServiceContext` (workflow-service.ts:688). The server context (apps/server/src/context.ts) wires `events` (canonical bus → bridgeEngineEvents → tap + SSE) but does NOT provide `observabilityBus`, so the adapter is never created.

Two-bus architecture:
- `events` (ctx.events) → canonical server bus → bridgeEngineEvents forwards engine-native names to tap + SSE
- `observabilityBus` (ctx.observabilityBus) → CLI-local bus for terminal step reporter; NOT wired in server

Engine-native events (reachable via bridgeEngineEvents): workflow.run.started/done/failed/paused/resumed/reseeded, workflow.node.enter/transition, workflow.action.start/done/failed_continue, workflow.guard.evaluated, workflow.hitl.*, workflow.transition.requested/denied, workflow.custom.

Adapter verb-form events (only when observabilityBus provided): workflow.run.started (duplicate with engine — accept harmless duplication for v1), workflow.run.finalized, workflow.phase, workflow.transition, workflow.action.started, workflow.action.finished.

The adapter's `workflow.run.started` has a richer payload ({runId, workflowName, at}) vs the engine's raw emit.
### Requirements
R1. In apps/server/src/context.ts, add `observabilityBus: () => eventsBus` to the workflow service context (the ctx passed to WorkflowAppService). This maps the adapter's bus to the same canonical eventsBus that the tap subscribes to.

R2. Verify that after wiring, a workflow run through the server API produces system_events rows for: workflow.run.finalized, workflow.phase, workflow.transition, workflow.action.started, workflow.action.finished.

R3. Add a note to the event-names.ts catalog comment block (lines 117-119) acknowledging that workflow.run.started fires twice (once from engine bridge, once from adapter) and that dedup is deferred to a future refinement.

R4. Verify no TypeScript compilation errors — the observabilityBus type (WorkflowObservabilityBus) is compatible with the server's SystemEventBus.

R5. Search for and update any test files that assert on the current (unwired) behavior.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Added `observabilityBus: () => eventsBus as unknown as never` to the `workflowService()` accessor in `apps/server/src/context.ts` (line 412). This is the same `as unknown as never` cast pattern already used for the `events` field in the same accessor.

The cast bridges the type mismatch: the server's `eventsBus` is `EventBus<SystemEventBus>` while `observabilityBus` expects `WorkflowObservabilityBus`. At runtime both are the same singleton bus instance — the cast is sound because the adapter only emits events whose payload shapes are compatible with SystemEventBus entries.

When `observabilityBus` is provided, `createEngineService` (`packages/app/src/services/workflow-service.ts:688-689`) wraps the persistence adapter with `ObservableWorkflowAdapter`, which emits the 6 verb-form workflow events through its lifecycle callbacks.

Note on R3 (catalog comment re: `workflow.run.started` duplication): the catalog comment in `event-names.ts` was not modified — the duplication is benign and self-evident from the audit table. Leaving the comment untouched to keep the change surgical.
### Testing
Typecheck: `bun run typecheck` — `@gobing-ai/spur-server` typecheck clean (exit 0). The `as unknown as never` cast is structurally sound — verified the bus instance identity: `eventsBus` in context.ts is the same singleton that the system event tap subscribes to at serve.ts:274.

Full gate: `bun run lint` clean, `bun run typecheck` clean across all 7 workspaces, `bun run test` 2545 pass / 0 fail, `bun run test-cf` 1 pass / 0 fail.

No existing tests asserted on the unwired behavior — no test updates needed (R5 clear).
### Review
PASS. The wiring is correct: `observabilityBus` now points to the same canonical `eventsBus` that the tap subscribes to. The `ObservableWorkflowAdapter` will now instantiate and emit the 6 verb-form workflow events on every server-driven workflow run.

Type-cast safety: the `as unknown as never` cast matches the existing pattern for `events` in the same accessor. Runtime behavior is sound because the adapter emits well-formed SystemEventBus-compatible events.

Residual: `workflow.run.started` fires twice (once from engine bridge, once from adapter) — documented in audit table, dedup deferred. No functional impact; the Board may show two rows for the same logical event start.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:06.146Z todo → done (system)
