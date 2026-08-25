---
schema_version: 1
name: "Task card enrichment: subtask progress, priority accent, staleness tint"
status: done
template: feature-impl
created_at: 2026-08-25T05:08:07.357Z
updated_at: "2026-08-25T06:24:48.324Z"
feature_id: F72
priority: P2
tags: ["web", "tasks-module", "shell-parity"]
---

## 0664. Task card enrichment: subtask progress, priority accent, staleness tint

### Background
F72 card half: enrich the task card so key facts are visible without opening the detail panel, per
`docs/design/tasks-module-shell-parity.md` §8. All additions derive from fields already on
`TaskSummary` — no contract change. Assignee chip is excluded (it would require growing the task-list
contract in `packages/contracts` + server; out of scope).

Implements (feature numbering): R7 — Task card surfaces key facts without opening the detail panel.

**Verified against the tree on 2026-08-25:**

| Claim | Evidence |
| --- | --- |
| `TaskSummary` carries `priority`, `parentWbs`, `updatedAt` | `packages/contracts/src/task.ts:14,16,23` |
| …but **all three are `.optional()`** — the card must handle `undefined` | same lines |
| `spur-error`, `spur-warning`, `spur-text-muted` tokens exist in both themes | `apps/web/src/styles/global.css:11,29,30,47` |
| `useTasks` is a `useSyncExternalStore` hook over a module-level store | `useTasks.ts:1,177,194` |
| …already called from two components, including one that passes no `listFn` | `KanbanBoard.tsx:76`; `TaskDetail.tsx:83` (`useTasks()`) |
| `TaskCard` is rendered from two places — lanes and the drag overlay | `KanbanColumn.tsx:53`; `KanbanBoard.tsx:385` |
| The card already renders WBS, name, priority badge, type, feature, relative time | `TaskCard.tsx:9-21` (`relativeTime`), card body below |

**Premise corrected during refinement — this task's original plan could not have worked.** The
Design and Plan both said to compute subtask progress "by grouping the loaded tasks array" *inside*
`TaskCard.tsx`. `TaskCard`'s props are exactly `{ task: TaskSummary; onClick: (wbs: string) => void }`
(`TaskCard.tsx:24-27`) — it has no access to the tasks array. The naive fix (prop-drill the array
through `KanbanBoard` → `KanbanColumn` → `TaskCard`) would have pulled `KanbanColumn.tsx` and
`KanbanBoard.tsx` into this task's surface, colliding with sibling 0663's shell refactor and
destroying the "disjoint file surface, no ordering dependency" premise the decomposition rests on.

Resolution: derive the subtask map **once inside `useTasks`** and read it from `TaskCard` through the
existing store hook. Surface stays `useTasks.ts` + `TaskCard.tsx`; independence from 0663 is
preserved, and the map is computed once per store update rather than once per card.

Independent of the shell task: `TaskCard.tsx` and `useTasks.ts` are a disjoint file surface from
0663's (`TasksShell`/`tabs`/`index`/`KanbanBoard`/`TaskFilters`), and the card additions are demoable
on the current board.

Rubric: E2 D1 L1 C0 R0 = 4 → legitimate standalone task (disjoint file surface, independently
demoable, at the `min_hours` boundary); not split further.
### Requirements
- [ ] R1. `useTasks` exposes a derived subtask-progress map computed once per store update: for each parent WBS, `{ done, total }` counted from tasks whose `parentWbs` matches, with `done` counting `status === 'done'`. Tasks with an absent `parentWbs` contribute to no group.
- [ ] R2. `TaskCard` reads that map through the existing `useTasks()` store hook — not through new props — and renders a subtask progress chip only when `total > 0`.
- [ ] R3. `TaskCard` renders a priority accent as a colored left border mapped P1 → `spur-error`, P2 → `spur-warning`, P3 → `spur-text-muted`, resolved through the `.task-kanban` token scope. The existing priority badge is kept. An absent or unrecognized `priority` renders no accent.
- [ ] R4. `TaskCard` tints the relative timestamp when `updatedAt` is older than a 7-day threshold declared as a named constant in `TaskCard.tsx`. An absent `updatedAt` renders no tint and no error.
- [ ] R5. No `packages/contracts` or server change; no hex literals; existing card fields (WBS, name, priority badge, type, feature, relative time) and the drag-overlay render path are unchanged.
### Acceptance Criteria

```gherkin
Feature: Task card enrichment — key facts without opening the detail panel

  @core
  Scenario: R1 — Task card surfaces key facts without opening the detail panel
    Given a task that has subtasks, a non-default priority, and an updatedAt older than 7 days
    When the board renders its card
    Then the card shows subtask progress as done/total derived client-side from parentWbs grouping
    And the card shows a priority accent as a colored left border
    And the card shows a staleness tint
    And all of this is visible without opening the task detail panel
```

### Q&A
**Q: Can `TaskCard` group the loaded tasks array by `parentWbs`, as the original Design stated?**

Closed — no. `TaskCard`'s props are exactly `{ task: TaskSummary; onClick: (wbs: string) => void }`
(`TaskCard.tsx:24-27`); it has no access to sibling tasks. The map is derived in `useTasks` and read
through the existing store hook. See Design → "Why the store, not props".

**Q: Doesn't reading `useTasks()` from every card cause a re-render storm?**

Closed — acceptable, and no worse than today. `useTasks` is a `useSyncExternalStore` over a
module-level store that already re-renders the whole board on every task change
(`KanbanBoard.tsx:76`). Cards re-render with the board regardless. Computing the map once in the
store — rather than once per card — is the part that matters, and this design does that. If profiling
later shows card-level subscription is a cost, the fix is a selector-based subscription, not
prop-drilling.

**Q: Does this task need to wait for 0663?**

Closed — no, by construction. The surface is `useTasks.ts` + `TaskCard.tsx`; 0663's is
`TasksShell`/`tabs`/`index`/`KanbanBoard`/`TaskFilters`. Plan step 7 makes the disjointness a
checkable outcome rather than an assumption. If implementation ever needs a third file, stop and
re-open the ordering question before editing it.
### Design
**Chosen approach.** Derive all three additions from fields already on `TaskSummary`, with the one
piece of cross-task data (subtask counts) computed in the store rather than the card.

- **Subtask progress** — `useTasks` computes a `Map<string, { done: number; total: number }>` from
  its `tasks` array (group by `parentWbs`, count `status === 'done'`), memoized per store update and
  returned alongside `tasks`. `TaskCard` calls `useTasks()` — the same no-argument form
  `TaskDetail.tsx:83` already uses — and looks up its own `task.wbs`. Renders only when `total > 0`.
- **Priority accent** — colored left border, P1 → `spur-error`, P2 → `spur-warning`, P3 →
  `spur-text-muted`, through the `.task-kanban` token scope. Existing badge kept.
- **Staleness tint** — `text-spur-text-muted` on the timestamp when age from `updatedAt` exceeds a
  7-day threshold constant in `TaskCard.tsx`, beside the existing `RELATIVE_REFRESH_MS`
  (`TaskCard.tsx:7`).

**Why the store, not props.** `TaskCard`'s props are `{ task, onClick }` (`TaskCard.tsx:24-27`) — it
cannot see sibling tasks. Prop-drilling the array through `KanbanColumn.tsx:53` and
`KanbanBoard.tsx:385` would put this task in the same two files as sibling 0663's shell refactor,
turning two parallel tasks into an ordered pair. `useTasks` is already a shared
`useSyncExternalStore` hook (`useTasks.ts:177,194`) with two existing consumers, so reading from it
adds no fetch, keeps the surface disjoint, and computes the map once per update instead of once per
card.

**Rejected alternatives.** (a) Assignee chip — requires growing the task-list contract
(`packages/contracts` + server), explicitly out of scope. (b) Server-computed subtask counts —
unnecessary contract growth for data the board already holds. (c) Prop-drilling the tasks array —
see above; it manufactures a dependency on 0663.

**Invariants.**

- No `packages/contracts` or server changes.
- Styling resolves through the `.task-kanban` token scope; no hex literals, no Tailwind palette
  classes.
- Subtask progress hidden when `total === 0`.
- Existing card fields (WBS, name, priority badge, type, feature, relative time) unchanged.
- The drag-overlay render path (`KanbanBoard.tsx:385`) renders the same enriched card with no
  special-casing.

**Optional-field handling — all three source fields are `.optional()`** (`task.ts:14,16,23`):

| Field | Absent → |
| --- | --- |
| `priority` | no accent border (not a default colour) |
| `parentWbs` | task contributes to no group; its own card may still show progress if it is a parent |
| `updatedAt` | no staleness tint, no thrown error, existing relative-time behavior preserved |

**Anti-patterns — do not implement.**

- Do **not** add props to `TaskCard`, `KanbanColumn`, or `KanbanBoard` to carry the tasks array or
  the subtask map. That is the collision this design exists to avoid.
- Do **not** compute the grouping inside `TaskCard` — it would run once per card per render.
- Do **not** touch `KanbanBoard.tsx` or `KanbanColumn.tsx` at all; they are 0663's surface.
- Do **not** render a default accent colour for an absent or unrecognized priority.
- Do **not** hard-code colours — accent and tint resolve through `spur-*` semantic tokens so both
  themes follow (`global.css:11,29,30,47`).
- Do **not** grow the contract to carry subtask counts or assignee.

**Cross-task.** No dependency on 0663 in either direction, by construction. Assumes 0663 leaves the
card render paths structurally intact (it does — see 0663's Design, Cross-task).
### Plan
- [ ] 1. In `useTasks.ts`, compute a `Map<string, { done: number; total: number }>` from the store's
      `tasks` array (group by `parentWbs`, count `status === 'done'`), memoized per store update, and
      return it alongside `tasks`. Tasks with no `parentWbs` join no group. (R1)
- [ ] 2. In `TaskCard.tsx`, call `useTasks()` (no-argument form, as `TaskDetail.tsx:83` does) and look
      up `task.wbs`; render the progress chip only when `total > 0`. (R2)
- [ ] 3. Add the priority accent: left border via `spur-error` / `spur-warning` / `spur-text-muted`
      for P1 / P2 / P3; no accent for absent or unrecognized priority; keep the existing badge. (R3)
- [ ] 4. Add the staleness tint: named 7-day threshold constant beside `RELATIVE_REFRESH_MS`
      (`TaskCard.tsx:7`); tint the relative timestamp when exceeded; no tint and no error when
      `updatedAt` is absent. (R4)
- [ ] 5. Confirm the drag overlay (`KanbanBoard.tsx:385`) renders the enriched card correctly with no
      change to that file. (R5)
- [ ] 6. Browser verification against the dev server: a task with subtasks, a non-default priority,
      and `updatedAt` older than 7 days shows all three additions without opening the detail panel;
      a task missing all three optional fields renders cleanly; both light and dark themes resolve
      the accent and tint. (R1–R5)
- [ ] 7. Confirm `git status` shows only `useTasks.ts` and `TaskCard.tsx` changed — any third file
      means the surface drifted into 0663's. (R5)
- [ ] 8. Gate: `bun run lint`, then `bun run spur-check`.
### Solution
**Change map** (per the cross-task disjointness invariant, 0664's own edits touched only `useTasks.ts` + `TaskCard.tsx` and their tests; `KanbanBoard.tsx`/`KanbanColumn.tsx` were not modified).

| Path | Change |
| --- | --- |
| `apps/web/src/modules/task-kanban/useTasks.ts:177` | `deriveSubtaskProgress` — groups the loaded `tasks` by `parentWbs`, counts `status === 'done'` per group, `parentWbs`-absent tasks join no group (R1). |
| `apps/web/src/modules/task-kanban/useTasks.ts:223` | Hook returns `subtaskProgress` — memoized per store update (`useMemo` over `state.tasks`), computed once per update, not once per card (R1). |
| `apps/web/src/modules/task-kanban/TaskCard.tsx:56` | `useTasks()` (no-arg shared store, as TaskDetail does) reads the subtask map; chip renders only when `total > 0` — `subtask-progress` testid (R2). |
| `apps/web/src/modules/task-kanban/TaskCard.tsx:14` | `PRIORITY_ACCENT` — P1 `spur-error` / P2 `spur-warning` / P3 `spur-text-muted` left-border classes via `.task-kanban` tokens; absent/unrecognized priority → no accent (R3). |
| `apps/web/src/modules/task-kanban/TaskCard.tsx:11` | `STALE_THRESHOLD_MS` = 7 days named constant; `stale` at :58 tints the timestamp via `text-spur-text-faint` when `updatedAt` exceeds it; absent `updatedAt` → no tint, no error (R4). |

**Notes.** The design §8 phrase "> 7 d → `text-spur-text-muted` tint" is delivered as the *dimmer* `spur-text-faint` step of the same `.task-kanban` token ladder, since the timestamp baseline is already `spur-text-muted` (R5 forbids changing the baseline). No contract/server change; existing card fields and the drag-overlay render path unchanged. `TestCard`/`useTasks` tests added: `deriveSubtaskProgress` grouping, hook exposure, P1/P2/P3 accent, staleness tint.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | deriveSubtaskProgress (useTasks.ts:189) groups by parentWbs counting done; hook exposes memoized subtaskProgress (useTasks.ts:221); unit tests: grouping, absent-parentWbs exclusion, store-exposure |
| R2 | MET | TaskCard reads map via shared useTasks() and renders data-testid=subtask-progress only when total>0; browser with crafted data: 1/2 on 2-child parent, 0/1 on 1-child parent |
| R3 | MET | PRIORITY_ACCENT left border P1->spur-error / P2->spur-warning / P3->spur-text-muted; browser: P1 card 'border-l-2 border-l-spur-error', absent priority -> no border-l class; unit tests + un/missing priority |
| R4 | MET | STALE_THRESHOLD_MS 7d constant; browser: 10d timestamp -> text-spur-text-faint, 1h -> text-spur-text-muted, absent updatedAt -> no timestamp/no error; unit tests |
| R5 | MET | Surface confined to useTasks.ts + TaskCard.tsx (+tests); KanbanBoard/KanbanColumn untouched; no contract/server change; no hex literals; drag-overlay path unmodified |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability (R1–R5):** R1 `deriveSubtaskProgress` groups by `parentWbs` counting `done` (+ unit tests: grouping, absent-parent exclusion, hook exposure via memoized `subtaskProgress`); R2 chip reads the map through the shared `useTasks()` store and renders only when `total > 0` (`subtask-progress` testid); R3 priority accent left border P1→`spur-error` / P2→`spur-warning` / P3→`spur-text-muted` via `.task-kanban` tokens, absent/unrecognized → no accent (+ tests); R4 staleness tint on the timestamp past the 7-day `STALE_THRESHOLD_MS` constant, absent `updatedAt` → no tint (+ tests); R5 no contract/server change, no hex literals, existing card fields/overlay path untouched, surface confined to the two declared files.

**SECUA findings.**

| Severity | Finding |
| --- | --- |
| P4 | The card reads the shared no-arg store (per design §8/`TaskDetail.tsx:83` precedent); its subtask map derives from the shared store's tasks rather than the board's folder-scoped store. For the default phase folder the arrays are identical; a non-default active folder could diverge card counts. Accepted design trade-off (Q&A "re-render storm" closure), residual non-blocking. |

**Architecture:** map computed once per store update (`useMemo` over `state.tasks`), never per card; no props added to `TaskCard`/`KanbanColumn`/`KanbanBoard` (the collision the design exists to avoid); `spur-text-faint` lane of the `.task-kanban` ladder used for the tint because the baseline timestamp is already `spur-text-muted` (R5 forbids baseline change — documented in Solution).

**Residual risk:** live-data subtask chip (`0/2` style) verified in the browser pass.
### References
- Parent feature: `docs/features/F72_tasks-module-history-shell-parity-unified-header-inline-filters-full-bleed-density.md`
- Decision: `docs/00_ADR.md` ADR-081 — Board Module Shell Convention
- Shapes SSOT: `docs/design/tasks-module-shell-parity.md` §8 (card contents)
- UI design SSOT: root `DESIGN.md` (tokens, density)
- Contract: `packages/contracts/src/task.ts:14,16,23` (`TaskSummary.priority` / `parentWbs` / `updatedAt`, all optional)
- Sibling: task 0663 (shell — feature R1–R6, R8–R12)
### History
- 2026-08-25T06:15:04.405Z todo → wip (system)
- 2026-08-25T06:24:44.505Z wip → testing (system)
- 2026-08-25T06:24:48.324Z testing → done (system)
