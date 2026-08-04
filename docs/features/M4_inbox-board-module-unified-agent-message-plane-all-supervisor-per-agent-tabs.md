---
schema_version: 1
id: "M4"
name: "Inbox Board module: unified agent message plane (All / Supervisor / per-agent tabs)"
status: backlog
priority: P2
tags: []
created_at: "2026-08-03T23:00:42.623Z"
updated_at: "2026-08-03T23:01:59.235Z"
---

# M4: Inbox Board module: unified agent message plane (All / Supervisor / per-agent tabs)

## Goal
**Destination:** the Spur Board has one surface for the agent message plane — an `Inbox` module whose
`All` and `Supervisor` fixed tabs plus per-agent tabs render a unified IN/OUT timeline for every
backend coding agent — and the Teams module is reduced to process lifecycle only.

Today the message plane is split across three places: `teams/MessagesTab.tsx` (global feed),
`teams/MemberTerminal.tsx` (per-agent stdin/stdout), and an orphaned
`observability/InboxTab.tsx` that was dropped from `OBSERVABILITY_TABS` in 0254 but still ships
code and tests. Reaching the destination consolidates all three, so the Board gains a module
without gaining a third place that shows messages.
## Scope
- In:
    - New `apps/web/src/modules/inbox/` Board module (registry-discovered, own route).
    - Fixed `All` tab (message feed across every agent) and fixed `Supervisor` tab (same feed
      filtered to supervisor endpoints) as tab positions 1 and 2.
    - Dynamic per-agent tabs derived from the selected (or default) team roster.
    - Per-agent **unified timeline**: durable queue messages (`GET /api/messages`) interleaved with
      process frames (`GET /api/team/processes/:id/stream` SSE) — merged client-side by timestamp.
    - Consolidation: Teams drops its `Message` tab; orphaned `observability/InboxTab.tsx` and its
      tests are deleted.
    - Supervisor **relay hold toggle** — OFF pauses forwarding to backend processes while the queue
      keeps filling; ON flushes the backlog.
- Out:
    - **Supervisor-hub routing.** `TeamService.sendMessage(fromId, toId)` stays direct. A→B does not
      become A→supervisor→B; no forwarding actor, no two-hop rows, no migration of existing rows.
      Deferred to its own feature — it is a message-plane redesign touching CLI, agent loop, and DAO.
    - **Supervisor as a message-plane agent identity.** The `Supervisor` tab is a filter over
      existing endpoints; `SupervisorService` remains a process manager.
    - **Changing message delivery.** Messages continue to reach agents via the durable queue drained
      by `spur agent loop` (`TeamService.drainPending`) — *not* by writing them to process stdin.
      The stdin path stays what it is today: an operator-typed terminal line.
    - **Server-side timeline materialization.** No new endpoint, table, or merge service; the two
      existing sources are merged in the client.
    - **Process-frame retention.** The bounded, ephemeral ring buffer (`ringBufferSize`, default 500)
      is not extended or persisted.
## Acceptance Criteria
```gherkin
Feature: Inbox Board module — unified agent message plane

  Scenario: R1 — Inbox registers as a Board module with two fixed leading tabs
    Given the web module registry has discovered the modules directory
    When the operator opens the Inbox module route
    Then the module renders with "All" as the first tab and "Supervisor" as the second tab
    And the registry reports no duplicate module id or route

  Scenario: R2 — The All tab shows message traffic across every agent
    Given messages exist addressed to more than one agent
    When the operator selects the "All" tab
    Then every message is listed newest-first with its sender, recipient, status, and timestamp
    And a malformed row from the endpoint does not crash the tab

  Scenario: R3 — The Supervisor tab filters the feed to supervisor traffic
    Given the message feed contains both supervisor and agent-to-agent messages
    When the operator selects the "Supervisor" tab
    Then only messages whose sender or recipient is the supervisor endpoint are listed
    And no message-routing behaviour changes as a result of viewing this tab

  Scenario: R4 — Per-agent tabs are derived from the team roster
    Given the selected team has members
    When the Inbox module renders its tab strip
    Then one tab appears per team member after the two fixed tabs
    And the tab set updates when the selected team changes

  Scenario: R5 — A per-agent tab renders a unified IN/OUT timeline
    Given an agent has both durable queue messages and recent process output frames
    When the operator selects that agent's tab
    Then queue messages and stdout/stderr frames appear in one timeline ordered by timestamp
    And each entry is visually distinguishable as a message or a process frame
    And each entry is marked as inbound or outbound relative to the agent

  Scenario: R6 — The process-frame history boundary is visible
    Given the process ring buffer holds fewer frames than the agent's message history spans
    When the operator views that agent's unified timeline
    Then a boundary marker indicates where process-frame history begins
    And messages older than the marker still render without fabricated frame context

  Scenario: R7 — Message surfaces are consolidated, not duplicated
    Given the Inbox module ships
    When the Board is loaded
    Then the Teams module no longer renders a "Message" tab
    And the orphaned observability InboxTab component and its tests are deleted
    And the full test suite passes with no dangling imports

  Scenario: R8 — The supervisor relay toggle holds delivery without losing messages
    Given the supervisor relay toggle is switched OFF
    When a message is sent to an agent
    Then the message remains in "queued" status and is not drained to the backend process
    And when the toggle is switched ON the held messages are drained in order
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0422 | Inbox Board module v1: All / Supervisor / per-agent tabs over a unified message+process timeline | todo |
<!-- END AUTO-GENERATED -->

## Notes
This feature is a **wayfinder map** (`sp:wayfinder`). Sessions orient to the Destination in `## Goal`,
resolve **one** ticket, record the answer here, then stop.

### Domain context every session needs

Spur has **two independent channels** between the Board and a backend coding agent. Conflating them
is the single most likely way to get this feature wrong:

| | Durable message queue | Process pipe |
| --- | --- | --- |
| Write path | `TeamService.sendMessage` → DAO `enqueue` | `POST /api/team/processes/:id/stdin` |
| Read path | `TeamService.getInbox` / `listRecent` / `drainPending` | `GET /api/team/processes/:id/stream` (SSE) |
| Delivery to agent | `spur agent loop` calls `drainPending`, prepends messages to the prompt | written straight to `PipeProcess` stdin |
| Storage | SQLite, durable, status lifecycle (`queued` → `injected`) | in-memory ring buffer, bounded (default 500), lost on restart |
| Ordering cursor | `createdAt` | `seq` (monotonic) + `ts` |

`SupervisorService` (`packages/app/src/services/supervisor-service.ts`) is a **process manager** —
it spawns, restarts, and buffers output. It has no identity or role in the message plane today.

### Skills to consult

- `sp:spur-cli` — corpus verbs; never direct-write `docs/tasks/` or `docs/features/`.
- Root `DESIGN.md` — UI/UX SSOT; read before any Board surface work.
- `sp:code-implementation` for prototype tickets, `sp:dev-refine` for grilling tickets.

### Decisions so far

Recorded during charting (2026-08-03). These were operator-held scope calls, answered directly
rather than ticketed.

- **D1 Placement** — a new `modules/inbox/` module owns the whole message plane; Teams gives up its
  `Message` tab and the orphaned `observability/InboxTab.tsx` is deleted. Rejected: adding Inbox
  alongside the existing surfaces, which would leave messages rendering in three places.
- **D2 Channel** — an Inbox row is a **unified per-agent timeline**: durable queue messages
  interleaved with process stdout/stderr frames. Rejected: queue-only (loses the IN/OUT process
  view) and stdin-only (a near-duplicate of the shipped `MemberTerminal`).
- **D3 Supervisor hop** — v1 is a **UI-only filter**. Real supervisor-hub routing (A→supervisor→B)
  is out of scope for this map's destination.
- **D4 Relay OFF** — **hold** semantics: the queue keeps filling, forwarding pauses, ON flushes the
  backlog. Rejected: pausing only the UI stream (the toggle would lie) and dropping messages
  (silent data loss).

### Not yet specified

- **Where the relay flag lives.** The Board runs in the server process; `spur agent loop` runs as a
  separate CLI process calling `drainPending` with no gate. There is no precedent for a Board-set
  runtime flag that a CLI process observes. DB row vs. config file vs. supervisor-held state behind
  an API — undecided, and it blocks R8.
- **Who "the supervisor" is in the message plane.** R3's filter needs an identity to match on, and
  no supervisor agent id exists today.
- **Merge fidelity.** Message `createdAt` and frame `ts` are stamped by different processes; ties
  and clock skew have no defined tiebreak.
- **Empty and partial states.** An agent with messages but no running process (no frames), versus a
  running process with no messages — the timeline's behaviour in each is unspecified.
- **Whether the All tab interleaves process frames too**, or stays message-only across agents.
- **Tab-strip overflow** once a team has more members than the strip can show.
## History
