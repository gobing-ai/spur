---
schema_version: 1
name: Inbox oRPC contract and server handler
status: done
template: feature-impl
created_at: 2026-10-20T06:59:42.645Z
updated_at: "2026-10-21T05:57:25.623Z"
feature_id: G11
priority: P1
tags:
  - inbox

dependencies: ["1266"]
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1267-verdict.json
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

- [x] R1. Add `packages/contracts/src/inbox.ts`, `inboxContract`, spread into `contract.inbox`. It uses transport DTOs only, and each procedure has a zod input and output:
  - `list` (GET; member, direction `in|out|both`, limit, cursor)
  - `thread` (GET; message id → root plus replies, oldest first)
  - `send` (POST; to defaults to the orchestrator, from defaults to `operator`, body, optional requestKey, optional projectPath)
  - `reply` (POST; id, from, body)
  - `read` (POST; id, reader)
  - `requests` (GET; limit)
  - `members` (GET; each inbox address with its queued and unread counts, for the 1269 member list)
- [x] R2. Add `apps/server/src/modules/inbox/handlers.ts` (`createInboxHandlers(ctx)`) and mount it as `inbox` in `createRouter`. Handlers call `ctx.inbox()` (a new `ServerContext` factory, Bun-only, without a bus). Errors map to `ORPCError`: NOT_FOUND for an unknown or mis-addressed message, CONFLICT for a project mismatch, BAD_REQUEST for a reserved or unknown recipient.
- [x] R3. GET procedures write nothing: no reconcile, no sweep and no guest expiry. `FleetGuestService.expire()` moves to the non-readOnly `StrategyRuntime.resume` tick.
- [x] R4. Delete `apps/server/src/modules/messages/` and its registry entry, the `/api/project/requests` block in `modules/health/index.ts`, and their server tests. Rewrite the coverage as contract round-trips.
- [x] R5. A server-scoped relay follows `system_events` rows with prefix `message` (snapshot at boot, then `followSystemEventsAfter`) and emits each row's payload on the server bus. `message.*` from any process therefore reaches `/api/events/planning` exactly once.

Out of scope: Board consumers (1269), CLI verbs (1268), and D1/Workers support for the inbox. It stays Bun-only; on Workers the procedures fail like the other stubCtx procedures.

### Acceptance Criteria

- [x] AC1 — The inbox API is a typed contract with read-only reads

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

One typed `inbox` oRPC namespace replaces six raw Hono routes, and one ledger relay makes `message.*` from every process visible on SSE.

**Contract (`packages/contracts`)**
- `packages/contracts/src/inbox.ts:1` (spread into the root contract at `packages/contracts/src/index.ts:37`): transport DTOs only — `inboxMessageSchema` (`from`/`to` non-null, `kind` chat|request, the guarded `status` ladder), `inboxMemberSchema`, `inboxRequestSchema`, and `inboxContract` with `list`, `thread`, `send`, `reply`, `read`, `requests`, `members`. Paths under `/inbox/…`; reads are GET, mutations POST.

**Server (`apps/server`)**
- `apps/server/src/context.ts:238,688`: `inbox()` — a memoized, Bun-only, deliberately **bus-less** `InboxService`. The relay owns fan-out, so a bus here would emit the server's own writes twice.
- `apps/server/src/modules/inbox/handlers.ts:1`: thin calls over `ctx.inbox()`, mounted as `inbox` in `apps/server/src/router.ts:19`. Errors are typed through one mapping (`apps/server/src/modules/inbox/handlers.ts:49`): NOT_FOUND for an unknown/mis-addressed message, CONFLICT for a project mismatch and a request-key payload conflict, BAD_REQUEST for an unresolvable recipient or a malformed cursor — and anything else stays a server error with fixed text rather than echoing an internal message as a 4xx.
- `apps/server/src/modules/inbox/handlers.ts:100`: `addressableRecipients` — a `send` to an address nothing owns is refused (reserved ids, agent specs, fleet members, joined guests, existing inboxes), so no undeliverable `queued` row is ever written. `send` defaults `to` to the bound orchestrator and `from` to `operator`; a project with no orchestrator is a refusal, not a silent drop. `list` pages by keyset cursor (`packages/contracts/src/inbox.ts:78`, `packages/app/src/services/inbox-service.ts:361`) and returns `{ messages, nextCursor }` — an offset window would duplicate a row when a message arrives between pages. `requests` keeps the health block's composition (`resolveOrchestrator` + `InboxService.requests` + a read-only `selectNext`) and its degraded `[]`.
- `apps/server/src/modules/events/index.ts:136,197`: one relay per server — snapshot `latestSequence()` at boot, then `followSystemEventsAfter` filtered to `message.` rows, re-emitting each row's payload on the bus. Rows written before boot stay history (the history endpoint replays them), and each live row is emitted exactly once.
- The SSE handler calls the stored-envelope-aware `projectStoredSystemEventEnvelope` at `apps/server/src/modules/events/index.ts:265` when the emitted value already *is* a v2 envelope (a relayed ledger row row), and only builds a fresh envelope otherwise. Without that, a relayed row rendered with an empty summary and no fields — live and history disagreed for the same row.
- `packages/app/src/services/system-event-tap.ts:76` — the tap skips the `message` prefix, so the inbox stays the single writer of those rows and the relay is the only fan-out.

**Writes moved off the read path (R3)**
- `packages/app/src/services/strategy-runtime.ts:318,440`: `StrategyRuntimeContext` gains `guestExpiry`; `resume` calls it only when `!readOnly`, beside the reconcile, and swallows a failure. `apps/cli/src/commands/agent/shared.ts:562` wires `FleetGuestService.expire()` there. `requests` therefore performs no guest expiry, no sweep and no reconcile.

**Deleted (R4)**
- `apps/server/src/modules/messages/` and its registry entry, the `/api/project/requests` block and its 107 lines in `apps/server/src/modules/health/index.ts`, and their tests. No alias routes (A6).

**Testability seam.** `fleetOver` honours a context-supplied `fleetService()`, so the handlers are testable without a `.spur` fleet file while production keeps the real `FleetService`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/contracts/src/inbox.ts:137-209` (`inboxContract`, seven procedures each with zod input and output); keyset `cursor` `packages/contracts/src/inbox.ts:74`, `{ messages, nextCursor }` `packages/contracts/src/inbox.ts:78-81`, `members` declares `z.object({})` `packages/contracts/src/inbox.ts:207`; spread at `packages/contracts/src/index.ts:37`; pinned by `packages/contracts/tests/contract.test.ts:405-414`; keyset pages `apps/server/tests/modules/inbox/handlers.test.ts:283` and `apps/server/tests/modules/inbox/handlers.test.ts:305` |
| R2 | MET | Mounted as `inbox` at `apps/server/src/router.ts:44` over the bus-less `ctx.inbox()` `apps/server/src/context.ts:688`; one error mapping `apps/server/src/modules/inbox/handlers.ts:49-63`; recipient set `apps/server/src/modules/inbox/handlers.ts:106-126` and guard `apps/server/src/modules/inbox/handlers.ts:188-192`; tests `apps/server/tests/modules/inbox/handlers.test.ts:148` (409 projectPath), `apps/server/tests/modules/inbox/handlers.test.ts:160` (unknown recipient, no row), `apps/server/tests/modules/inbox/handlers.test.ts:218` (non-recipient read 404), `apps/server/tests/modules/inbox/handlers.test.ts:238` (fixed-text 500) |
| R3 | MET | Reads are `list`/`thread`/`requests`/`members` only (`apps/server/src/modules/inbox/handlers.ts:157`, `apps/server/src/modules/inbox/handlers.ts:169`, `apps/server/src/modules/inbox/handlers.ts:233`, `apps/server/src/modules/inbox/handlers.ts:275`); `apps/server/tests/modules/inbox/handlers.test.ts:112` asserts both ledger row counts unchanged across all four; guest expiry write-side behind `!options.readOnly` `packages/app/src/services/strategy-runtime.ts:440`; tap skips the message prefix `packages/app/src/services/system-event-tap.ts:76` |
| R4 | MET | No `messages` module in `apps/server/src/modules/` and none in the registry `apps/server/src/modules/registry.ts:29-42`; no `requests` match in `apps/server/src/modules/health/index.ts`; retirement test mounts `healthModule` with a real context `apps/server/tests/modules/inbox/handlers.test.ts:334-349`; `/openapi.json` carries the inbox paths instead `apps/server/tests/modules/inbox/handlers.test.ts:351` |
| R5 | MET | One relay per context, snapshot then `followSystemEventsAfter` on the `message.` prefix `apps/server/src/modules/events/index.ts:134-175`, emitting each row once `apps/server/tests/modules/events/index.test.ts:345-396`; the stream projects stored v2 rows through `projectStoredSystemEventEnvelope` with the row's own actor and timestamp `apps/server/src/modules/events/index.ts:260-288`, matching the history projection `apps/server/tests/modules/events/index.test.ts:398-474` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The inbox API is a typed contract with read-only reads | MET | test | `packages/contracts/tests/contract.test.ts:405-414` (seven typed procedures), `apps/server/tests/modules/inbox/handlers.test.ts:112` (four reads leave both ledger tables untouched), `apps/server/tests/modules/inbox/handlers.test.ts:283` (keyset pages cover every row once), `apps/server/tests/modules/events/index.test.ts:345-396` (relay emits one row once), `apps/server/tests/modules/events/index.test.ts:398-474` (relayed frame equals its history row) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1267 (G11 R9: inbox oRPC contract and server handler) — confirmation pass

**Scope:** uncommitted working tree on top of `8064812d3` — the same 14 modified/deleted files plus `packages/contracts/src/inbox.ts` and `apps/server/src/modules/inbox/`. This pass re-probes the five findings of the previous round and the code each fix touched; it does not re-audit the rest of the task.
**Dimensions:** functional traceability (R1–R5, AC1), security, correctness, efficiency, usability, architecture.
**Verdict:** PASS
**Confidence:** MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | **Fixed.** Relayed `message.*` rows now project through the stored-envelope helper instead of re-building from raw data. Probed on a migrated DB with a capturing bus: a stored v2 `message.replied` envelope renders live as summary `[message] proj-coder replied in msg_root`, `data {status,msgId,fromId,toId,threadId}` and all four fields — deep-equal to the history payload for the same row; a real `InboxService` row (raw payload, no `schemaVersion`) renders identically on both paths through the shared builder. | `apps/server/src/modules/events/index.ts:262-272` (history at `:385`) | RESOLVED |
| 2 | P3 (minor) | security | **Fixed — the leak half.** A service throwing `database is locked: /var/db/spur.sqlite` now answers `400 "the mailbox rejected this message"` (`send`) and `404 "message not found for this reader"` (`reply`, `read`): the internal string appears in no response, and `MessageNotFoundError`/`RequestKeyConflictError` are matched by type instead of by message text. The classification half is finding 6. | `apps/server/src/modules/inbox/handlers.ts:49-63` | RESOLVED |
| 3 | P3 (minor) | functional | **Fixed.** `send` resolves the recipient against reserved ids, agent specs, joined guests and existing inbox addresses, and refuses anything else. Over HTTP: `POST /api/inbox/messages {"to":"nobody-at-all"}` → 400 naming the reason, with `inbox_messages` and `system_events` both still at 0 rows. An address that already owns a row (inserted straight through the service) stays addressable, so the guard cannot orphan legacy mail. | `apps/server/src/modules/inbox/handlers.ts:100-125`, `:178-184` | RESOLVED |
| 4 | P3 (minor) | functional | **Fixed.** `list` takes the keyset `cursor` and returns an object of `messages` plus `nextCursor`; `members` declares `z.object({})`. `/openapi.json` shows `member`, `direction`, `limit` and `cursor` query parameters on `GET /inbox/messages`, a 200 schema carrying both response fields, and the six `/inbox/*` paths with neither retired path. Two pages cover three rows exactly once. | `packages/contracts/src/inbox.ts:69-81`, `:198-209` | RESOLVED |
| 5 | P3 (minor) | correctness | **Fixed.** The retirement test mounts `healthModule` with the real harness context and only then asserts 404. Probed: with that ctx `/api/health` answers 200 while `/api/project/requests` answers 404, and `builtins` carries no `messages`; the pre-fix module registered that route and returned `{requests: []}` whenever ctx existed (`git show HEAD:apps/server/src/modules/health/index.ts:438-441`), so the assertion now fails closed instead of passing on a missing ctx. | `apps/server/tests/modules/inbox/handlers.test.ts:285-300` | RESOLVED |
| 6 | P3 (minor) | correctness | **Resolved by the fix, not by the deferral.** A malformed cursor now answers BAD_REQUEST `the list cursor is malformed`, and the classification half is fixed too: the service throws the typed `MessageNotFoundError` (so the transport matches by type) and `toOrpcError` sends anything else — a locked DB, a broken adapter — to INTERNAL_SERVER_ERROR with fixed text, so a client that retries on 5xx no longer gives up. | `apps/server/src/modules/inbox/handlers.ts:49-70`; `packages/app/src/services/inbox-service.ts` (`reply`, `markRead`) | RESOLVED |
| 7 | P4 (advisory) | correctness | **New — residue of finding 1.** Summary, fields, data and correlation are now identical live vs history; the one remaining delta is `presentation.agent`. History reads the `system_events.actor` column, the relay emits the payload alone, and `extractSystemEventActor` finds no `actor`/`agentId`/`memberId` on a message payload (it carries `fromId`/`toId`), so live message rows show `agent: -` where history shows the member. | `apps/server/src/modules/events/index.ts:153`, `:257-272`; consumer `apps/web/src/modules/observability/SystemEventsTab.tsx:455` | DEFER(1269 — the Board renders the chip; carry `row.actor` through the relay) |
| 8 | P4 (advisory) | correctness | **New — test coverage.** The relay test inserts a raw `{msgId,fromId,toId}` row, so it exercises the builder fallback and not the `'schemaVersion' in event` branch the fix added; I verified that branch by hand with a stored v2 envelope (finding 1) and no suite case pins it. | `apps/server/tests/modules/events/index.test.ts:345-395`; branch at `apps/server/src/modules/events/index.ts:264` | ACCEPTED |

##### Verification evidence (this pass)

- `apps/server`: `bun test tests/modules/inbox/handlers.test.ts tests/modules/events/index.test.ts tests/modules/registry.test.ts tests/modules/health.test.ts --preload ./tests/setup.ts` → 77 pass / 0 fail.
- `packages/contracts`: `bun test` → 92 pass / 0 fail.
- Hand probes on a temporary harness (migrated in-memory DB, deleted after the run): relay on a stub ctx with a capturing bus reading the real SSE stream; error injection into `send`/`reply`/`read`; unknown-recipient row counts; `generateOpenApiSpec()`; `createApp(undefined, { ctx })` HTTP statuses. Each finding above quotes its own result.
- Not re-run — accepted from the implementer's gate: `bun run spur-check` 11532 pass / 0 fail, `bun run test-cf` exit 0, `bun run fleet-e2e` 9/9 legs.

##### Functional traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Seven procedures, each with a zod input and output (`packages/contracts/src/inbox.ts:126-209`), spread into `contract.inbox` (`packages/contracts/src/index.ts:37`) and pinned by `packages/contracts/tests/contract.test.ts:405-414`. `list` pages by keyset `cursor` and returns `{ messages, nextCursor }` (`inbox.ts:74`, `:78-81`; `packages/app/src/services/inbox-service.ts:361-376`); `members` declares `z.object({})` (`inbox.ts:207`). `/openapi.json` carries the four list query parameters and the `{messages,nextCursor}` 200 schema. |
| R2 | MET | `createInboxHandlers(ctx)` mounted as `inbox` over the bus-less `ctx.inbox()` (`apps/server/src/router.ts:44`; `apps/server/src/context.ts:688`). Mapping at `apps/server/src/modules/inbox/handlers.ts:49-63`: NOT_FOUND for an unknown or mis-addressed message, CONFLICT for a project mismatch and a request-key payload conflict, BAD_REQUEST for an unresolvable recipient. Verified over HTTP: 200 list, 400 unknown recipient (0 rows), 409 mismatched `projectPath`, 404 unknown id, 404 non-recipient read. Reserved ids stay valid addresses, as the contract documents (`packages/contracts/src/inbox.ts:85-90`). |
| R3 | MET | Reads reach only `list`, `thread`, `requests` and `members` (`handlers.ts:151-264`); `apps/server/tests/modules/inbox/handlers.test.ts:112` asserts both `inbox_messages` and `system_events` counts unchanged across all four. Guest expiry is write-side only, behind `!options.readOnly` (`packages/app/src/services/strategy-runtime.ts:440`), and the message prefix is skipped by the persistence tap (`packages/app/src/services/system-event-tap.ts:76`). `requests` composes the read-only `classify` plus `selectNext({ readOnly: true })`. |
| R4 | MET | `apps/server/src/modules/messages/` and its registry entry are gone (`apps/server/src/modules/registry.ts:29-42`), as is the health module's requests block (`apps/server/src/modules/health/index.ts` now jumps from the project routes to `/api/projects`). `/api/messages*` and `/api/project/requests` answer 404, and `/openapi.json` carries neither path. Test fidelity is finding 5. |
| R5 | MET | One relay per context: snapshot then `followSystemEventsAfter` with the `message.` prefix (`apps/server/src/modules/events/index.ts:122-160`), exactly-once proven at `apps/server/tests/modules/events/index.test.ts:345-395`, transmitted through the stored-envelope projection so live and history agree for one row (finding 1). The `agent` chip delta is finding 7. |

AC1 — "The inbox API is a typed contract with read-only reads" — MET: the contract tests pin the seven typed procedures and their DTOs, the handler tests pin the write-free reads and the keyset pagination, and the relay tests pin the live path.

##### Residual risk

- **Cross-channel duplicate window.** A client that reads `/api/events/history` and then subscribes can see one row twice if it lands inside that window. Pre-existing for every event family; "exactly once" holds per channel, not across both.
- **Pre-boot rows are history only.** A client that never queries history sees no message traffic written while the server was down.
- **Guest expiry depends on an orchestrator tick.** A deployment running `spur serve` with no agent orchestrator expires no guest lease; the task's Q&A records this as by design.
- **Error classification (finding 6) — closed.** A transient DB fault during `send`/`reply`/`read`/`list` reaches the client as INTERNAL_SERVER_ERROR with fixed text, so a retry-on-5xx client behaves correctly, and a fabricated cursor is the BAD_REQUEST the Design names.
- **Live message rows carry no `agent` label (finding 7)** while the same row in history does; the System Events tab renders the difference.
- **Relay unmeasured under load.** One 100 ms ledger poll for all clients, no profile evidence recorded, and its `AbortController` is never aborted (re-checked: unchanged since round 1).
- **Round-1 advisories still open by design:** `coordination()` remains bus-wired with no module consumer (`apps/server/src/context.ts:660-672`), the only place a server-side `message.*` bus emit could reappear and bypass the relay; and the suite still invokes `~orpc.handler` directly rather than through `OpenAPILink`, which this pass mitigated with hand probes over `createApp` rather than with a repeatable HTTP test.
- **1269 is the release gate for the deleted paths.** The web modules still fetch them and still compile, so the break is runtime-only until 1269 lands.

##### Carried to dependent work

- **1269 (Board consumers):** `apps/web/src/modules/projects/useProjectRequests.ts:52`, `conversation.ts:99`, `receipt.ts:27`, `MemberDetail.tsx:16` and `MemberTerminal.tsx:125` still fetch `/api/messages*` and `/api/project/requests`; `apps/web/tests/modules/projects/useProjectRequests.test.ts:33` still stubs the retired path. Out of scope here by plan §4/A6.
- **1269 also owns findings 7 and 8:** the live Board view shows no `agent` chip on message rows (the actor lives in the `system_events` column, not in the relayed payload), and a relayed v2-envelope row has no suite case.
- **1268 (CLI verbs):** unchanged by this task; a CLI client can now page by cursor and retry on 5xx, because finding 6 was fixed rather than deferred.
- **Task-file wording:** R2's "reserved or unknown recipient" is settled in the code as "unknown recipient refused, `operator`/`spur` are valid addresses" (`packages/contracts/src/inbox.ts:85-90`); the requirement line still reads the old way.

##### Disposition

PASS. All five findings are fixed and re-verified by probe rather than by reading the diff: the relay now renders one stored row identically live and in history, the internal error string no longer reaches a client, an unknown recipient is refused with no row written, `list` pages by keyset cursor with a declared `members` input and both are visible in `/openapi.json`, and the retirement test fails closed on a live context. Three residuals are recorded and none blocks: finding 6 (error classification versus the amended Design text, deferred to the 1267 follow-up), finding 7 (`presentation.agent` on live message rows, deferred to 1269) and finding 8 (one missing relay test case, accepted). No P1 or P2 is open, so `done` is not held by this section; the two DEFER rows make the disposition-derived confidence MEDIUM rather than HIGH.

**Next:** land finding 6 with the 1269 wire work (or correct the Design sentence), and hand 1269 the four web call sites plus the two live-view deltas.

### References

- Feature G11 R9; plan §3.2; ADR-143; `docs/design/inter-agent-control-plane.md` §13.
- Pattern: `apps/server/src/modules/task/handlers.ts`, `packages/contracts/src/task.ts`.
- Prior art: 0844 (project-scoped requests and the 409 guard), 1081 (guest expiry), 0531 (`followSystemEventsAfter`), 0839 (ledger wake).
- Depends on 1266; consumed by 1269.

### History

- 2026-10-20T22:50:02.166Z todo → wip (system)
- 2026-10-20T23:42:19.242Z wip → testing (system)
- 2026-10-20T23:42:21.648Z testing → done (system)

