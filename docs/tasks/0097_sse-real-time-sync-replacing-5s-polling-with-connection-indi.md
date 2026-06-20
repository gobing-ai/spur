---
schema_version: 1
name: "SSE real-time sync replacing 5s polling, with connection indicator"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.369Z
updated_at: 2026-06-20T16:05:41.238Z
feature_id: F7
priority: P2
tags: ["task-kanban", "wave-3", "api", "sse", "realtime"]
---

## 0097. SSE real-time sync replacing 5s polling, with connection indicator

### Background

Implements gap-analysis §2 (SSE Sync — Medium) + §4.1 (Events Stream) + Wave 3. Effort: ~12h. The migrated board polls every 5s (useTasks.ts) with no connection indicator; legacy pushed changes over an SSE /events stream with a green/red connection dot. Polling is safe but generates redundant HTTP traffic and lags up to 5s behind. This task adds a server event stream sourced from the existing EventBus and switches the board to consume it, falling back to polling if the stream drops, plus a header connection indicator. The contract/stream shape must remain Worker-compatible (test-cf stays green). Depends on the board being stable (Wave 1/2); independent otherwise. Ordering: Wave 3.

### Requirements
- [ ] R1. Add a server-sent events surface (oRPC stream or a dedicated SSE route) that emits task change events mapped from the EventBus (created/updated/transitioned), with a typed event schema in packages/contracts (transport DTOs only).
- [ ] R2. Switch useTasks.ts to consume the stream and apply incremental updates to the task store; on stream error/close, fall back to the existing 5s polling so the board never goes stale.
- [ ] R3. Add a connection indicator in the board header (connected/disconnected) reflecting the stream state.
- [ ] R4. The stream must not break the Cloudflare Worker build/runtime — test-cf stays green; if SSE is local-Bun-only, gate it like the static-asset block and document the runtime boundary (ADR-019).
- [ ] R5. Tests: events emitted on a mutation reach a subscribed client; a dropped stream falls back to polling; the indicator reflects state. Gate green including test-cf.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — the server emits task change events over a stream
  Given the server EventBus<PlanningEventMap>
  When a task is created, updated, or transitioned
  Then a typed event (task.created/updated/transitioned) is published on the SSE/stream surface
  And the event schema lives in packages/contracts (transport DTO)

Scenario: R2 — the board consumes the stream and applies incremental updates
  Given the board subscribed to the stream
  When a task change event arrives
  Then the useTasks store applies the incremental update without a full re-poll

Scenario: R3 — the board falls back to polling on stream failure
  Given an open stream
  When the stream errors or closes
  Then the board falls back to the existing 5s polling so it never goes stale

Scenario: R4 — a connection indicator reflects stream state
  Given the board header
  When the stream is connected or disconnected
  Then a connection indicator shows the current state

Scenario: R5 — the Worker build stays green
  Given the new stream surface
  When test-cf runs
  Then the server still builds and runs under the Cloudflare Worker runtime
```

Edge cases (advisory):

```gherkin
Scenario: R6 — reconnect resumes live updates after a transient drop
  Given a stream that dropped and the board fell back to polling
  When the stream reconnects
  Then live updates resume and the indicator returns to connected
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — add an SSE surface sourced from `ServerContext.eventBus()` (already typed `EventBus<PlanningEventMap>`); the `useTasks` store subscribes to it and falls back to the existing 5s poll on failure.**

The backend seam already exists: `ServerContext.eventBus()` returns `EventBus<PlanningEventMap>`, explicitly documented as "the pub/sub seam for SSE (S6)". The planning event names are defined (`task.created`/`updated`/`transitioned`, feature equivalents). And `useTasks.ts` already documents the swap as invariant #10: "The SSE swap (W6 usePlanningEvents) is a drop-in that feeds the same store." So this task wires the two ends.

**Server stream.** Expose the EventBus as a stream the web client can consume — an SSE route (or oRPC streaming output) that forwards `PlanningEventMap` events as typed messages. The event payload schema goes in `packages/contracts` (transport DTO only); domain types stay in their owning package.

**Client consumption (R2).** Add a `usePlanningEvents` subscriber that feeds the same `TaskStore` the poll feeds — applying incremental updates (`setTasks` on create/transition) rather than re-fetching the whole list. Because the store is the single subscribe point, the board and detail both update from one stream.

**Fallback (R3/R6).** On stream error/close, fall back to the existing `setInterval` poll so the board never goes stale; on reconnect, resume live updates. The poll is the safety net, not removed — the stream is an enhancement layered over it.

**Connection indicator (R4).** A header dot (connected/disconnected) bound to the stream state — the legacy green/red affordance.

**Worker compatibility (R5).** SSE long-lived connections are a Bun/Node concern; the Cloudflare Worker may not support the same streaming. Gate the SSE route like the static-asset block (ADR-019 runtime split) — if SSE is local-Bun-only, document the boundary and keep the Worker on poll-only. `test-cf` must stay green.

**Depends on:** the board being stable (Waves 1–2). **Invariant:** the store remains the single source the UI renders from; SSE feeds it, poll backs it up — never two competing sources of truth.
### Plan
1. Add a typed event payload schema to `packages/contracts` for the planning events streamed to the client.
2. Expose an SSE route (or oRPC stream) on the server that forwards `ServerContext.eventBus()` (`EventBus<PlanningEventMap>`) events to subscribers; gate it by runtime per ADR-019 if SSE is local-Bun-only.
3. Add a `usePlanningEvents` client subscriber that feeds the existing `TaskStore` (incremental `setTasks` on create/transition), reusing the single subscribe point.
4. Implement fallback: on stream error/close, run the existing 5s poll; on reconnect, resume live updates.
5. Add a header connection indicator bound to stream state.
6. Tests: an emitted event reaches a subscribed client and updates the store; a dropped stream falls back to polling; the indicator reflects state. Run the gate including `test-cf` (R5) — confirm the Worker build stays green / poll-only path intact.
### History
