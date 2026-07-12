---
template: feature-impl
schema_version: 1
name: "Tool Using v1.1: capture correctness, token cascade, agent fields, UI polish"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-12T22:48:19.168Z"
updated_at: "2026-07-12T22:54:07.650Z"
---

## 0246. Tool Using v1.1: capture correctness, token cascade, agent fields, UI polish

### Background
## Why

Follow-up to **0245** (Tool Using tab). Operators report sparse/confusing data, want better
token estimates, agent/model context, and table UX polish. Investigation shows the API already
returns a 200-row window on spur-new; the real gaps are **row-key collisions**, **sparse recent
tool events** (hooks only for Claude Read/Write/Edit + SessionStart required), and **misleading
tokens=0**.

## Investigation (2026-07-12)

| Finding | Detail |
| --- | --- |
| Ledger size | ~52k lines; API `count=200 truncated=true` healthy |
| Newest rows | Often `session_start`/`session_end` only; last tool write sample 2026-07-11 |
| Hooks | PostToolUse matcher R/W/E only; requires `.session.json`; fail-open drops events |
| React keys | UI key from ts\|session\|type\|file\|tokens → ~45/200 collisions |
| Tokens | `ceil(bytes/4)` only when `tool_response.content` set; Edit often empty |

## Goal

Ship **Tool Using v1.1 capture + UI**: correct row identity, honest tokens, optional agent/model
fields, sparse-state UX, column polish — without SSE (task 0247) or matcher expansion (0248).

## Source

Brainstorm: `docs/plans/2026-07-12-tool-using-followup-0245-brainstorm.md` (Task A). Parent **0245**. Feature **J**.
### Requirements
- [x] R1. **Stable row identity** for Tool Using table: stop colliding React keys (use monotonic
      `seq` from service and/or file offset / index within snapshot). Identical ts/file must still
      render as separate rows.
- [x] R2. **Sparse / empty diagnostics in UI**: when ledger missing, empty, or newest window has
      zero `read`/`write` events, show calm explanation covering (a) hooks only on supported agents,
      (b) SessionStart required, (c) path used. Surface `truncated` + `count` + path in header
      (already partial — strengthen).
- [x] R3. **Token estimate cascade** in `context-post-tool` (and document):
      1) `tool_response.content` / stdout string length
      2) Write: `tool_input.content`
      3) Edit: `old_string`/`new_string` combined
      4) Read: optional file `stat` size if path exists
      5) else omit `tokens` (null) — **never store 0 to mean unknown**
- [x] R4. **Optional ledger fields** (best-effort, never fail logging): `sessionId` (Claude
      `session_id` when present), `agent`, `model` when discoverable (SessionStart env/payload /
      known vars). Extend `ToolUseEvent` + parse + table columns (show `—` when absent).
- [x] R5. **UI column polish**: order **Time | Type | File | Action | Tokens | Session** (+ Agent,
      Model if present). Tokens column right-aligned with thousands separators (`Intl.NumberFormat`).
- [x] R6. **SessionStart enrichment**: record agent/model hints into `.session.json` and/or
      `session_start` event when available; PostToolUse copies onto tool events.
- [x] R7. **Tests**: key uniqueness in UI/service; token cascade unit tests; null vs 0; parse new
      fields; column order smoke. Hooks unit tests for cascade.
- [x] R8. **Docs**: `docs/04_DESIGN.md` §7.8b field list + token semantics; same-commit T3.
- [x] R9. **Out of scope (later tasks):** SSE/live replace poll (0247); Bash/Grep/Glob matcher (0248).
### Acceptance Criteria
```gherkin
Feature: Tool Using v1.1 capture correctness and UI

  @core
  Scenario: R1 Duplicate tool events render as separate rows
    Given two ledger lines share the same ts, session, type, and file
    When the Tool Using table renders a snapshot containing both
    Then both rows appear (no React key collapse)

  @core
  Scenario: R2 Unknown tokens are not shown as zero
    Given a write event with no measurable content
    When the event is recorded and displayed
    Then tokens are null/omitted and the UI shows an em dash not 0

  @core
  Scenario: R3 Token cascade uses Write input content
    Given a Write PostToolUse payload with tool_input.content of 400 bytes and empty tool_response.content
    When context-post-tool records the event
    Then tokens equals ceil(400/4)

  @core
  Scenario: R4 File column sits next to Type
    Given the Tool Using tab is open with events
    When the table header is inspected
    Then column order is Time, Type, File, then Action, Tokens, Session

  @core
  Scenario: R5 Sparse recent activity is explained
    Given the newest window has only session_start/session_end events
    When the operator opens Tool Using
    Then a non-error status explains limited recent tool capture / hooks

  @edge
  Scenario: R6 Optional agent and model never block logging
    Given agent and model cannot be determined
    When a Read tool event is recorded
    Then the event is still appended without agent/model fields
```
### Q&A
| Q | A |
| --- | --- |
| Parent | 0245 |
| Packaging | Task A of A→B→C |
| Two-row root cause | Not API empty; keys + sparse hooks + session markers at top |
| Tokens | Cascade; null unknown |
| Agent/model | Best-effort optional |
| SSE / poll replace | Deferred to 0247 |
| Hook matcher expand | Deferred to 0248 |
### Design
## Chosen approach

**Correctness + schema + UI polish** without live-transport rewrite.

| Concern | Decision |
| --- | --- |
| Row keys | Service adds `seq` (0..n-1 newest-first) or `offset` per event in snapshot |
| Tokens | Cascade in hook; DTO `tokens?: number \| null`; UI formats with `—` |
| Agent/model | Optional strings on event + session_start; fail-open |
| UI | Column reorder; Tokens `text-right` + `toLocaleString` |
| Diagnostics | Banner when no tool events in window or no session file (server can expose `diagnostics` optional flag later — v1 can be client-side heuristics on types) |

## Impacted surfaces

- `plugins/sp/hooks/context-post-tool.ts`, `context-session-start.ts` (+ tests)
- `packages/app` token-ledger types/service parse
- `apps/web` ToolUsingTab
- `docs/04_DESIGN.md` §7.8b

## Invariants

1. Hooks remain fail-open.
2. Missing agent/model never drops events.
3. Observe path stays read-only on Board.
### Plan
1. [x] Fix snapshot row identity (`seq`) + UI keys
2. [x] Token cascade in context-post-tool + tests
3. [x] Optional sessionId/agent/model on events + SessionStart
4. [x] Parse/pass new fields through API (no breaking change)
5. [x] UI: columns order, Tokens format, sparse banner
6. [x] Design doc + rebuild web dist for dogfood
### Solution
| File:line | What / why |
| --- | --- |
| `packages/app/src/services/token-ledger-service.ts:1-210` | Add `seq`, optional agent/model/sessionId; `sparseToolActivity`; omit unknown tokens |
| `packages/app/tests/services/token-ledger-service.test.ts` | seq uniqueness, sparse flag, optional fields |
| `plugins/sp/hooks/context-post-tool.ts:1-145` | Token cascade; omit tokens when unknown; copy sessionId/agent/model |
| `plugins/sp/hooks/context-session-start.ts:1-95` | Best-effort agent/model on `.session.json` + session_start |
| `plugins/sp/hooks/context-hooks.test.ts` | Cascade Write content; omit tokens; agent/model copy |
| `apps/web/src/modules/observability/ToolUsingTab.tsx:1-280` | seq keys; Time\|Type\|File\|Action\|Tokens\|Session\|Agent\|Model; sparse banner; thousands |
| `apps/web/tests/modules/observability/components.test.tsx` | column order, sparse banner, seq, thousands |
| `docs/04_DESIGN.md` §7.8b | Field list + token semantics + sparseToolActivity |

**Why:** Fix row collapse, honest tokens, multi-agent hints, UI polish without SSE (0247) or matcher expand (0248).
### Testing
**Commands (verify --force turn)**

```
bun test packages/app/tests/services/token-ledger-service.test.ts \
  plugins/sp/hooks/context-hooks.test.ts \
  plugins/sp/hooks/token-estimate.test.ts \
  apps/server/tests/modules/observability/index.test.ts \
  apps/web/tests/modules/observability/components.test.tsx \
  apps/web/tests/modules/observability/tabs.test.ts
→ 78 pass, 0 fail
```

Coverage: token-ledger-service + cascade unit helpers exercised; hooks integration + direct unit tests for all cascade steps (response, Write input, Edit strings, Read stat, undefined).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 Stable seq keys | MET | `token-ledger-service.ts` seq assign; collision test; UI `key={e.seq}` |
| R2 Sparse diagnostics | MET | `sparseToolActivity` + `data-sparse-banner` + empty state copy |
| R3 Token cascade | MET | `resolveTokenEstimate` + `token-estimate.test.ts` all branches + hook integration |
| R4 agent/model/sessionId | MET | parse + post-tool copy + optional columns when present |
| R5 Column polish | MET | header Time Type File Action Tokens Session; Tokens right + Intl |
| R6 SessionStart enrichment | MET | `resolveAgentHint`/`resolveModelHint` + session file fields |
| R7 Tests | MET | 78 pass including cascade unit file |
| R8 Design doc | MET | `docs/04_DESIGN.md` §7.8b token semantics + fields |
| R9 Out of scope | MET | SSE/matchers deferred to 0247/0248 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 Duplicate rows | MET | test | unique seq when ts/file collide |
| R2 Unknown tokens not zero | MET | test | omits tokens when unknown; UI — |
| R3 Write input cascade | MET | test | Write content → 100; unit cascade |
| R4 File next to Type | MET | test | header index Type < File < Action |
| R5 Sparse explained | MET | test | data-sparse-banner |
| R6 Agent optional | MET | test | logging without agent; optional copy when present |

**Design conformance:** all A claims DONE; no silent deviations.
### Review
**Disposition:** PASS — 0246 v1.1 capture + UI complete.

| Priority | Finding | Status |
| --- | --- | --- |
| P1 | None | — |
| P2 | None | — |
| P3 | None | — |
| P4 | SSE / hook matcher expansion deferred to 0247 / 0248 | OPEN → follow-up |

**SECUA:** fail-open hooks preserved; optional agent/model never blocks; tokens omit when unknown (no fake zero); path local-only.
### References
- Parent **0245** — Tool Using tab baseline
- Sibling **0247** (SSE), **0248** (hook expand)
- Brainstorm: `docs/plans/2026-07-12-tool-using-followup-0245-brainstorm.md`
- Feature **J**
- Claude hooks: PostToolUse input includes `session_id`, `tool_input`, `tool_response`
### History
- 2026-07-12T22:52:22.241Z todo → wip (system)
- 2026-07-12T22:52:25.460Z wip → testing (system)
- 2026-07-12T22:52:40.525Z testing → done (system)
