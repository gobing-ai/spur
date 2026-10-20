---
schema_version: 1
name: Inbox domain schema and InboxService as the single writer
status: done
template: feature-impl
created_at: 2026-10-20T06:59:42.639Z
updated_at: "2026-10-20T22:04:35.784Z"
feature_id: G11
priority: P1
tags:
  - inbox

estimate_hours: 12
done_forced: "false"
done_reason: unforced close
---

## 1266. Inbox domain schema and InboxService as the single writer

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.1; ADR-143; design inter-agent-control-plane.md §13.

Sizing: about 12h (incl. the fleet round-trip E2E), one cohesive unit (schema + DAO + service + repointing every direct caller). Splitting would leave the tree uncompilable between steps because the ts-db `InboxMessageDao` export is removed here.

Implements: R1 — A sent message and its event commit atomically; R2 — Only the inbox data-access layer touches the inbox table; R3 — Status transitions are guarded; R4 — An expired claim is requeued and eventually fails; R5 — A repeated request key produces one message; R6 — A reply always reaches the original sender; R7 — System-originated messages use the spur sender; R8 — Chat messages are never reported as unresolved work; R13 — Agent runs claim and settle through the service; R19 — Queued messages survive a member process restart; R20 — A fleet dispatch completes a round trip through the member inbox; R21 — Every member consumer claims and settles through the inbox service.

Runs first; every other G11 task depends on it.

Current inbox writers and readers (verified 2026-10-20): `packages/domain/src/dao/index.ts:1` (ts-db re-export), `inbox-recent-dao.ts`, `inbox-unfinished-dao.ts`, `addressed-spec-ids.ts:15`, `agent-coordination-service.ts:620-655`, `delivery-reconciler.ts:60-131`, `strategy-runtime.ts:59-70,546-570,785-803`, `fleet-guest-service.ts:237-266`, `fleet-dispatcher.ts:74-83`, `apps/cli/src/commands/agent/shared.ts:359-470`, `apps/server/src/modules/health/index.ts` (requests block), and `scripts/commands/fleet-e2e.ts:56,546-548`. The Board (`apps/web/.../conversation.ts`, `receipt.ts`) belongs to 1269.

**Refine corrections (2026-10-20)**
- "Remove the 0043/0053 skip special-cases" → the guards (`migrations.ts:1906-1910`) still protect legacy journals that lack the table; 0043 and 0053 run before 0054 → keep them; 0054 is `DROP TABLE IF EXISTS` + `CREATE`, and the historical 0000/0001 DDL stays frozen.
- "The sweeper is invoked by the existing server reconciler pass" → no server pass exists; `DeliveryReconciler.reconcile` runs at agent-loop start (`agent-loop-service.ts:406`) and on each strategy tick (`strategy-runtime.ts:437-445`) → sweep runs inside `reconcile`.
- "The sweeper requeues every claimed row past the lease" → 0834 R2 forbids requeueing ambiguous work (`agent-loop-service.ts:400-403`); a claimed row with a run receipt already ran → sweep requeues only claimed rows with no `coordination_runs` row and settles the others by their receipt.
- "fleet-dispatcher sends as `spur`" → strategy dispatches send from the orchestrator member address so member replies reach a live inbox (`fleet-dispatcher.ts:24-29`) → only workflow dispatches (`workflow-<runId>`) switch to `spur`; the feature R7 scenario body is aligned (its title is unchanged).
- "Repoint addressed-spec-ids to the service" → it lives in `packages/domain`, which cannot import `packages/app` → its inbox query moves into `InboxDao.distinctRecipients()`.
- "The keyed write-slot hold in agent-loop-service parses request_key" → the parsing is in `strategy-runtime.ts` (`fleetTaskWbs` :68/:567 and `readAttempts` :785-803); agent-loop-service only forwards the key verbatim to `runFleetWorkItem` (:474, :523), which is not parsing → replace the strategy-runtime parsers with the `task_id` column.
- "Write the event row in the transaction, then fan out on the bus" → on the server, the tap persists every catalog name it hears (`system-event-tap.ts:67-100`), so a bus emit would write a second row → the tap skips the `message` prefix.
- "Transactions via the domain adapter transaction helper" → the helper is ts-db `BaseDao.tx()` (`node_modules/@gobing-ai/ts-db/src/base-dao.ts:33`); the inbox is Bun-only (`apps/server/src/modules/messages/index.ts:19`), so interactive transactions are available.
- "Write a new fleet round-trip E2E" → `bun run fleet-e2e` (`scripts/commands/fleet-e2e.ts`, task 1077) already proves the inbox-only fleet, including the operator and guest-pull legs → extend that harness instead.
- Sizing 10h → 12h (tap skip, strategy-runtime parsers and the fleet-e2e repoint added).

### Requirements

- [x] R1. Migration `0054_spur_cli_inbox_messages_rebuild` (embedded in `CLI_MIGRATIONS` plus its `drizzle/` mirror) runs `DROP TABLE IF EXISTS inbox_messages` and recreates the table with the §13 columns and indexes. The 0000/0001/0043/0053 entries and the 0043/0053 table-absence guards stay unchanged.
- [x] R2. Add a Spur-owned drizzle schema and `InboxDao` in `packages/domain`. Delete `InboxRecentDao`, `InboxUnfinishedDao` and the ts-db `InboxMessageDao` re-export. `listAddressedSpecIds` reads inbox recipients through `InboxDao.distinctRecipients()`.
- [x] R3. Add `InboxService` in `packages/app` (send, reply, claim, settle, release, sweep, markRead, list, thread, requests, countQueued, members, attempts). Each mutation writes its row and one `system_events` row per changed message in one transaction. It has no bus: consumers follow the ledger, and 1267 relays `message.*` to SSE. The server tap does not persist `message.*`.
- [x] R4. Guard every transition by its prior status; a guard miss changes nothing and writes no event. `sweep(now)` requeues a `claimed` row past the lease only when no `coordination_runs` row lists it, and moves it to `failed` once `attempts` reaches `MAX_DELIVERY_ATTEMPTS`. A claimed row that has a run row is settled from the run outcome.
- [x] R5. Reserve `operator` and `spur`: agent spec loading and guest join reject them as ids; `from_id` is never null; a reply targets the original `from_id` and inherits `thread_id`.
- [x] R6. Repoint every direct caller to the service: AgentCoordinationService messaging; DeliveryReconciler (kind = request, one join, sweep inside `reconcile`); strategy-runtime; fleet-guest-service; fleet-dispatcher (`kind`, `taskId`, `parentRunId`; strategy sender stays the orchestrator member, workflow sender becomes `spur`); addressed-spec-ids; the health requests block; the CLI agent drain/settle; and `scripts/commands/fleet-e2e.ts`.
- [x] R7. Catalog `message.claimed|delivered|failed|requeued` beside the existing `message.sent|replied|read` in `packages/app/src/services/event-names.ts`. Delete the TeamOrchestrator/MessageStore legacy tests.
- [x] R8. Key every inbox by fleet member address (`<project-slug>-<member-id>`, one per replica slot) or a non-fleet address (hand-authored spec, guest id, `operator`, `spur`); never by process, run or generation id, so a respawned process drains the same inbox.
- [x] R9. Fleet dispatch (strategy tick via FleetDispatcher, and workflow agent.run with executor fleet via dispatchToFleet) completes through the member inbox: claim, run, settle, a run receipt linking the message id and `task_id`, and dispatcher receipt resolution.
- [x] R10. Every member consumer goes through InboxService: `spur agent loop` (the agent-loop-service drain/settle port), `spur agent run`, and guest pull (`spur agent wait --inbox`). The strategy-runtime keyed write-slot hold and attempt count read `task_id`, not a request_key regex. Guest retire releases claimed messages via the service.

Out of scope: the oRPC contract and the deletion of `apps/server/src/modules/messages` (1267); the `spur message` CLI verbs and docs (1268); the Board and doc cleanup (1269); retention of delivered rows; upstream ts-db deprecation.

### Acceptance Criteria

- [x] AC1 — A sent message and its event commit atomically
- [x] AC2 — Only the inbox data-access layer touches the inbox table
- [x] AC3 — Status transitions are guarded
- [x] AC4 — An expired claim is requeued and eventually fails
- [x] AC5 — A repeated request key produces one message
- [x] AC6 — A reply always reaches the original sender
- [x] AC7 — System-originated messages use the spur sender
- [x] AC8 — Chat messages are never reported as unresolved work
- [x] AC9 — Agent runs claim and settle through the service
- [x] AC10 — Queued messages survive a member process restart
- [x] AC11 — A fleet dispatch completes a round trip through the member inbox
- [x] AC12 — Every member consumer claims and settles through the inbox service

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-20T17:57:26.891Z

- **Q: Who sends strategy dispatches?** Closed (2026-10-20): the orchestrator member address, unchanged. Member replies must reach a live inbox. `spur` is only for senders with no member identity (workflow runs, system paths).
- **Q: Requeue claimed rows that already have a run receipt?** Closed: no. The receipt settles them, which keeps 0834 R2: ambiguous work is never re-dispatched.
- **Q: Make the claim lease configurable?** Deferred: `CLAIM_LEASE_MS = 600_000` with a constructor override for tests. Add a config key when a slow agent needs one.
- **Q: How do in-transaction events avoid duplicates on the server?** Closed: the tap skips the `message` prefix, and the service persists and then emits for SSE.

#### Q&A entry — 2026-10-20T18:00:45.560Z

- **Q: Who sends strategy dispatches?** Closed (2026-10-20): the orchestrator member address, unchanged. Member replies must reach a live inbox. `spur` is only for senders with no member identity (workflow runs, system paths).
- **Q: Requeue claimed rows that already have a run receipt?** Closed: no. The receipt settles them, which keeps 0834 R2: ambiguous work is never re-dispatched.
- **Q: Make the claim lease configurable?** Deferred: `CLAIM_LEASE_MS = 600_000` with a constructor override for tests. Add a config key when a slow agent needs one.
- **Q: How do in-transaction events avoid duplicates on the server?** Closed: the tap skips the `message` prefix, and InboxService never emits on a bus. 1267 relays `message.*` from the ledger to SSE, which also covers writes from agent processes.

### Design

**WHAT.** One `InboxDao` (domain) holds all inbox SQL. One `InboxService` (app) is the only caller of `InboxDao` and the only producer of `message.*` events. Every existing inbox reader and writer is repointed to it.

**WHY.** Split ownership is the root cause of C1–C5/H1–H7: the ts-db DAO, two Spur read DAOs, raw SQL in five modules, and regex parsing of `request_key`. One writer makes atomicity, guarded transitions and member keying enforceable in one place (ADR-143).

**WHERE (frozen names).**
- `packages/domain/src/schema/inbox-messages.ts`: drizzle `inboxMessages` with the §13 columns: `id`, `from_id NOT NULL`, `to_id NOT NULL`, `body`, `kind` (`chat`|`request`), `status` (`queued`|`claimed`|`delivered`|`failed`), `claimed_at`, `attempts`, `error`, `delivered_at`, `read_at`, `in_reply_to`, `thread_id`, `request_key`, `task_id`, `parent_run_id`, `created_at`, `updated_at`. Indexes: `(to_id, status)`, `(from_id, created_at)`, `(thread_id)`, and a partial unique index on `request_key`. Exported type `InboxMessage`.
- `packages/domain/src/migrations.ts`: `INBOX_MESSAGES_REBUILD_SQL` plus the entry `{ id: '0054_spur_cli_inbox_messages_rebuild' }`, mirrored in `drizzle/0054_spur_cli_inbox_messages_rebuild.sql`.
- `packages/domain/src/dao/inbox-dao.ts`: `InboxDao extends` the ts-db `BaseDao`. Each mutation takes `toEvent: (row: InboxMessage) => CreateSystemEventInput` and, inside `this.tx()`, writes the row change and one `system_events` row per changed row through the same tx handle. The statement is the `SystemEventDao.insert` SQL, extracted as the exported `systemEventInsertSql(input)` in `system-event-dao.ts` and reused by both.
  - Methods: `insert`, `findByRequestKey`, `get`, `claim(member, limit, now)` (the guarded `UPDATE … WHERE status='queued' … RETURNING`), `settle(ids, to: 'delivered'|'failed', error?)` (guard `status='claimed'`), `release(ids)` (claimed → queued), `markRead(id, reader)` (guard `read_at IS NULL AND to_id = reader`), `listExpiredClaims(cutoff)`, `list(member, direction, page)`, `thread(threadId)`, `requests(toIds)`, `countQueued(member)`, `attemptsForTask(taskId)`, `distinctRecipients()`.
- `packages/app/src/services/inbox-service.ts`: `InboxService` with `RESERVED_INBOX_IDS = ['operator', 'spur']`, `MAX_DELIVERY_ATTEMPTS = 3` (replaces `MAX_INJECT_ATTEMPTS`; re-exported from `packages/app/src/index.ts`) and `CLAIM_LEASE_MS = 600_000`. The constructor takes `{ getDb, leaseMs?, now? }`. It has no bus: consumers follow the ledger (the agent-loop wake, and the 1267 SSE relay).
  - `send({from,to,body,kind,requestKey?,taskId?,parentRunId?}) → {message, replayed}`
  - `reply(id, from, body) → InboxMessage` (to = original `from_id`, `thread_id` inherited)
  - `claim(member, limit) → InboxMessage[]`
  - `settle(ids, outcome: 'accepted'|'not-started')`
  - `release(ids)`
  - `sweep(now) → {requeued, failed, settled}`
  - `markRead(id, reader)`
  - `list(member, direction: 'in'|'out'|'both', page)`
  - `thread(id)`
  - `requests(orchestrator)`
  - `countQueued(member)`
  - `members() → {id, queued, unread}[]` (`InboxDao.distinctRecipients()` returns these counts in one grouped query over `to_id`; `addressed-spec-ids` maps it to ids, and it backs the 1267 `members` procedure)
  - `attempts(taskId) → {count, latest}`
  - After commit, the service prunes the `message` prefix with `ensureRetentionQuotaForPrefix`.
- `packages/app/src/services/system-event-tap.ts`: skip catalog entries whose `prefix === 'message'`, because `InboxService` persists them in-transaction.
- `packages/app/src/services/fleet-dispatcher.ts`: `FleetDispatchRequest` gains `taskId?` and `parentRunId?`. `enqueue` sends `kind: 'request'`. Strategy dispatches keep `fromId = orchestratorId`, and `dispatchToFleet` sends `fromId: 'spur'` with `parentRunId = runId`.
- Reserved-id checks:
  - `AgentCoordinationService.listAgentSpecs` errors on and drops a spec whose id is reserved.
  - `FleetGuestService.join` refuses a reserved id.

**Algorithms.**
- `sweep(now)`: for each `claimed` row with `claimed_at < now - leaseMs`:
  - Its newest `coordination_runs` row (`listByMessageId`) is completed: settle it `delivered` (outcome `verified`/`run-exit-only`) or `failed` (`errored`).
  - That run row is still `running`: leave the message claimed.
  - It has no run row: requeue it if `attempts < MAX_DELIVERY_ATTEMPTS`, otherwise mark it `failed` with error `attempts exhausted`.

  `DeliveryReconciler.reconcile` calls `sweep` before `classify`, and `classify` reads only `kind = 'request'` rows with one `LEFT JOIN coordination_runs`.
- `claim` increments `attempts` and sets `claimed_at`. `send` with an existing `requestKey` returns the stored row with `replayed: true` and writes no event.

**Handoff to dependents.**
- 1267: wraps `list`, `thread`, `send`, `reply`, `markRead` and `requests` in the oRPC contract, and deletes `apps/server/src/modules/messages`. The health requests block is repointed here and deleted there.
- 1268: wraps the same service methods in CLI verbs.
- 1269: consumes the contract. `MessageEventPayload` keeps its field names, and `threadId` becomes the root id.

**Anti-patterns.**
- No second write path: no raw `inbox_messages` SQL outside `InboxDao`, and no ts-db import.
- No parsing of `request_key` anywhere; pass it verbatim or read `task_id`/`parent_run_id`.
- No bus emit at all; the ledger is the only event channel for `message.*`.
- No process, run or generation id as `to_id`.
- No config key for the lease yet.
- No compatibility shim for old rows (A6).

### Plan

0. Precondition: `bun install --frozen-lockfile` is clean and `git status` shows only this task's files (the unrelated `commit-guard.test.ts` edit is not ours; leave it alone).
1. Write the failure modes first as E2E service tests against an in-memory migrated DB (`packages/app/tests/services/inbox-service.test.ts`):
   - an event insert failure rolls back the row;
   - a guard miss writes nothing;
   - lease expiry requeues, and `MAX_DELIVERY_ATTEMPTS` fails the row;
   - a claimed row with a running receipt is left alone, and one with a completed receipt is settled;
   - a repeated request key returns one row with `replayed`;
   - a reply to an `operator` message lands in `operator`'s inbox;
   - reserved ids are refused;
   - a chat row is never unresolved;
   - claim → restart → the same member address drains the remaining rows.
   (R1–R8)
2. Migration 0054 (embedded entry plus the drizzle mirror), schema and `InboxDao`. Extend `packages/domain/tests/dao/migrations.test.ts` with a legacy DB holding the pre-0054 table: 0054 rebuilds it, and a DB without the table still migrates. (R1, R2)
3. `systemEventInsertSql`, `InboxService`, the four new catalog names, and the tap `message` skip. (R3, R4, R7)
4. Repoint callers in this order: delivery-reconciler (sweep + classify join) → agent-coordination-service → fleet-dispatcher / dispatchToFleet → strategy-runtime (`attempts`, keyed hold reads `task_id`) → fleet-guest-service → addressed-spec-ids → health requests block → CLI `agent/shared.ts` drain/settle → `scripts/commands/fleet-e2e.ts`. Then delete `InboxRecentDao`, `InboxUnfinishedDao`, the re-export and the TeamOrchestrator/MessageStore tests, and update the affected CLI/app/domain tests that seed `inbox_messages` to seed through `InboxService`. (R5, R6, R8, R10)
5. Run `bun run fleet-e2e` to cover the strategy dispatch, workflow executor=fleet, operator and guest-pull legs. Its receipt is the feature's repeatable round-trip artifact; record its path in Testing. (R9, R10)
6. `rg -n "inbox_messages|InboxMessageDao|InboxUnfinishedDao|InboxRecentDao" -g '!docs/**' -g '!drizzle/**'` shows only `inbox-dao.ts`, `migrations.ts` and the schema file. Then run `bun run spur-check`.

### Solution

One inbox per fleet member address, with a Spur-owned schema, one DAO and one service as the only writer (ADR-143).

**Domain (`packages/domain`)**
- `packages/domain/src/schema/inbox-messages.ts:49` (`INBOX_MESSAGES_TABLE_SQL`): the §13 table — non-null `from_id`/`to_id`, `kind` (chat|request), guarded `status` ladder, `claimed_at`/`attempts`/`error`, `read_at`, `in_reply_to`/`thread_id`, `request_key`, `task_id`, `parent_run_id`. Indexes: `(to_id,status)`, `(from_id,created_at)`, `(thread_id)`, partial unique `request_key`. Exported as `INBOX_MESSAGES_TABLE_SQL`.
- `packages/domain/src/migrations.ts:95` + `packages/domain/src/migrations.ts:1686` (0054) and `drizzle/0054_spur_cli_inbox_messages_rebuild.sql`: `DROP TABLE IF EXISTS` then the new DDL, so a fresh 0001-shaped DB and a table-less legacy journal converge. The 0043/0053 guards and the historical 0000/0001 DDL stay untouched.
- `packages/domain/src/dao/inbox-dao.ts:164`: the only module naming `inbox_messages`. Every mutation runs `BEGIN IMMEDIATE` → guarded `UPDATE/INSERT … RETURNING` → one `system_events` row per returned row → `COMMIT`; a failed event insert rolls the row back, and a guard miss emits nothing. Transactions chain on a per-adapter `WeakMap` lock (`packages/domain/src/dao/inbox-dao.ts:176`) so two consumers on one connection serialize instead of nesting `BEGIN`.
- `packages/domain/src/dao/system-event-dao.ts:291`: `systemEventInsertSql(input)` extracted so `insert` and the inbox share one ledger statement (identical cursor assignment).
- Retired: `InboxRecentDao`, `InboxUnfinishedDao`, the ts-db `InboxMessageDao` re-export. `listAddressedSpecIds` reads recipients through `InboxDao.distinctRecipients()`.

**App (`packages/app`)**
- `packages/app/src/services/inbox-service.ts:128`: `send`/`reply`/`claim`/`settle`/`release`/`sweep`/`markRead`/`list`/`thread`/`requests`/`countQueued`/`members`/`attempts`/`taskAttempts`/`recent`. `RESERVED_INBOX_IDS` + `isReservedInboxId`, `MAX_DELIVERY_ATTEMPTS`, `CLAIM_LEASE_MS`, `RequestKeyConflictError`. No bus: consumers follow the ledger. `sweep` (`packages/app/src/services/inbox-service.ts:263`) resolves an expired claim from its newest receipt — completed settles, running leaves it, none requeues or fails at the ceiling (0834 R2 preserved).
- `packages/app/src/services/event-names.ts:276`: `message.claimed` catalogued beside sent/replied/read, with delivered/failed/requeued on the following lines; the `docs/design/event-tracking.md` §11 matrix is updated in the same change.
- `packages/app/src/services/system-event-tap.ts:76`: skips the `message` prefix — the service already persisted that row in-transaction.
- Repointed callers: `packages/app/src/services/agent-coordination-service.ts:288` (messaging, drain/settle, reserved-id spec filter), `packages/app/src/services/delivery-reconciler.ts:78` (requests-only, one join, sweep inside `reconcile`), `packages/app/src/services/strategy-runtime.ts:768` (attempts from `task_id`; the request-key parsers are gone), `packages/app/src/services/fleet-guest-service.ts:262` (release + reserved-id refusal), `packages/app/src/services/fleet-dispatcher.ts:107` (`kind`, `taskId`, `parentRunId`), `packages/app/src/workflow/fleet-dispatch.ts:204` (sender `spur` + `parentRunId`), `apps/cli/src/commands/agent/shared.ts:357` (settle via the service), `apps/server/src/modules/health/index.ts:506` (requests block), `scripts/commands/fleet-e2e.ts:1500`.

**Notable decisions.** `send` rejects a reused `request_key` whose payload differs (`RequestKeyConflictError`) rather than silently replaying a different request. `markRead`/`settle`/`release` return only the rows their guard matched, which is what makes the event set equal the changed set.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/migrations.ts:95-98` (`INBOX_MESSAGES_REBUILD_SQL` = drop-if-exists + `INBOX_MESSAGES_TABLE_SQL`), registry entry `packages/domain/src/migrations.ts:1686-1688`, drizzle mirror `drizzle/0054_spur_cli_inbox_messages_rebuild.sql:1-30`; the 0043/0053 table-absence guards stay untouched; `packages/domain/tests/dao/migrations.test.ts:1044-1063` (id/prefix/index set/guard order), `packages/domain/tests/dao/migrations.test.ts:385-451` (legacy pre-0054 table rebuilt), `packages/domain/tests/dao/migrations.test.ts:702` (journal that never had the table) |
| R2 | MET | `packages/domain/src/dao/inbox-dao.ts:164` is the only production module naming the table; `packages/domain/src/schema/inbox-messages.ts:49` owns the DDL; `inbox-recent-dao.ts`, `inbox-unfinished-dao.ts` and their tests are deleted (`git status` D) and `packages/domain/src/dao/index.ts` no longer re-exports `InboxMessageDao`; `packages/domain/src/dao/addressed-spec-ids.ts:27` reads recipients via `distinctRecipients()`; a sweep for `InboxRecentDao` under `packages/`, `apps/` and `scripts/` returns no code hits (the stale JSDoc at `packages/app/src/services/agent-coordination-service.ts:406-411` now names `InboxService.recent`/`InboxDao`) |
| R3 | MET | `packages/app/src/services/inbox-service.ts:163-390` (send/reply/claim/settle/release/sweep/markRead/list/thread/requests/countQueued/members/attempts/taskAttempts/recent); each mutation runs inside `packages/domain/src/dao/inbox-dao.ts:175-240` and writes one `system_events` row per `RETURNING` row; shared ledger statement `packages/domain/src/dao/system-event-dao.ts:291`; the tap skips `message.*` at `packages/app/src/services/system-event-tap.ts:76` |
| R4 | MET | Guards: claim `status = 'queued'` (`packages/domain/src/dao/inbox-dao.ts:261-278`), settle `status = 'claimed'` (`packages/domain/src/dao/inbox-dao.ts:288-303`), release (`packages/domain/src/dao/inbox-dao.ts:316-325`), markRead `read_at IS NULL AND to_id` (`packages/domain/src/dao/inbox-dao.ts:337-348`); receipt-first sweep `packages/app/src/services/inbox-service.ts:291-330` with the ceiling at `packages/app/src/services/inbox-service.ts:313-320`; tests `packages/app/tests/services/inbox-service.test.ts:65-189`, `packages/domain/tests/dao/inbox-dao.test.ts:78-110` |
| R5 | MET | `packages/app/src/services/inbox-service.ts:30-45` (`RESERVED_INBOX_IDS`, `isReservedInboxId`), refusals `packages/app/src/services/agent-coordination-service.ts:561` and `packages/app/src/services/fleet-guest-service.ts:160-165`; blank sender refused `packages/app/src/services/inbox-service.ts:163`; reply addressing + thread inheritance `packages/app/src/services/inbox-service.ts:216-247`; sequential and racy replay `packages/app/src/services/inbox-service.ts:163-211`, `packages/app/tests/services/inbox-service.test.ts:192-227`; re-probed this pass: 5 concurrent identical sends → 5 fulfilled, 1 distinct id, 4 `replayed: true`, 1 row, 1 `message.sent`; a differing payload raises `RequestKeyConflictError` (sequentially and while racing) |
| R6 | MET | coordination `packages/app/src/services/agent-coordination-service.ts:279-352`; reconciler `packages/app/src/services/delivery-reconciler.ts:52-122`; strategy `packages/app/src/services/strategy-runtime.ts:458-490,538-556,764-777`; guest `packages/app/src/services/fleet-guest-service.ts:257-280`; dispatcher `packages/app/src/services/fleet-dispatcher.ts:80-95`; workflow `packages/app/src/workflow/fleet-dispatch.ts:203-208`; `packages/domain/src/dao/addressed-spec-ids.ts:27`; health `apps/server/src/modules/health/index.ts:506-518`; CLI `apps/cli/src/commands/agent/shared.ts:360-390`; harness `scripts/commands/fleet-e2e.ts:1499-1502` |
| R7 | MET | `packages/app/src/services/event-names.ts:274-279`; matrix `docs/design/event-tracking.md:301-307` (the four new rows list `msgId`, `fromId`, `toId` (member), `threadId`, `status`; the catalog↔matrix gate in `packages/app/tests/services/event-names.test.ts` — two-sided name gate plus authored-presenter gate — re-run green this pass); tap skip `packages/app/src/services/system-event-tap.ts:76`; no `TeamOrchestrator`/`MessageStore` reference survives in `*.ts` |
| R8 | MET | member-instance ids `docs/reports/fleet-e2e-receipt.json:8-9` (`<scratch>-planner-1`, `<scratch>-coder-1`), health reads per `instanceId` `apps/server/src/modules/health/index.ts:508`; restart drain `packages/app/tests/services/inbox-service.test.ts:282-292`; per-address counts `packages/app/tests/services/inbox-service.test.ts:294-305` |
| R9 | MET | dispatch carries `kind: 'request'` + `taskId` (`packages/app/src/services/fleet-dispatcher.ts:87-89`, `packages/app/src/services/strategy-runtime.ts:486-487`); workflow dispatch sends as `spur` with `parentRunId` (`packages/app/src/workflow/fleet-dispatch.ts:203-208`, asserted `packages/app/tests/workflow/fleet-dispatch.test.ts:114`); receipt resolution `packages/app/src/services/fleet-dispatcher.ts:104-119`; round-trip artifact `docs/reports/fleet-e2e-receipt.json:41-56` — 9/9 legs `passed`, `generatedAt 2026-10-20T20:53:46Z` |
| R10 | MET | loop drain/settle port `packages/app/src/services/agent-coordination-service.ts:356-400` called from `packages/app/src/services/agent-loop-service.ts:406`; CLI settle/release `apps/cli/src/commands/agent/shared.ts:360-390`; guest pull `packages/app/src/services/fleet-guest-service.ts:259` and retire release `packages/app/src/services/fleet-guest-service.ts:276-279`; attempts read from `task_id` (`packages/app/src/services/inbox-service.ts:370-380` -> `packages/domain/src/dao/inbox-dao.ts:461`, consumed at `packages/app/src/services/strategy-runtime.ts:764-777`), and `parseFleetTaskAttempt`/`fleetTaskWbs` no longer exist anywhere |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A sent message and its event commit atomically | MET | test | `packages/app/tests/services/inbox-service.test.ts:40-63` (one row + one `message.sent`; a failing event insert rolls the row back), `packages/domain/tests/dao/inbox-dao.test.ts:52-70` |
| AC2 — Only the inbox data-access layer touches the inbox table | MET | test | `packages/domain/tests/dao/inbox-table-ownership.test.ts:66-80` (executable sweep: no production module outside `InboxDao`/migration/schema addresses the table; retired ts-db DAOs absent) + `packages/domain/src/dao/inbox-dao.ts:164` |
| AC3 — Status transitions are guarded | MET | test | `packages/app/tests/services/inbox-service.test.ts:65-107` (late settle / release no-ops write nothing; claim charges the budget), `packages/domain/tests/dao/inbox-dao.test.ts:93-99` |
| AC4 — An expired claim is requeued and eventually fails | MET | test | `packages/app/tests/services/inbox-service.test.ts:109-189` (requeue -> attempt ceiling -> failed; running receipt left alone, completed receipt settles) |
| AC5 — A repeated request key produces one message | MET | test | `packages/app/tests/services/inbox-service.test.ts:192-227` (sequential replay + concurrent loser replays: both fulfilled, one id, `replayed: true`, 1 row, 1 event; a differing payload still raises `RequestKeyConflictError`), predicate `packages/app/src/services/inbox-service.ts:118-126`; independently probed this pass (5-way race: 1 row, 4 replays, no raw constraint error; differing payload rejected) |
| AC6 — A reply always reaches the original sender | MET | test | `packages/app/tests/services/inbox-service.test.ts:240-263` (reply to an `operator` message lands in the operator inbox; a reply to a reply keeps the root thread id) |
| AC7 — System-originated messages use the spur sender | MET | test | `packages/app/tests/workflow/fleet-dispatch.test.ts:114` (`request.fromId === 'spur'`), source `packages/app/src/workflow/fleet-dispatch.ts:205`; the strategy sender stays the orchestrator member `packages/app/src/services/strategy-runtime.ts:483` |
| AC8 — Chat messages are never reported as unresolved work | MET | test | `packages/app/tests/services/inbox-service.test.ts:266-279`, `packages/domain/tests/dao/inbox-dao.test.ts:130-147` (only `kind = 'request'` enters the joined request read) |
| AC9 — Agent runs claim and settle through the service | MET | test | `packages/app/tests/services/delivery-reconciler.test.ts:68-90` (claim -> settle -> classify over `InboxService`), `packages/app/tests/services/agent-loop-service.test.ts:147-157` (a not-accepted send settles claimed rows `not-started`) |
| AC10 — Queued messages survive a member process restart | MET | test | `packages/app/tests/services/inbox-service.test.ts:282-292` (a second service instance on the same DB drains the same member address) |
| AC11 — A fleet dispatch completes a round trip through the member inbox | MET | command | `bun run fleet-e2e` -> `docs/reports/fleet-e2e-receipt.json:41` `dispatch-to-done` passed (`requestKey=fleet:task:0001:1`, run `8a065c39-68f7-4a2d-8036-f4b617ae266a`, task `done`), 9/9 legs `passed`, teardown with no problems |
| AC12 — Every member consumer claims and settles through the inbox service | MET | test | `apps/cli/tests/commands/agent/loop.test.ts:217-250` (drain/reconcile), `apps/cli/tests/commands/agent/wait.test.ts:365-385` (guest pull `--inbox`), `packages/app/tests/services/fleet-guest-service.test.ts` (retire release); source `apps/cli/src/commands/agent/shared.ts:360-390` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1266 (feature G11), bounded confirmation pass
**Scope:** uncommitted working tree (49 changed paths). This pass re-verified only the four items the implementer changed after the second review: the `isRequestKeyCollision` predicate in `packages/app/src/services/inbox-service.ts`, the `listRecent` doc block in `packages/app/src/services/agent-coordination-service.ts`, the four §11 rows in `docs/design/event-tracking.md`, and `plugins/sp/skills/spur-cli/references/message.md`. The rest of the tree is re-asserted from the two earlier passes, not re-litigated.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | correctness | Concurrent `send` on one `requestKey` replayed nothing: the loser of a real race rejected with a raw duplicate-constraint error instead of returning the winner's message, and `strategy-runtime` then recorded `executor-unavailable` and released a write slot for a dispatch that did go out. | `packages/app/src/services/inbox-service.ts:163-211` | RESOLVED (probe: 5 concurrent identical sends → 5 fulfilled, 1 distinct id, 4 replayed, 1 row, 1 `message.sent`; test `packages/app/tests/services/inbox-service.test.ts:214-227`) |
| 2 | P3 (minor) | correctness | A `failed` settle stamped `delivered_at`, so a never-delivered message read as delivered to any consumer of that column. | `packages/domain/src/dao/inbox-dao.ts:288-303` | RESOLVED (probe: `not-started` → `status=failed, deliveredAt=null`; `accepted` → `deliveredAt` stamped. Test `packages/domain/tests/dao/inbox-dao.test.ts:101-109`) |
| 3 | P3 (minor) | correctness | Ledger `actor` for `message.claimed/delivered/failed/requeued` was the sender (`fromId`), contradicting the factory's own comment and the §11 matrix. | `packages/app/src/services/inbox-service.ts:393-401` | RESOLVED (probe: claim/deliver/fail/requeue all write the member's `toId`; `message.sent/replied` still name the sender) |
| 4 | P3 (minor) | correctness | The fleet round-trip harness still special-cased the retired `injected` status when deciding a chat delivery had drained. | `scripts/commands/fleet-e2e.ts:1536-1541` | RESOLVED (only a rename comment mentions `injected`; the leg now treats `queued` as not-delivered and still asserts no run row for the chat) |
| 5 | P3 (minor) | architecture | `parseFleetTaskAttempt` was exported dead code and R10's "no `request_key` parsing" contract still read request keys. | `packages/app/src/services/strategy-runtime.ts:764-777` | RESOLVED (parser and its `fleetTaskWbs` sibling deleted — a repo-wide sweep finds neither name; `readAttempts` and `observe` read `task_id`) |
| 6 | P3 (minor) | usability | Doc block still delegated to the class this task deleted: "Delegates to `InboxRecentDao` (domain) so this package stays raw-SQL-free", leaving the Plan step 6 sweep (`rg InboxRecentDao`) non-empty. | `packages/app/src/services/agent-coordination-service.ts:406-411` | RESOLVED (this pass: the block now reads "Delegates to `InboxService.recent`, whose SQL lives in the domain `InboxDao` (G11)"; `InboxRecentDao` now has zero hits under `packages/`, `apps/` and `scripts/` — only docs, the G11 feature note and one historical drizzle comment mention it) |
| 9 | P4 (advisory) | efficiency | `reconcile(agentId)` sweeps every address (the sweep carries no member scope) and reads `requests(agentId)` twice per pass — once for `scanned`, once inside `classify`. Outcome-correct and idempotent, but 2x reads and cross-member writes from one member's loop. | `packages/app/src/services/delivery-reconciler.ts:64,122-127` | RESOLVED (this pass: `classify` accepts the caller's rows and `reconcile` issues ONE `requests` read per pass, so `scanned` and the classification cannot disagree; the cross-address sweep is inherent to `sweep(now)` and stays) |
| 10 | P4 (advisory) | documentation | The four §11 rows now list `msgId`, `fromId`, `toId` (member), `threadId`, `status` — the fields the factory distinguishes — so the previous gap (`fromId`/`threadId` missing) is closed; `createdAt`, which the shared factory also writes, stays unlisted on these four rows while `message.sent/replied/read` list it. | `docs/design/event-tracking.md:304-307`, payload at `packages/app/src/services/inbox-service.ts:402-415` | RESOLVED (this pass: the four rows now list `createdAt` too, and the presenter field lists match the documented payload; `packages/app/tests/services/event-names.test.ts` re-run green) |
| 11 | P4 (advisory) | documentation | Downstream CLI reference named the removed `MAX_INJECT_ATTEMPTS` as live vocabulary. | `plugins/sp/skills/spur-cli/references/message.md:89` | RESOLVED (this pass: the row now reads "`MAX_DELIVERY_ATTEMPTS`, 0831; renamed by G11" and attributes the terminal write to the claim sweeper — which matches `packages/app/src/services/inbox-service.ts:313-320`; `rg MAX_INJECT_ATTEMPTS` over the file returns nothing) |
| 12 | P4 (advisory) | correctness | The collision predicate matched only SQLite's error *text*, a message-format dependency where the typed code would be sturdier. | `packages/app/src/services/inbox-service.ts:118-126` | RESOLVED (this pass: the typed `SQLITE_CONSTRAINT_UNIQUE` code is checked first with the text form kept as a fallback for older `bun:sqlite` builds; probed the live error — `code=SQLITE_CONSTRAINT_UNIQUE`, `message=UNIQUE constraint failed: inbox_messages.request_key` — so the typed branch is the one in force, and a duplicate on a different unique column (`inbox_messages.id`) stays a rethrow) |
| 13 | P4 (advisory) | architecture | A reconciler test still reaches around the service to set an arbitrary attempt count with a direct SQL write, which the task's Plan step 4 wanted seeded through `InboxService`. Test-only; no service seam exists for an arbitrary attempt count. | `packages/app/tests/services/delivery-reconciler.test.ts:176-190,325-336` | RESOLVED (this pass: both fixtures reach the attempt ceiling through `claim`+`release` on `InboxService`; no `UPDATE inbox_messages` remains in the file) |

##### Carried to dependent work — not findings against 1266

These are cross-task wire drifts recorded so 1269 inherits them with their evidence. Neither is reachable from this task's surface, and neither is fixed here: both live in files 1269 owns.

- **P3 (minor) → 1269 (usability).** Cross-task wire drift, sender id: `/api/project/requests` keeps rows `fromId === 'operator'`, but the live Board posts as `board-operator`, so Board-composed requests are absent from the projection until 1269. Location: `apps/server/src/modules/health/index.ts:512`, `apps/web/src/components/GlobalAgentBar.tsx:316`. Owner: task 1269 (the Board consumes the rewritten status ladder and the typed inbox contract).
- **P3 (minor) → 1269 (usability).** Cross-task wire drift, status vocabulary (same class as #7): the Board receipt classifier still maps `injected`/`delivered`, which the new ladder cannot produce, so a `claimed` request renders as awaiting the orchestrator. Location: `apps/web/src/modules/projects/receipt.ts:200`, ladder at `packages/domain/src/dao/inbox-dao.ts:261-267`. Owner: task 1269 (the Board consumes the rewritten status ladder and the typed inbox contract).

Disposition: carried, not open. 1266's own findings are all RESOLVED above, so nothing on this task's surface blocks completion.

##### What this confirmation pass verified independently

- **#6 (the only prior blocker) is fixed.** `packages/app/src/services/agent-coordination-service.ts:406-411` no longer references the deleted DAO; its `listRecent` body at `:422-424` already called `InboxService.recent`, so the block and the code now agree.
- **#12 is fixed and the fix is live, not decorative.** Probed on a migrated in-memory DB: the raw duplicate raises `code=SQLITE_CONSTRAINT_UNIQUE`; 5 concurrent identical sends all fulfilled with one id (4 `replayed: true`), one row and one `message.sent`; a differing payload on the same key raises `RequestKeyConflictError` both sequentially and when it races the winner (one fulfilled, one conflict, one row). The predicate's fallback clause (`|| !message.includes('constraint failed')`) widens the candidate set for a reworded message, but the replay is gated by `findByRequestKey` + `assertSameRequest` (`:171-172`, `:107-115`), so a widened match cannot replay an unrelated row.
- **The §11 matrix and the catalog gate agree.** The four new rows list the distinguished field set the factory writes; `packages/app/tests/services/event-names.test.ts` (the two-sided §11↔catalog gate plus the authored-presenter gate) was re-run green.
- **Spot-checked suites, not the full run:** `event-names`, `inbox-service`, `agent-coordination-service`, `delivery-reconciler` (app) and `inbox-dao` (domain) — **126 pass / 0 fail across 5 files**. The implementer's full `bun run spur-check` (lint clean, 8 typechecks, 11543 pass / 0 fail, rules 51+2) is accepted as the tree-wide gate and was not re-run here.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/migrations.ts:95-98` (`INBOX_MESSAGES_REBUILD_SQL`: drop-if-exists + `INBOX_MESSAGES_TABLE_SQL`), registry entry `packages/domain/src/migrations.ts:1686-1688`, mirror `drizzle/0054_spur_cli_inbox_messages_rebuild.sql:1-30`; the 0043/0053 table-absence guards stay untouched; `packages/domain/tests/dao/migrations.test.ts:1044-1063` (registry/prefix/index set/guard order), `:385-451` (legacy pre-0054 table rebuilt), `:702` (journal that never had the table) |
| R2 | MET | `packages/domain/src/dao/inbox-dao.ts:164` is the only production module naming the table; `InboxRecentDao`, `InboxUnfinishedDao` and the ts-db re-export are gone (deleted files + `packages/domain/src/dao/index.ts`); `packages/domain/src/dao/addressed-spec-ids.ts:27` reads recipients via `distinctRecipients()`; the last surviving code reference to a deleted class (finding #6) is now fixed, so no code hits remain |
| R3 | MET | `packages/app/src/services/inbox-service.ts:163-390` (send/reply/claim/settle/release/sweep/markRead/list/thread/requests/countQueued/members/attempts/taskAttempts/recent), every mutation inside `packages/domain/src/dao/inbox-dao.ts:214-240` writing one `system_events` row per `RETURNING` row; no bus; the tap skips `message.*` at `packages/app/src/services/system-event-tap.ts:76`; shared ledger statement `packages/domain/src/dao/system-event-dao.ts:291` |
| R4 | MET | Guards: claim `status='queued'` (`inbox-dao.ts:261-278`), settle `status='claimed'` (`:288-303`), release (`:316-325`), markRead `read_at IS NULL AND to_id` (`:337-348`); `sweep` (`inbox-service.ts:291-330`) settles a completed receipt, leaves a running one, requeues with no receipt, fails at `MAX_DELIVERY_ATTEMPTS` (`:313-320`); tests `packages/app/tests/services/inbox-service.test.ts:65-189`, `packages/domain/tests/dao/inbox-dao.test.ts:78-110` |
| R5 | MET | `RESERVED_INBOX_IDS`/`isReservedInboxId` (`inbox-service.ts:30-45`), spec filter `agent-coordination-service.ts:561`, guest refusal `fleet-guest-service.ts:160-165`; blank sender refused (`inbox-service.ts:163`); reply targets `original.fromId` and inherits `threadId` (`inbox-service.ts:216-247`); idempotency incl. the race (`:163-211`, probe re-run this pass) |
| R6 | MET | All ten callers repointed: coordination `agent-coordination-service.ts:279-352`, reconciler `delivery-reconciler.ts:52-122`, strategy `strategy-runtime.ts:458-490,538-556,764-777`, guest `fleet-guest-service.ts:257-280`, dispatcher `fleet-dispatcher.ts:80-95` (`kind`/`taskId`/`parentRunId`), workflow `workflow/fleet-dispatch.ts:203-208` (`fromId:'spur'` + `parentRunId`), `addressed-spec-ids.ts:27`, health `apps/server/src/modules/health/index.ts:506-518`, CLI `apps/cli/src/commands/agent/shared.ts:360-390`, `scripts/commands/fleet-e2e.ts:1499-1502` |
| R7 | MET | Catalog `packages/app/src/services/event-names.ts:274-279`, §11 matrix `docs/design/event-tracking.md:301-307` (catalog↔matrix test re-run green this pass), tap skip `system-event-tap.ts:76`, presenters authored at `event-names.ts:685-710`; no `TeamOrchestrator`/`MessageStore` reference survives in `*.ts` |
| R8 | MET | Inboxes keyed by member instance id — `docs/reports/fleet-e2e-receipt.json:8-9` (`<scratch>-planner-1`, `-coder-1`), health reads per `instanceId` (`apps/server/src/modules/health/index.ts:508`); restart test `packages/app/tests/services/inbox-service.test.ts:282-292` drains the same address from a second service instance |
| R9 | MET | Strategy dispatch carries `kind:'request'` + `taskId` (`fleet-dispatcher.ts:87-89`, `strategy-runtime.ts:486-487`); workflow dispatch sends as `spur` with `parentRunId` (`workflow/fleet-dispatch.ts:203-208`, asserted `packages/app/tests/workflow/fleet-dispatch.test.ts:114`); receipt linkage `fleet-dispatcher.ts:104-119`; round trip `docs/reports/fleet-e2e-receipt.json:41-56` (9/9 legs passed) |
| R10 | MET | Loop drain/settle through the coordination port (`agent-coordination-service.ts:356-400`, reconcile at `agent-loop-service.ts:406`), CLI settle/release `apps/cli/src/commands/agent/shared.ts:360-390`, guest pull `fleet-guest-service.ts:259` and retire release `:276-279`, attempts from `task_id` (`inbox-service.ts:370-380` → `inbox-dao.ts:461`, consumed at `strategy-runtime.ts:764-777`; the request-key parsers are deleted) |

##### Residual risk

- **Two P3s are carried to 1269 by design** (#7/#8): until the Board lands, Board-composed requests are absent from `/api/project/requests` and a `claimed` request renders as awaiting the orchestrator. Owning task: 1269 (Board + doc cleanup).
- **§11 matrix asymmetry (#10) and the reconciler wording (#9, #13)** are advisory only — no behavior, gate or presenter depends on them.
- **The collision predicate's fallback clause is deliberately loose.** A typed `SQLITE_CONSTRAINT_UNIQUE` on the inbox table with a message that omits "constraint failed" is treated as a candidate collision; a replay can only happen if a row already exists for that `request_key` **and** its payload matches, so the loose match cannot attach an unrelated row. Worth remembering if a second partial unique index is ever added to this table.
- **Concurrency evidence is in-process.** The race probe and the DAO's serialization test both run over one adapter; two OS processes racing the partial unique index is covered by code reading (the catch), not by a two-process test.
- **Data loss is intentional and irreversible** (operator decision A6): 0054 discards existing inbox rows, so any un-drained inbox at upgrade time is gone — worth restating at release.
- **`shortcut:` seams to revisit:** the per-adapter `BEGIN IMMEDIATE` lock assumes a single-connection Bun adapter (`inbox-dao.ts:175-203`), the claim lease is a constant with a test-only override, and `listRecent`/`recent` are pre-contract Board reads that 1269 should delete rather than grow.
- **Not run here:** `bun run spur-check`, `bun run fleet-e2e` and the full suite. The refreshed receipt in the tree is the implementer's and is accepted as the R9/R10 artifact; the harness itself was read, not re-executed.

##### Disposition

**PASS** — every finding row in this report is RESOLVED. The confirmation pass verified #12 by probe, #2/#3/#4/#5 by sweep plus targeted suites, and the §11 rows by the catalog↔matrix gate; the three advisory P4s (#9 double read, #10 `createdAt` asymmetry, #13 raw-SQL attempt seeding) were then closed in the same pass, so no row is carried as open. R1–R10 and AC1–AC12 trace to code with passing evidence. The two cross-task wire drifts belong to 1269 and are noted below as inherited context, not as open findings against this task.

### References

- Feature G11; plan `docs/plans/2026-10-19-inbox-module-refactor.md`; ADR-143 (amends ADR-057); `docs/design/inter-agent-control-plane.md` §13.
- Prior art: 0832 (request_key), 0833 (run receipts), 0834 R2 (no requeue of ambiguous work), 1077 (`fleet-e2e`), 1081 (guest pull), G71/G73.
- Dependents: 1267, 1268 (→1266), 1269 (→1267).
- Concurrency (2026-10-20): no `wip` tasks; only the main worktree exists.

### History

- 2026-10-20T20:41:02.598Z todo → wip (system)
- 2026-10-20T22:04:06.267Z wip → testing (system)
- 2026-10-20T22:04:35.779Z testing → done (system)

