---
schema_version: 1
name: Serve fleet members as A2A agents from spur serve
status: done
template: feature-impl
created_at: 2026-11-15T04:06:32.869Z
updated_at: "2026-11-15T04:37:29.703Z"
feature_id: G9
priority: P3
tags:
  - a2a
  - server
  - fleet
estimate_hours: 16

done_forced: "false"
done_reason: unforced close
---

## 1336. Serve fleet members as A2A agents from spur serve

### Background

Implements: R1 — A live member is published as an A2A Agent Card; R2 — An A2A message becomes one keyed inbox request; R3 — Task state is read from the run receipt; R4 — Canceling the task stops the run; R5 — The endpoint is off by default and refuses unauthenticated callers.

G8 lets Spur send work to any A2A agent. This task lets a Spur install receive it, so two installs form a cross-machine fleet. Contract: `docs/design/a2a-member-transport.md` section 3.5. No outside caller exists yet, hence P3.

### Requirements

- [x] R1 — Config `server.a2a.enabled` (default false) and `server.a2a.authEnv` (variable name); with it off, no A2A route is mounted.
- [x] R2 — One Agent Card per live member, protocol version 1.0, HTTP+JSON interface only, streaming and push notifications declared false.
- [x] R3 — `SendMessage` calls `InboxService` with `request_key` derived from the caller's `messageId`; a repeated `messageId` returns the existing task.
- [x] R4 — The task id is the inbox message id; `GetTask` maps the `coordination_runs` receipt to an A2A task state and returns the answer as a text artifact.
- [x] R5 — `CancelTask` stops the member's run through the existing stop path.
- [x] R6 — A request without the configured bearer token is rejected before any inbox write; the token value is never logged.
- [x] R7 — The routes are exercised by the unmodified `a2a` CLI (`card get`, `send --async`, `task get`, `task cancel`).

### Acceptance Criteria

- [x] AC1 — A live member is published as an A2A Agent Card
- [x] AC2 — An A2A message becomes one keyed inbox request
- [x] AC3 — Task state is read from the run receipt
- [x] AC4 — Canceling the task stops the run
- [x] AC5 — The endpoint is off by default and refuses unauthenticated callers

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

An `apps/server` module over the existing services — no new table, no second inbox writer
(ADR-143/ADR-148). `apps/server/src/modules/a2a/index.ts` mounts four raw Hono routes only when the
listener is enabled; `apps/server/src/modules/a2a/projection.ts` owns the wire projection (card,
state mapping, error envelope).

**Change map**

- `packages/config/src/index.ts:15,1300` — `server.a2a.{enabled,authEnv}` on the app-layer schema,
  `SPUR_A2A_ENABLED` / `SPUR_A2A_AUTH_ENV` in the single env funnel, and a `superRefine` that fails
  the load when `enabled` has no `authEnv`.
- `apps/server/src/server-config.ts:22,75` — `ServerBootConfig.a2a` carries the switch and the
  variable NAME (never the token).
- `apps/server/src/modules/a2a/index.ts` — `GET /a2a/members/<member>/.well-known/agent-card.json`,
  `POST …/message:send`, `GET …/tasks/<id>`, `POST …/tasks/<id>:cancel`. Bearer check precedes every
  route including the card; the token is compared without short-circuiting.
- `apps/server/src/modules/a2a/index.ts:send` — `InboxService.send` with `kind: 'request'` and
  request key `a2a:<member>:<messageId>`; the task id IS the inbox message id, so a replayed
  `messageId` returns the same task and a different body is `409`.
- `apps/server/src/modules/a2a/index.ts:cancel` — intent marker `.spur/run/a2a-canceled-<id>` first
  (so a restart still reads `canceled`), then `ctx.supervisor().stop(member)`; only a `WORKING` task
  is cancelable.
- `apps/server/src/modules/a2a/projection.ts:projectState` — receipt → state, cancel outranking the
  `errored` exit a stopped run leaves behind; `COMPLETED` carries the newest inbox reply as a text
  artifact.
- `packages/app/src/services/fleet-service.ts:memberAddresses` — addresses from the declaration
  alone, so a card is served for a member whose pinned executor is globally disabled.
- `apps/server/src/middleware/pipeline.ts:csrf` — `/a2a/*` exempt: every route is header-authenticated,
  and the unmodified `a2a` CLI sends no `Content-Type` on `task cancel`, which `csrf()` rejects.
- `scripts/commands/a2a-serve-e2e.ts` (+ `bun run a2a-serve-e2e`) — the real CLI drives a real
  `spur serve` and writes `docs/reports/a2a-serve-e2e-receipt.json`.

**Why the receipt, not a table.** The inbox request and its `coordination_runs` row are the durable
record; the endpoint derives every answer from them, so a `spur serve` restart changes nothing and
`CancelTask` needs no state of its own beyond the cancel marker.

**Rejected.** `a2a server --exec` in front of each member (cold, in-memory, no auth — ADR-148); an
A2A SDK dependency (four routes and a card); an oRPC contract (the binding's paths carry `:send` /
`:cancel` literals and its envelopes are proto3 JSON, not the Board's DTOs); trusting CSRF for a
bearer surface.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `server.a2a.enabled` default false + `authEnv`; off mounts no route | MET | `packages/config/src/index.ts:1309`, `packages/config/src/index.ts:1326`, `apps/server/src/modules/a2a/index.ts:171`; tests `routes.test.ts` "no A2A route exists when the endpoint is disabled" + "endpoint-off" e2e step |
| R2 — one card per live member, v1.0, HTTP+JSON only, streaming/push false | MET | `apps/server/src/modules/a2a/projection.ts:56`; `apps/server/tests/modules/a2a/projection.test.ts` card cases; e2e `card-get` step |
| R3 — `SendMessage` → one inbox request keyed by `messageId`; replay returns the same task | MET | `apps/server/src/modules/a2a/index.ts:233`; tests "the same message id twice yields one row and the same task id" + conflict case |
| R4 — task id = inbox message id; GetTask maps the `coordination_runs` receipt and returns the answer as a text artifact | MET | `apps/server/src/modules/a2a/projection.ts:121`, `apps/server/src/modules/a2a/index.ts:255`; tests SUBMITTED/WORKING/COMPLETED/FAILED + restart; e2e `task-get-completed`/`task-get-failed` |
| R5 — `CancelTask` stops the run through the existing stop path | MET | `apps/server/src/modules/a2a/index.ts:304` (`ctx.supervisor().stop`, the `POST /api/agents/:id/stop` path at `apps/server/src/modules/processes/index.ts:109`); tests both cancel arms; e2e `task-cancel` |
| R6 — no token → rejected before any inbox write; token never logged | MET | `apps/server/src/modules/a2a/index.ts:183` (check precedes every write), `apps/server/src/modules/a2a/index.ts:53`; tests "a missing bearer token … enqueues nothing" + "no response body echoes the configured token"; e2e `unauthenticated-refused`, `token-not-echoed` |
| R7 — exercised by the unmodified `a2a` CLI (`card get`, `send --async`, `task get`, `task cancel`) | MET | `scripts/commands/a2a-serve-e2e.ts:196`; `docs/reports/a2a-serve-e2e-receipt.json` (10/10, `a2a version 0.4.0`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A live member is published as an A2A Agent Card | MET | test | `apps/server/tests/modules/a2a/projection.test.ts`; e2e `card-get` (protocol 1.0, HTTP+JSON, streaming/push false) |
| AC2 — An A2A message becomes one keyed inbox request | MET | test | `apps/server/tests/modules/a2a/routes.test.ts` duplicate-id case; e2e `send-async` |
| AC3 — Task state is read from the run receipt (completed+artifact / failed+reason / working, survives restart) | MET | test | `apps/server/tests/modules/a2a/routes.test.ts` receipt cases + restart case; e2e `task-get-completed`, `task-get-failed` |
| AC4 — Canceling the task stops the run and reports canceled | MET | test | `apps/server/tests/modules/a2a/routes.test.ts` cancel cases; e2e `task-cancel` (seeds a live run row, then cancels through the CLI) |
| AC5 — Off by default; unauthenticated call rejected and enqueues nothing | MET | test | `apps/server/tests/modules/a2a/routes.test.ts` off/401 cases; e2e `endpoint-off` (404), `unauthenticated-refused` (401) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the task diff (21 files) against R1–R7 and AC1–AC5; full tables in
`.spur/run/d7e98296-1314-4512-b4d9-dc4ebc5ff04a-review-cert.md`.

**Verdict: PASS** — every requirement and AC is MET with test + command evidence (30 module tests,
282 config-suite tests, `spur task gate 1336 light` PASS, `bun run a2a-serve-e2e` 10/10 against
`a2a version 0.4.0`).

**SECUA.** Auth precedes every route and every write; the token is read from a named variable, never
persisted/echoed/logged, compared without short-circuiting. One A2A error envelope on every path;
an enabled listener with an unreadable token variable refuses with 500 naming the config key rather
than a 404 indistinguishable from "off". Idempotency is the inbox request key (a differing body is
409, never a silent drop); a message owned by another member is 404; cancel of a non-running task is
400 `TASK_NOT_CANCELABLE` and records no intent. State is derived from the inbox + receipt, so a
restart changes nothing.

**Architecture.** A deep module over existing seams: the transport is one adapter, the inbox and
`coordination_runs` stay the state, no new table/DTO/dependency. `FleetService.memberAddresses`
keeps one owner for member identity and skips executor resolution the listener does not need.
ADR-148 holds: no fourth `agent.run` surface, no user-visible transport choice.

**Residual risk (P4, advisory).** `history[].messageId` echoes the request key rather than the
caller's raw id (no client depends on it); the card is behind the same bearer token, deliberately —
member names are not public; a cancel marker is sticky per task id, which is safe because a canceled
request never re-dispatches.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-15T04:30:22.308Z todo → wip (system)
- 2026-11-15T04:37:27.855Z wip → testing (system)
- 2026-11-15T04:37:29.695Z testing → done (system)

