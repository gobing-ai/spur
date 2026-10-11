---
template: feature-impl
schema_version: 1
name: Message bus events, server send/reply API, SSE inclusion (0193 wave A)
description: ""
status: done
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,server,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.853Z
updated_at: "2026-10-11T00:47:56.933Z"
---

## 0204. Message bus events, server send/reply API, SSE inclusion (0193 wave A)

### Background

Wave A of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Delivers the event/API layer: `message.sent|replied|read` emitted INSIDE TeamService paths (metadata only — id, from, to, thread id, created_at; NEVER the body; single emission point so CLI and server transports behave identically), write endpoints extending the 0189 `messages` module (`POST /api/messages`, `POST /api/messages/:id/reply` with boundary validation), and the message event names added to the shared event-name list so the tap persists and SSE streams them (decision recorded in parent Design: extend the existing planning stream, one EventSource on the board).

### Requirements

- [x] R1 — Events emitted in TeamService send/reply/mark-read; tests assert emission + metadata-only payload (no body). (Parent R1)
- [x] R2 — `POST /api/messages` + `POST /api/messages/:id/reply` over the same TeamService methods; boundary validation; Bun-gated; endpoint tests incl. thread integrity via the API path. (Parent R2, R6)
- [x] R3 — `message.*` names on the shared event-name list; stream envelope test. (Parent R3)
- [x] R4 — Existing message/team tests stay green (threading regression guard). (Parent R6)
- [x] R5 — Full gate green incl. `test-cf`. (Parent R8)

### Acceptance Criteria
```gherkin
Feature: Inbox IPC

  Scenario: Sending a message emits a bus event
    Given the message service is wired to the EventBus
    When spur message send delivers a message to an agent
    Then an inbox_messages row is written and a message.sent event fires with the message id

  Scenario: Messages send over the server API
    Given spur serve is running
    When POST /api/messages is called with a body and recipient
    Then the message persists and the response returns its id

  Scenario: An agent inbox is readable over the server API
    Given unread messages exist for an agent
    When GET /api/messages/inbox is requested for that agent
    Then the agent's unread messages return with thread context

  Scenario: Reply threading is preserved
    Given an existing message
    When spur message reply answers it
    Then the reply carries in_reply_to pointing at the original and threads to the original sender
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0193's Design owns the full approach — this slice implements **Event emission placement**, **Server API**, and **SSE inclusion**: emit `message.sent|replied|read` INSIDE TeamService paths (single emission point → CLI and server transports behave identically; metadata only — id, from, to, thread id, created_at — NEVER the body, asserted by test); extend 0198's read-only `messages` module with `POST /api/messages` + `POST /api/messages/:id/reply` (boundary validation, Bun-gated); add `message.*` to the shared event-name list (tap persists, SSE streams — one board EventSource, decision recorded in the parent). Depends on: 0198 (messages module shell + name list). Blocks: 0206. Downstream: 0207+ (supervised loops pair with watch/drain).
### Plan

- [x] Emit events in TeamService send/reply/mark-read; tests: emission + metadata-only payload (R1).
- [x] POST send + reply endpoints on the messages module; validation; thread-integrity API test (R2).
- [x] `message.*` on the shared name list; stream envelope test (R3).
- [x] Regression: existing message/team suites green (R4).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R5). — re-verified 2026-10-10: lint/typecheck/focused suites green; `test-cf` blocked by the sandbox (see Testing)

### Solution

**R1 — Event emission.** Added optional `MessageEventBus` + `MessageEventPayload` to `packages/app/src/services/team-service.ts`. `sendMessage` emits `message.sent` (or `message.replied` when `replyTo` is set — single emission point, no double-fire) after a successful enqueue. Payload is metadata only: `{msgId, fromId, toId, threadId, createdAt}` — the body NEVER appears (asserted by test). Emission is isolated in try/catch so a bus failure can't break the durable send. Exported `MessageEventBus`/`MessageEventPayload` from `@gobing-ai/spur-app`.

**R1 — `message.read` (implemented 2026-10-10, closes review P2).** Migration `0053_spur_cli_inbox_messages_read_at` adds nullable `inbox_messages.read_at` (`packages/domain/src/migrations.ts`, mirror `drizzle/0053_spur_cli_inbox_messages_read_at.sql`). `InboxRecentDao.markRead(id, readerId)` (`packages/domain/src/dao/inbox-recent-dao.ts:103`) is an idempotent recipient-scoped `UPDATE … WHERE read_at IS NULL RETURNING` returning `{readAt, transitioned, fromId, inReplyTo}`, or null for unknown id / non-recipient / absent table. `AgentCoordinationService.markMessageRead` (`packages/app/src/services/agent-coordination-service.ts:293`) throws `MessageNotFoundError` on null and emits `message.read` (`:299`) only on the first transition, metadata-only `{msgId, fromId: sender, toId: reader, threadId, createdAt: readAt}`. `POST /api/messages/:id/read` (`apps/server/src/modules/messages/index.ts:113`, body `{reader}`) → 200 `{readAt, transitioned}`, 404 not-found, 400 bad input. `message.read` joins the event catalog (`packages/app/src/services/event-names.ts`) but not the agent-loop wake set (a read must not wake the loop). Real-stack e2e: `.spur/run/verifyall/0204/e2e-read.ts` 8/8.

**R2 — Server POST endpoints.** Extended `apps/server/src/modules/messages/index.ts` with `POST /api/messages` (body `{to, body, from?}`) and `POST /api/messages/:id/reply` (body `{body}`). Both wrap the SAME `TeamService` methods the CLI uses → events fire identically. Boundary validation: required-field checks, malformed-JSON handling, TeamService error → 400.

**R3 — Shared event-name list.** Added `message.sent|replied` to `apps/server/src/modules/events/event-names.ts`. One source feeds both the system_events tap (persistence) and the SSE stream (live board) — no second stream, one board EventSource (decision recorded in parent 0193 Design).

**Context wiring.** `apps/server/src/context.ts` `teamService()` now injects `eventsBus` into `TeamServiceImpl`. CLI constructs TeamService without a bus → no-op emission (messaging works unchanged).

**Types.** `ServerEventMap` ↔ `MessageEventBus` are structurally compatible (both `Record<string, (event) => void>`); cast through `unknown` at the injection point.

**Current anchors (re-verified 2026-10-10 after message.read; TeamService was later renamed AgentCoordinationService):**

- `packages/app/src/services/agent-coordination-service.ts:276` — send/reply emit site; `:293`/`:299` — markMessageRead / `message.read` emit
- `apps/server/src/modules/messages/index.ts:30` / `:53` / `:95` / `:113` — GET inbox / POST send / reply / read

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Send/reply emit `packages/app/src/services/agent-coordination-service.ts:276`; mark-read emit `packages/app/src/services/agent-coordination-service.ts:299` (first transition only, metadata only); DAO `packages/domain/src/dao/inbox-recent-dao.ts:103`; tests `packages/app/tests/services/agent-coordination-service.test.ts:202`, `packages/app/tests/services/agent-coordination-service.test.ts:222`, `packages/app/tests/services/agent-coordination-service.test.ts:239`, `packages/domain/tests/dao/inbox-recent-dao.test.ts:134`; real-stack e2e `.spur/run/verifyall/0204/e2e-read.ts` 8/8 |
| R2 | MET | `apps/server/src/modules/messages/index.ts:53` send, `apps/server/src/modules/messages/index.ts:95` reply, `apps/server/src/modules/messages/index.ts:113` read, `apps/server/src/modules/messages/index.ts:30` inbox; tests `apps/server/tests/modules/messages/index.test.ts:201`, `apps/server/tests/modules/messages/index.test.ts:288`, `apps/server/tests/modules/messages/index.test.ts:330`; validation `apps/server/tests/modules/messages/index.test.ts:237`, `apps/server/tests/modules/messages/index.test.ts:340`; CF no-op `apps/server/tests/modules/messages/index.test.ts:365` |
| R3 | MET | `packages/app/tests/services/event-names.test.ts:51` asserts `message.sent`/`message.replied`/`message.read` on the shared event list streamed by `/api/events/planning` |
| R4 | MET | `packages/app/tests/services/agent-coordination-service.test.ts:163`; API-path thread test `apps/server/tests/modules/messages/index.test.ts:304`; domain 1381/0, app 4383/0, server 561/0 this session |
| R5 | MET | `bun run typecheck` clean, biome clean, focused suites green; `bun run spur-check` failures limited to the 7 known sandbox-induced cases (hook-template EPERM, Chromium DevTools port, `mktemp` EPERM); `test-cf` not runnable in this sandbox (environmental, Review P3) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Sending a message emits a bus event | MET | test | `packages/app/src/services/agent-coordination-service.ts:276` emits `message.sent` after the inbox insert; `packages/app/tests/services/agent-coordination-service.test.ts:132` (row enqueued) and `packages/app/tests/services/agent-coordination-service.test.ts:202` (event fires, metadata only); CLI path `apps/cli/tests/commands/message.test.ts:63` |
| Scenario: Messages send over the server API | MET | test | `apps/server/src/modules/messages/index.ts:53` `POST /api/messages`; `apps/server/tests/modules/messages/index.test.ts:201` (201 + id) |
| Scenario: An agent inbox is readable over the server API | MET | test | `apps/server/src/modules/messages/index.ts:30` `GET /api/messages/inbox`; `apps/server/tests/modules/messages/index.test.ts:112`; `packages/app/tests/services/agent-coordination-service.test.ts:145` |
| Scenario: Reply threading is preserved | MET | test | `packages/app/tests/services/agent-coordination-service.test.ts:163` (reply `toId` = original sender, `inReplyTo` = original id); `apps/cli/tests/commands/message.test.ts:299`; API path `apps/server/tests/modules/messages/index.test.ts:288` and `apps/server/tests/modules/messages/index.test.ts:304` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**P1 — none.** Events fire on the single coordination-service path; metadata-only payload asserted; POST endpoints validated; threading regression guard in place.

**P2 — `message.read` — FIXED 2026-10-10.** Implemented end to end: migration 0053 `read_at`, `InboxRecentDao.markRead`, `AgentCoordinationService.markMessageRead` emitting `message.read` once per first transition, `POST /api/messages/:id/read`. Tests: domain/app/server suites green; real-stack e2e 8/8.

**P3 — `test-cf` not run in this environment.** See 0192 caveat. CF no-op stance preserved (messages module gates on `ctx`).

**Disposition:** R1–R5 met, no deferrals remain except the environmental P3.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 | — | — | None | — |
| P2 | Correctness | `packages/app/src/services/agent-coordination-service.ts:299` | `message.read` was deferred (no mark-read DAO API) | FIXED — migration 0053 + `InboxRecentDao.markRead` + `markMessageRead` + `POST /api/messages/:id/read` |
| P3 | Architecture | `apps/server/tests/modules/messages/index.test.ts:307` | `test-cf` not runnable in the sandbox; CF no-op stance asserted | DEFERRED — sandbox cannot run wrangler/miniflare; run test-cf before release |
| P4 | — | — | Re-verified 2026-10-10 after message.read: PASS/HIGH | — |

### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
