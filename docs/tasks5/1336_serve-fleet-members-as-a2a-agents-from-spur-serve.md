---
schema_version: 1
name: Serve fleet members as A2A agents from spur serve
status: todo
template: feature-impl
created_at: 2026-11-15T04:06:32.869Z
updated_at: "2026-11-15T04:06:32.911Z"
feature_id: G9
priority: P3
tags:
  - a2a
  - server
  - fleet
estimate_hours: 16

---

## 1336. Serve fleet members as A2A agents from spur serve

### Background

Implements: R1 — A live member is published as an A2A Agent Card; R2 — An A2A message becomes one keyed inbox request; R3 — Task state is read from the run receipt; R4 — Canceling the task stops the run; R5 — The endpoint is off by default and refuses unauthenticated callers.

G8 lets Spur send work to any A2A agent. This task lets a Spur install receive it, so two installs form a cross-machine fleet. Contract: `docs/design/a2a-member-transport.md` section 3.5. No outside caller exists yet, hence P3.

### Requirements

- [ ] R1 — Config `server.a2a.enabled` (default false) and `server.a2a.authEnv` (variable name); with it off, no A2A route is mounted.
- [ ] R2 — One Agent Card per live member, protocol version 1.0, HTTP+JSON interface only, streaming and push notifications declared false.
- [ ] R3 — `SendMessage` calls `InboxService` with `request_key` derived from the caller's `messageId`; a repeated `messageId` returns the existing task.
- [ ] R4 — The task id is the inbox message id; `GetTask` maps the `coordination_runs` receipt to an A2A task state and returns the answer as a text artifact.
- [ ] R5 — `CancelTask` stops the member's run through the existing stop path.
- [ ] R6 — A request without the configured bearer token is rejected before any inbox write; the token value is never logged.
- [ ] R7 — The routes are exercised by the unmodified `a2a` CLI (`card get`, `send --async`, `task get`, `task cancel`).

### Acceptance Criteria

- [ ] AC1 — A live member is published as an A2A Agent Card
- [ ] AC2 — An A2A message becomes one keyed inbox request
- [ ] AC3 — Task state is read from the run receipt
- [ ] AC4 — Canceling the task stops the run
- [ ] AC5 — The endpoint is off by default and refuses unauthenticated callers

Task-local check: the E2E run with the `a2a` CLI leaves a repeatable transcript artifact.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: a thin facade in `apps/server` over the existing services — no new table and no second writer (ADR-143). The inbox and `coordination_runs` are the A2A task store, which is what makes the tasks durable across a restart.

Why: the smallest thing that makes a Spur member reachable by any A2A client; idempotency comes from the existing request key.

Rejected: `a2a server --exec` in front of each member (cold, in-memory, no auth); an A2A SDK dependency (three routes and a card); streaming (the sender polls).

Open at implementation: whether the A2A route shapes fit an oRPC contract or need plain Hono routes — verify the HTTP+JSON paths against the v1.0 specification and the `a2a` client before choosing.

Invariants: off by default; `InboxService` stays the only inbox writer; no unauthenticated write; receipt-to-state mapping is the inverse of design section 4.2.

### Plan

- [ ] Write the failure list first as E2E cases driven by the `a2a` CLI: endpoint off, no token, wrong token, duplicate message id, unknown member, cancel of a finished task, restart mid-run.
- [ ] Config keys and conditional route mounting.
- [ ] Card, send, get and cancel handlers over the existing services.
- [ ] Update `docs/design/a2a-member-transport.md` section 3.5 into a contract section and the server surface satellite.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
