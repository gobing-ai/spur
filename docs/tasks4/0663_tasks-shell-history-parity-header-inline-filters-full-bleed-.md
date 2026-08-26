---
schema_version: 1
name: "Tasks shell: History-parity header, inline filters, full-bleed layout"
status: done
template: feature-impl
created_at: 2026-08-25T05:08:07.333Z
updated_at: "2026-08-26T01:47:49.979Z"
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
**Current verified change map (2026-08-25).** Original shell landing: `f104bf5c3fc0a74abb25f8a63c2f419c6cc573f0`. Open Design prototype: project `tasks-frontend`, artifact `index.html` — [Open Design studio](http://127.0.0.1:57774/projects/tasks-frontend-74af/conversations/0c1e3b9c-c54d-46c9-9451-59afbede3356/files/index.html).

| Anchor | Delivered |
| --- | --- |
| `apps/web/src/modules/task-kanban/TasksShell.tsx:32` | `TasksShell` owns the one-row header, live chip, URL-driven inline controls, New Task action, tab strip, and full-bleed body. |
| `apps/web/src/modules/task-kanban/useTaskParams.tsx` | URL state owns phase folder, comma-separated status visibility, and mutually exclusive feature/parent queries. |
| `apps/web/src/modules/task-kanban/KanbanBoard.tsx` | Pure lanes, controlled folder/visibility, substring filtering, path-WBS detail, and the board-owned task-store provider. |
| `apps/web/src/modules/task-kanban/useTasks.ts` | Descendant cards/detail resolve the board's folder-scoped store before the module fallback. |
| `apps/web/src/modules/task-kanban/tabs.ts` | Append-only Tasks tab contract with one Kanban entry and a connection-state reporter. |
| `apps/web/src/modules/task-kanban/index.tsx` | Headerless `TaskKanbanView` remains the Workspace embed seam. |
| `apps/web/tests/modules/task-kanban/index.test.tsx` | Restores phase/status/query from one URL and proves exactly one folder-scoped task-list request. |
| `apps/web/tests/modules/task-kanban/board.test.tsx` | Proves one board store supplies lanes, card progress, detail updates, and connection state. |
| `docs/design/tasks-module-shell-parity.md` | Surface SSOT records the final URL, controlled-prop, tab, and board-owned store contracts. |

`TaskFilters.tsx` remains deleted; task-list contracts and server handlers remain unchanged. The post-verification store-ownership repair closes the former duplicate initial `task.list` request: the shell receives only the board's connection boolean, while all task data stays in the single folder-scoped board store.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Shell integration asserts heading, live chip, and Kanban tab; full web suite reports 720 pass, 0 fail. Repo-root `.spur/run/0663-verdict.json` lines 1-187 regenerated from this fresh verification. |
| R2 | MET | Shell integration asserts one textbox and seven status checkboxes; board purity test asserts no toolbar controls. |
| R3 | MET | Combined-input parser and path-WBS board test cover four-digit navigation and popup. |
| R4 | MET | Parser and URL tests cover dotted-WBS parent filtering. |
| R5 | MET | Parser and case-insensitive board test cover feature substring filtering. |
| R6 | MET | Shell integration rejects a max-width wrapper and checks aligned header/body padding. |
| R7 | MET | URL-hook and fresh-router tests cover folder, status, feature, parent, and empty-status state. |
| R8 | MET | Detail tests cover dock, backdrop, Escape, resize persistence, and path-WBS auto-open. |
| R9 | MET | Headerless embed, drag transition/rollback, detail, and single folder-scoped store tests pass. |
| R10 | MET | Tabs contract test and generic shell rendering preserve the append-only Kanban entry. |
| R11 | MET | Solution cites the pre-implementation Open Design artifact; fresh `curl -I` returned HTTP 200. |
| AC-1 | MET | Feature-scenario alias; the complete scenario evidence is recorded in the acceptance-criteria table below. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Tasks module renders the one-row shell header with History-parity layout | MET | test | Shell integration asserts heading, live chip, and one Kanban tab; full web suite reports 720 pass. |
| R2 — Header hosts inline filters with no separate filter section | MET | test | Shell integration asserts one combined textbox and seven status checkboxes; board purity test asserts no toolbar. |
| R3 — Combined input opens the path-WBS popup for a bare four-digit WBS | MET | test | Parser and path-WBS detail integration tests pass. |
| R4 — Combined input filters subtasks for a dotted WBS | MET | test | Parser and URL mutual-exclusion tests pass. |
| R5 — Combined input falls back to feature substring filtering | MET | test | Parser and case-insensitive substring board tests pass. |
| R6 — Board body is full-bleed and header-aligned | MET | test | Shell integration asserts no max-width wrapper and aligned `px-4`/`p-4` spacing. |
| R8 — Filters stay URL-driven and shareable | MET | test | Router integration restores folder, status, and feature; hook tests cover mutation and clearing. |
| R9 — Floating and right-dock task detail panel behavior is unchanged | MET | test | Detail regression and path-WBS auto-open tests pass. |
| R10 — Workspace embed keeps the headerless board | MET | test | Embed, board interaction, and single-store tests pass. |
| R11 — Tab strip contract is append-only for future views | MET | command | Web typecheck exits 0 and the tabs contract test passes. |
| R12 — Open Design prototype precedes React implementation | MET | command | Solution records `tasks-frontend/index.html`; fresh HTTP HEAD returns 200. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings; functional, SECUA, and architecture review PASS. The former duplicate-load residual is closed. |

**Functional traceability.**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/task-kanban/TasksShell.tsx:32` and the shell integration test cover the one-row identity/live/tab shell. |
| R2 | MET | Shell integration asserts one textbox and seven status checkboxes; board purity test asserts no toolbar controls. |
| R3 | MET | Combined-input parser test plus path-WBS board test cover four-digit navigation and popup. |
| R4 | MET | Parser and URL tests cover dotted-WBS parent filtering. |
| R5 | MET | Parser and case-insensitive board test cover feature substring filtering. |
| R6 | MET | Shell integration rejects a max-width wrapper and checks aligned header/body padding. |
| R7 | MET | URL-hook and fresh-router tests cover folder, status, feature, parent, and empty-status state. |
| R8 | MET | Existing detail tests cover dock, backdrop, Escape, resize persistence, and path-WBS auto-open. |
| R9 | MET | Headerless embed test plus drag transition, rollback, detail, SSE/poll-store tests pass. |
| R10 | MET | Tabs contract test and generic shell rendering preserve the append-only Kanban entry. |
| R11 | MET | Solution cites the pre-implementation Open Design artifact; the prior HTTP probe returned 200. |

**SECUA.** No security boundary changed; the folder filter remains typed through the existing API. Correctness is covered by URL restoration, exact-one-request, non-default-folder progress, drag rollback, and detail tests. The change removes redundant I/O rather than adding it.

**Architecture.** `KanbanBoard` owns the only folder-scoped task store and provides it to its multiple existing descendants; `TasksShell` receives only `connected`. This is the narrowest ownership seam that keeps cards/detail on the same data and avoids task-array/map prop drilling. No deepening candidates remain in the F72 scope.

**Residual risk:** none identified within F72 scope.
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
