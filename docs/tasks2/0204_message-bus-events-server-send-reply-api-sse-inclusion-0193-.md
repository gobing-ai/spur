---
template: feature-impl
schema_version: 1
name: "Message bus events, server send/reply API, SSE inclusion (0193 wave A)"
description: ""
status: todo
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: ["approach-c", "server", "collaboration", "subtask"]
dependencies: []
created_at: "2026-07-04T04:13:23.853Z"
updated_at: "2026-07-04T04:17:39.181Z"
---

## 0204. Message bus events, server send/reply API, SSE inclusion (0193 wave A)

### Background

Wave A of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Delivers the event/API layer: `message.sent|replied|read` emitted INSIDE TeamService paths (metadata only — id, from, to, thread id, created_at; NEVER the body; single emission point so CLI and server transports behave identically), write endpoints extending the 0189 `messages` module (`POST /api/messages`, `POST /api/messages/:id/reply` with boundary validation), and the message event names added to the shared event-name list so the tap persists and SSE streams them (decision recorded in parent Design: extend the existing planning stream, one EventSource on the board).

### Requirements
- [ ] R1 — Events emitted in TeamService send/reply/mark-read; tests assert emission + metadata-only payload (no body). (Parent R1)
- [ ] R2 — `POST /api/messages` + `POST /api/messages/:id/reply` over the same TeamService methods; boundary validation; Bun-gated; endpoint tests incl. thread integrity via the API path. (Parent R2, R6)
- [ ] R3 — `message.*` names on the shared event-name list; stream envelope test. (Parent R3)
- [ ] R4 — Existing message/team tests stay green (threading regression guard). (Parent R6)
- [ ] R5 — Full gate green incl. `test-cf`. (Parent R8)
### Acceptance Criteria
```gherkin
Feature: Inbox IPC

  Scenario: Sending a message emits a bus event
    Given the message service is wired to the EventBus
    When spur message send delivers a message to an agent
    Then an inbox_messages row is written and a message.sent event fires with the message id

  Scenario: Messages send over the server API
    Given spur serve is running
    When POST /api/messages is called with a body and recipient
    Then the message persists and the response returns its id

  Scenario: An agent inbox is readable over the server API
    Given unread messages exist for an agent
    When GET /api/messages/inbox is requested for that agent
    Then the agent's unread messages return with thread context

  Scenario: Reply threading is preserved
    Given an existing message
    When spur message reply answers it
    Then the reply carries in_reply_to pointing at the original and threads to the original sender
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0193's Design owns the full approach — this slice implements **Event emission placement**, **Server API**, and **SSE inclusion**: emit `message.sent|replied|read` INSIDE TeamService paths (single emission point → CLI and server transports behave identically; metadata only — id, from, to, thread id, created_at — NEVER the body, asserted by test); extend 0198's read-only `messages` module with `POST /api/messages` + `POST /api/messages/:id/reply` (boundary validation, Bun-gated); add `message.*` to the shared event-name list (tap persists, SSE streams — one board EventSource, decision recorded in the parent). Depends on: 0198 (messages module shell + name list). Blocks: 0206. Downstream: 0207+ (supervised loops pair with watch/drain).
### Plan
- [ ] Emit events in TeamService send/reply/mark-read; tests: emission + metadata-only payload (R1).
- [ ] POST send + reply endpoints on the messages module; validation; thread-integrity API test (R2).
- [ ] `message.*` on the shared name list; stream envelope test (R3).
- [ ] Regression: existing message/team suites green (R4).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R5).
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
