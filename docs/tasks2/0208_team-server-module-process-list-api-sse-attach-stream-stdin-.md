---
template: feature-impl
schema_version: 1
name: "Team server module: process list API, SSE attach stream, stdin endpoint (0195 wave B)"
description: ""
status: done
type: task
profile: standard
feature_id: G2
parent_wbs: "0195"
priority: P2
tags: [approach-c,server,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.856Z
updated_at: 2026-07-05T07:17:56.376Z
---

## 0208. Team server module: process list API, SSE attach stream, stdin endpoint (0195 wave B)

### Background

Wave B of parent 0195 (team process supervision) — read the parent's Background and Design first. Depends on wave A (SupervisorService + registry). Delivers the transport: a Bun-gated `team` server module with `GET /api/team/processes` (registry projection), `GET /api/team/processes/:id/stream` (SSE: ring-buffer replay then live framed stdout/stderr; REUSE the events module's teardown pattern — abort listener, heartbeat, idempotent close, the shape that fixed ERR_INCOMPLETE_CHUNKED_ENCODING; drop-oldest backpressure, enqueue failures never kill the child), and `POST /api/team/processes/:id/stdin` forwarding a line to child stdin. Detach (client disconnect) never affects the process.

### Requirements
- [ ] R1 — `GET /api/team/processes`: id/pid/status/uptime projection; endpoint test. (Parent R5)
- [ ] R2 — SSE attach stream: replay-then-tail, framed `{stream,ts,line}`, events-module teardown pattern, drop-oldest backpressure; tests with a stubbed supervisor. (Parent R4)
- [ ] R3 — stdin POST endpoint → child stdin; test via fake seam. (Parent R4)
- [ ] R4 — Detach leaves process running (asserted); CF no-op; full gate green incl. `test-cf`. (Parent R4, R9)
### Acceptance Criteria
```gherkin
Feature: Team process supervision

  Scenario: Supervised processes are listable over the API
    Given supervised processes exist
    When GET /api/team/processes is requested
    Then each process returns with agent id, pid, status, and uptime

  Scenario: Attaching replays the buffer then tails live output
    Given a running supervised agent with prior output
    When a client attaches to the process output stream
    Then recent buffered frames replay and new stdout and stderr frames arrive live

  Scenario: Stdin lines reach the child process
    Given a client is attached to a running supervised agent
    When a line is posted to the process stdin endpoint
    Then the child process receives that line on stdin

  Scenario: Detaching leaves the process running
    Given a client is attached to a supervised agent
    When the client disconnects from the stream
    Then the process keeps running and remains attachable
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0195's Design owns the full approach — this slice implements **Server module**: Bun-gated `team` module with `GET /api/team/processes` (registry projection: id/pid/status/uptime), `GET /api/team/processes/:id/stream` (SSE — ring-buffer replay then live `{stream, ts, line}` frames; REUSE the events module's teardown pattern: abort listener, heartbeat, idempotent close — the shape that fixed ERR_INCOMPLETE_CHUNKED_ENCODING; drop-oldest backpressure, enqueue failures never kill the child), `POST /api/team/processes/:id/stdin` → child stdin. Detach = client disconnect, process unaffected. CF no-op. Depends on: 0207 (SupervisorService + registry). Blocks: 0209 (attach CLI), 0210 (tab).
### Plan
- [ ] `GET /api/team/processes` projection + endpoint test (R1).
- [ ] SSE attach stream: replay-then-tail, events-module teardown pattern, drop-oldest backpressure; stubbed-supervisor tests (R2).
- [ ] stdin POST → child stdin via fake seam; test (R3).
- [ ] Detach-leaves-running asserted; CF no-op via `test-cf`; gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R4).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

G2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
