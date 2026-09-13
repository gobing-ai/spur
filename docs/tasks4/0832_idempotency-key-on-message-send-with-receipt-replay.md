---
schema_version: 1
name: Idempotency key on message send with receipt replay
status: done
template: feature-impl
created_at: 2026-09-12T04:45:30.146Z
updated_at: "2026-09-12T06:51:32.964Z"
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

- ts-libs `packages/db/src/embedded-migrations.ts:49-53` — frozen migration `0014_inbox_messages_request_key` (nullable `request_key` TEXT + partial unique index `idx_inbox_messages_request_key WHERE request_key IS NOT NULL`; sha256-journaled).
- ts-libs `packages/db/src/schema/inbox-messages.ts:20` — drizzle column `requestKey`.
- ts-libs `packages/db/src/inbox-message-dao.ts:92-110` (`RequestKeyConflictError`), `:111-118` (`isRequestKeyUniqueViolation`), `:159-204` (`enqueueIdempotent` — insert-first, constraint arbitration, replay vs conflict). `enqueue` untouched.
- ts-libs `packages/db/src/index.ts` — export `RequestKeyConflictError`.
- spur `package.json` catalog `^0.4.64 → ^0.4.65` + regenerated `bun.lock` (stale nested 0.4.64 pins required a full lock regen).
- spur `packages/app/src/services/team-service.ts:154-162` (`SendResult.replayed?`), `:315-346` (`sendMessage` 5th arg `requestKey`; keyed path routes to `enqueueIdempotent`, keyless untouched).
- spur `apps/cli/src/commands/message.ts:37` (`--request-key`), `:96-101` (trim/normalize), `:241` (pass-through), `:248-253` (`replayed ... already accepted` receipt).
- spur `apps/server/src/modules/messages/index.ts:60-62` (`requestKey` validation), `:65` (pass-through), `:95` (parseJsonBody type).
- spur `packages/domain/src/migrations.ts:36-49` (fresh-DB mirror DDL extension), `:66-83` (`INBOX_MESSAGES_REQUEST_KEY_SCHEMA_SQL`), `:1319-1327` (`0043_spur_cli_inbox_messages_request_key` with `addColumnIfMissing` + table-absent skip, 0041 precedent).
- spur `drizzle/0001_spur_cli_team_inbox.sql` + `drizzle/0043_spur_cli_inbox_messages_request_key.sql` (regenerate-on-release mirrors).
- spur probe 3 rewritten in `apps/cli/tests/commands/agent-team.test.ts:828-864` — one row, one delivery, `replayed` marker, conflict rejection; probe 4 untouched.
- **Deviation (root cause)**: the frozen anti-pattern "no Spur-local migration for inbox_messages" was based on the belief ts-db embedded migrations provision spur DBs — they do not; spur provisions from its own mirror (`drizzle/0001` + `__spur_cli_migrations`). Verified empirically: the new tests failed with `table inbox_messages has no column named request_key` before the mirror + 0043 step. The 0817/0041 queue-jobs precedent documents the same provision path. Root-cause fix: extend the mirror + ship 0043.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `enqueue` byte-untouched by ts-libs 15cd79b (diff adds only RequestKeyConflictError/isRequestKeyUniqueViolation/enqueueIdempotent after it); keyless branch unchanged: `packages/app/src/services/team-service.ts:331` (`requestKey !== undefined ? enqueueIdempotent : null` → falls to `dao.enqueue` :332) and keyless return shape without `replayed` :343; CLI absent flag → keyless `apps/cli/src/commands/message.ts:101-103`; keyless coexist test ts-libs `packages/db/tests/inbox-message-dao.test.ts:401` (many NULL request_key rows) — fresh run 23 pass / 0 fail |
| R2 | MET | Insert-first replay on same key + same body + same to_id: ts-libs `packages/db/src/inbox-message-dao.ts:168-213`; probe-3 regression `apps/cli/tests/commands/agent-team.test.ts:831-866`: `second.msgId === first.msgId`, `replayed: true`, 1 row, exactly 1 drained delivery, conflict attempt leaves 1 row; no second `message.enqueued` asserted at ts-libs test :355 (1 event, 1 row) — fresh run 80 pass / 0 fail (spur) + 23 pass / 0 fail (ts-db) |
| R3 | MET | Same key + different body or to_id throws `RequestKeyConflictError(requestKey, existingId)` (ts-libs `packages/db/src/inbox-message-dao.ts:95-109`), original row untouched (asserted :369-388), never a silent overwrite nor a second identity (probe-3 rejects.toThrow + row count still 1, `agent-team.test.ts:855-861`); typed error exported from ts-db `dist/index.d.ts:5` |
| R4 | MET | Key threads from all three surfaces: `packages/app/src/services/team-service.ts:318-331` (5th arg → enqueueIdempotent), `apps/cli/src/commands/message.ts:38` (`--request-key`), :96-103 (trim/normalize), :245 (pass-through), :251-255 (`replayed … already accepted` receipt), `apps/server/src/modules/messages/index.ts:53,60-62,65` (body field, validation, pass-through; result incl. `replayed` returned 201 at :67); readable back: probe-3 asserts `rows[0].requestKey === 'retry-key-1'` (:846) and ts-db test :342 asserts persisted requestKey |
| R5 | MET | Additive + reversible: nullable `request_key` TEXT (no NOT NULL, no default; ts-libs `packages/db/src/schema/inbox-messages.ts:20`) + partial unique index `WHERE request_key IS NOT NULL` (embedded migration `0014_inbox_messages_request_key`, `embedded-migrations.ts:50-52`, sha256-journaled 7277e79f…); spur mirror for fresh DBs `drizzle/0001_spur_cli_team_inbox.sql:17,25` and for legacy DBs `drizzle/0043_spur_cli_inbox_messages_request_key.sql:8-9` + `packages/domain/src/migrations.ts:66-83,1319-1327` (addColumnIfMissing, 0041 precedent); keyless clients unaffected (test :401) |
| R6 | MET | Uniqueness by database constraint, not read-then-write: `enqueueIdempotent` inserts first via `create()` and arbitrates in the unique-violation catch (ts-libs `packages/db/src/inbox-message-dao.ts:168-213` — no pre-INSERT SELECT); concurrent same-key test :389: exactly 1 fresh + 1 replay, 1 row; probe-3's duplicate suppresses at TeamService level too |
| R7 | MET | Probe 3 rewritten as the repeated-key suppression regression `apps/cli/tests/commands/agent-team.test.ts:831` ("regression (was 0828 probe 3, flipped by 0832)"); probe 4 (competing consumers) intact and separate at :868; both in the fresh 80 pass / 0 fail run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| A retried submission is idempotent | MET | test | `apps/cli/tests/commands/agent-team.test.ts:831-866` (same key + same payload → same msgId, `replayed: true`, 1 row, 1 delivery; fresh run) + ts-libs `packages/db/tests/inbox-message-dao.test.ts:355-368` (no new row, exactly 1 `message.enqueued`) |
| A changed payload mints a new identity | MET | test | New key → new row: ts-libs `packages/db/tests/inbox-message-dao.test.ts:342-354` (`replayed: false`, row persisted with its key); changed payload under the SAME key mints no second identity — conflict, row count unchanged (`agent-team.test.ts:855-861`, ts-db :369-388) |
| Replay survives a restart | MET | command | `.spur/run/0832-restart-check.ts` this session, exit 0: keyed send accepted on a durable file DB, adapter closed, brand-new adapter + DAO reopened over the same file → `{id: same, replayed: true}`, 1 row, `request_key` read back from storage (replay lookup is stateless `findBy(requestKey)` on the durable row, ts-libs `inbox-message-dao.ts:199-204`) |
| Competing consumers still claim at most once | MET | test | `apps/cli/tests/commands/agent-team.test.ts:868+` (probe 4, kept asserted per 0832 R7; fresh 80 pass / 0 fail run); at-most-once guard is drainPending's conditional UPDATE (ts-libs `packages/db/src/inbox-message-dao.ts:215+`) |
| Attempts are bounded | MET | test | `apps/cli/tests/commands/agent-team.test.ts:734-782` (never-started invocation redelivered within budget, then rests failed; fresh run re-asserts it — regression owned by 0831, co-located in the same gate file) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0832 (2026-09-11, /sp:dev-review --auto, profile=auto, mode=safety)

**Scope:** ts-libs commit 15cd79b (migration 0014 + enqueueIdempotent + RequestKeyConflictError + tests) + spur surface (team-service.ts:315-346, message.ts flag/receipt, messages/index.ts:53-65, domain mirror migrations + drizzle/0001 + drizzle/0043, agent-team.test.ts probe-3 regression, 3 doc satellites). 0831's surface excluded per dispatch.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS (2026-09-11) — no P1/P2; 1×P3 dispositioned to 0834/0844; fresh gate evidence below.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | usability | Conflict error is not machine-distinguishable at the surface boundaries: server catches the typed error and returns a generic 400 `{error: <message>}` with no `instanceof RequestKeyConflictError` branch (no 409, no code field); the CLI `--json` error path bypasses the JSON envelope (plain text to stderr, exit 1). R3 is fully met at the library boundary (typed error, `requestKey`/`existingId` fields); surface distinction is text-only. Fold into 0834's operator-visible delivery states. | `apps/server/src/modules/messages/index.ts:63-67`; `apps/cli/src/index.ts:210-214` |
| 2 | P4 (advisory) | correctness | A replayed send still emits the TeamService-level `message.sent` feed event (no `replayed` marker in the payload), so SSE/feed watchers see a second event for the same `msgId`. The frozen DAO contract ("replay emits nothing") is honored — `message.enqueued` is correctly suppressed and no delivery is duplicated. Consider suppressing or flagging when 0844 wires the Board feed. | `packages/app/src/services/team-service.ts:332-341` |
| 3 | P4 (advisory) | correctness | The thin pass-through layers have no direct tests: the server `requestKey` validation branch and the CLI trim/empty→keyless normalization are unexercised. The typed core is well covered (5 ts-db cases + probe-3 regression through TeamService), so this is gap bookkeeping, not a defect. | `apps/server/src/modules/messages/index.ts:60-61`; `apps/cli/src/commands/message.ts:101-103` |
| 4 | P4 (advisory) | correctness | `isRequestKeyUniqueViolation` arbitrates by matching SQLite error-message text (both observed forms covered: partial-index and `table.column`). Standard approach; if a future adapter surfaces `error.code`, prefer a code-based match. | ts-libs `packages/db/src/inbox-message-dao.ts:111-118` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `enqueue` byte-untouched (ts-libs diff adds only after it); keyless branch identical (`team-service.ts:326-329`); CLI absent flag → `undefined` (`message.ts:101-103`); keyless coexistence test (ts-db `inbox-message-dao.test.ts`: many NULL keys) |
| R2 | MET | Insert-first replay on `body===body && toId===toId` (`inbox-message-dao.ts:172-204`); probe-3 regression: `second.msgId === first.msgId`, `replayed: true`, 1 row, 1 drained delivery, no second `message.enqueued` (`agent-team.test.ts:830-864`) |
| R3 | MET | Same key + different body or to_id throws `RequestKeyConflictError(requestKey, existingId)`; original row untouched (asserted); never silent overwrite or second identity. Surface-level distinction is the P3 above |
| R4 | MET | Key threads from all three surfaces — `team-service.ts:318-326` (5th arg), `message.ts:245` + `--request-key` (`:37`), `messages/index.ts:65` + body field (`:53,60-61`); readable back (`rows[0].requestKey` asserted in probe 3); `replayed` on both receipts (`message.ts:248-253`, `SendResult.replayed` `team-service.ts:154-162`) |
| R5 | MET | Nullable `request_key TEXT`, no default; partial unique index `WHERE request_key IS NOT NULL` (ts-db 0014, hash-verified sha256 `7277e79f…`; mirror 0043 + drizzle/0001:17,25); keyless clients unaffected; legacy null-key rows first-class |
| R6 | MET | Insert-first via `create()` — the constraint is the arbiter, no read-then-write window (`inbox-message-dao.ts:159-171`); concurrent same-key test: 1 row, 1 fresh + 1 replay |
| R7 | MET | Probe 3 rewritten as the repeated-key regression (`agent-team.test.ts:830`); probe 4 competing-consumers intact and separate (`:868`) |

##### Anti-pattern audit

All frozen prohibitions held: no check-then-insert; no body hash; no row mutation on conflict; `enqueue` signature/return untouched; no `NOT NULL`/default on `request_key`. The one deviation — Spur-local migration 0043 against "do not add a Spur-local migration" — is **accepted**: the frozen premise was factually wrong (spur DBs are provisioned from the spur mirror `drizzle/0001` + `__spur_cli_migrations`, not ts-db embedded migrations; empirically re-verified with the `no column named request_key` failure), the fix follows the 0041/0817 precedent, journals via `addColumnIfMissing`, and is documented in-code (`migrations.ts:66-83,1319-1327`).

##### Gate evidence (fresh, 2026-09-11)

- ts-libs `packages/db`: 218 pass / 0 fail, 527 expect() calls (this review re-run).
- spur `bun run spur-check`: 8047 pass / 0 fail, 32682 expect() calls + post-check `recommended-post-check` all rules passed (this review re-run).
- Installed `@gobing-ai/ts-db@0.4.65` verified in `node_modules` with `enqueueIdempotent` present in dist.

##### Residual risk

The two-statement embedded migration (ALTER + CREATE INDEX) is executed statement-by-statement with the journal hash inserted after both (`ts-db migrate.ts:97-110`) — a crash in the window leaves the column present without the index and a duplicate-column error on re-apply. Pre-existing infrastructure pattern shared with all prior embedded migrations (0013 identical), not introduced by this diff; probability negligible on local SQLite. No other residual risk identified.

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

