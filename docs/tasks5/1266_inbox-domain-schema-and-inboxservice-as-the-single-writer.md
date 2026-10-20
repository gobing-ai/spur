---
schema_version: 1
name: Inbox domain schema and InboxService as the single writer
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.639Z
updated_at: "2026-10-20T18:02:33.749Z"
feature_id: G11
priority: P1
tags:
  - inbox

estimate_hours: 12
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

- [ ] R1. Migration `0054_spur_cli_inbox_messages_rebuild` (embedded in `CLI_MIGRATIONS` plus its `drizzle/` mirror) runs `DROP TABLE IF EXISTS inbox_messages` and recreates the table with the §13 columns and indexes. The 0000/0001/0043/0053 entries and the 0043/0053 table-absence guards stay unchanged.
- [ ] R2. Add a Spur-owned drizzle schema and `InboxDao` in `packages/domain`. Delete `InboxRecentDao`, `InboxUnfinishedDao` and the ts-db `InboxMessageDao` re-export. `listAddressedSpecIds` reads inbox recipients through `InboxDao.distinctRecipients()`.
- [ ] R3. Add `InboxService` in `packages/app` (send, reply, claim, settle, release, sweep, markRead, list, thread, requests, countQueued, members, attempts). Each mutation writes its row and one `system_events` row per changed message in one transaction. It has no bus: consumers follow the ledger, and 1267 relays `message.*` to SSE. The server tap does not persist `message.*`.
- [ ] R4. Guard every transition by its prior status; a guard miss changes nothing and writes no event. `sweep(now)` requeues a `claimed` row past the lease only when no `coordination_runs` row lists it, and moves it to `failed` once `attempts` reaches `MAX_DELIVERY_ATTEMPTS`. A claimed row that has a run row is settled from the run outcome.
- [ ] R5. Reserve `operator` and `spur`: agent spec loading and guest join reject them as ids; `from_id` is never null; a reply targets the original `from_id` and inherits `thread_id`.
- [ ] R6. Repoint every direct caller to the service: AgentCoordinationService messaging; DeliveryReconciler (kind = request, one join, sweep inside `reconcile`); strategy-runtime; fleet-guest-service; fleet-dispatcher (`kind`, `taskId`, `parentRunId`; strategy sender stays the orchestrator member, workflow sender becomes `spur`); addressed-spec-ids; the health requests block; the CLI agent drain/settle; and `scripts/commands/fleet-e2e.ts`.
- [ ] R7. Catalog `message.claimed|delivered|failed|requeued` beside the existing `message.sent|replied|read` in `packages/app/src/services/event-names.ts`. Delete the TeamOrchestrator/MessageStore legacy tests.
- [ ] R8. Key every inbox by fleet member address (`<project-slug>-<member-id>`, one per replica slot) or a non-fleet address (hand-authored spec, guest id, `operator`, `spur`); never by process, run or generation id, so a respawned process drains the same inbox.
- [ ] R9. Fleet dispatch (strategy tick via FleetDispatcher, and workflow agent.run with executor fleet via dispatchToFleet) completes through the member inbox: claim, run, settle, a run receipt linking the message id and `task_id`, and dispatcher receipt resolution.
- [ ] R10. Every member consumer goes through InboxService: `spur agent loop` (the agent-loop-service drain/settle port), `spur agent run`, and guest pull (`spur agent wait --inbox`). The strategy-runtime keyed write-slot hold and attempt count read `task_id`, not a request_key regex. Guest retire releases claimed messages via the service.

Out of scope: the oRPC contract and the deletion of `apps/server/src/modules/messages` (1267); the `spur message` CLI verbs and docs (1268); the Board and doc cleanup (1269); retention of delivered rows; upstream ts-db deprecation.

### Acceptance Criteria

- [ ] AC1 — A sent message and its event commit atomically
- [ ] AC2 — Only the inbox data-access layer touches the inbox table
- [ ] AC3 — Status transitions are guarded
- [ ] AC4 — An expired claim is requeued and eventually fails
- [ ] AC5 — A repeated request key produces one message
- [ ] AC6 — A reply always reaches the original sender
- [ ] AC7 — System-originated messages use the spur sender
- [ ] AC8 — Chat messages are never reported as unresolved work
- [ ] AC9 — Agent runs claim and settle through the service
- [ ] AC10 — Queued messages survive a member process restart
- [ ] AC11 — A fleet dispatch completes a round trip through the member inbox
- [ ] AC12 — Every member consumer claims and settles through the inbox service

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G11; plan `docs/plans/2026-10-19-inbox-module-refactor.md`; ADR-143 (amends ADR-057); `docs/design/inter-agent-control-plane.md` §13.
- Prior art: 0832 (request_key), 0833 (run receipts), 0834 R2 (no requeue of ambiguous work), 1077 (`fleet-e2e`), 1081 (guest pull), G71/G73.
- Dependents: 1267, 1268 (→1266), 1269 (→1267).
- Concurrency (2026-10-20): no `wip` tasks; only the main worktree exists.

### History
