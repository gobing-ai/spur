---
schema_version: 1
id: "M4"
name: "Inbox Board module: unified agent message plane (All / Supervisor / per-agent tabs)"
status: backlog
priority: P2
tags: []
created_at: "2026-08-03T23:00:42.623Z"
updated_at: "2026-08-04T04:44:28.037Z"
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

  Scenario: R9 — Process-stream helpers are shared, not duplicated
    Given the frame parsing buffering backoff and stream-url helpers are extracted to a shared module
    When both the Teams member terminal and the Inbox agent timeline consume them
    Then both import the helpers from the shared module rather than redeclaring them
    And the pre-existing member-terminal tests pass unchanged against the new import path

  Scenario: R10 — Inbox surfaces resolve DESIGN.md tokens through a module scope
    Given the Inbox module root carries its own scoping class
    When Inbox surfaces render
    Then the DESIGN.md token values resolve only within that scope
    And the shared theme token values are left unmodified
    And no hard-coded hex value or framework palette class appears in the module

  Scenario: R11 — Inbox controls resolve a single chromatic accent
    Given the Inbox renders shared UI primitives that map onto component-library variants
    When a primary or accent control renders inside the Inbox
    Then it resolves the DESIGN.md accent rather than the component library's own default hue
    And the accent is used only for focus selection or link emphasis
    And no row card or tab uses the accent as a fill

  Scenario: R12 — Inbox cards and type follow the DESIGN.md ladder and scale
    Given an Inbox timeline row or panel renders
    When the operator views the rendered card
    Then its background sits one surface-ladder step above its container
    And it carries a hairline border and the DESIGN.md card corner radius
    And body text timestamps and identifiers follow the DESIGN.md type scale
    And display type is not introduced

  Scenario: R13 — Other board modules are unregressed by the Inbox palette
    Given the Inbox defines DESIGN.md token values in its own scope
    When the Teams and Observability modules render
    Then they resolve the unchanged shared palette
    And their existing tests pass

  Scenario: R14 — Switching agent tabs tears down the previous stream
    Given an agent tab is mounted with an open event stream and an in-flight fetch
    When the operator switches to a different agent tab
    Then the previous stream is closed and its in-flight fetch aborted
    And exactly one stream remains open for the newly mounted tab
    And unmounting the module leaves no open stream or in-flight fetch
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0422 | Inbox Board module v1: All / Supervisor / per-agent tabs over a unified message+process timeline | done |
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

### Ship AC note (0422 v1)

**R8 (supervisor relay hold toggle) is deferred from ship AC** until the cross-process flag
location is decided (see *Not yet specified* above). Task 0422 deliberately excludes R8; the
Gherkin ship set is R1–R7 and R9–R14 only. When the flag lands, re-add the R8 scenario and
open a covering implement task.

## History
