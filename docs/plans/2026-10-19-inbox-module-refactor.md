---
kind: plan
title: Inbox module refactor — one fleet member, one inbox
status: draft
created_at: 2026-10-19
updated_at: 2026-10-19
related:
  - docs/plans/2026-10-04-agent-fleet-inbox-redesign.md
  - docs/design/inter-agent-control-plane.md
  - docs/design/inbox-board-module.md
tags: [inbox, messaging, fleet, board]
---

# Inbox module refactor — one fleet member, one inbox

## 1. Objective and outcome

The inbox is Spur infrastructure. **Each fleet member has exactly one inbox.** A fleet member is one
declared member slot in one project, addressed by `<project-slug>-<member-id>`
(`packages/app/src/services/fleet-service.ts:470`). The address is stable across restarts. A member
declared with replicas has one slot, and therefore one inbox, per replica. The processes, runs,
generations and guest sessions that serve a member read from its inbox but never own one, so queued
input survives a respawn. Non-fleet addresses get one inbox each on the same rule: hand-authored
specs, guest ids (ADR-121), `operator` and `spur`. The member's inbox durably stores every message
sent to or from the member, and it is the member's input buffer. The
orchestrator, the CLI (`spur message`), the Board global input and every internal service send and
receive only through it. Each mutation writes the message row and its `system_events` row in one
transaction.

Done when:

- One `InboxService` (in `packages/app`) and one `InboxDao` (in `packages/domain`) own all inbox reads
  and writes. Nothing else touches `inbox_messages`.
- The human has one reserved identity (`operator`), and the system has one (`spur`).
- Replies always reach a sender.
- Terminal stdin is no longer double-delivered.
- Claimed messages can no longer get stuck.
- Message routes are oRPC. The CLI gains `message show` and `message read`.
- The Projects → Inbox tab is laid out as member list → two-direction thread → composer, with
  inline reply and mark-read.
- The legacy code and docs listed in §3.5 are deleted.

## 2. Premises and dependencies

### Review findings (2026-10-19)

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| C1 | Critical | The human has four identities: `board-operator`, `operator`, `terminal` and `null`. | `apps/web/src/modules/projects/conversation.ts:18`, `apps/cli/src/commands/message.ts:22`, `apps/server/src/modules/messages/index.ts:86`, `MemberTerminal.tsx:262-280` |
| C2 | Critical | Replies to a `null` sender throw. Replies to `board-operator`/`terminal` land in inboxes nobody reads. | `agent-coordination-service.ts:475-484` |
| C3 | Critical | Each terminal line goes both to stdin and to `POST /api/messages`, so the same input is delivered twice. | `MemberTerminal.tsx:262-280` |
| C4 | Critical | There is no claim lease or sweeper, so `injected` rows stay stuck forever. The live DB has 5. | `.spur/spur.db`; ts-db `drainPending` |
| C5 | Critical | Chat messages are classified as unresolved work. `classify` runs a full scan and issues one query per row. | `delivery-reconciler.ts:88` |
| H1 | High | Drain and settle logic lives in the CLI transport. | `apps/cli/src/commands/agent/shared.ts:358-470` |
| H2 | High | Task id and parent run are parsed out of `request_key` with regexes. The UI reads metadata from a body envelope (`SPUR-REQUEST/1`). | `shared.ts:444-452`, `conversation.ts` |
| H3 | High | ts-db owns the schema and DAO, Spur owns the migrations, and five modules bypass the service. | `dao/index.ts:1`, `strategy-runtime.ts`, `fleet-guest-service.ts:251-266`, `addressed-spec-ids.ts:15` |
| H4 | High | The routes are raw Hono. The requests route lives in the health module. A GET performs writes (`FleetGuestService.expire`). | `apps/server/src/modules/messages/index.ts`, `health/index.ts:439-520` |
| H5 | High | There is no per-member view covering both directions. The Inbox tab shows a global feed of 100 messages. | `ConversationView.tsx:93` |
| H6 | High | `message inbox --json` writes because it runs a reconcile before reading. | `message.ts:374` |
| H7 | High | Status transitions are unguarded, and the transition events are never emitted. | ts-db `markDelivered/markFailed` |

### Decisions

- **A1:** The human's id is `operator`. It is already the CLI default and reads as a role, not a product. `spur` is reserved as the sender of system-originated messages; it replaces `null` and `workflow-<runId>`. Both ids are rejected as agent spec ids. `board-operator` and `terminal` are retired.
- **A2:** Spur owns the schema and the data-access layer in `packages/domain`. The `@gobing-ai/ts-db` `InboxMessageDao` import is dropped. ts-db's embedded inbox migrations never run in Spur (`migrations.ts` owns the DDL). `TeamOrchestrator`/`MessageStore` appear only in two legacy tests, which are deleted.
- **A3:** Terminal stdin stays a raw pipe and stops enqueueing messages. There are two first-class operator input paths:
  - CLI: `spur message send`. When `--to` is omitted, it sends to the orchestrator.
  - Board: GlobalAgentBar.
  
  Both send from `operator` and default to the orchestrator.
- **A4:** An oRPC `inbox` contract replaces `/api/messages*` and `/api/project/requests`. The new CLI verbs `spur message show <id>` (thread) and `spur message read <id>` are approved.
- **A5:** The Inbox tab is laid out as member list → thread (both directions) → composer, with inline reply and mark-read.
- **A6:** Existing inbox data is dropped. Migration `0054` recreates the table.
- **A7 (2026-10-20):** One inbox per fleet member, not per process. `to_id`/`from_id` hold the member
  address (`<project-slug>-<member-id>`), never a process, run or generation id. Which run consumed a
  message is recorded by the run receipt (`coordination_runs.message_ids_json`), not by the inbox key.
  - Rejected: one inbox per process. Queued messages would be stranded on respawn, senders would have to
    race to find the live process, and replies to an exited process would be lost.

### Target schema (`inbox_messages`, migration 0054: drop and recreate)

| Column | Notes |
| --- | --- |
| `id`, `from_id NOT NULL`, `to_id NOT NULL`, `body`, `created_at`, `updated_at` | `from_id` is never null; `operator` or `spur` cover the non-agent cases. |
| `kind` | `chat` \| `request`. Only `request` rows are reconciled or receipted. |
| `status` | `queued` → `claimed` → `delivered` \| `failed`; `release`/sweep moves rows back to `queued`. Every transition is guarded by its expected prior status. |
| `claimed_at`, `attempts`, `error`, `delivered_at`, `read_at` | The sweeper requeues `claimed` rows once `claimed_at` exceeds the lease. Once `attempts` reaches `MAX_ATTEMPTS`, it moves them to `failed`. |
| `in_reply_to`, `thread_id` | `thread_id` is the root message id, so a whole thread is fetched with one indexed read. |
| `request_key` | An idempotency key only, with a partial unique index. Nothing parses it. |
| `task_id`, `parent_run_id` | First-class columns that replace the regex extraction from `request_key`. |

Indexes: `(to_id, status)`, `(from_id, created_at)`, `(thread_id)`, and a partial unique index on `request_key`.

### Events

The service writes `message.sent`, `message.replied`, `message.claimed`, `message.delivered`, `message.failed`, `message.requeued` and `message.read` to `system_events` in the same transaction as the row. The bus fan-out happens after the commit. These names are added to the `event-names.ts` catalog.

## 3. Execution sequence

Tasks 1 → 2 → {3, 4}. Tasks 3 and 4 can run in parallel once task 2's contract is in place.

1. **Domain and service.**
   - Migration `0054`, Spur `inboxMessages` schema, `InboxDao` (all inbox SQL, guarded transitions, sweep).
   - `InboxService`: `send`, `reply`, `claim`, `settle`, `release`, `sweep`, `markRead`, `list(member, direction)`, `thread`, `requests(orchestrator)`. Each runs in one transaction with its event.
   - Point `AgentCoordinationService` messaging, `DeliveryReconciler` (kind = request only, a single join), `strategy-runtime`, `fleet-guest-service`, `fleet-dispatcher` (sender `spur`) and `addressed-spec-ids` at it.
   - Delete `InboxRecentDao`, `InboxUnfinishedDao` and the ts-db import.
   - Checkpoint: no file outside `InboxDao` references `inbox_messages`.
2. **Contract and server.**
   - `packages/contracts` inbox contract covering list, thread, send, reply, read and requests.
   - Server handler via `implement(contract)`.
   - Delete `apps/server/src/modules/messages` and the `/api/project/requests` block from health. GETs become read-only; guest expiry moves to the sweeper.
3. **CLI.**
   - Move `drainIntoPrompt` / `settleClaimedMessages` from `agent/shared.ts` into `InboxService.claim/settle`.
   - `message send` defaults to the orchestrator and the `operator` sender; `--wait` watches the sent message's own status.
   - `message inbox` becomes read-only.
   - Add `message show <id>` and `message read <id>`.
   - Update `docs/help/cmd_message.md`, `docs/help2/message.md` and `plugins/sp/skills/spur-cli/references/message.md`.
4. **Web and cleanup.**
   - Inbox tab: member list → thread → composer (reply and mark-read) on the typed oRPC client.
   - GlobalAgentBar sends from `operator`, with no body envelope; refs move to the contract field.
   - MemberTerminal stops posting messages.
   - Delete `buildRecentMessagesThread`, the `SPUR-REQUEST/1` envelope, the dead `conversation`/`processes` tab ids, the `useProjectTab` alias, the `router.tsx` redirect, the `.inbox` CSS scope and `useProjectRequests` polling (replaced by the contract plus SSE).
   - Docs: retire `docs/design/inbox-board-module.md` and its `04_DESIGN.md:76` index row. Fold the message-plane facts into `inter-agent-control-plane.md`. Fix `03_ARCHITECTURE.md` (~583).

## 4. Risks and verification

| Risk | Mitigation |
| --- | --- |
| Agents prompted to run `spur message reply <id>` break mid-migration. | The CLI verb's shape doesn't change, so `ORCHESTRATOR_REPLY_INSTRUCTION` stays valid. |
| A Board build running against a new server, or the reverse, during development | One release ships both. No compatibility shim (A6). |
| The sweep lease is too short for slow agents. | The lease is a config value, defaulting to 10 minutes. Settlement is guarded, so a late settle after a requeue is a no-op. |
| Removing ts-db's `InboxMessageDao` breaks other ts-db consumers | Spur stops importing it; ts-db itself doesn't change. |

Verification uses E2E tests first. Each scenario's failure modes are written before the code:

- **CLI E2E**
  - `send` (no `--to`) then `inbox`, `show`, `reply` (from the orchestrator member), `read`. The thread has both directions, and the reply lands in `operator`'s inbox.
  - The same `--request-key` sent twice produces one row.
  - A claimed row whose lease expired is requeued by sweep. After `MAX_ATTEMPTS` it becomes `failed`.
  - A chat message never shows up as unresolved.
- **Server:** contract round-trip through `OpenAPILink`. Each mutation produces exactly one `system_events` row, and a failed insert rolls back both.
- **Browser:** pick a member, see the thread, send, see the reply arrive over SSE, mark read. A terminal line produces no inbox row.
- **Gates:** `bun run spur-check` per task, then `bun run spur-check-feature` once.
- **Repeatable artifact:** an E2E transcript and DB snapshot, saved under the final task.

## 5. Follow-up

- ts-db: deprecate `InboxMessageDao` and the inbox migrations upstream once no consumer is left. That work is out of Spur's scope.
- Retention and compaction of old delivered messages are deferred until volume makes it matter.
