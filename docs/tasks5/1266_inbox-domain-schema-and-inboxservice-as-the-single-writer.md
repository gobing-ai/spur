---
schema_version: 1
name: Inbox domain schema and InboxService as the single writer
status: todo
template: feature-impl
created_at: 2026-10-20T06:59:42.639Z
updated_at: "2026-10-20T16:42:20.066Z"
feature_id: G11
priority: P1
tags:
  - inbox

---

## 1266. Inbox domain schema and InboxService as the single writer

### Background

Plan: docs/plans/2026-10-19-inbox-module-refactor.md §3.1; ADR-143; design inter-agent-control-plane.md §13.

Sizing: about 10h (incl. the fleet round-trip E2E), one cohesive unit (schema + DAO + service + repointing every direct caller). Splitting would leave the tree uncompilable between steps because the ts-db `InboxMessageDao` export is removed here.

Implements: R1 — A sent message and its event commit atomically; R2 — Only the inbox data-access layer touches the inbox table; R3 — Status transitions are guarded; R4 — An expired claim is requeued and eventually fails; R5 — A repeated request key produces one message; R6 — A reply always reaches the original sender; R7 — System-originated messages use the spur sender; R8 — Chat messages are never reported as unresolved work; R13 — Agent runs claim and settle through the service; R19 — Queued messages survive a member process restart; R20 — A fleet dispatch completes a round trip through the member inbox; R21 — Every member consumer claims and settles through the inbox service.

Runs first; every other G11 task depends on it.

### Requirements

- [ ] R1. Migration 0054 drops and recreates `inbox_messages` with the §13 columns and indexes; remove the 0043/0053 skip special-cases that no longer apply.
- [ ] R2. Add a Spur-owned drizzle schema and `InboxDao` in `packages/domain`; delete `InboxRecentDao`, `InboxUnfinishedDao` and the ts-db `InboxMessageDao` re-export.
- [ ] R3. Add `InboxService` in `packages/app` (send, reply, claim, settle, release, sweep, markRead, list, thread, requests). Each mutation writes its row plus one `system_events` row in one transaction, with bus fan-out after commit.
- [ ] R4. Guard every transition by its prior status; the claim lease and sweeper requeue, then fail at MAX_ATTEMPTS.
- [ ] R5. Reserve `operator` and `spur`: reject them as spec ids; `from_id` is never null; a reply targets the original `from_id` and inherits `thread_id`.
- [ ] R6. Repoint every direct caller to the service: AgentCoordinationService messaging, DeliveryReconciler (kind=request, one join), strategy-runtime, fleet-guest-service, fleet-dispatcher (sender `spur`, `task_id`/`parent_run_id` columns), addressed-spec-ids, the health requests block, and the CLI agent drain/settle in `apps/cli/src/commands/agent/shared.ts`.
- [ ] R7. Catalog the new `message.*` event names in event-names.ts; delete the TeamOrchestrator/InboxMessageDao legacy tests.
- [ ] R8. Key every inbox by fleet member address (`<project-slug>-<member-id>`, one per replica slot) or a non-fleet address (hand-authored spec, guest id, `operator`, `spur`); never by process, run or generation id, so a respawned process drains the same inbox.
- [ ] R9. Fleet dispatch (strategy tick via FleetDispatcher, and workflow agent.run with executor fleet via dispatchToFleet) completes through the member inbox: claim, run, settle, run receipt linking message id and task_id, and dispatcher receipt resolution.
- [ ] R10. Every member consumer goes through InboxService: `spur agent loop` (agent-loop-service drain/settle port; the keyed write-slot hold reads `task_id`, not the request_key regex), `spur agent run`, and guest pull (`spur agent wait --inbox`); guest retire releases claimed messages via the service.

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

### Design

Approach: one service over one DAO; transactions via the domain adapter transaction helper; the sweeper is a service method invoked by the existing server reconciler pass.
Rejected: keeping ts-db InboxMessageDao and extending it (split ownership is the root cause); a new table name (ts-db embedded migrations never run in Spur, so it is not needed).
Invariants: one inbox per fleet member — to_id/from_id hold the member address (`<project-slug>-<member-id>`), never a process, run or generation id; only InboxDao names inbox_messages; no null senders; request_key is never parsed.
Key signatures: `send({from,to,body,kind,requestKey?,taskId?,parentRunId?,inReplyTo?}) → InboxMessage`, `claim(member, limit) → InboxMessage[]`, `settle(ids, outcome)`, `sweep(now) → {requeued, failed}`, `list(member, direction, page)`, `thread(id)`.

### Plan

1. Write the failure modes (atomicity rollback, guarded transitions, lease expiry, idempotency, reply routing) as E2E service tests against an in-memory DB. Include the fleet round-trip E2E (strategy dispatch and workflow executor=fleet → agent loop → receipt) and the guest-pull consumer; keep its transcript as the feature's rerunnable proof.
2. Migration 0054, schema and InboxDao.
3. InboxService and event catalog.
4. Repoint callers; delete the old DAOs and the re-export.
5. `rg inbox_messages|InboxMessageDao` shows only InboxDao; `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
