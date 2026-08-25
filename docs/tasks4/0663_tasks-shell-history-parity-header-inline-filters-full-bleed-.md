---
schema_version: 1
name: "Tasks shell: History-parity header, inline filters, full-bleed layout"
status: done
template: feature-impl
created_at: 2026-08-25T05:08:07.333Z
updated_at: "2026-08-25T06:10:50.553Z"
feature_id: F72
priority: P2
tags: ["web", "tasks-module", "shell-parity"]
---

## 0663. Tasks shell: History-parity header, inline filters, full-bleed layout

### Background

F72 structural half: rebuild the Tasks board module (`apps/web/src/modules/task-kanban/`) on the
History shell convention per ADR-081 and `docs/design/tasks-module-shell-parity.md` (the shapes SSOT
— not restated here). History (0626) and Observability (J92) established the module-shell pattern;
Tasks is the first full-bleed instance. Open Design prototyping (project `tasks-frontend`, against
root `DESIGN.md` tokens) precedes React implementation; the artifact link is cited as T3 surface
evidence in this task's Solution.

Implements (feature numbering): R1, R2, R3, R4, R5, R6, R8, R9, R10, R11, R12. Feature R7 (task card
enrichment) belongs to sibling task 0664. **The Acceptance Criteria below carry the feature's
numbering verbatim** — task-local Requirements R1–R11 use their own sequence and are mapped by
subject, not by number.

**Verified against the tree on 2026-08-25:**

| Claim | Evidence |
| --- | --- |
| ADR-081 exists and owns the shell convention | `docs/00_ADR.md:1182` |
| The design satellite exists | `docs/design/tasks-module-shell-parity.md` |
| Root `DESIGN.md` exists and is the UI SSOT | `DESIGN.md` (26,964 bytes) |
| The History shell is the pattern to copy | `apps/web/src/modules/history/HistoryShell.tsx`, `history/tabs.ts` |
| `TaskKanbanView` is exported and consumed by the Workspace embed | `task-kanban/index.tsx:19`; `modules/workspace/tabs.ts:3,20` |
| `module.component` currently points at `TaskKanbanView` | `task-kanban/index.tsx:35` |
| `TaskFilters` has exactly one consumer | `KanbanBoard.tsx:11,229` (rendered only when `onFilterChange` is passed) |
| The in-board toolbar row exists and hosts filters + live chip + folder Select | `KanbanBoard.tsx:228-245` |
| `useTaskParams` drives `?status=`, `?feature=`, `?parent=` (and `assignee`) | `useTaskParams.tsx:30-36,50` |
| `api.task.folders` exists for the phase dropdown | `packages/contracts/src/task.ts:163-166` |
| The live/connected flag comes from `useTasks` | `useTasks.ts:40,105`; consumed at `KanbanBoard.tsx:76` |
| The `.task-kanban` token scope is established | `apps/web/src/styles/global.css:21-22,66` |

**Premise corrected during refinement.** The earlier Design invariant said "no `max-w-[1600px]`
wrapper", implying one exists in Tasks. It does not — `TaskKanbanView` is already full-bleed
(`index.tsx:22`, `flex flex-col h-full`). The `max-w-[1600px] mx-auto` constraint lives in
**`HistoryShell.tsx:361`**, the shell being copied. The real instruction is therefore: when porting
the History shell, **do not carry over its max-width constraint** — that divergence is exactly the
"density-first full-bleed" clause ADR-081 names. Stated as a removal, an implementer would search
Tasks for a wrapper that was never there.

Sibling task 0664 (card enrichment) touches a disjoint file surface (`TaskCard.tsx`, `useTasks.ts`)
and carries no ordering dependency on this task — see this task's Q&A for how that independence is
preserved.

Rubric: feature level E7 D2 L1 C0 R0 = 10 (>= 5) → decompose; this child is one cohesive file
surface (TasksShell/tabs/index/KanbanBoard/TaskFilters) with a single review context — not split
further.

### Requirements

- [ ] R1. Tasks module renders the one-row shell header with History-parity layout: icon + name + live chip left, tab strip right, full-width.
- [ ] R2. Header hosts inline filters (phase Select, status checkboxes, combined WBS/feature input) immediately before the tab strip; the TaskFilters bar and the in-board toolbar row are removed.
- [ ] R3. Combined input with a bare four-digit WBS navigates to /board/tasks/<wbs>, opening the existing path-WBS detail popup.
- [ ] R4. Combined input with a dotted WBS applies the parent filter (board shows that parent's subtasks).
- [ ] R5. Combined input with any other text applies the feature substring filter.
- [ ] R6. Board body is full-bleed: no centered max-width wrapper; header and body share the same horizontal padding so lanes align under the header.
- [ ] R7. All filter state stays URL-driven via useTaskParams (?parent=, ?feature=, ?status=) — shareable URLs restored in a new session.
- [ ] R8. Floating/right-dock task detail panel appearance and behavior are unchanged (--detail-w persistence, Escape, path-WBS auto-popup).
- [ ] R9. Workspace embed keeps rendering the headerless board (TaskKanbanView export preserved); card click to detail, drag-and-drop, and live updates work in the embed.
- [ ] R10. tabs.ts declares the append-only TASKS_TABS contract with exactly one Kanban tab; appending an entry renders a new tab with no shell layout changes.
- [ ] R11. An Open Design artifact for the header and cards exists before React implementation and is cited as T3 surface evidence.

### Acceptance Criteria

```gherkin
Feature: Tasks shell — History-parity header, inline filters, full-bleed layout

  @core
  Scenario: R1 — Tasks module renders the one-row shell header with History-parity layout
    Given the operator navigates to the Tasks module route
    When the module shell renders
    Then the header is a single row with the same layout and full-width behavior as the History module header
    And the left side shows the module icon, the name "Tasks", and the live chip
    And the right side shows the tab strip containing exactly one tab: "Kanban"

  @core
  Scenario: R2 — Header hosts inline filters with no separate filter section
    Given the Tasks module shell is rendered
    When the operator views the header row
    Then a phase dropdown, status checkboxes, and one combined WBS/feature input appear inline immediately before the tab strip
    And no separate filter bar section exists below the header
    And the previous in-board toolbar row and the TaskFilters bar are removed

  @core
  Scenario: R3 — Combined input opens the path-WBS popup for a bare four-digit WBS
    Given the Tasks board is rendered
    When the operator enters a bare four-digit WBS into the combined input
    Then the existing path-WBS navigation popup for that task opens

  @core
  Scenario: R4 — Combined input filters subtasks for a dotted WBS
    Given the Tasks board is rendered
    When the operator enters a dotted WBS into the combined input
    Then the board filters to that parent's subtasks via the parent filter

  @core
  Scenario: R5 — Combined input falls back to feature substring filtering
    Given the Tasks board is rendered
    When the operator enters text that is neither a bare four-digit WBS nor a dotted WBS
    Then the board applies it as a feature substring filter

  @core
  Scenario: R6 — Board body is full-bleed and header-aligned
    Given the Tasks module is rendered at a standard desktop viewport
    When the Kanban tab renders its lanes and cards
    Then the main body occupies the full available width with no centered max-width wrapper
    And the header and body share the same horizontal padding so lanes align under the header

  @core
  Scenario: R8 — Filters stay URL-driven and shareable
    Given the operator has set a phase selection, status visibility, and a combined-input query
    When the resulting URL is opened in a new session
    Then the same phase, status, and query filter state is restored from the URL

  @core
  Scenario: R9 — Floating and right-dock task detail panel behavior is unchanged
    Given the Tasks board is rendered
    When the operator opens a task detail and switches between floating and right-dock modes
    Then the panel appearance, resizing, Escape handling, and path-WBS auto-popup behave exactly as before the refactor

  @core
  Scenario: R10 — Workspace embed keeps the headerless board
    Given the Workspace module renders its Tasks tab
    When the embedded board appears
    Then no module shell header is rendered inside the embed
    And card click to detail, drag-and-drop, and live updates continue to work in the embed

  @edge
  Scenario: R11 — Tab strip contract is append-only for future views
    Given the tabs contract declares only the Kanban tab
    When a new tab entry is appended to the contract
    Then the shell renders the additional tab with no changes to the shell layout logic

  @edge
  Scenario: R12 — Open Design prototype precedes React implementation
    Given the F72 design satellite and root DESIGN.md tokens
    When implementation begins
    Then an Open Design artifact for the header and enriched task cards exists and is cited as T3 surface evidence in the implementation task
```

### Q&A

**Q: The live chip currently renders inside `KanbanBoard`'s toolbar (`KanbanBoard.tsx:236-243`).
Moving it into the shell header removes it from the headerless Workspace embed. Is that acceptable?**

Closed — accepted, with the embed keeping live *behavior*. R10 requires the embed to keep working
(card click, drag-and-drop, live updates), not to keep the live *indicator*. The chip is a
shell-header affordance in the History pattern being copied, and the Workspace tab has its own
surrounding chrome. Do not re-add a second chip inside the board to compensate; if the embed later
needs a connection indicator, that is a Workspace-module decision, not a Tasks-board one.

**Q: Does this task collide with sibling 0664 over `KanbanBoard.tsx` / `KanbanColumn.tsx`?**

Closed — no, because 0664 was re-scoped during this same refine. The naive card implementation would
have needed the full tasks array prop-drilled through `KanbanBoard` → `KanbanColumn` → `TaskCard`,
putting both tasks in the same files. 0664 instead derives the subtask map inside `useTasks` and
reads it from `TaskCard` via the existing `useSyncExternalStore` hook, so its surface stays
`useTasks.ts` + `TaskCard.tsx`. The two tasks remain genuinely parallel. If 0664's approach changes,
re-open this: shared `KanbanBoard.tsx` edits would require an ordering dependency.

**Q: `TaskCard` is rendered from two places — the lanes (`KanbanColumn.tsx:53`) and the drag overlay
(`KanbanBoard.tsx:385`). Does the full-bleed lane restructure affect the overlay?**

Closed — the overlay renders outside lane layout and is unaffected by lane width or padding changes.
Verify it visually during the browser pass rather than assuming it, since drag preview is the one
surface a layout refactor most often breaks silently.

### Design

**Chosen approach.** New `TasksShell.tsx` owns the one-row header (identity block + live chip →
inline filters → + New Task → tab strip) and tab switching; new `tabs.ts` exports the append-only
`TASKS_TABS` contract (`{ id: 'kanban', label: 'Kanban' }`); `KanbanBoard` loses its toolbar row
(`KanbanBoard.tsx:228-245`) and gains optional controlled props with uncontrolled in-board defaults;
`TaskFilters.tsx` is deleted (its single consumer at `KanbanBoard.tsx:229` is absorbed into the
header); `index.tsx` points `module.component` (`index.tsx:35`) at `TasksShell` while the headerless
`TaskKanbanView` export (`index.tsx:19`) is preserved for the Workspace embed. `NewTaskPanel` is
rendered by the shell.

**Why.** Reuses the proven History shell pattern (0626) instead of inventing a second convention;
the controlled-prop seam keeps one board implementation serving both entry points (route + embed).

**Rejected alternatives.** (a) In-place toolbar restyle — strands the tab contract the idea
explicitly prepares for. (b) Open-design-led multi-view redesign (List/Swimlanes/Analytics now) —
unrequested scope, multiplied verification surface.

**Invariants.**

- All filter state stays URL-driven via `useTaskParams` (`?status=`, `?feature=`, `?parent=`).
- **Full-bleed: do not port `HistoryShell.tsx:361`'s `max-w-[1600px] mx-auto` wrapper.** Tasks has no
  such wrapper today and must not acquire one — this is the ADR-081 density-first divergence from the
  otherwise-copied History shell. Header and body share one `px-4` so lanes align under the header.
- Styling resolves through the `.task-kanban` token scope (`global.css:21-22,66`) — no hex literals,
  no Tailwind palette classes.
- `TaskDetail` appearance and behavior untouched.
- No `packages/contracts` or server changes.
- Assignee chip excluded (contract growth out of scope).

**Key shapes.**

```ts
interface TasksTab { readonly id: string; readonly label: string; readonly component: ComponentType }

// KanbanBoardProps additions — all optional, uncontrolled defaults retained in-board:
folder?: string;
onFolderChange?: (folder: string) => void;
hiddenColumns?: ReadonlySet<string>;
onToggleColumn?: (status: string) => void;
```

**Combined-input parse rule** (`docs/design/tasks-module-shell-parity.md` §4):
`/^\d{4}$/` → navigate `/board/tasks/<wbs>`; contains `.` → `setFilter('parent', value)`; otherwise
→ `setFilter('feature', value)`.

Status checkboxes drive lane visibility via `hiddenColumns` (default hidden: `blocked`, `cancelled`),
**not** the URL `status` filter — the two are different mechanisms and conflating them breaks R8's
shareable-URL contract.

**Anti-patterns — do not implement.**

- Do **not** search Tasks for a `max-w-[1600px]` wrapper to delete. There isn't one; the constraint
  is in the shell you are copying from. Porting it is the error to avoid.
- Do **not** re-add a live chip inside `KanbanBoard` to compensate for the Workspace embed losing the
  header. See Q&A — that is a Workspace decision.
- Do **not** make the new `KanbanBoard` props required. The embed renders the board without a shell
  and must keep its uncontrolled defaults.
- Do **not** route lane visibility through the URL `status` param. `hiddenColumns` is view state.
- Do **not** touch `TaskDetail.tsx`, `packages/contracts`, or the server.
- Do **not** edit `TaskCard.tsx` — that is sibling task 0664's surface.
- Do **not** begin React implementation before the Open Design artifact exists (R12 is a gate, not a
  formality).

**Cross-task.** No dependency on 0664 in either direction — see Q&A for how the file surfaces were
kept disjoint. Leaves for 0664: `KanbanColumn.tsx` and `KanbanBoard.tsx`'s card render paths
(`KanbanColumn.tsx:53`, `KanbanBoard.tsx:385`) stay structurally intact so card changes land
independently.

### Plan

1. Open Design loop: create_project('tasks-frontend') → start_run with a prompt naming root DESIGN.md tokens and the header/card shapes in docs/design/tasks-module-shell-parity.md §3/§8; iterate until the header row and card read correctly at full bleed; record the artifact link.
2. tabs.ts: append-only TASKS_TABS contract with the single Kanban tab.
3. TasksShell.tsx: header row (identity block + live chip from the useTasks connected flag → inline filters → + New Task → History-styled tab strip) + tab switching; render NewTaskPanel from the shell.
4. Header filters: phase Select (api.task.folders), status checkboxes driving hiddenColumns (blocked/cancelled hidden by default), combined WBS/feature input with the §4 parse rule; delete TaskFilters.tsx.
5. KanbanBoard.tsx: remove the toolbar row; accept the optional controlled props with uncontrolled defaults; render lanes full-bleed (flex-1 overflow-hidden; horizontal scroll only when lane count exceeds viewport).
6. index.tsx: point the module route at TasksShell; preserve the headerless TaskKanbanView export for the Workspace embed.
7. Browser verification against the dev server per docs/design/tasks-module-shell-parity.md §11 (header full-bleed, filters move URL params and lane sets, /board/tasks/0001 deep link auto-opens detail, drag-and-drop persists, Workspace embed headerless); cite the Open Design artifact as T3 evidence; update docs/04_DESIGN.md in the same commit.

### Solution

**Change map** (T3 surface evidence; Open Design prototype: project `tasks-frontend`, artifact `index.html` — [Open Design studio](http://127.0.0.1:57774/projects/tasks-frontend-74af/conversations/0c1e3b9c-c54d-46c9-9451-59afbede3356/files/index.html), R12 gate).

| Path | Change |
| --- | --- |
| `apps/web/src/modules/task-kanban/tabs.ts:28` | `TASKS_TABS` append-only contract — single `kanban` tab whose component is the headerless board; additive future tabs need no shell-layout change (R10/R11). |
| `apps/web/src/modules/task-kanban/TasksShell.tsx:33` | `TasksShell` module shell: one-row header (📋 + Tasks + live chip, inline phase Select/status checkboxes/combined input, + New Task, tab strip) + full-bleed body on shared padding (R1/R2/R6/R8). |
| `apps/web/src/modules/task-kanban/TasksShell.tsx:17` | `parseCombinedInput` §4 rule: bare 4-digit WBS → navigate + path-WBS popup; dotted → parent filter; else → feature substring filter (R3/R4/R5). |
| `apps/web/src/modules/task-kanban/KanbanBoard.tsx:41` | `Props` — optional controlled `folder`/`hiddenColumns` with uncontrolled in-board defaults so the Workspace embed keeps working headerless (R9/R10). |
| `apps/web/src/modules/task-kanban/KanbanBoard.tsx:84` | `hiddenColumns` prop drives lane visibility; default hides `blocked`/`cancelled` (R2). |
| `apps/web/src/modules/task-kanban/KanbanBoard.tsx:210` | Pure-lane body `flex gap-3 overflow-x-auto h-full p-4`; the in-board toolbar (nav bar + `TaskFilters` bar) was removed wholesale — `TaskFilters.tsx` deleted, single consumer absorbed into the header (R2/R6). |
| `apps/web/src/modules/task-kanban/index.tsx:36` | Module registry `component` → `TasksShell`; the headerless `TaskKanbanView` export is preserved for the Workspace embed (R1/R10). |
| `docs/04_DESIGN.md:70` | tasks-module-shell-parity satellite status → shell built (same-commit T3). |

**What was skipped / noted.** Board carries only the props it actually uses — `onFolderChange`/`onToggleColumn` from the design-doc §7 draft are omitted (folder/visibility controls moved wholesale into the shell; single owner, no dead props). Shell live chip reads `connected` from the shared ref-counted `useTasks()` store per design §3; the board keeps its folder-scoped store for lane data (residual: two list calls on mount).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | TasksShell.tsx header: icon+Tasks+live chip left, tab strip right; browser: headerTitle=1, liveChip rendered, tabs=[Kanban] |
| R2 | MET | Inline filters in header row (Select/checkboxes/combined input); TaskFilters.tsx deleted, board toolbar removed; browser: phaseSelect=1, checkboxes=7, combinedInput=1, no data-key inputs |
| R3 | MET | parseCombinedInput `/^\d{4}$/` -> selectTask -> /board/tasks/<wbs>; board location effect opens popup; browser: URL /board/tasks/0663 + detail panel docked right:0 |
| R4 | MET | parseCombinedInput dotted -> setFilter('parent'); unit tests tasks-shell.test.ts |
| R5 | MET | parseCombinedInput else -> setFilter('feature'); browser: ?feature=F72 in URL |
| R6 | MET | Full-bleed: no max-w wrapper ported; browser: header/lane paddingLeft both 16px, widths equal (1196), zero max-w-* inside shell |
| R7 | MET | All filter state via useTaskParams (URL params); browser: ?feature=F72 restored from URL |
| R8 | MET | Detail panel unchanged: TaskDetail/ResizeHandle/docked markup carried verbatim; browser: right:0 top:0 dock, Escape closes |
| R9 | MET | TaskKanbanView headerless export preserved; workspace/tabs.ts imports unchanged; browser: embed has board, no Tasks header (embedNoHeader=1) |
| R10 | MET | tabs.ts append-only TASKS_TABS with single kanban tab; tabs.test.ts asserts length 1 + resolvable component |
| R11 | MET | Open Design artifact project tasks-frontend/index.html (10.4KB) produced before React implementation; cited as T3 evidence in Solution |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Functional traceability (R1–R12):** R1 header identity block + live chip + single Kanban tab; R2 inline filters with toolbar/TaskFilters removed; R3/R4/R5 combined-input parse rule (`parseCombinedInput`, pure + unit-tested); R6 full-bleed body with shared header/body padding; R7/R8 URL-driven filter state via `useTaskParams`; R9 TaskDetail untouched (board carried verbatim); R10 headerless `TaskKanbanView` export preserved for the Workspace embed; R11 append-only `TASKS_TABS` contract (+ `tabs.test.ts`); R12 Open Design artifact exists and is cited. All 12 covered by code, tests (705 web tests), or cited artifact.

**SECUA findings.**

| Severity | Finding |
| --- | --- |
| P3 | Shell live chip subscribes to the ref-counted shared `useTasks()` store, triggering one full `api.task.list({})` initial load in addition to the board's folder-scoped store. Matches design §3's noted singleton pattern; two list calls on mount. Residual, non-blocking. |
| P4 | Combined input clears after a bare-WBS navigate (R3) so the field never holds a stale WBS after the popup opens — intended; filter-type inputs mirror their URL param via the filters effect. |

**Architecture:** controlled/uncontrolled seam matches design §7 (optional `folder`/`hiddenColumns` with in-board defaults); dead `onFolderChange`/`onToggleColumn` props from the design-doc draft omitted (controls moved wholesale into the shell — single owner); `TaskFilters.tsx` deleted with zero dangling references; NewTaskPanel ownership moved to the shell; sections per one-writer protocol (Solution = implement, Review = this stage).

**Residual risk:** browser-level verification (full-bleed pixel layout, drag overlay under the new header, embed headerlessness) still to be confirmed in the verify browser pass.

### References

- Parent feature: `docs/features/F72_tasks-module-history-shell-parity-unified-header-inline-filters-full-bleed-density.md`
- Decision: `docs/00_ADR.md` ADR-081 — Board Module Shell Convention
- Shapes SSOT: `docs/design/tasks-module-shell-parity.md` (§3 header, §4 combined-input parse rule, §8 cards, §11 browser verification)
- UI design SSOT: root `DESIGN.md` (tokens, typography, density)
- Pattern being copied: `apps/web/src/modules/history/HistoryShell.tsx`, `apps/web/src/modules/history/tabs.ts` (task 0626)
- Sibling: task 0664 (card enrichment — feature R7)

### History

- 2026-08-25T05:53:51.473Z todo → wip (system)
- 2026-08-25T06:10:17.773Z wip → testing (system)
- 2026-08-25T06:10:23.707Z testing → done (system)
