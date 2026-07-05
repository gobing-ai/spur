---
template: feature-impl
schema_version: 1
name: "Live board inbox tab: message events live tail (0193 wave C)"
description: ""
status: todo
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,web,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.855Z
updated_at: 2026-07-04T04:17:54.059Z
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
