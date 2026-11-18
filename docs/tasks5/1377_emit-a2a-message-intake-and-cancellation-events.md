---
schema_version: 1
name: Emit A2A message intake and cancellation events
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:15.947Z
updated_at: "2026-11-18T05:36:41.558Z"
feature_id: J94
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1375"]
---

## 1377. Emit A2A message intake and cancellation events

### Background

The A2A listener (G9, ADR-148/143) maps `SendMessage` to a keyed inbox request (`apps/server/src/modules/a2a/index.ts:239-275`) and `CancelTask` to the supervisor stop path (`:289-338`). Neither emits a system event. The only signals are `logger.warn` on an unset token (`:198`) and on a cancel with no supervised run (`:330`). The inbox already reports deduplication: `InboxService.send` returns `{ message, replayed }` (`packages/app/src/services/inbox-service.ts:86-89,192,230`), and a same-key/different-body send throws `RequestKeyConflictError` (409).

**Refine corrections (2026-11-17)**
- "deduplicated flag (RequestKeyConflictError or replay)" → these are different outcomes. `replayed: true` is an idempotent duplicate (200). `RequestKeyConflictError` is a refused conflict (409) → the event carries `outcome` ∈ `accepted | replayed | conflict` instead of one boolean.
- "a2a.task.cancelled … whether a supervised run stopped" → a cancel on a non-WORKING task is refused 400 before any stop (`:300-312`) → the event is emitted only on the accepted cancel path, with `runStopped` true/false from the supervisor try/catch.

### Requirements

- [ ] R1. Add `'a2a'` to `SystemEventSource`, and catalog `a2a.message.received` and `a2a.task.cancelled` with event-specific presenters.
- [ ] R2. Emit `a2a.message.received` on every authenticated, well-formed `SendMessage`. Payload: `member` (instance id), `messageId`, `requestKey`, `outcome` (`accepted` | `replayed` | `conflict`) and `inboxMessageId` when present.
- [ ] R3. Emit `a2a.task.cancelled` on the accepted cancel path with `member`, `taskId` and `runStopped`.
- [ ] R4. No message body text appears in any payload.

Out of scope: the `auth.denied` emitter for A2A (owned by 1376), GetTask read events (low decision value), cross-project delegation (G91).

### Acceptance Criteria

- [ ] AC1 — A2A message intake and cancellation emit events (req: R1, R2, R3, R4)

Test layer: the real A2A routes with tap and `SystemEventDao` in `apps/server/tests/modules/a2a/routes.test.ts`, plus regression of `scripts/commands/a2a-serve-e2e.ts`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:36:41.557Z

- **One `deduplicated` boolean vs an `outcome` enum?** Closed: an `outcome` enum, because replay and conflict are distinct operator signals.
- **Emit on validation refusals?** Deferred: not now. Revisit if I61 (1398) shows demand.

### Design

**WHAT.** Catalog entries via `baseEvent(name, 'a2a', 'a2a')`, both `metadata-only`. Emit with `ctx.eventBus().emit(...)` in the route handlers:
- after `inbox.send` resolves: `outcome = sent.replayed ? 'replayed' : 'accepted'`;
- in the `RequestKeyConflictError` catch, before returning 409: `outcome = 'conflict'`;
- after the supervisor try/catch: `runStopped = true` on success, `false` in the catch.

Presenter summaries look like `[a2a] <member> received <messageId> (replayed)` and `[a2a] <member> cancelled <taskId> (run stopped)`.

**WHY.** The inbox's `replayed` flag already is the dedup truth, so no new detection is needed. Splitting conflict from replay matters operationally: a replay is benign client retry, a conflict is a client bug.

**WHERE.** `apps/server/src/modules/a2a/index.ts` and `packages/app/src/services/event-names.ts`.

**Anti-patterns.** No body text, no headers. Don't emit on 400/404 validation refusals, which a later task can add if decision value appears. Don't touch the inbox service.

**Dependencies.** 1375 (shared guard) must land first because both edit the same module. Sequence after 1376 in `event-names.ts`, where both add a source and entries.

### Plan

- [ ] Step 1 (test first, R2–R4): in `apps/server/tests/modules/a2a/routes.test.ts`, attach the tap (pattern: `apps/server/tests/upstream-system-events-wiring.test.ts:61-63`). Assert rows for a first send (`accepted`), the same send again (`replayed`), the same key with a different body (`conflict`), and an accepted cancel with `runStopped`. Assert that the body text is absent from `payload_json`.
- [ ] Step 2 (R1): add the catalog entries and presenters. `packages/app/tests/services/event-names.test.ts` must stay green.
- [ ] Step 3 (R2/R3): emit in the two handlers.
- [ ] Step 4: run `scripts/commands/a2a-serve-e2e.ts`, which must still pass, then the focused tests and `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
