---
schema_version: 1
name: Inbox oRPC contract and server handler
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.645Z
updated_at: "2026-10-20T18:00:48.034Z"
feature_id: G11
priority: P1
tags:
  - inbox

dependencies: ["1266"]
estimate_hours: 5
---

## 1267. Inbox oRPC contract and server handler

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.2; ADR-143.

Sizing: about 5h (was 4h); contract, handler, a ledger relay for SSE, and the route deletions form one review surface.

Implements: R9 — The inbox API is a typed contract with read-only reads.

Depends on: 1266 (InboxService as the single writer).

**Verified surface (2026-10-20).**
- The oRPC router is `apps/server/src/router.ts`: `createRouter(ctx)` builds handlers per module (`modules/task/handlers.ts` is the pattern). `bootstrap.ts` serves it through `OpenAPIHandler` under `/api`. `/openapi.json` is generated at runtime, so no checked-in spec needs regenerating.
- Contracts live in `packages/contracts/src/<noun>.ts` and are spread into `contract` in `index.ts`. `packages/contracts/tests/contract.test.ts` pins their schemas.
- Raw Hono routes to delete:
  - `apps/server/src/modules/messages/index.ts`: `GET /api/messages`, `GET /api/messages/inbox`, `POST /api/messages`, `POST /api/messages/:id/reply` and `POST /api/messages/:id/read`. Registered in `modules/registry.ts:11,35`; tests are in `apps/server/tests/modules/messages/index.test.ts`.
  - `apps/server/src/modules/health/index.ts:439-530`: `GET /api/project/requests`. It composes orchestrator resolution, `DeliveryReconciler.classify`, `FleetGuestService.expire()` (a write inside a GET) and strategy holds. Tests are in `apps/server/tests/modules/health.test.ts`.
- `POST /api/messages` enforces the 0844 R4 project guard: a `projectPath` that differs from `ctx.cwd` returns 409 before any write.
- The SSE stream (`modules/events/index.ts`) relays only names on the in-process server bus. The Board therefore never sees `message.*` written by agent CLI processes (`spur message reply`, claim and settle). The agent loop already wakes from the ledger (`agent-loop-service.ts:162-180`), and `followSystemEventsAfter` (`system-event-follow.ts`) names "future Board SSE" as a consumer.
- Web callers of the deleted routes (`useProjectRequests.ts`, `conversation.ts`, `receipt.ts`, `MemberDetail.tsx`, `MemberTerminal.tsx`) belong to 1269. They use string fetches, so they still compile; their runtime break is closed by 1269 in the same release (plan §4, A6).

**Refine corrections (2026-10-20)**
- "guest expiry plus the claim sweep run in the reconciler pass" → the server has no reconciler pass. Sweep runs inside `DeliveryReconciler.reconcile`, on the orchestrator's strategy tick (1266) → `FleetGuestService.expire()` moves to the same non-readOnly tick in `StrategyRuntime.resume` (`strategy-runtime.ts:437-445`). The requests read becomes write-free.
- "`message.*` SSE events still reach the planning stream" → this holds only for server-side sends; agent-process replies never reach it → one server-scoped relay follows `system_events` rows with prefix `message` and re-emits them on the bus. The server's InboxService gets no bus, so nothing is emitted twice; this also amends the 1266 Design.
- "the generated OpenAPI is regenerated" → the spec is built at runtime (`bootstrap.ts:33`) → no regeneration step; assert that the inbox paths appear in `/openapi.json` instead.
- The task omitted the 0844 R4 project guard on send → the `send` input keeps an optional `projectPath`, and a mismatch is a CONFLICT (409) with no row written.
- "list, thread, send, reply, read, requests" → `requests` needs the orchestrator binding and strategy holds, which InboxService does not own → the handler composes `FleetService.resolveOrchestrator` + `InboxService.requests` + `StrategyRuntime.selectNext({readOnly})`, as the health block does today. No new service.
- Sizing goes from 4h to 5h because of the relay.

### Requirements

- [ ] R1. Add `packages/contracts/src/inbox.ts`, `inboxContract`, spread into `contract.inbox`. It uses transport DTOs only, and each procedure has a zod input and output:
  - `list` (GET; member, direction `in|out|both`, limit, cursor)
  - `thread` (GET; message id → root plus replies, oldest first)
  - `send` (POST; to defaults to the orchestrator, from defaults to `operator`, body, optional requestKey, optional projectPath)
  - `reply` (POST; id, from, body)
  - `read` (POST; id, reader)
  - `requests` (GET; limit)
  - `members` (GET; each inbox address with its queued and unread counts, for the 1269 member list)
- [ ] R2. Add `apps/server/src/modules/inbox/handlers.ts` (`createInboxHandlers(ctx)`) and mount it as `inbox` in `createRouter`. Handlers call `ctx.inbox()` (a new `ServerContext` factory, Bun-only, without a bus). Errors map to `ORPCError`: NOT_FOUND for an unknown or mis-addressed message, CONFLICT for a project mismatch, BAD_REQUEST for a reserved or unknown recipient.
- [ ] R3. GET procedures write nothing: no reconcile, no sweep and no guest expiry. `FleetGuestService.expire()` moves to the non-readOnly `StrategyRuntime.resume` tick.
- [ ] R4. Delete `apps/server/src/modules/messages/` and its registry entry, the `/api/project/requests` block in `modules/health/index.ts`, and their server tests. Rewrite the coverage as contract round-trips.
- [ ] R5. A server-scoped relay follows `system_events` rows with prefix `message` (snapshot at boot, then `followSystemEventsAfter`) and emits each row's payload on the server bus. `message.*` from any process therefore reaches `/api/events/planning` exactly once.

Out of scope: Board consumers (1269), CLI verbs (1268), and D1/Workers support for the inbox. It stays Bun-only; on Workers the procedures fail like the other stubCtx procedures.

### Acceptance Criteria

- [ ] AC1 — The inbox API is a typed contract with read-only reads

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-20T18:00:46.592Z

- **Q: Relay per SSE client or one per server?** Closed (2026-10-20): one per server. The bus already fans out to clients, and per-client polling multiplies DB reads.
- **Q: Keep a bus in InboxService for server-side sends?** Closed: no. The relay covers every process, and a bus emit would duplicate events. (Amends the 1266 Design.)
- **Q: Who expires guests once the GET stops writing?** Closed: the orchestrator's non-readOnly strategy tick, next to reconcile. With no orchestrator, nothing dispatches to guests, so nothing is stranded.

### Design

**WHAT.** One `inbox` oRPC router replaces six raw Hono routes, and one ledger relay makes `message.*` from every process visible on SSE.

**WHY.** H4: typed contracts, GETs without side effects, and one place for message validation. The relay exists because InboxService persists events in-transaction (1266). The ledger is the only source that sees agent-process writes, and the agent loop already wakes from it.

**WHERE.**
- `packages/contracts/src/inbox.ts`:
  - `inboxMessageSchema`: id, fromId, toId, body, kind, status, attempts, error, claimedAt, deliveredAt, readAt, inReplyTo, threadId, requestKey, taskId, parentRunId, createdAt.
  - `inboxRequestSchema` (the old requests row, renamed to the new columns): messageId, requestKey, status, attempts, error, runId, taskId, outcome, reason, hold.
  - `inboxMemberSchema`: id, queued, unread.
  - `inboxContract` with the paths `/inbox/messages`, `/inbox/messages/{id}/thread`, `/inbox/messages` (POST), `/inbox/messages/{id}/reply`, `/inbox/messages/{id}/read`, `/inbox/requests` and `/inbox/members`.
- `apps/server/src/modules/inbox/handlers.ts`: thin calls to `ctx.inbox()`. `requests` keeps today's composition and degraded `{ requests: [] }` states (no orchestrator, unresolvable).
- `apps/server/src/context.ts`: `inbox(): InboxService`, memoized like `coordination()`.
- `apps/server/src/modules/events/index.ts`: in `mount`, when `ctx` exists, start one `followSystemEventsAfter(ctx.getDb, { afterSequence: <latest at boot>, match: row => row.event_name.startsWith('message.') })` loop that does `bus.emit(row.event_name, parsedPayload)`. It is aborted by the server's existing shutdown signal (if none exists, an `AbortController` held by the module).
  - `ponytail:` one 100 ms poll for all clients. Switch to a push channel if the ledger poll shows up in profiles.
- `packages/app/src/services/strategy-runtime.ts` `resume`: when `!options.readOnly`, call `FleetGuestService.expire()` once after the member reconcile loop. A failure is logged and swallowed, as today.

**Anti-patterns.** No Hono alias routes (A6). No domain types in the contract. No writes in GET handlers. No bus emit from the server's InboxService, because the relay would emit it a second time.

### Plan

1. Failure modes first, in `apps/server/tests/modules/inbox.test.ts` (contract round-trips through `OpenAPILink` against `createApp` with an in-memory DB):
   - list and thread leave `inbox_messages`/`system_events` row counts unchanged;
   - send with a mismatched projectPath → 409 and no row;
   - send without `to` → the orchestrator, from `operator`;
   - read by a non-recipient → 404;
   - a reserved or unknown recipient → 400;
   - a `message.replied` row inserted directly into `system_events` (simulating an agent process) arrives once on `/api/events/planning`;
   - `/api/messages` and `/api/project/requests` → 404;
   - `/openapi.json` lists the inbox paths.
2. Contract and contract.test schema pins.
3. `ctx.inbox()`, handlers and router mount.
4. The ledger relay in the events module, and guest expiry on the strategy tick (extend `strategy-runtime` tests: a non-readOnly resume expires a stale guest, and a readOnly resume does not).
5. Delete the messages module, the health requests block and their tests.
6. `bun run spur-check`, then `bun run test-cf` (the Workers build must still compile with the stubCtx inbox handlers).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G11 R9; plan §3.2; ADR-143; `docs/design/inter-agent-control-plane.md` §13.
- Pattern: `apps/server/src/modules/task/handlers.ts`, `packages/contracts/src/task.ts`.
- Prior art: 0844 (project-scoped requests and the 409 guard), 1081 (guest expiry), 0531 (`followSystemEventsAfter`), 0839 (ledger wake).
- Depends on 1266; consumed by 1269.

### History
