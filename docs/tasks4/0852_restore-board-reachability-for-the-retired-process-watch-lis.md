---
schema_version: 1
name: Restore Board reachability for the retired process watch list (executions + filters)
status: done
template: feature-impl
created_at: 2026-09-14T05:54:18.081Z
updated_at: "2026-09-15T01:23:17.612Z"
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
| R1 | MET | Registry one-shot rows exposed: `apps/web/src/modules/projects/ProcessesView.tsx:31` `buildWatchRows(processes, executions)` (anchor re-read this run), dedup by covered agentId/pid at `:43-48` (re-read: coveredAgents/coveredPids skips), label fallback `:51`, rendered rows `:333-358` (re-read); test `apps/web/tests/modules/projects/ProcessesView.test.tsx:79-143` (one-shot listed alongside supervised, covered duplicate excluded; anchor re-read) — green inside the fresh web batch: cd apps/web && bun test tests/modules/registry.test.ts tests/components/LeftSidebar.test.tsx tests/components/BoardLayout.test.tsx tests/modules/projects/ProcessesView.test.tsx tests/modules/projects/roster.test.ts tests/modules/projects/MemberTerminal.test.tsx tests/modules/projects/activity-history.test.ts tests/modules/projects/MemberDetail.test.tsx tests/modules/projects/conversation.test.ts tests/modules/projects/ConversationView.test.tsx — exit 0, 130 pass / 0 fail / 438 expect (fresh 2026-09-14); endpoint half pre-existing at `apps/server/src/modules/team/index.ts:41-72` (re-read this run) |
| R2 | MET | Embedded Work section, not a fourth tab: `apps/web/src/modules/projects/WorkView.tsx:9` (`WorkSectionId` gains 'processes'), `:13-17` (WORK_SECTIONS third entry), `:40` (component state), `:75-83` (three-way mount with ProcessesView) — all re-read this run; tab contract intact: `apps/web/src/modules/projects/tabs.tsx:7` and `:17-21` remain exactly conversation/agents/work (re-read; file untouched by the diff); router audit this run: no new `/board` route, only the three RETIRED_ROUTES redirects at `apps/web/src/router.tsx:15-17` |
| R3 | MET | 0267 filters verbatim: `apps/web/src/modules/projects/ProcessesView.tsx:77-92` pure `filterWatchRows` (runningOnly, source all/supervisor/one-shot/other, team all/id/unassigned — re-read this run); filter bar `:101-175` (re-read: ProcessFilterControls), no-matches empty state with controls visible `:281-296` (re-read); tests pure `:225-281` and UI `:295-505` (`:225-228` re-read) — green inside the fresh 130-pass web batch |
| R4 | MET | Single parse path: `apps/web/src/modules/projects/MemberTerminal.tsx:24` `parseProcessList` extended additively, `:55` `RegistryExecution`, `:76` `parseExecutions`, consumer import at `:156` — all re-read this run; consumers import from the module (`apps/web/src/modules/projects/ProcessesView.tsx:4-10` — re-read); repo-wide grep this run: the only other processes-field narrowing is `apps/web/src/modules/observability/ProcessListTab.tsx:58`, a different endpoint (re-read); typecheck green across 7 workspaces in the fresh spur-check |
| R5 | MET | Supervised-row group restored, not only filters: `apps/web/tests/modules/projects/ProcessesView.test.tsx:26-77` (rows from /api/team/processes; anchor re-read), `:79-143` (registry one-shots + dedup), `:145-161` (empty state), plus 0267 pure `:225-281` and UI `:295-505` — all green inside the fresh 130-pass / 0-fail web batch |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Dedup + row fields at `ProcessesView.tsx:43-48`, `:51`, `:333-358` (anchors re-read); `ProcessesView.test.tsx:79-143` green inside the fresh 130-pass web batch |
| AC2 | MET | test | `tabs.tsx:7-21` unchanged (re-read; absent from the diff); section is component state (`WorkView.tsx:9`, `:13-17`, `:40`, `:75-83` — re-read); no fourth tab/route/URL change (router re-read this run) |
| AC3 | MET | test | Filter semantics `ProcessesView.tsx:77-92`, controls `:101-175`, no-matches empty state `:281-296` (anchors re-read); UI filter tests `:295-505` green inside the fresh web batch |
| AC4 | MET | command | Sole parse site `MemberTerminal.tsx:24-76` (anchors re-read); grep finds no second supervised-fields parser (only observability's different endpoint at `ProcessListTab.tsx:58`); full typecheck green in fresh spur-check |
| AC5 | MET | test | Three supervised-row cases + 0267 filter behaviors all inside `ProcessesView.test.tsx:26-505`, green in the fresh 130-pass / 0-fail web batch |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Embedded-section placement, verbatim 0267 filters, single parse path, and supervised-row restoration all match the Design; no deviation. |
| P4 | repository-gate | — | bun run spur-check — exit 0 fresh this run (full suite green incl. coverage denominator after the 0855-owned context.ts repair). |
| P4 | task-check | — | spur task check 0852 --strict-core --json — exit 0, pass: true (fresh 2026-09-14) |
| P4 | secua-review | — | No blocker or major finding. |
| P4 | tab-contract | — | ProjectTabId remains exactly conversation/agents/work (`tabs.tsx:7` re-read); no route change (router audit this run). |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

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

