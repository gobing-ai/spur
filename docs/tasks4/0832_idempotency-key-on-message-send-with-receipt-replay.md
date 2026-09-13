---
schema_version: 1
name: Idempotency key on message send with receipt replay
status: done
template: feature-impl
created_at: 2026-09-12T04:45:30.146Z
updated_at: "2026-09-13T07:03:09.152Z"
feature_id: G61

---

## 0832. Idempotency key on message send with receipt replay

### Background

**Probe 3 (UNMET)** — `InboxMessageDao.enqueue` mints a fresh `crypto.randomUUID()` per send
(ts-db 0.4.62, `node_modules/@gobing-ai/ts-db/dist/inbox-message-dao.js:21-43`). Two identical bodies
produce two distinct rows and both deliver in one drain: a retried submission duplicates the work
(`docs/reports/g6-runtime-inventory.md` §3). Re-verified at refinement time — the call takes no key
and performs no lookup before `create`.

The Board's global input depends on this key for honest acknowledgement — the design's interaction
loop requires that "a retry with the same request key returns the original receipt" and that the
composer clears only after that receipt. The G6 prototype demonstrates the intended semantics end to
end against fixtures (`docs/reports/g6-projects-prototype.md` R2-4, R2-5).

**Ownership, verified.** `inbox_messages` is ts-db's table, created by embedded migration
`0003_inbox_messages` (`dist/embedded-migrations.js:27-28`) with columns
`id, from_id, to_id, body, status, in_reply_to, created_at, updated_at, delivered_at,
inject_attempts, inject_error`. **There is no key column.** So this task is genuinely an additive
`@gobing-ai/ts-db` change (repo `~/xprojects/ts-libs`) — unlike task 0833, whose `coordination_runs`
table turned out to be Spur-owned. Do not add a Spur-local migration for `inbox_messages`.

Send surfaces that must carry the key:

- `TeamService.sendMessage(fromId, toId, body, replyTo?)` — `packages/app/src/services/team-service.ts:316-331`
- `spur message send` — `apps/cli/src/commands/message.ts:28` → `runMessageSend`
- `POST /api/messages` — `apps/server/src/modules/messages/index.ts:50`, calling `svc.sendMessage(from ?? null, to, body)` at `:62`

### Requirements

- **R1** — A caller may supply a request key on send. Sends without a key behave **exactly** as today,
  including `enqueue`'s current signature and `Promise<string>` return; no existing caller changes.
- **R2** — Re-sending the same key returns the original message identity and a `replayed` marker; no
  second row is created and no second delivery occurs.
- **R3** — Re-sending the same key with a **different** body fails loudly with a distinguishable
  conflict error. Never a silent overwrite, and never a silent second identity.
- **R4** — The key reaches the durable row from every send surface — `TeamService.sendMessage`,
  `spur message send`, `POST /api/messages` — and is readable back on the receipt.
- **R5** — The schema change is additive and reversible: a nullable column plus a partial unique
  index. Old clients that never send a key keep working against the new schema, and new code keeps
  working against an old row with a null key.
- **R6** — Uniqueness is enforced by the database, not by a read-then-write check, so two concurrent
  submissions of the same key cannot both insert.
- **R7** — Probe 3 is rewritten as a regression asserting suppression; probe 4 (competing consumers)
  stays asserted separately.

### Acceptance Criteria

```gherkin
Feature: Idempotency key on message send with receipt replay

  @core
  Scenario: A retried submission is idempotent
    Given a submission carrying a request key that was already accepted
    When the same payload is submitted again
    Then the original receipt is returned and no second request row is created

  @core
  Scenario: A changed payload mints a new identity
    Given a request key that was already accepted
    When a different payload is submitted under a new key
    Then a new request row is created

  @core
  Scenario: Replay survives a restart
    Given an accepted request key
    When the process restarts and the same key is submitted
    Then the original receipt is returned from durable storage
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:08:25.151Z

- **Additive verb vs. widened `enqueue` — closed: additive verb.** Replay must report *that* it
  replayed; that needs an object return, and widening `enqueue`'s `Promise<string>` breaks every
  existing caller including the engine's own `TeamOrchestrator`. `enqueueIdempotent` is the smaller
  non-breaking diff.
- **Conflict on a changed payload — closed: throw.** R3 allowed "error or new identity". A new
  identity would make a client bug (key reuse across different payloads) look like success and put
  two divergent requests into the fleet. Fail loudly.
- **Key scope — closed: globally unique, caller-minted.** Not per-recipient, not derived from the
  body. The submitter owns request identity.
- **Deferred (owner: 0844).** Key generation and the Board's retry UX. This task only stores and
  replays the key.
- **Deferred (owner: 0834).** Surfacing `request_key` in operator output beyond the send receipt.

### Design

**WHAT.** Add a caller-supplied request key to `inbox_messages` and one additive DAO verb that
inserts-or-replays on it.

**WHY a second verb rather than a parameter on `enqueue`.** Replay must tell the caller *whether* it
replayed — the Board renders "accepted" differently from "already accepted". That needs a richer
return than `enqueue`'s `Promise<string>`, and widening the existing return type breaks every current
caller (`TeamOrchestrator`, `TeamService`, tests). One new verb beside the old one is the smaller,
non-breaking diff and keeps R1 literally true.

**WHERE.**

| Layer | Change |
| --- | --- |
| `@gobing-ai/ts-db` (`~/xprojects/ts-libs`) | embedded migration + `InboxMessageDao.enqueueIdempotent` |
| `packages/app/src/services/team-service.ts:316-331` | optional `requestKey` on `sendMessage` |
| `apps/cli/src/commands/message.ts:28` | `--request-key <key>` on `spur message send` |
| `apps/server/src/modules/messages/index.ts:50-67` | accept `requestKey` in the POST body |

**Frozen names.**

- Column `request_key TEXT` on `inbox_messages`, nullable, no default.
- Index `idx_inbox_messages_request_key` — `CREATE UNIQUE INDEX … ON inbox_messages (request_key)
  WHERE request_key IS NOT NULL`. A **partial** unique index: SQLite lets unlimited NULLs coexist,
  so keyless sends are unaffected while keyed sends are collision-proof (R6).
- Migration tag `0014_inbox_messages_request_key` in ts-db's `embedded-migrations.ts` — one
  `ALTER TABLE … ADD COLUMN` plus the index, appended after the current last tag.
- `InboxMessageDao.enqueueIdempotent(fromId: string | null, toId: string, body: string,
  requestKey: string, inReplyTo?: string): Promise<{ id: string; replayed: boolean }>`.
- `RequestKeyConflictError extends Error` — fields `requestKey`, `existingId`; exported from ts-db.
- `TeamService.sendMessage(fromId, toId, body, replyTo?, requestKey?)` — when `requestKey` is
  present it routes to `enqueueIdempotent` and the returned envelope gains `replayed: boolean`;
  otherwise the existing `enqueue` path and envelope are untouched.
- CLI flag `--request-key <key>`; JSON body field `requestKey`; both surface `replayed` on the receipt.

**Algorithm (`enqueueIdempotent`).**

1. `INSERT` the row with `request_key = requestKey`, `status: 'queued'`, `injectAttempts: 0` —
   the same shape `enqueue` writes today.
2. On success: emit `message.enqueued` exactly as `enqueue` does, return `{ id, replayed: false }`.
3. On a unique-constraint violation: `SELECT` the existing row by `request_key`.
   - Same `body` **and** same `to_id` → return `{ id: existing.id, replayed: true }`, emit nothing.
   - Otherwise → throw `RequestKeyConflictError`.

Insert-first, not check-then-insert: the constraint is the arbiter, so the race is resolved by the
database rather than by a window between two statements (R6).

**Key scope.** The key is globally unique, not scoped per recipient. A request key identifies one
human submission; the same submission addressed to two recipients is two requests and needs two keys.
Callers mint the key (a UUID from the Board composer); this task does not generate keys.

**Anti-patterns — do not implement.**

- Do not add a Spur-local migration for `inbox_messages`; the table belongs to ts-db.
- Do not check for an existing key with a `SELECT` before inserting — that reintroduces the race.
- Do not hash the body into the key; the caller owns request identity, and a content hash would make
  an intentional resend of the same text impossible.
- Do not mutate the existing row on a body conflict, and do not silently mint a second identity.
- Do not change `enqueue`, its signature, or its return type.
- Do not make `request_key` `NOT NULL` or give it a default — keyless sends must stay first-class.

**Handoff.** Task 0844 (Board global input) mints the key and renders `replayed`; task 0834 reads
`request_key` when reporting unresolved requests. The delivery settle path (0831) is untouched by
this task — a replayed send returns the original row, which settles under its own existing state.

### Plan

1. In `~/xprojects/ts-libs`: add `requestKey` to the `inboxMessages` schema definition and append
   embedded migration `0014_inbox_messages_request_key` (ALTER TABLE + partial unique index). (R5)
2. Implement `enqueueIdempotent` with the insert-first / catch-unique / compare-body algorithm and
   export `RequestKeyConflictError`. (R2, R3, R6)
3. ts-db unit tests: fresh insert; same key + same body replays with no new row and no second
   `message.enqueued`; same key + different body throws; two concurrent inserts of one key yield one
   row and one replay; a keyless send still works. (R1, R2, R3, R6)
4. Publish ts-db and bump the workspace dependency (shared with 0831's `release` verb — land both in
   one engine release if the tasks run together).
5. Thread `requestKey` through `TeamService.sendMessage`; add `replayed` to the returned envelope only
   on the keyed path. (R4)
6. Add `--request-key <key>` to `spur message send` and `requestKey` to the `POST /api/messages` body;
   surface `replayed` on both receipts; update the `spur-cli` message reference. (R4)
7. Rewrite probe 3 in `apps/cli/tests/commands/agent-team.test.ts` as a regression asserting one row
   and one delivery for a repeated key; leave probe 4 asserting at-most-once claiming. (R7)
8. `cd apps/cli && bun test tests/commands/message.test.ts tests/commands/agent-team.test.ts`, then
   `bun run spur-check`.

### Solution

Re-audit fixes and current change map:

- `packages/app/src/services/team-service.ts:511` — keyed send uses durable enqueueIdempotent; keyless branch unchanged; receipt carries requestKey
- `apps/cli/tests/commands/message.test.ts:26` — fresh CLI golden path invokes main repeatedly against disk SQLite: replay, new key, conflict, blank-key rejection, exactly two rows
- `apps/server/tests/modules/messages/index.test.ts:70` — fresh POST route test verifies key forwarding and rejects invalid key types/empty keys
- `packages/domain/src/migrations.ts:47` — nullable key and partial unique index; fresh ts-db tests cover concurrent insert arbitration and keyless compatibility
- `apps/cli/tests/commands/agent-team.test.ts:829` — fresh regression asserts one message and one drain delivery; changed body conflicts

Engine origin: @gobing-ai/ts-db `src/inbox-message-dao.ts` line 168 uses insert-first constraint arbitration, and `src/embedded-migrations.ts` line 49 owns the additive key migration. Spur mirrors schema provisioning in its own migration journal (0043); this goal-equivalent exception to the old Design was confirmed during implementation. No new public verb.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/team-service.ts:511` — keyed send uses durable enqueueIdempotent; keyless branch unchanged; receipt carries requestKey |
| R2 | MET | `apps/cli/tests/commands/agent-team.test.ts:829` — fresh regression asserts one message and one drain delivery; changed body conflicts |
| R3 | MET | `apps/cli/tests/commands/message.test.ts:26` — fresh CLI golden path invokes main repeatedly against disk SQLite: replay, new key, conflict, blank-key rejection, exactly two rows |
| R4 | MET | `apps/server/tests/modules/messages/index.test.ts:70` — fresh POST route test verifies key forwarding and rejects invalid key types/empty keys |
| R5 | MET | `packages/domain/src/migrations.ts:47` — nullable key and partial unique index; fresh ts-db tests cover concurrent insert arbitration and keyless compatibility |
| R6 | MET | `packages/domain/src/migrations.ts:47` — nullable key and partial unique index; fresh ts-db tests cover concurrent insert arbitration and keyless compatibility |
| R7 | MET | `apps/cli/tests/commands/agent-team.test.ts:866` — fresh competing-consumer regression preserves atomic one-claim behavior |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: A retried submission is idempotent | MET | test | `apps/cli/tests/commands/agent-team.test.ts:829` — fresh regression asserts one message and one drain delivery; changed body conflicts; command: apps/cli: bun test tests/commands/message.test.ts; apps/server: bun test tests/modules/messages/index.test.ts; ts-libs/packages/db: bun test tests/inbox-message-dao.test.ts (exit 0) |
| Scenario: A changed payload mints a new identity | MET | test | `apps/cli/tests/commands/message.test.ts:26` — fresh CLI golden path invokes main repeatedly against disk SQLite: replay, new key, conflict, blank-key rejection, exactly two rows; command: apps/cli: bun test tests/commands/message.test.ts; apps/server: bun test tests/modules/messages/index.test.ts; ts-libs/packages/db: bun test tests/inbox-message-dao.test.ts (exit 0) |
| Scenario: Replay survives a restart | MET | test | `apps/cli/tests/commands/message.test.ts:26` — fresh CLI golden path invokes main repeatedly against disk SQLite: replay, new key, conflict, blank-key rejection, exactly two rows; command: apps/cli: bun test tests/commands/message.test.ts; apps/server: bun test tests/modules/messages/index.test.ts; ts-libs/packages/db: bun test tests/inbox-message-dao.test.ts (exit 0) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### G61 final forced re-audit — 0832

Verdict: PASS

Review coordinator: inline sp-super-reviewer; functional traceability, SECUA (security, efficiency, correctness, usability, architecture), and architecture-improvement lenses applied to current source. No remaining findings in this task.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | All | `packages/app/src/services/team-service.ts:511` | No remaining findings after fixes and verification against published 0.4.66. |

#### Functional traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/team-service.ts:511` — keyed send uses durable enqueueIdempotent; keyless branch unchanged; receipt carries requestKey |
| R2 | MET | `apps/cli/tests/commands/agent-team.test.ts:829` — fresh regression asserts one message and one drain delivery; changed body conflicts |
| R3 | MET | `apps/cli/tests/commands/message.test.ts:26` — fresh CLI golden path invokes main repeatedly against disk SQLite: replay, new key, conflict, blank-key rejection, exactly two rows |
| R4 | MET | `apps/server/tests/modules/messages/index.test.ts:70` — fresh POST route test verifies key forwarding and rejects invalid key types/empty keys |
| R5 | MET | `packages/domain/src/migrations.ts:47` — nullable key and partial unique index; fresh ts-db tests cover concurrent insert arbitration and keyless compatibility |
| R6 | MET | `packages/domain/src/migrations.ts:47` — nullable key and partial unique index; fresh ts-db tests cover concurrent insert arbitration and keyless compatibility |
| R7 | MET | `apps/cli/tests/commands/agent-team.test.ts:866` — fresh competing-consumer regression preserves atomic one-claim behavior |


Verification: final bun run spur-check exit 0 (8498 tests, 0 failures; 99.21% functions / 98.99% lines), bun run test-cf exit 0 (1 test), bun run build exit 0. Published ts-ai-runner 0.4.66 is installed; its probe verifies acceptance only after process creation. Focused evidence and Design corrections are recorded in Testing and Solution.

--next: no-op — task already terminal (done). All four G61 tasks are re-verified against the final dependency and code state.

### References

- Parent feature: [G61 — Durable project command and result loop](../features/G61_durable-project-command-and-result-loop.md)
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §3 probe 3, §5.3; [strategy prototype](../reports/g6-strategy-prototype.md) §4.1
- Intended UX semantics: [projects prototype](../reports/g6-projects-prototype.md) R2-4, R2-5, R3-6
- Engine repo: `~/xprojects/ts-libs` (`@gobing-ai/ts-db`, installed 0.4.62)

### History

- 2026-09-12T04:57:17.749Z backlog → todo (system)
- 2026-09-12T05:54:14.063Z todo → wip (system)
- 2026-09-12T06:51:23.635Z wip → testing (system)
- 2026-09-12T06:51:32.964Z testing → done (system)

