---
doc: design/tasks-module-shell-parity
feature_id: F72
owns: SURFACE + mechanism for the Tasks Board module — History-shell parity (one-row header, inline filters, append-only tabs, full-bleed density, enriched cards)
authority: derived (ADR-081 wins on conflict)
updated_at: 2026-08-24
---

# Tasks Module — History-Shell Parity (F72)

Brings the Tasks Board module (`apps/web/src/modules/task-kanban/`) up to the module-shell
convention established by History (0626) and Observability (J92), with one recorded divergence:
Tasks is the first **full-bleed** module (ADR-081). Decision record and rationale: `docs/00_ADR.md`
ADR-081; mechanism placement: `docs/03_ARCHITECTURE.md` §14.5. Rationale is not restated here —
this file holds the shapes.

---

## 1. Component Architecture

```
apps/web/src/modules/task-kanban/
├── index.tsx            # module registration: route component becomes TasksShell;
│                        #   headerless TaskKanbanView export preserved for Workspace embed
├── tabs.ts              # NEW — append-only tab contract (§5)
├── TasksShell.tsx       # NEW — one-row header + tab switching (§3)
├── KanbanBoard.tsx      # toolbar row REMOVED; renders pure lanes; accepts optional
│                        #   controlled props (§7)
├── TaskFilters.tsx      # DELETED — absorbed into the header (single consumer: KanbanBoard)
├── TaskCard.tsx         # enriched card (§8)
├── TaskDetail.tsx       # UNCHANGED (floating/right-dock panel: --detail-w, Escape,
│                        #   path-WBS auto-popup stay as-is)
├── NewTaskPanel.tsx     # UNCHANGED — now rendered by TasksShell (§3)
├── KanbanColumn.tsx     # UNCHANGED
├── useTaskParams.tsx    # UNCHANGED — filters stay URL-driven
├── useTasks.ts          # UNCHANGED — singleton store (SSE + 5 s poll fallback)
└── types.ts             # UNCHANGED
```

## 2. Module Registration & Entry Points

```ts
// index.tsx
export function TaskKanbanView() { … }   // headerless embed seam — PRESERVED (Workspace tab)

export const module: WebModule = {
    id: 'tasks',
    name: 'Tasks',
    icon: '📋',
    route: 'tasks',
    component: TasksShell,               // ← was TaskKanbanView
};
```

Two entry points, exactly one shell: the `tasks` route renders `TasksShell`; the Workspace
embed (`workspace/tabs.ts`) keeps importing the headerless `TaskKanbanView`.

## 3. Header Anatomy (TasksShell)

One row, `flex flex-wrap items-center justify-between gap-4 border-b border-base-content/10 pb-3`,
full-width with the same horizontal padding as the body (`px-4`) so lanes align under the header.
Left → right:

1. **Identity block** — `📋` + `Tasks` title + live chip (Live/Polling dot from the shared
   `useTasks` store `connected` flag; the store is a ref-counted singleton, so the shell's
   subscription adds no request load).
2. **Inline filters** (in order):
   - **Phase `Select`** — options from `api.task.folders`, value = active folder. Controls the
     board's `folder` (§7).
   - **Status checkboxes** — one per `TASK_STATUSES` entry (`taskStatusIcon` + label); default
     hidden: `blocked`, `cancelled`. Drive **lane visibility** (the existing `hiddenColumns`
     mechanic), not the URL `status` filter.
   - **Combined WBS/feature input** — one text input; parse rule in §4.
3. **`+ New Task` button** — compact `Button size="sm"`; opens `NewTaskPanel` rendered by the
   shell. `folder` comes from shell state; `onCreated` lets the SSE/poll store propagate the new
   card (documented fallback today: "poll will catch up on next interval").
4. **Tab strip** — History styling (`bg-base-300 p-1 rounded-xl`, active tab
   `bg-primary text-primary-content`); one tab: `Kanban`.

No `TaskFilters` bar, no in-board toolbar row: the board's first pixel below the header is lane
content.

## 4. Combined Input Parse Rule

One input replaces the three `TaskFilters` inputs (feature / parent-WBS / assignee). On submit:

| Input shape | Action |
|---|---|
| `/^\d{4}$/` | navigate `/board/tasks/<wbs>` — opens the existing path-WBS detail popup |
| contains `.` (dotted WBS) | `setFilter('parent', value)` |
| anything else | `setFilter('feature', value)` (substring match stays server/client-side as today) |

All filter state remains URL-driven via `useTaskParams` (`?parent=`, `?feature=`, `?status=`) —
shareable URLs unchanged. Clearing the input clears the param it last set. The `assignee` filter
input is dropped (client-side-only field, lowest signal); the URL param remains accepted by
`useTaskParams` for link compatibility.

## 5. Tab Contract (`tabs.ts`)

```ts
/**
 * Tab contract for the Tasks board module (F72).
 *
 * Append-only contract: never reorder or rename an entry — the board's tab
 * strip and any persisted user state (e.g. last-selected tab) key on the id.
 */
export interface TasksTab {
    readonly id: string;
    readonly label: string;
    readonly component: ComponentType;
}

export const TASKS_TABS: readonly TasksTab[] = [
    { id: 'kanban', label: 'Kanban', component: KanbanBoardTab },
];
```

`KanbanBoardTab` is the shell-local adapter that wires shell state (folder, lane visibility,
filters) into `KanbanBoard`. Future tabs (List / Swimlanes / Analytics) are **additive entries
only** — designing them is out of F72's scope.

## 6. Full-Bleed Layout & Tokens

- Header and body are both full-width: **no** `max-w-[1600px] mx-auto` wrapper (the recorded
  ADR-081 divergence from History/Observability). Shared `px-4` on header and body.
- Body: `flex-1 overflow-hidden`; lanes row keeps `flex gap-3 overflow-x-auto h-full p-4`
  (horizontal scroll only when lane count exceeds viewport; vertical scroll stays inside lanes).
- No re-theming: the module keeps resolving the `DESIGN.md` ladder through the `.task-kanban`
  scope in `global.css` (task 0420; architecture §14.4). No hex literals, no Tailwind palette
  classes in module code.

## 7. Shell/Embed Seam — Controlled-Prop Contract

`KanbanBoard` keeps working headerless for the Workspace embed. Header-owned state reaches the
board as **optional controlled props with uncontrolled in-board defaults** (standard React
pattern; the embed behaves exactly as today minus the toolbar):

```ts
interface KanbanBoardProps {
    onSelectTask: (wbs: string) => void;
    filters?: TaskListFilters;
    onFilterChange?: (key: 'status' | 'feature' | 'parent' | 'assignee', value: string | null) => void;
    // NEW — all optional; when omitted the board falls back to its current internal state:
    folder?: string;                                        // controlled phase
    onFolderChange?: (folder: string) => void;
    hiddenColumns?: ReadonlySet<string>;                    // controlled lane visibility
    onToggleColumn?: (status: string) => void;
}
```

Embed behavior change (explicit, operator-visible): the Workspace `Tasks` tab renders **pure
lanes** — no filter inputs, folder switch, lane toggles, or `+ New Task` button (those are
module-route affordances). Card click → detail panel, drag-and-drop transitions, and live
updates are unchanged in the embed.

## 8. Card Enrichment (TaskCard)

All additions derive from fields already on `TaskSummary` — **no contract change**:

| Addition | Derivation |
|---|---|
| Subtask progress `done/total` | group the already-loaded `tasks` array by `parentWbs`; count children of this card's `wbs` and their `status === 'done'` share. Rendered only when `total > 0`. |
| Priority accent | `priority` field → colored left border on the card (`P1` error / `P2` warning / `P3` muted, resolved through `spur-*` semantic tokens). Existing priority badge stays. |
| Staleness tint | age from `updatedAt` (already rendered as relative time): > 7 d → `text-spur-text-muted` tint on the timestamp; threshold constant in `TaskCard.tsx`. |

Feature badge, type badge, WBS, name, relative time: unchanged. **Assignee chip: excluded** —
would require growing the task-list contract (`packages/contracts` + server); not approved.

## 9. Open Design Prototyping Gate

Visual design is prototyped before React implementation:

1. `create_project('tasks-frontend')` → `start_run` with a prompt naming root `DESIGN.md`
   tokens and §3/§8 shapes.
2. Iterate on the artifact until the header row and enriched card read correctly at full bleed.
3. Implement React to match the artifact; the artifact link is cited in the implementing task's
   evidence (T3 surface evidence).

## 10. Non-Goals

- `TaskDetail` floating/right-dock panel: appearance and behavior unchanged (`--detail-w`
  persistence, Escape, path-WBS auto-popup).
- No tabs beyond `Kanban`; no new filter types beyond §3; no `packages/contracts` or server
  changes; no changes to other Board modules; no redesign outside the existing
  `DESIGN.md` / `.task-kanban` token scope.

## 11. Verification

Browser-driven against the dev server: header renders one row at full bleed; phase/status/
combined-input filters move URL params and lane sets; `/board/tasks/0001`-style deep link still
auto-opens the detail panel; drag-and-drop transition persists; Workspace embed renders
headerless lanes with working detail popup. Golden-path evidence goes to the implementing task's
verify step.
