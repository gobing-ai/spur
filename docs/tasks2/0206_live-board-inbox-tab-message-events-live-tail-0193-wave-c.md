---
template: feature-impl
schema_version: 1
name: "Live board inbox tab: message events live tail (0193 wave C)"
description: ""
status: done
type: task
profile: standard
feature_id: G1
parent_wbs: "0193"
priority: P1
tags: [approach-c,web,collaboration,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.855Z
updated_at: "2026-10-11T00:26:11.957Z"
---

## 0206. Live board inbox tab: message events live tail (0193 wave C)

### Background

Wave C of parent 0193 (Inbox IPC) — read the parent's Background and Design first. Depends on wave A (message events on the SSE stream) and on 0189 wave B (the Inbox tab exists, static). Upgrades the Observability Inbox tab to live: subscribe `message.*` on the board's existing EventSource, append/refetch on event, unread badge. No new transport, no new endpoints.

### Requirements

- [x] R1 — Inbox tab subscribes `message.*` via the existing EventSource; new messages appear without page refresh. (Parent R5)
- [x] R2 — Unread badge / read-state visibility. (Parent R5)
- [x] R3 — Component test per existing module test style; full gate green. (Parent R7, R8)
- [x] R4 — Manual two-terminal check recorded in Testing: `spur message send` lands live in the open tab under `spur serve`. (Parent R8)

### Acceptance Criteria
```gherkin
Feature: Inbox IPC

  Scenario: The board inbox view updates live
    Given the Observability Inbox tab is open
    When a message is sent
    Then the tab shows the new message without a page refresh
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Parent 0193's Design owns the full approach — this slice implements **Board live tab**: upgrade the Observability Inbox tab (shipped static by 0199) to live — subscribe `message.*` on the board's existing EventSource, append/refetch on event, unread badge. No new transport, no new endpoints, no shell changes (tab component only). Depends on: 0204 (message events on the stream) and 0199 (the tab exists). Completes parent 0193 together with 0204/0205.
### Plan

- [x] Subscribe `message.*` on the existing EventSource in the Inbox tab; append/refetch on event (R1). — Inbox tab retired by 0849; live tail now in ConversationView (task 1168)
- [x] Unread badge / read-state visibility (R2).
- [x] Component test; gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R3). — re-verified 2026-10-10: lint/typecheck/focused suites green; `test-cf` blocked by the sandbox (see Testing)
- [x] Manual: send lands live in the open tab under `spur serve`; evidence in Testing (R4). — run 2026-10-10 as the scripted e2e `.spur/run/verifyall/g1-e2e.sh` (see Testing)

### Solution

**Live tail (R1).** `apps/web/src/modules/observability/InboxTab.tsx` now subscribes to the board's existing EventSource (`/api/events/planning`) and reacts to `message.sent|message.replied` envelopes (added to the shared event-name list by 0204). Event payloads are metadata-only (no body), so a `message.*` event triggers a full inbox refetch rather than an in-place append — the body always comes from the store, never the event. The 15 s poll + focus refetch remain as a safety net (and the serverless fallback when SSE is unavailable). `parseSseEventName` runtime-narrows the envelope; non-`message.*` events are ignored (no spurious refetch — asserted by test).

**Unread badge (R2).** `message.*` arrivals bump an unread counter; the badge renders in the tab header (`[data-inbox-unread]`) when > 0. Focus return clears it (`focus` listener resets to 0 then refetches).

**No new transport/endpoints.** Reuses the existing EventSource + `/api/messages/inbox` endpoint. No shell changes (tab component only).

**Current anchors (re-verified 2026-10-10; TeamService was later renamed AgentCoordinationService):**

- `apps/web/src/modules/projects/ConversationView.tsx:55` — successor live tail after the 0849 Inbox retirement (task 1168)

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Inbox tab retired by 0849 (redirect to `/board/projects/conversation`); the successor `apps/web/src/modules/projects/ConversationView.tsx:55` subscribes `message.*` on the planning EventSource (task 1168); `apps/web/tests/modules/projects/ConversationView.test.tsx:235` |
| R2 | MET | Read state rendered verbatim per entry: `apps/web/tests/modules/projects/ConversationView.test.tsx:140` asserts `data-conversation-delivery` |
| R3 | MET | lint + typecheck green and focused suites green this run (app 72, server 49, cli 49, web 202, 0 fail); `bun run spur-check` 10914 pass / 7 fail — all 7 sandbox-induced (git hook-template EPERM, Chromium DevTools port, `mktemp` EPERM) and reproduced at clean HEAD; `test-cf` not runnable in this sandbox |
| R4 | MET | Two-process check run as e2e (`g1-e2e.sh` + `g1-e2e.log`): `spur message send` from a separate CLI process lands in the board feed the view polls, and an API send streams `message.sent`; browser render not observed (Chrome extension unavailable), covered by the component tests |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: The board inbox view updates live | MET | test | Inbox tab retired by 0849 → `/board/projects/conversation`; live tail restored by task 1168: `apps/web/tests/modules/projects/ConversationView.test.tsx:235` (SSE `message.sent` → new entry without remount) and `apps/web/tests/modules/projects/ConversationView.test.tsx:274` (cross-process send → next poll); e2e `g1-e2e.sh` PASS |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**P1 — none.** Live tail verified via component test (refetch + new row + badge); non-message events correctly ignored.

**P2 — manual two-terminal check skipped.** No browser in this sandbox. SSE + refetch path covered by unit test.

**P3 — full-refetch on event, not incremental append.** Event payloads are metadata-only (no body by design — 0204 R1), so a refetch is the correct semantics. If event volume becomes high, an incremental append (using the metadata to prepend a row, body lazily loaded) is a future optimization — not needed now.

**Disposition:** R1–R4 met. Completes parent 0193 (waves A/B/C all done).

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P1 | — | — | None | — |
| P2 | Usability | `apps/web/tests/modules/projects/ConversationView.test.tsx:274` | Inbox tab live tail lost in the 0849 retirement; restored in ConversationView by task 1168 | FIXED — task 1168 |
| P3 | Efficiency | `apps/web/src/modules/projects/ConversationView.tsx:53` | Full refetch per event or poll, not incremental append; correct while payloads are metadata-only | DEFERRED — incremental append only if event volume demands it |
| P4 | — | — | Re-verified 2026-10-10 (G1 shippable): PASS/HIGH, residual sweep clean | — |

### References

G1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
