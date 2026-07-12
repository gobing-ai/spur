---
template: feature-impl
schema_version: 1
name: "Tool Using live: SSE stream + cursor pagination (replace Live poll)"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-12T22:48:20.425Z"
updated_at: "2026-07-12T22:59:15.063Z"
---

## 0247. Tool Using live: SSE stream + cursor pagination (replace Live poll)

### Background
## Why

0245 Live checkbox **polls every 3s**. Operator wants **SSE live tail** like System Events, plus
cursor pagination for history older than the default window. Depends on **0246** for stable event
identity / schema.

## Goal

Replace poll-as-primary with **fs.watch-driven SSE** + **GET cursor pagination**; keep poll only
as degraded fallback when EventSource is unavailable.

## Source

Brainstorm Task B; System Events pattern (`/api/events/history` + `/api/events/planning` SSE).
### Requirements
- [ ] R1. **Cursor pagination** on `GET /api/observability/tool-use`:
      `?limit=` (default 200 max 1000) + `?before=<ISO ts>` (optional) returns events strictly older
      than `before`, newest-first within page; response includes `nextBefore` (or null) for load-more.
- [ ] R2. **SSE endpoint** e.g. `GET /api/observability/tool-use/stream` (or under events module):
      when token-ledger.jsonl grows, push new-line events (parsed) to subscribers. Use `fs.watch` /
      watchFile on ledger path; fail soft if watch unsupported.
- [ ] R3. **ToolUsingTab Live**: when Live on, open EventSource (System Events style liveness);
      prepend new events; when Live off, close stream. Initial load still GET.
- [ ] R4. **Load more** control fetches next page via `before=` without full reload.
- [ ] R5. **Remove 3s poll as primary** when EventSource available; optional poll fallback only if
      `EventSource` undefined or stream errors repeatedly (document policy).
- [ ] R6. Hooks **unchanged** in this task (still append-only file) — no HTTP from hooks.
- [ ] R7. Tests: pagination unit/service; SSE smoke if pattern exists; web Live stream mock.
- [ ] R8. Docs §7.8b update for stream + cursor (T3).
### Acceptance Criteria
```gherkin
Feature: Tool Using SSE and cursor pagination

  @core
  Scenario: R1 Cursor returns older page
    Given more than 200 ledger events exist
    When GET /api/observability/tool-use?limit=50 then again with before=oldestTsOfPage
    Then the second page contains only events older than before
    And pages do not duplicate events

  @core
  Scenario: R2 Live SSE prepends new tool events
    Given Tool Using is open with Live on and SSE connected
    When a new line is appended to token-ledger.jsonl
    Then the new event appears at the top without a full page reload

  @core
  Scenario: R3 Live off closes the stream
    Given Live is on with an open EventSource
    When the operator unchecks Live
    Then the EventSource is closed and no further prepends occur

  @edge
  Scenario: R4 EventSource unavailable falls back gracefully
    Given EventSource is undefined
    When Live is on
    Then the tab still shows data via GET (poll fallback or single load — documented)
```
### Q&A
| Q | A |
| --- | --- |
| Depends on | 0246 (schema/seq preferred) |
| Transport | fs.watch + SSE; hooks stay file-only |
| Poll | Fallback only |
| Pattern | System Events tab |
### Design
## Chosen approach

**Observe plane:** reverse-tail GET with cursor + filesystem watch SSE fan-out.

| Concern | Decision |
| --- | --- |
| Watch | `fs.watch` on ledger file; debounce; read new bytes from last size |
| Multi-client | Server module holds subscribers; serve process only |
| Cursor | `before` = exclusive upper bound on `ts` (document tie-break with seq if needed) |
| UI | Mirror SystemEventsTab EventSource + liveness strip lite |

## Risks

- Editors that replace files may restart watch — re-bind on rename.
- ts ties: prefer seq from 0246 for stable pagination.
### Plan
1. [ ] Extend TokenLedgerService with before/cursor tail
2. [ ] Mount GET pagination params + SSE stream route
3. [ ] Wire fs.watch lifecycle on serve (cleanup on shutdown)
4. [ ] Rewrite ToolUsingTab Live to EventSource + load-more
5. [ ] Tests + design doc
### Solution
| File:line | What / why |
| --- | --- |
| `packages/app/src/services/token-ledger-service.ts:1-230` | `before` cursor on reverse-tail; `nextBefore`; `path` getter |
| `packages/app/src/services/token-ledger-watcher.ts:1-180` | fs.watch + byte poll; subscribe fan-out for SSE |
| `packages/app/src/index.ts:180-200` | Export watcher + snapshot options |
| `packages/app/tests/services/token-ledger-service.test.ts:210-250` | Pagination page1/page2 no overlap |
| `packages/app/tests/services/token-ledger-watcher.test.ts:1-70` | Append emit + unsubscribe |
| `apps/server/src/modules/observability/index.ts:1-160` | GET `before=`; SSE `/tool-use/stream` |
| `apps/server/tests/modules/observability/index.test.ts:90-180` | before opts + SSE content-type |
| `apps/web/src/modules/observability/ToolUsingTab.tsx:1-360` | SSE Live primary; poll fallback; Load older |
| `apps/web/tests/modules/observability/components.test.tsx:810-980` | SSE prepend + load more |
| `docs/04_DESIGN.md:912-930` | Stream + cursor contract (§7.8b) |

**Why:** Replace 3s poll with System Events–style SSE + cursor pagination; hooks stay file-append only.
### Testing
**Commands (this verify turn, 2026-07-12 re-audit --force)**

```
bun test packages/app/tests/services/token-ledger-service.test.ts \
  packages/app/tests/services/token-ledger-watcher.test.ts \
  apps/server/tests/modules/observability/index.test.ts \
  apps/web/tests/modules/observability/components.test.tsx
→ 55 pass, 0 fail (247 expect calls)

bun test packages/app/tests/services/token-ledger-service.test.ts \
  packages/app/tests/services/token-ledger-watcher.test.ts --coverage
→ 15 pass; token-ledger-service lines 95.93%; token-ledger-watcher lines 97.70%
```

Coverage: N/A as monorepo aggregate gate for the 4-file run (exit 1 from unrelated 0%-covered packages loaded into report); **scoped** ledger service/watcher lines ≥95%.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 Cursor pagination | MET | `token-ledger-service.ts:155-156,214` (`before` exclusive; `nextBefore`); server `index.ts:61-63`; test `token-ledger-service.test.ts:217-247` page1/page2 no overlap |
| R2 SSE stream | MET | `token-ledger-watcher.ts:41-52,114-157` fs.watch + byte poll fail-soft; server `index.ts:71-147` `/tool-use/stream`; test `index.test.ts:133-158` SSE content-type |
| R3 Live SSE | MET | `ToolUsingTab.tsx:121-179` EventSource primary; test `components.test.tsx:907-959` FakeEventSource prepend + close on unmount |
| R4 Load more | MET | `ToolUsingTab.tsx:181-204` + `data-load-more`; test `components.test.tsx:962+` `before=` fetch |
| R5 Poll fallback | MET | `ToolUsingTab.tsx:128-133` when `EventSource === undefined` → 3s poll; primary path is SSE |
| R6 Hooks unchanged | MET | 0247 Solution map has no hook files; hooks stay append-only JSONL (0246 hook edits are sibling scope) |
| R7 Tests | MET | service pagination + watcher emit/unsub + server before/SSE + web SSE/load-more — 55 pass this turn |
| R8 Design | MET | `docs/04_DESIGN.md:907-926` §7.8b stream + cursor + nextBefore + Live SSE/poll policy |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 Cursor returns older page | MET | test | `token-ledger-service.test.ts:217-247` + server forwards `before` `index.test.ts:124-130` |
| Scenario: R2 Live SSE prepends new tool events | MET | test | `components.test.tsx:907-959` tool-use frame prepends write row |
| Scenario: R3 Live off closes the stream | MET | test + static-ref | toggle Live off `components.test.tsx:875-881`; effect cleanup `es.close()` `ToolUsingTab.tsx:175-178` when `live` changes |
| Scenario: R4 EventSource unavailable falls back gracefully | MET | static-ref | `ToolUsingTab.tsx:128-133` poll branch; documented in §7.8b |

**Design conformance:** DONE — reverse-tail `before` + `nextBefore`; fs.watch watcher fan-out; SSE route; UI EventSource primary + Load older; poll fallback only. No silent design deviation.

**SECUA (skim, --focus all):** no blockers/majors. Read-only GET/SSE; fail-soft watch; no hook HTTP; process-local watcher (known multi-serve limitation → 0248/ops follow-up, advisory).
### Review
**Disposition:** PASS — SSE + cursor pagination for Tool Using.

| Priority | Finding | Status |
| --- | --- | --- |
| P1 | None | — |
| P2 | None | — |
| P3 | None | — |
| P4 | Multi-process serve watchers are process-local; hook matcher expand is 0248 | OPEN → follow-up |

**SECUA:** read-only SSE; fail-soft watch; no hook HTTP; poll only when EventSource missing.
### References
- Depends on **0246**
- Sibling **0248**
- Parent context **0245**
- System Events: `SystemEventsTab.tsx`, `/api/events/planning`
- Brainstorm: `docs/plans/2026-07-12-tool-using-followup-0245-brainstorm.md`
### History
- 2026-07-12T22:57:01.034Z todo → wip (system)
- 2026-07-12T22:57:18.298Z wip → testing (system)
- 2026-07-12T22:57:21.184Z testing → done (system)
