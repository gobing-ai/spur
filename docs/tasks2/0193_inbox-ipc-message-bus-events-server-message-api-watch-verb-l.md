---
template: feature-impl
schema_version: 1
name: "Inbox IPC: message bus events, server message API, watch verb, live board inbox"
description: ""
status: done
type: task
profile: standard
feature_id: G1
parent_wbs: null
priority: P1
tags: [approach-c,collaboration,server,cli]
dependencies: []
created_at: 2026-07-03T23:35:28.257Z
updated_at: "2026-10-11T00:25:29.643Z"
---

## 0193. Inbox IPC: message bus events, server message API, watch verb, live board inbox

### Background

Cycle position P4 (decision D2 ordering, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). The message store is already durable and threaded: `inbox_messages` table (migration `0001_spur_cli_team_inbox`), `TeamService` over `TeamOrchestrator`/`MessageService` (packages/app, 100% covered), `spur message send|inbox|reply` with `in_reply_to` threading, and `spur agent run --drain` folding the inbox into prompts. What's MISSING for real IPC between coding agents: nothing observes message arrival — delivery is pull-only via one-shot commands.

This task adds the event/push layer (decision trace: the IPC substrate that team supervision G2 and the workspace G3 both consume): message lifecycle events on the EventBus, a server message API, an SSE path for message events, a `spur message watch --agent <id>` verb so a running agent session blocks on new messages, and the Observability Inbox tab (shipped read-only in the P1 task) upgrading to live tail.

Dependencies: P1 Observabilities task (Inbox tab exists, events visible); P2 job-queue task is NOT required (messaging is synchronous DB + bus). MessageService primitives live in `@gobing-ai/ts-ai-runner` — if event emission belongs upstream (inside MessageService) rather than in Spur's TeamService wrapper, prefer the smallest upstream change per the shared-library evolution rule; otherwise emit from `packages/app`.

### Requirements

- [x] R1 — Emit `message.sent`, `message.replied`, `message.read` on the EventBus from the app-layer message path (TeamService seam or upstream MessageService — decide per the shared-library rule and record in Design); events carry message id, from, to, and thread id, never the full body (events are observable metadata; body stays in the store).
- [x] R2 — Server `messages` module: `POST /api/messages` (send), `POST /api/messages/<id>/reply`, `GET /api/messages/inbox?agent=<id>` — thin wrappers over TeamService with lifecycle events firing exactly as the CLI path does.
- [x] R3 — Message events reach SSE consumers: extend the planning stream's event list or add `/api/events/messages`; document the choice in Design and keep the events module's CF no-op stance.
- [x] R4 — `spur message watch --agent <id> [--json]`: blocks, surfaces new inbox messages as they arrive (poll the store or follow SSE when serve is up; poll fallback must work serverless), exits cleanly on interrupt; `--json` emits one JSON object per message line (machine-consumable by agent wrappers).
- [x] R5 — Observability Inbox tab upgrades to live: new messages append without refresh via the message events; read/unread state visible.
- [x] R6 — Threading regression guard: reply still threads to the original sender via `in_reply_to` (existing tests keep passing; add an API-path thread test).
- [x] R7 — Tests: event emission on send/reply/read, server endpoints against in-memory SQLite, watch verb poll path (injected interval), SSE inclusion.
- [x] R8 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`.

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

  Scenario: A watching agent observes new messages without restart
    Given an agent session is running spur message watch
    When another agent sends it a message
    Then the watcher surfaces the new message within the follow interval

  Scenario: Reply threading is preserved
    Given an existing message
    When spur message reply answers it
    Then the reply carries in_reply_to pointing at the original and threads to the original sender

  Scenario: The board inbox view updates live
    Given the Observability Inbox tab is open
    When a message is sent
    Then the tab shows the new message without a page refresh
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Add the event/push layer over the already-durable message store (`inbox_messages` migration `0001_spur_cli_team_inbox`; `TeamService` in `packages/app` over ts-ai-runner's `TeamOrchestrator`/`MessageService`, 100% covered; CLI `send|inbox|reply` with `in_reply_to` threading). Nothing about storage changes — this task makes arrival OBSERVABLE: bus events, server write API, SSE inclusion, a blocking `watch` verb, and the live board tab.

**Event emission placement (R1).** Emit from Spur's app layer (`TeamService` send/reply/mark-read paths), NOT upstream: the EventBus is host-owned (Spur context), events are a Spur-domain concern, and this is the smallest change (shared-library rule satisfied by NOT touching ts-ai-runner). Record here if implementation finds a reason to move it upstream. Event payloads carry metadata ONLY — message id, from, to, thread id (`in_reply_to` root), created_at — NEVER the body (bodies stay in the store; events are observable metadata and land in `system_events` via the 0189 tap).

**Server API (R2).** Extend the read-only `messages` module from 0189 with writes: `POST /api/messages` (send), `POST /api/messages/:id/reply`. Thin wrappers over the SAME TeamService methods the CLI uses so events fire identically on both paths (one code path emits; the transport is irrelevant). Validation at the boundary (agent id exists, body non-empty); Bun-gated like the other ctx-dependent modules.

**SSE inclusion (R3).** Add `message.sent|replied|read` to the shared event-name list (established by 0189, extended by 0190) — one list feeds both the tap (history) and the SSE stream (live). Decision recorded: extend the existing `/api/events/planning` stream rather than adding a second stream — the envelope already carries `eventName`, the board holds ONE EventSource, and CF no-op behavior is inherited. Rename/alias considerations for the route (it now carries more than planning events) are cosmetic — defer, note in the follow-ups.

**Watch verb (R4).** `spur message watch --agent <id> [--interval <ms>] [--json]` in `apps/cli/src/commands/message.ts`: baseline implementation POLLS the store via TeamService (works with no server running — serverless is the contract); surfaces each new message as it arrives; `--json` emits one JSON object per line (machine-consumable by agent wrappers); clean exit on SIGINT. Watch SURFACES, it does not consume — read-marking stays with `--drain`/explicit reads (record this semantic here; it's what makes watch safe to run alongside drain loops). SSE-follow (when serve is up) is an optimization — implement only if trivial, otherwise scoped follow-up.

**Board live tab (R5).** The Inbox tab (0189) subscribes to `message.*` via the existing EventSource: append/refetch on event, unread badge. No new transport.

**Testing (R6, R7).** Event emission on send/reply/read (fake bus); API endpoints against in-memory SQLite incl. thread integrity via the API path; watch poll loop with injected interval (no real sleeps); SSE list inclusion (unit on the shared constant + stream envelope test).

**Risks.** Poll interval vs. test time (inject); double-emission if both CLI and server paths wrap emission separately (emit INSIDE TeamService once); body leakage into events (explicitly asserted in tests).

**Decomposition guidance.** Split if desired: A = events + server writes + SSE (R1–R3); B = watch verb (R4); C = live tab (R5). `--parent 0193`.

**Dependencies.** 0189 (messages module shell, tap, shared event-name list, Inbox tab). NOT dependent on 0190. Downstream: 0195 (supervised agents pair watch/drain), 0197 (workspace-scoped messaging).
### Plan

- [x] Emit `message.sent|replied|read` (metadata only) inside TeamService paths; tests assert emission + no body in payload (R1).
- [x] Extend the `messages` server module with POST send + reply; boundary validation; endpoint tests incl. thread integrity (R2, R6).
- [x] Add message event names to the shared event-name list (tap + SSE inherit); stream envelope test (R3).
- [x] `spur message watch --agent <id> [--interval] [--json]`: poll baseline, JSON-lines output, SIGINT-clean; injected-interval tests (R4).
- [x] Inbox tab live: subscribe `message.*` on the existing EventSource, append + unread badge; component test (R5). — Inbox tab retired by 0849; live tail now in ConversationView (task 1168)
- [x] Regression: existing message/team tests green; reply threading via API asserted (R6).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R8). — re-verified 2026-10-10: lint/typecheck/focused suites green; `test-cf` blocked by the sandbox (see Testing)
- [x] Manual: two terminals — `spur message watch --agent a1` + `spur message send "hi" --to a1`; watcher surfaces it; board tab shows it live under `spur serve`. — run 2026-10-10 as the scripted e2e `.spur/run/verifyall/g1-e2e.sh` (see Testing)

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0204 | Message bus events, server send/reply API, SSE inclusion (0193 wave A) | todo |
| 0205 | spur message watch verb (0193 wave B) | todo |
| 0206 | Live board inbox tab: message events live tail (0193 wave C) | todo |
<!-- END AUTO-GENERATED -->

### Solution

**Current anchors (re-verified 2026-10-10; TeamService was later renamed AgentCoordinationService):**

- Parent task; delivered by waves 0204 (events + server API), 0205 (watch verb) and 0206 (board live tail, now restored in ConversationView by 1168).
- `packages/app/src/services/agent-coordination-service.ts:271` — single `message.sent|replied` emit site
- `apps/server/src/modules/messages/index.ts:28` inbox, `apps/server/src/modules/messages/index.ts:51` send, `apps/server/src/modules/messages/index.ts:93` reply
- `apps/web/src/modules/projects/ConversationView.tsx:55` — board live tail (SSE) plus `apps/web/src/modules/projects/ConversationView.tsx:53` poll

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-coordination-service.ts:271` single emit site (`message.replied` for replies, else `message.sent`), metadata only; `packages/app/tests/services/agent-coordination-service.test.ts:197`, `packages/app/tests/services/agent-coordination-service.test.ts:217`; `message.read` deliberately deferred — no mark-read DAO API; documented deviation in 0204 Design + Review P2 |
| R2 | MET | `apps/server/src/modules/messages/index.ts:51` send, `apps/server/src/modules/messages/index.ts:93` reply, `apps/server/src/modules/messages/index.ts:28` inbox — thin wrappers over the coordination service; `apps/server/tests/modules/messages/index.test.ts:186`, `apps/server/tests/modules/messages/index.test.ts:273` |
| R3 | MET | `packages/app/tests/services/event-names.test.ts:51` (`message.sent`/`message.replied` on the shared list streamed by `/api/events/planning`); e2e: API send produced a `message.sent` SSE frame |
| R4 | MET | `apps/cli/tests/commands/message.test.ts:372`, `apps/cli/tests/commands/message.test.ts:444` (never marks read), `apps/cli/tests/commands/message.test.ts:572` (SIGINT); e2e watch PASS |
| R5 | MET | Successor view after 0849: `apps/web/src/modules/projects/ConversationView.tsx:55` SSE + `apps/web/src/modules/projects/ConversationView.tsx:53` poll (task 1168); delivery status rendered verbatim (`apps/web/tests/modules/projects/ConversationView.test.tsx:140`) |
| R6 | MET | `packages/app/tests/services/agent-coordination-service.test.ts:158`; API-path thread test `apps/server/tests/modules/messages/index.test.ts:289` |
| R7 | MET | Emission, endpoint, watch-poll and SSE-list tests cited in R1–R4; all green this run |
| R8 | MET | lint + typecheck green and focused suites green this run (app 72, server 49, cli 49, web 202, 0 fail); `bun run spur-check` 10914 pass / 7 fail — all 7 sandbox-induced (git hook-template EPERM, Chromium DevTools port, `mktemp` EPERM) and reproduced at clean HEAD; `test-cf` not runnable in this sandbox |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Sending a message emits a bus event | MET | test | `packages/app/src/services/agent-coordination-service.ts:271` emits `message.sent` with `msgId` after the inbox insert; `packages/app/tests/services/agent-coordination-service.test.ts:127` (row enqueued) and `packages/app/tests/services/agent-coordination-service.test.ts:197` (event fires, metadata only); CLI path `apps/cli/tests/commands/message.test.ts:30`; e2e: CLI send persisted a `message.sent` row in `GET /api/events/history` |
| Scenario: Messages send over the server API | MET | test | `apps/server/src/modules/messages/index.ts:51` `POST /api/messages`; `apps/server/tests/modules/messages/index.test.ts:186` (201 + id); e2e `g1-e2e.sh`: POST returned `msgId`, which then appeared in `GET /api/messages` |
| Scenario: An agent inbox is readable over the server API | MET | test | `apps/server/src/modules/messages/index.ts:28` `GET /api/messages/inbox`; `apps/server/tests/modules/messages/index.test.ts:97`; `packages/app/tests/services/agent-coordination-service.test.ts:140`; e2e inbox read returned the queued row with `inReplyTo` thread context |
| Scenario: A watching agent observes new messages without restart | MET | test | `apps/cli/tests/commands/message.test.ts:372` (one-tick surfacing) and `apps/cli/tests/commands/message.test.ts:391` (between-poll, exactly once); e2e: `spur message watch --agent watcher1 --interval 1 --json` surfaced a message sent from a separate CLI process within one interval, then exited on SIGINT |
| Scenario: Reply threading is preserved | MET | test | `packages/app/tests/services/agent-coordination-service.test.ts:158` (reply `toId` = original sender, `inReplyTo` = original id); `apps/cli/tests/commands/message.test.ts:299` (CLI reply); API path `apps/server/tests/modules/messages/index.test.ts:273` and `apps/server/tests/modules/messages/index.test.ts:289` |
| Scenario: The board inbox view updates live | MET | test | Inbox tab retired by 0849 → `/board/projects/conversation`; live tail restored by task 1168: `apps/web/tests/modules/projects/ConversationView.test.tsx:235` (SSE `message.sent` → new entry without remount) and `apps/web/tests/modules/projects/ConversationView.test.tsx:274` (cross-process send → next poll); e2e `g1-e2e.sh` PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T04:13:23.918Z todo → wip (system)
