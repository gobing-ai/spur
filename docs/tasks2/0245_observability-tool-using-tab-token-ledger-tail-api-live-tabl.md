---
template: feature-impl
schema_version: 1
name: "Observability Tool Using tab: token-ledger tail API + Live table"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-12T22:12:48.955Z"
updated_at: "2026-07-12T22:31:05.008Z"
---

## 0245. Observability Tool Using tab: token-ledger tail API + Live table

### Background
## Why

Indexed-context hooks (task **0232**) already append agent file-tool activity to
`.spur/context/token-ledger.jsonl` (`session_start` / `read` / `write` / `session_end`).
The skill explicitly reserves this file for a **future tool-use monitoring tool**. Spur Board
Observability has System Events, Inbox, Jobs, and Processes — but **no surface** for this ledger.

Operators currently must `tail` a multi‑MB gitignored file by hand. We need a Board tab that
reads the same SSOT safely (tail window, newest-first) with an optional Live poll.

## Investigation (2026-07-12) — hooks are healthy

| Item | Finding |
| --- | --- |
| Hooks | `plugins/sp/hooks/hooks.json` → PostToolUse `Read\|Write\|Edit` → `context-post-tool` |
| Writers | `context-session-start.ts`, `context-post-tool.ts`, `context-session-stop.ts` |
| Schema | JSONL lines: `ts`, `session`, `type`, optional `file`, `tokens`, `action`, `totals` |
| Live spur-new ledger | ~52k lines / ~9.5 MB; 0 parse errors; unit tests 13/13 pass |
| Critical fix before tab? | **None.** Limitations are by design (file tools only; tokens often 0 when PostToolUse omits content; fail-open; only hook-enabled agents write) |

**Do not** expand hook matcher or rework token estimation in this task unless a blocking bug is
discovered during implement (none known).

## Goal

Add Observability tab **Tool Using**: read-only table over the project token-ledger via a new
observe API, newest-first, with a **Live** checkbox that polls while on.

## Source decisions

Brainstorm: `docs/plans/2026-07-12-observability-tool-using-tab-brainstorm.md` (Approach 1 ⭐).
Feature **J** (Observabilities board module). Related: **0232** ledger writers; **0243** observe
API + poll UI pattern.
### Requirements
- [x] R1. **TokenLedgerService** (name flexible) in `packages/app` reads
      `{cwd}/.spur/context/token-ledger.jsonl`, returns the **newest N** events (default **200**,
      max **1000**), reverse chronological. Skips malformed lines without failing the whole request.
      Missing file → empty list success (not 404). Unreadable path / unexpected I/O → structured error.
- [x] R2. Efficient tail: must not load the entire multi‑MB file into memory as the primary path
      when only a limit window is needed (chunked reverse read or equivalent). Unit-test with fixture
      files larger than the window.
- [x] R3. New read API: **`GET /api/observability/tool-use?limit=`** mounted on the existing
      observability server module (alongside processes). Response envelope includes at least:
      `events[]`, `count`, `limit`, `truncated` (true if more data may exist beyond the window),
      `path` (absolute ledger path used), `capturedAt` (ISO). Event objects preserve ledger fields:
      `ts`, `session`, `type`, optional `file`, `tokens`, `action`, `totals`.
- [x] R4. Default includes **all** event types: `session_start`, `read`, `write`, `session_end`.
      No server-side type filter required in v1 (optional client filter is a follow-up).
- [x] R5. Path resolution: **`join(serverContext.cwd, '.spur/context/token-ledger.jsonl')`**.
      No multi-project merge; no env path override in v1.
- [x] R6. Web: append **Tool Using** tab to `OBSERVABILITY_TABS` (`id: 'tool-using'`, stable —
      append-only contract). New `ToolUsingTab` component:
      - Table columns: **Time | Type | Action | Tokens | Session | File** (file truncated in cell,
        full path in `title`/tooltip).
      - Session rows: Action/File empty or em dash; `session_end` may show totals summary in Tokens
        or a compact subtitle (implementer choice — document in Design).
      - Newest-first (API already ordered).
      - **Live** checkbox: ON → poll ~**3s**; OFF → single load. Cancel in-flight on unmount /
        Live toggle off. Soft error if refresh fails while prior data is shown.
      - Empty ledger: calm empty copy (e.g. “No tool-use events yet. File tools are logged when
        agent hooks write token-ledger.jsonl.”) — not a red error.
- [x] R7. **Hooks unchanged** in this task (verified healthy). Explicit non-goals: all-tools matcher,
      token re-estimation, SQLite import, SSE file-watch, cursor pagination, expandable raw JSON.
- [x] R8. Tests: service unit tests (fixtures, empty, missing, malformed lines, limit clamp);
      server route smoke (200 / empty / error); web tab tests (rows, Live off load once, Live on
      interval, unmount cancel, empty state).
- [x] R9. Docs surface: same-commit note in `docs/04_DESIGN.md` for the new endpoint (T3).
      Link brainstorm in References.
### Acceptance Criteria
```gherkin
Feature: Observability Tool Using tab over token-ledger

  @core
  Scenario: R1 Newest ledger events appear without loading full history
    Given .spur/context/token-ledger.jsonl has more than 200 tool and session events
    When GET /api/observability/tool-use is requested with default limit
    Then at most 200 events are returned newest first
    And truncated is true

  @core
  Scenario: R2 All event types are represented
    Given the ledger contains session_start, read, write, and session_end lines
    When the Tool Using tab loads
    Then each type can appear in the table with a type indicator

  @core
  Scenario: R3 Live poll refreshes while enabled
    Given the Tool Using tab is open and Live is checked
    When the poll interval elapses
    Then the table refetches inventory
    And unmounting or turning Live off stops further polls

  @core
  Scenario: R4 Missing ledger is empty not error
    Given the project has no token-ledger.jsonl yet
    When GET /api/observability/tool-use is requested
    Then the API returns 200 with an empty events array
    And the tab shows a calm empty state

  @core
  Scenario: R5 Tab is registered on Observability shell
    Given the Observability module is open
    When the operator selects Tool Using
    Then the tool-using panel mounts without shell registry edits beyond tabs.ts append

  @edge
  Scenario: R6 Malformed JSONL lines are skipped
    Given the ledger contains some non-JSON lines among valid events
    When the inventory is built
    Then valid events still return
    And the request does not fail solely due to skipped lines
```
### Q&A
| Q | A |
| --- | --- |
| Data contract? | Existing token-ledger.jsonl via new observe API |
| Expand hooks first? | No — hooks healthy; file tools only by design |
| Default event types? | All four (session_start, read, write, session_end) |
| Live model? | Checkbox → poll ~3s when on; single load when off |
| Paging? | Tail window limit default 200 max 1000; no cursor v1 |
| Columns? | Time, Type, Action, Tokens, Session, File |
| Path? | `{serve cwd}/.spur/context/token-ledger.jsonl` |
| Approach? | TokenLedgerService + API + ToolUsingTab (brainstorm Approach 1) |
| Feature? | J |
### Design
## Chosen approach

**TokenLedgerService + `GET /api/observability/tool-use` + ToolUsingTab** (brainstorm Approach 1).

| Concern | Decision |
| --- | --- |
| Write path | Unchanged hooks → JSONL (0232) |
| Read path | App service tails file; server is thin transport (ADR-021) |
| API home | Existing `apps/server/src/modules/observability/` (extend, don’t fork) |
| UI | Append-only entry on `OBSERVABILITY_TABS`; poll like ProcessListTab |
| Order | Reverse chronological (newest first) |
| Missing file | Empty success |
| I/O / parse errors | Structured 500 (or 503) with message — fail loud, not silent [] for hard errors |

## DTO (normative for implementer)

```ts
interface ToolUseEvent {
  ts: string;
  session: string;
  type: 'session_start' | 'read' | 'write' | 'session_end';
  file?: string;
  tokens?: number;
  action?: 'create' | 'edit' | string;
  totals?: { reads: number; writes: number; tokens: number };
}

interface ToolUseSnapshot {
  events: ToolUseEvent[];
  count: number;
  limit: number;
  truncated: boolean;
  path: string;
  capturedAt: string;
}
```

## Tail algorithm (recommended)

1. Resolve path from `cwd`.
2. If `!exists` → empty snapshot, `truncated: false`.
3. Read file from end in chunks (e.g. 64–256 KiB); accumulate complete lines until
   `limit + 1` valid events collected (extra for truncated detection) or file exhausted.
4. Parse lines bottom-up (newest last in file = first in result after reverse).
5. Clamp `limit` to `[1, 1000]`; default 200.
6. Malformed line → skip + optional debug counter (not required in response).

## UI details

- Tab label: **Tool Using**; id: `tool-using` (never rename after ship).
- Live checkbox in header row next to title/count (pattern: System Events liveness strip / Processes header).
- Default Live: **on** when tab mounts (operator can uncheck) — or **off** if we want cheaper idle; **recommend default on** for a monitoring tab.
- Badge colors: type → session_start secondary, read primary/ghost, write warning/success by action, session_end muted.
- File column: show basename or truncated path; `title={full path}`.

## Impacted surfaces

- `packages/app` — new service + export
- `apps/server` — observability route + context wiring if needed
- `apps/web` — `ToolUsingTab.tsx`, `tabs.ts`, tests
- `docs/04_DESIGN.md` — endpoint surface (T3)
- **Non-impact:** hook scripts, team APIs, system_events schema

## Invariants

1. Observe ≠ control — tab never starts agents or edits the ledger.
2. Ledger remains append-only SSOT; Board never writes it.
3. Limit always enforced server-side.
4. Missing ledger is empty success; corrupt-only-if-total-failure is an error.

## Key risks

- Reverse-read edge cases (last line without trailing newline) → fixture tests.
- Concurrent append during read → acceptable torn last line skip.
- Absolute paths leak host layout in UI — already true of ledger; Board is local-first.
### Plan
1. [x] Add `TokenLedgerService` (or `ToolUseLedgerService`) + reverse-tail helper in `packages/app` with fixture tests
2. [x] Export from `packages/app` public API
3. [x] Wire service on server context (or construct in observability module from `ctx.cwd` + fs)
4. [x] Extend `apps/server/src/modules/observability/index.ts` with `GET /api/observability/tool-use`
5. [x] Implement `ToolUsingTab.tsx` (table, Live checkbox, 3s poll, empty/error states)
6. [x] Append tab to `OBSERVABILITY_TABS` in `tabs.ts` (`id: tool-using`)
7. [x] Web + server + app tests green
8. [x] Update `docs/04_DESIGN.md` surface note; link brainstorm
9. [x] Rebuild web dist when dogfooding monorepo board (`bun run build` or web filter)
### Solution
| File:line | What / why |
| --- | --- |
| `packages/app/src/services/token-ledger-service.ts:1-179` | TokenLedgerService + reverse-tail JSONL reader; clamp limit 200/1000; missing file → empty success |
| `packages/app/tests/services/token-ledger-service.test.ts:1-183` | Unit tests: parse, newest-first, truncate, no trailing newline, missing file |
| `packages/app/src/index.ts:108-124` | Export service + DTO types for server/web |
| `apps/server/src/context.ts:143-148,400-405` | Lazy `tokenLedger()` → `{cwd}/.spur/context/token-ledger.jsonl` |
| `apps/server/src/modules/observability/index.ts:34-49` | `GET /api/observability/tool-use?limit=` |
| `apps/server/tests/modules/observability/index.test.ts:72-144` | Route smoke: 200 snapshot, empty, 500 |
| `apps/server/tests/context.test.ts:382-391` | tokenLedger empty + cache |
| `apps/web/src/modules/observability/ToolUsingTab.tsx:1-244` | Table + Live checkbox (default on, 3s poll) + calm empty/error |
| `apps/web/src/modules/observability/tabs.ts:30` | Append `{ id: 'tool-using', label: 'Tool Using' }` (append-only) |
| `apps/web/tests/modules/observability/components.test.tsx:810-890` | Tool Using rows / empty / error / Live toggle |
| `apps/web/tests/modules/observability/tabs.test.ts:26-33` | Registry includes tool-using |
| `docs/04_DESIGN.md:900-918` | §7.8b surface contract (T3) |

**Why:** Completes 0232’s “future tool-use monitoring” as a Board observe surface; hooks unchanged; large ledgers handled via reverse tail (not full-file load).
### Testing
**Commands (verify turn, 2026-07-12)**

```
bun test packages/app/tests/services/token-ledger-service.test.ts \
  apps/server/tests/modules/observability/index.test.ts \
  apps/server/tests/context.test.ts \
  apps/web/tests/modules/observability/tabs.test.ts \
  apps/web/tests/modules/observability/components.test.tsx
→ 90 pass, 0 fail (includes Live poll interval test)
```

Coverage: `token-ledger-service.ts` 100% line/func in suite; observability route module 100% lines. Full monorepo gate previously green under `bun run spur-check` (2669 pass).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 TokenLedgerService | MET | `packages/app/src/services/token-ledger-service.ts:157-182`; unit tests missing/empty/parse |
| R2 Efficient tail | MET | `tailTokenLedgerFile` chunked reverse read `:102-152`; multi-chunk fixture (chunkSize 64) |
| R3 GET /api/observability/tool-use | MET | `apps/server/src/modules/observability/index.ts:33-49`; route tests 200/empty/500 |
| R4 All event types | MET | no server type filter; UI TypeBadge + web test asserts session_start/read/write |
| R5 Path = cwd/.spur/context/… | MET | `TokenLedgerService` + `context.tokenLedger()` cwd wire |
| R6 ToolUsingTab Live + table | MET | `ToolUsingTab.tsx`; columns Time/Type/Action/Tokens/Session/File; Live default on; soft refresh error |
| R7 Hooks unchanged | MET | `git status plugins/sp/hooks` clean; no hook file edits |
| R8 Tests | MET | service + server + web suites including Live poll refetch + Live-off no poll |
| R9 docs/04_DESIGN §7.8b | MET | `docs/04_DESIGN.md` §7.8b contract + TokenLedgerService mechanism (fixed under verify --fix) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 Newest ledger events appear without loading full history | MET | test | `token-ledger-service.test.ts` limit window + truncated |
| Scenario: R2 All event types are represented | MET | test | components.test tool-using type badges session_start/read/write |
| Scenario: R3 Live poll refreshes while enabled | MET | test | `tool using tab Live on schedules poll refetches` (3.2s wait) + Live-off no extra calls |
| Scenario: R4 Missing ledger is empty not error | MET | test | service empty + API 200 empty + calm empty UI |
| Scenario: R5 Tab is registered on Observability shell | MET | test | `tabs.test.ts` contains tool-using |
| Scenario: R6 Malformed JSONL lines are skipped | MET | test | unit skips NOT_JSON among valid events |

**Design conformance**

| Claim | Status |
| --- | --- |
| TokenLedgerService + reverse tail | DONE |
| GET /api/observability/tool-use | DONE |
| ToolUsingTab + Live poll | DONE |
| All event types, limit 200/1000 | DONE |
| Path cwd/.spur/context/token-ledger.jsonl | DONE |
| Hooks unchanged | DONE |
| docs/04_DESIGN §7.8b | DONE (mechanism text restored under correct sections during --fix) |
### Review
**Disposition:** PASS — task 0245 complete for v1 scope.

| Priority | Finding | Status |
| --- | --- | --- |
| P1 | None | — |
| P2 | None | — |
| P3 | None | — |
| P4 | Hook coverage remains Read/Write/Edit only; tokens often 0 when agent omits content; no cursor pagination | OPEN → intentional follow-up (out of 0245 scope) |

**SECUA (summary):** read-only observe path; path confined to project cwd ledger; no secrets; fail loud on hard I/O; missing file empty success. Residual: concurrent append may skip a torn last line (acceptable).

**Traceability:** R1–R9 MET (checkboxes closed); AC R1–R6 MET with test evidence (90 pass targeted suite). Verdict: `.spur/run/0245-verdict.json` PASS.

**Corpus hygiene:** Requirements + Plan checklists marked complete; monorepo `dist/web` rebuilt with Tool Using tab for dogfood.
### References
- Feature **J** — Observabilities board module
- Task **0232** — indexed-context + token-ledger hooks (write path)
- Task **0243** — Processes observe API + poll UI pattern (read-path sibling)
- Brainstorm: `docs/plans/2026-07-12-observability-tool-using-tab-brainstorm.md`
- Hooks: `plugins/sp/hooks/hooks.json`, `context-post-tool.ts`, `context-session-start.ts`, `context-session-stop.ts`
- Skill: `plugins/sp/skills/indexed-context/SKILL.md` (token-ledger section)
### History
- 2026-07-12T22:20:59.177Z todo → wip (system)
- 2026-07-12T22:21:20.268Z wip → testing (system)
- 2026-07-12T22:21:44.221Z testing → done (system)
