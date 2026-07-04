---
template: feature-impl
schema_version: 1
name: "Inbox IPC: message bus events, server message API, watch verb, live board inbox"
description: ""
status: wip
type: task
profile: standard
feature_id: G1
parent_wbs: null
priority: P1
tags: ["approach-c", "collaboration", "server", "cli"]
dependencies: []
created_at: "2026-07-03T23:35:28.257Z"
updated_at: "2026-07-04T04:13:23.918Z"
---

## 0193. Inbox IPC: message bus events, server message API, watch verb, live board inbox

### Background

Cycle position P4 (decision D2 ordering, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). The message store is already durable and threaded: `inbox_messages` table (migration `0001_spur_cli_team_inbox`), `TeamService` over `TeamOrchestrator`/`MessageService` (packages/app, 100% covered), `spur message send|inbox|reply` with `in_reply_to` threading, and `spur agent run --drain` folding the inbox into prompts. What's MISSING for real IPC between coding agents: nothing observes message arrival — delivery is pull-only via one-shot commands.

This task adds the event/push layer (decision trace: the IPC substrate that team supervision G2 and the workspace G3 both consume): message lifecycle events on the EventBus, a server message API, an SSE path for message events, a `spur message watch --agent <id>` verb so a running agent session blocks on new messages, and the Observability Inbox tab (shipped read-only in the P1 task) upgrading to live tail.

Dependencies: P1 Observabilities task (Inbox tab exists, events visible); P2 job-queue task is NOT required (messaging is synchronous DB + bus). MessageService primitives live in `@gobing-ai/ts-ai-runner` — if event emission belongs upstream (inside MessageService) rather than in Spur's TeamService wrapper, prefer the smallest upstream change per the shared-library evolution rule; otherwise emit from `packages/app`.

### Requirements
- [ ] R1 — Emit `message.sent`, `message.replied`, `message.read` on the EventBus from the app-layer message path (TeamService seam or upstream MessageService — decide per the shared-library rule and record in Design); events carry message id, from, to, and thread id, never the full body (events are observable metadata; body stays in the store).
- [ ] R2 — Server `messages` module: `POST /api/messages` (send), `POST /api/messages/<id>/reply`, `GET /api/messages/inbox?agent=<id>` — thin wrappers over TeamService with lifecycle events firing exactly as the CLI path does.
- [ ] R3 — Message events reach SSE consumers: extend the planning stream's event list or add `/api/events/messages`; document the choice in Design and keep the events module's CF no-op stance.
- [ ] R4 — `spur message watch --agent <id> [--json]`: blocks, surfaces new inbox messages as they arrive (poll the store or follow SSE when serve is up; poll fallback must work serverless), exits cleanly on interrupt; `--json` emits one JSON object per message line (machine-consumable by agent wrappers).
- [ ] R5 — Observability Inbox tab upgrades to live: new messages append without refresh via the message events; read/unread state visible.
- [ ] R6 — Threading regression guard: reply still threads to the original sender via `in_reply_to` (existing tests keep passing; add an API-path thread test).
- [ ] R7 — Tests: event emission on send/reply/read, server endpoints against in-memory SQLite, watch verb poll path (injected interval), SSE inclusion.
- [ ] R8 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`.
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

  Scenario: A watching agent observes new messages without restart
    Given an agent session is running spur message watch
    When another agent sends it a message
    Then the watcher surfaces the new message within the follow interval

  Scenario: Reply threading is preserved
    Given an existing message
    When spur message reply answers it
    Then the reply carries in_reply_to pointing at the original and threads to the original sender

  Scenario: The board inbox view updates live
    Given the Observability Inbox tab is open
    When a message is sent
    Then the tab shows the new message without a page refresh
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Add the event/push layer over the already-durable message store (`inbox_messages` migration `0001_spur_cli_team_inbox`; `TeamService` in `packages/app` over ts-ai-runner's `TeamOrchestrator`/`MessageService`, 100% covered; CLI `send|inbox|reply` with `in_reply_to` threading). Nothing about storage changes — this task makes arrival OBSERVABLE: bus events, server write API, SSE inclusion, a blocking `watch` verb, and the live board tab.

**Event emission placement (R1).** Emit from Spur's app layer (`TeamService` send/reply/mark-read paths), NOT upstream: the EventBus is host-owned (Spur context), events are a Spur-domain concern, and this is the smallest change (shared-library rule satisfied by NOT touching ts-ai-runner). Record here if implementation finds a reason to move it upstream. Event payloads carry metadata ONLY — message id, from, to, thread id (`in_reply_to` root), created_at — NEVER the body (bodies stay in the store; events are observable metadata and land in `system_events` via the 0189 tap).

**Server API (R2).** Extend the read-only `messages` module from 0189 with writes: `POST /api/messages` (send), `POST /api/messages/:id/reply`. Thin wrappers over the SAME TeamService methods the CLI uses so events fire identically on both paths (one code path emits; the transport is irrelevant). Validation at the boundary (agent id exists, body non-empty); Bun-gated like the other ctx-dependent modules.

**SSE inclusion (R3).** Add `message.sent|replied|read` to the shared event-name list (established by 0189, extended by 0190) — one list feeds both the tap (history) and the SSE stream (live). Decision recorded: extend the existing `/api/events/planning` stream rather than adding a second stream — the envelope already carries `eventName`, the board holds ONE EventSource, and CF no-op behavior is inherited. Rename/alias considerations for the route (it now carries more than planning events) are cosmetic — defer, note in the follow-ups.

**Watch verb (R4).** `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`: baseline implementation POLLS the store via TeamService (works with no server running — serverless is the contract); surfaces each new message as it arrives; `--json` emits one JSON object per line (machine-consumable by agent wrappers); clean exit on SIGINT. Watch SURFACES, it does not consume — read-marking stays with `--drain`/explicit reads (record this semantic here; it's what makes watch safe to run alongside drain loops). SSE-follow (when serve is up) is an optimization — implement only if trivial, otherwise scoped follow-up.

**Board live tab (R5).** The Inbox tab (0189) subscribes to `message.*` via the existing EventSource: append/refetch on event, unread badge. No new transport.

**Testing (R6, R7).** Event emission on send/reply/read (fake bus); API endpoints against in-memory SQLite incl. thread integrity via the API path; watch poll loop with injected interval (no real sleeps); SSE list inclusion (unit on the shared constant + stream envelope test).

**Risks.** Poll interval vs. test time (inject); double-emission if both CLI and server paths wrap emission separately (emit INSIDE TeamService once); body leakage into events (explicitly asserted in tests).

**Decomposition guidance.** Split if desired: A = events + server writes + SSE (R1–R3); B = watch verb (R4); C = live tab (R5). `--parent 0193`.

**Dependencies.** 0189 (messages module shell, tap, shared event-name list, Inbox tab). NOT dependent on 0190. Downstream: 0195 (supervised agents pair watch/drain), 0197 (workspace-scoped messaging).
### Plan
- [ ] Emit `message.sent|replied|read` (metadata only) inside TeamService paths; tests assert emission + no body in payload (R1).
- [ ] Extend the `messages` server module with POST send + reply; boundary validation; endpoint tests incl. thread integrity (R2, R6).
- [ ] Add message event names to the shared event-name list (tap + SSE inherit); stream envelope test (R3).
- [ ] `spur message watch --agent <id> [--interval] [--json]`: poll baseline, JSON-lines output, SIGINT-clean; injected-interval tests (R4).
- [ ] Inbox tab live: subscribe `message.*` on the existing EventSource, append + unread badge; component test (R5).
- [ ] Regression: existing message/team tests green; reply threading via API asserted (R6).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R8).
- [ ] Manual: two terminals — `spur message watch --agent a1` + `spur message send "hi" --to a1`; watcher surfaces it; board tab shows it live under `spur serve`.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0204 | Message bus events, server send/reply API, SSE inclusion (0193 wave A) | todo |
| 0205 | spur message watch verb (0193 wave B) | todo |
| 0206 | Live board inbox tab: message events live tail (0193 wave C) | todo |
<!-- END AUTO-GENERATED -->
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
- 2026-07-04T04:13:23.918Z todo → wip (system)
