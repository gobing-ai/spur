---
schema_version: 1
name: Restore Board reachability for the retired process watch list (executions + filters)
status: done
template: feature-impl
created_at: 2026-09-14T05:54:18.081Z
updated_at: "2026-09-14T23:03:21.607Z"
feature_id: G64

ac_altitude: task-local
---

## 0852. Restore Board reachability for the retired process watch list (executions + filters)

### Background

Task 0849 (G64) retired the Board modules `workspace`, `inbox`, and `teams` with redirects into
Projects. Its Design mapped each retired surface onto a Projects capability — Workspace → the project
summary in the Projects header, Inbox → the Conversation tab (0841), Teams → the roster and member
terminal on the Agents tab (0842). The Teams **process watch list** was not part of that mapping and
therefore retired with its shell:

- `apps/web/src/modules/teams/ProcessesTab.tsx` (`0262` supervised rows, `0264` registry one-shot
  rows, `0267` running-only + team filters, no-matches empty state) was deleted with the module.
- `GET /api/team/processes` still serves `executions` — the full `ts-runtime` `ProcessRegistry` watch
  list (`apps/server/src/modules/team/index.ts:40-72`) — but after 0849 `apps/web` has **zero**
  readers of `executions`: `parseProcessList` in `MemberTerminal.tsx` narrows only the supervised
  fields, and no surviving view lists registry one-shots.
- The supervised half stays reachable: `AgentsView` polls the same endpoint and renders each
  roster member's observed status (`data-agents-view`), so *which declared members are running* is
  covered. What is gone is the *watch list* view: one-shot executions, and the 0267 filters.

Captured by the 0849 review as a P2 (major) finding: `R2`'s clause "no Board capability becomes
unreachable" is unestablished for this sub-facet, and retiring it silently would be a surface
reduction no operator owned. This task is the owner.

### Requirements

- **R1** — The surviving Board exposes the registry one-shot (`executions`) rows that
  `GET /api/team/processes` already returns, or the removal of that facet is recorded as an explicit
  operator decision on this task.
- **R2** — If a view is added, it lives on a surface whose tab contract allows it (Projects' three
  tabs are frozen by 0840: Conversation, Agents, Work) — do not silently add a fourth Projects tab.
- **R3** — The `0267` filter behaviors (running-only, team filter, no-matches empty state) either
  return with the view or are explicitly dropped with a recorded reason.
- **R4** — No duplicate reader of `/api/team/processes`: reuse `parseProcessList` or extend it; do not
  stand up a second parse path.
- **R5** — Cover the `0262 AC` supervised-row test group too, not only the `0267` filters (`0849
  review pass 3` flagged it as unowned): the deleted `tests/modules/teams/components.test.tsx` had
  three supervised-row cases — rows rendered from `/api/team/processes`, registry one-shots shown
  alongside them, and the empty state — and only the filters are named by R3 today.

### Acceptance Criteria

- [x] AC1 — one-shots reachable: Given the Board server's team module mounted and `GET /api/team/processes` returning at least one registry execution, when the operator opens Projects → Work → Processes, then every `executions` row is listed (label, command, status, started time) alongside the supervised rows, with supervised/one-shot dedup by covered agentId/pid preserved from 0262/0264.
- [x] AC2 — tab contract intact: Projects still exposes exactly the three 0840 tabs (Conversation, Agents, Work); the watch list is an embedded Work section — no fourth `ProjectTabId`, no new `/board` route, no URL change.
- [x] AC3 — filters return: The Processes section provides running-only toggle, source filter (`all | supervisor | one-shot | other`), and team filter (`all | <teamId> | unassigned`); when filters match no rows, a no-matches empty state renders instead of a blank list.
- [x] AC4 — single parse path: The `/api/team/processes` wire shape is parsed only by the existing MemberTerminal parse module (extended, not duplicated): no second copy of the supervised-fields parse exists under `apps/web/src`.
- [x] AC5 — test coverage restored: Component tests cover the three supervised-row cases — rows rendered from the endpoint, registry one-shots shown alongside, empty state — plus the 0267 filter behaviors (running-only, source, team, no-matches).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Surface (R2):** Work tab gains a third embedded section `processes` beside `tasks`/`features` in `WorkView.tsx` (`WorkSectionId` + `WORK_SECTIONS` + conditional mount). Component-state section switching is the existing 0843 pattern; the frozen three-tab `ProjectTabId` contract is untouched and no route is added.

**Component:** new `apps/web/src/modules/projects/ProcessesView.tsx` — port of the retired `teams/ProcessesTab.tsx` (deleted in 2ba02214f) trimmed to Projects context:
- `buildWatchRows(processes, executions)` — supervised rows plus registry executions not already covered by a supervised agentId/pid (dedup sets, as 0264).
- `filterWatchRows(rows, filters)` — pure, exported: `runningOnly`, `source: all|supervisor|one-shot|other`, `team: all|id|unassigned` (0267 semantics verbatim).
- Filter bar keeps the `data-processes-filters` / `data-processes-filter-*` attributes; rows and no-matches empty state keep their data hooks for tests.
- Polls `GET /api/team/processes` via `resolveApiUrl()` on `STATUS_POLL_MS` (same cadence as AgentsView/MemberTerminal).

**Parse (R4):** extend the existing parse module in `MemberTerminal.tsx` — add `parseExecutions` (and the `RegistryExecution` wire type) beside `parseProcessList`; supervised parse stays the single definition site. `ProcessesView` imports both plus `STATUS_POLL_MS` from `./MemberTerminal`, mirroring how `AgentsView` already imports them.

**Server:** none — `apps/server/src/modules/team/index.ts:40-72` already serves `executions` + `executionsCount`.

**Invariants:** exactly three Projects tabs (asserted by existing ProjectsShell/tab tests); one parse module for the endpoint wire; Work sections remain component-state only.

**Tests (R5/R3):** new `apps/web/tests/modules/projects/ProcessesView.test.tsx` porting the three supervised-row cases and the filter suite shape from the retired `tests/modules/teams/components.test.tsx` (deleted 2ba02214f), narrowed to this component; update any Work-section-count assertions.

### Plan

1. Extend `MemberTerminal.tsx` parse module with `parseExecutions` + `RegistryExecution` wire type (R4); keep `parseProcessList` behavior untouched.
2. Create `apps/web/src/modules/projects/ProcessesView.tsx`: port `buildWatchRows`, `filterWatchRows`, filter bar, rows, and no-matches empty state from `teams/ProcessesTab.tsx@2ba02214f^`; poll endpoint on `STATUS_POLL_MS`.
3. Add the `processes` section to `WorkView.tsx` (`WorkSectionId`, `WORK_SECTIONS`, conditional mount).
4. Add `apps/web/tests/modules/projects/ProcessesView.test.tsx`: three supervised-row cases + filter suite (R3/R5).
5. Fix any Work-section/tab-contract test assertions; run web tests + lint/typecheck locally, then the pipeline gate.

### Solution

Ported the retired Teams process watch list (0262/0264/0267, deleted in 2ba02214f) into Projects as an embedded Work section, per the task Design. No server changes — `apps/server/src/modules/team/index.ts:40-72` already serves `executions`/`executionsCount`.

**Parse module (R4 — single parse path)**
- `apps/web/src/modules/projects/MemberTerminal.tsx:8-15` — `ProcessStatus` gains `teamId: string | null` (the server already sends it; the watch-list team filter needs it).
- `apps/web/src/modules/projects/MemberTerminal.tsx:39-54` — `parseProcessList` narrows `teamId` additively: a missing/non-string value narrows to `null` instead of failing the poll, so the accept/reject behavior existing callers (`AgentsView`, `MemberTerminal`) see is untouched (Plan 1 constraint).
- `apps/web/src/modules/projects/MemberTerminal.tsx:55-120` — new `RegistryExecution` wire type + `parseExecutions` beside `parseProcessList`, same strict all-or-nothing narrowing contract (returns `null` on malformed input). This is the only supervised/executions parse site; `ProcessesView` imports it — no second copy exists under `apps/web/src`.

**Component (R1/R2/R3)**
- `apps/web/src/modules/projects/ProcessesView.tsx:1-363` (new) — port of `teams/ProcessesTab.tsx@2ba02214f^` trimmed to Projects context: exported `buildWatchRows` (`ProcessesView.tsx:31`, supervised rows first, registry executions deduped by covered agentId/pid as 0264), exported pure `filterWatchRows` + `WatchFilters` (`ProcessesView.tsx:64-99`, 0267 semantics verbatim: `runningOnly`, `source: all|supervisor|one-shot|other`, `team: all|id|unassigned`), the native-control filter bar keeping all `data-processes-filters`/`data-processes-filter-*` hooks (`ProcessesView.tsx:101-185`), and the default `ProcessesView` (`ProcessesView.tsx:187`) polling `GET /api/team/processes` via `resolveApiUrl()` on `STATUS_POLL_MS` imported from `./MemberTerminal` (mirrors `AgentsView`). Trims vs the retired file: no `teamId` prop scoping (Projects is not team-scoped; team narrowing lives in the filter bar), empty-state guidance retargeted from the retired Terminal tab to the Agents tab, malformed payloads skip the tick instead of defaulting (`AgentsView` rule). Data hooks (`data-processes-tab`, `data-processes-row`, `data-process-source`, `data-process-team`, no-matches/empty/error/loading states) kept identical for the ported tests. A `pollMs` prop (default `STATUS_POLL_MS`) follows the `AgentsView` test-seam convention.

**Surface (R2 — tab contract intact)**
- `apps/web/src/modules/projects/WorkView.tsx:5` — import `ProcessesView`.
- `apps/web/src/modules/projects/WorkView.tsx:9-17` — `WorkSectionId` gains `'processes'`; `WORK_SECTIONS` gains the Processes entry (component-state switching, the existing 0843 pattern).
- `apps/web/src/modules/projects/WorkView.tsx:75-86` — three-way conditional mount: Tasks/Features behavior byte-identical, Processes mounts `ProcessesView`. `tabs.tsx` untouched — `ProjectTabId` remains exactly `conversation|agents|work`, no route, no URL change.

**Tests (R5/R3)**
- `apps/web/tests/modules/projects/ProcessesView.test.tsx:1-506` (new) — ported from the retired `tests/modules/teams/components.test.tsx`, narrowed to this component: the three supervised-row cases (rows from the endpoint incl. header copy and endpoint-vs-observability assertion, `ProcessesView.test.tsx:25`; one-shots alongside supervised rows with agentId/pid dedup, `:84`; empty state with actionable guidance, `:139`), the 0267 unit suite for `buildWatchRows`/`filterWatchRows` verbatim (`:166`, 9 cases incl. teamId threading and combined filters), and the filter-bar UI behaviors (`:286`: controls render, running-only, source select, team select, `unassigned`, no-matches empty state with controls kept visible).
- `apps/web/tests/modules/projects/roster.test.ts:18-28` — `proc` fixture base literal gains `teamId: null`: direct consequence of `ProcessStatus` gaining the required field; no behavior change.

**Deviations from Design:** none of substance. The Design's "keep `parseProcessList` behavior untouched" is honored by narrowing `teamId` additively (existing pass/fail outcomes unchanged); `ProcessStatus` extending with `teamId` is the R4-sanctioned "extend it" path rather than a second supervised parse. No Work-section-count assertions existed to update — the suite stayed green without edits beyond the fixture above.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Registry one-shot `executions` rows exposed: `apps/web/src/modules/projects/ProcessesView.tsx:31` `buildWatchRows(processes, executions)` appends executions not covered by a supervised agentId/pid (dedup `:47-48`, rows `:46-59`), rendered `:333-358`; test `apps/web/tests/modules/projects/ProcessesView.test.tsx:79-143` proves a one-shot is listed alongside supervised rows (keys `['sup:planner','reg:pe_1']`, covered `pe_2` deduped, asserted `:139-142`). Endpoint half pre-existing and untouched: `apps/server/src/modules/team/index.ts:41-72`. |
| R2 | MET | Watch list is an embedded Work section, not a fourth tab: `apps/web/src/modules/projects/WorkView.tsx:9` `WorkSectionId` gains `'processes'`, `:13-17` WORK_SECTIONS third entry, component-state switching `:40`, three-way mount `:75-83` (`ProcessesView` at `:81`). Tab contract intact: `apps/web/src/modules/projects/tabs.tsx:7` `ProjectTabId` remains exactly `conversation`/`agents`/`work` (file unmodified — absent from git status). Grep over App/routes found no new `/board` route and no URL change in the diff. |
| R3 | MET | 0267 filters return verbatim: `apps/web/src/modules/projects/ProcessesView.tsx:77-92` pure `filterWatchRows` — runningOnly `:79`, source `all`/`supervisor`/`one-shot`/`other` `:80-84` (`other` = neither supervisor nor one-shot), team `all`/id/`unassigned` `:85-89`; filter bar with `data-processes-filter-*` hooks `:101-175`; no-matches empty state with controls kept visible `:281-296`. Tests: pure suite `ProcessesView.test.tsx:225-281`; UI suite `:295-505` (running-only `:323`, source `:360`, team `:404`, unassigned `:440`, no-matches `:476`). |
| R4 | MET | Single parse path: `apps/web/src/modules/projects/MemberTerminal.tsx:24` `parseProcessList` extended additively (`:38-48` missing/non-string `teamId` narrows to null — existing accept/reject outcomes unchanged), `:55` `RegistryExecution` + `:76` `parseExecutions` beside it (same all-or-nothing null contract). Consumers import from the module: `ProcessesView.tsx:4-10` (both parsers + `STATUS_POLL_MS`), `AgentsView.tsx:4` (unchanged). Repo-wide grep under `apps/web/src`: the only other `processes`-field narrowing is `apps/web/src/modules/observability/ProcessListTab.tsx:58`, which parses the `/observability/processes` wire (`:29`) — a different endpoint, not a second copy of the supervised-fields parse. `tsc --noEmit` exit 0. |
| R5 | MET | Supervised-row test group restored, not only filters: `apps/web/tests/modules/projects/ProcessesView.test.tsx:26-77` (rows rendered from `/api/team/processes`, incl. endpoint-vs-observability assertion `:72-73`), `:79-143` (registry one-shots alongside supervised with dedup), `:145-161` (empty state with actionable guidance); plus 0267 filters pure `:166-282` and UI `:286-505`. Fresh run this turn: 33 pass, 0 fail, 93 expect() calls across ProcessesView + roster suites. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Every non-deduped `executions` row listed alongside supervised rows: dedup by covered agentId/pid `apps/web/src/modules/projects/ProcessesView.tsx:43-48`; row fields — label `:337` (via label-or-command fallback `:51`), status `:348-352`, started time `:353-355`; test `apps/web/tests/modules/projects/ProcessesView.test.tsx:79-143` asserts the one-shot row is present and the covered duplicate is not (keys `:139-142`). |
| AC2 | MET | test | `apps/web/src/modules/projects/tabs.tsx:7-21` — exactly three 0840 tabs, file unmodified (absent from `git status --porcelain`); section is component state: `WorkView.tsx:9`, `:13-17`, `:40`; embedded mount `:75-83`; grep confirms no fourth `ProjectTabId`, no `/board` route, no URL change anywhere in the diff. Executable: fresh `cd apps/web && bun test tests/modules/projects/WorkView.test.tsx tests/modules/projects/a11y.test.tsx tests/modules/projects/useProjectTab.test.ts` — 17 pass, 0 fail, 172 expect() (three-tab contract, aria-selected navigation, work-section switching incl. the processes mount). |
| AC3 | MET | test | Semantics `apps/web/src/modules/projects/ProcessesView.tsx:77-92`; controls `:101-175`; UI tests `apps/web/tests/modules/projects/ProcessesView.test.tsx:295-505` incl. no-matches empty state rendered instead of a blank list with controls kept visible `:476-505`; pure combined-filter no-match case `:270-275`. |
| AC4 | MET | command | Sole parse site `apps/web/src/modules/projects/MemberTerminal.tsx:24-113` (`parseProcessList` `:24` extended, `parseExecutions` `:76`); grep under `apps/web/src` finds no second copy of the supervised-fields parse — only consumers `AgentsView.tsx:4`, `ProcessesView.tsx:4-10`, `MemberTerminal.tsx:156`; the `observability/ProcessListTab.tsx:58` hit parses a different endpoint (`:29`). `tsc --noEmit` exit 0 proves the additive `ProcessStatus.teamId` broke no consumer. |
| AC5 | MET | test | `apps/web/tests/modules/projects/ProcessesView.test.tsx:26-505` — the three supervised-row cases (`:26-77`, `:79-143`, `:145-161`) plus the 0267 filter behaviors (pure `:225-281`, filter-bar UI `:323-505`). Fresh run this turn: `cd apps/web && bun test tests/modules/projects/ProcessesView.test.tsx tests/modules/projects/roster.test.ts` — 33 pass, 0 fail, 93 expect() calls. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | 5/5 Design claims DONE on re-read: surface (WorkSectionId + WORK_SECTIONS + mount, `WorkView.tsx:9,13-17,75-83`); component port (`ProcessesView.tsx:31` buildWatchRows, `:77-92` filterWatchRows, `:101-175` filter bar with 0267 data hooks, `:187` default export polling on `STATUS_POLL_MS` via `resolveApiUrl`); parse extension (`MemberTerminal.tsx:24,55,76`); server none (`apps/server/src/modules/team/index.ts:41-72` untouched); tests ported (`ProcessesView.test.tsx:26-505`). Documented Solution deviations (additive teamId narrowing, strict parse skip-the-tick, empty-state retarget to Agents tab, pollMs test seam) all present as described — none silent. Every diff hunk maps to an R/AC/Design/Plan item; no scope creep. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:e3f13751ae36216bbf1708fcf77ef63a248887c4d0dacf3188ddd234d541728a |

### References

- Raised by: [0849 review](../tasks4/0849_retire-workspace-inbox-and-teams-board-routes-with-redirects.md) P2 (major), 2026-09-14
- Retirement that dropped it: [G64](../features/G64_retire-workspace-inbox-teams-and-spur-team.md); task 0849
- Server contract: `GET /api/team/processes` → `apps/server/src/modules/team/index.ts:40-72` (`executions`, `executionsCount`)
- Deleted view: `apps/web/src/modules/teams/ProcessesTab.tsx` (0262/0264/0267), tests `tests/modules/teams/components.test.tsx` (0267 filter suite)
- Surviving consumer: `apps/web/src/modules/projects/MemberTerminal.tsx` (`parseProcessList`), roster view `apps/web/src/modules/projects/AgentsView.tsx`

### History

- 2026-09-14T21:58:55.273Z backlog → todo (system)
- 2026-09-14T22:18:34.042Z todo → wip (system)
- 2026-09-14T22:55:15.204Z wip → testing (system)
- 2026-09-14T23:03:21.607Z testing → done (system)

