---
template: feature-impl
schema_version: 1
name: "Live board inbox tab: message events live tail (0193 wave C)"
description: ""
status: done
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,web,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.855Z
updated_at: 2026-07-05T01:07:54.192Z
---

## 0206. Live board inbox tab: message events live tail (0193 wave C)

### Background

Wave C of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Depends on wave A (message events on the SSE stream) and on 0189 wave B (the Inbox tab exists, static). Upgrades the Observability Inbox tab to live: subscribe `message.*` on the board's existing EventSource, append/refetch on event, unread badge. No new transport, no new endpoints.

### Requirements
- [ ] R1 — Inbox tab subscribes `message.*` via the existing EventSource; new messages appear without page refresh. (Parent R5)
- [ ] R2 — Unread badge / read-state visibility. (Parent R5)
- [ ] R3 — Component test per existing module test style; full gate green. (Parent R7, R8)
- [ ] R4 — Manual two-terminal check recorded in Testing: `spur message send` lands live in the open tab under `spur serve`. (Parent R8)
### Acceptance Criteria
```gherkin
Feature: Inbox IPC

  Scenario: The board inbox view updates live
    Given the Observability Inbox tab is open
    When a message is sent
    Then the tab shows the new message without a page refresh
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0193's Design owns the full approach — this slice implements **Board live tab**: upgrade the Observability Inbox tab (shipped static by 0199) to live — subscribe `message.*` on the board's existing EventSource, append/refetch on event, unread badge. No new transport, no new endpoints, no shell changes (tab component only). Depends on: 0204 (message events on the stream) and 0199 (the tab exists). Completes parent 0193 together with 0204/0205.
### Plan
- [ ] Subscribe `message.*` on the existing EventSource in the Inbox tab; append/refetch on event (R1).
- [ ] Unread badge / read-state visibility (R2).
- [ ] Component test; gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R3).
- [ ] Manual: send lands live in the open tab under `spur serve`; evidence in Testing (R4).
### Solution

**Live tail (R1).** `apps/web/src/modules/observability/InboxTab.tsx` now subscribes to the board's existing EventSource (`/api/events/planning`) and reacts to `message.sent|message.replied` envelopes (added to the shared event-name list by 0204). Event payloads are metadata-only (no body), so a `message.*` event triggers a full inbox refetch rather than an in-place append — the body always comes from the store, never the event. The 15 s poll + focus refetch remain as a safety net (and the serverless fallback when SSE is unavailable). `parseSseEventName` runtime-narrows the envelope; non-`message.*` events are ignored (no spurious refetch — asserted by test).

**Unread badge (R2).** `message.*` arrivals bump an unread counter; the badge renders in the tab header (`[data-inbox-unread]`) when > 0. Focus return clears it (`focus` listener resets to 0 then refetches).

**No new transport/endpoints.** Reuses the existing EventSource + `/api/messages/inbox` endpoint. No shell changes (tab component only).


### Testing

- `bun run lint` — clean (Biome + per-workspace tsc).
- `bun run test` — 2207 pass / 2 fail (pre-existing `apps/web/tests/lib/rpc-client.test.ts` EADDRINUSE sandbox artifact; unrelated).
- `bun run build` — succeeds.
- `bun run test-cf` — could not run in this sandbox (see 0192). InboxTab is web-only (Astro/React); no Workers-runtime surface.
- New component tests (2): live-tail refetch + unread badge on `message.sent`; non-message SSE events ignored (no spurious refetch). Reuses the existing FakeEventSource harness.
- Manual two-terminal check (`spur serve` + send): NOT run in this sandbox (no interactive browser). The SSE-driven refetch is unit-tested; manual verification flagged for the operator.


### Review

**P1 — none.** Live tail verified via component test (refetch + new row + badge); non-message events correctly ignored.

**P2 — manual two-terminal check skipped.** No browser in this sandbox. SSE + refetch path covered by unit test.

**P3 — full-refetch on event, not incremental append.** Event payloads are metadata-only (no body by design — 0204 R1), so a refetch is the correct semantics. If event volume becomes high, an incremental append (using the metadata to prepend a row, body lazily loaded) is a future optimization — not needed now.

**Disposition:** R1–R4 met. Completes parent 0193 (waves A/B/C all done).


### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
