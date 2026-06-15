---
name: "W3: Task Kanban module — board, cards, detail panel, filters, polling, drag-and-drop"
description: "W3: Task Kanban module — board, cards, detail panel, filters, polling, drag-and-drop"
status: Backlog
created_at: 2026-06-15T16:57:15.341Z
updated_at: 2026-06-15T16:57:15.341Z
folder: docs/tasks
type: task
feature-id: W3
priority: P1
estimated_hours: 16
tags: ["server-side-adjustment","wave-W1","group-W"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0084. "W3: Task Kanban module — board, cards, detail panel, filters, polling, drag-and-drop"

### Background

The FIRST module — proves the design end-to-end with a real, useful view. Columns by status, drag-to-transition, task cards, right-panel detail, filters, live polling. The daily-driver replacement for the generated kanban.md artifact — this is what clears the Phase-1.5 Wave-3 board + A17 cutover gate. Read-only detail initially (inline editing deferred); polling now (SSE deferred to W6, shaped as a drop-in swap). Anchors: design §3.5; finalized W3.


### Requirements

R1: TaskKanbanModule (WebModule) registered in the W2 registry. R2: KanbanBoard — columns = the 7 TASK_STATUSES (backlog/todo/wip/testing/blocked/done/cancelled, from spur-domain), tasks grouped into columns. R3: TaskCard — WBS, name, status badge (daisyUI badge colored by status), priority badge (P0-P3), feature link; compact daisyUI card; onClick opens detail. R4: TaskDetail (right panel) — full frontmatter, status transition buttons (daisyUI btn-group), section viewer (markdown render); READ-ONLY initially (inline editing deferred). R5: Drag-and-drop — native HTML5 (onDragStart/onDragOver/onDrop); on drop to a new column call api.transition({ wbs, toStatus }); OPTIMISTIC update + revert on error. Start native; @dnd-kit only if reliability issues surface (risk item #5). R6: TaskFilters — by status/feature/parent-WBS/assignee; filter state in URL query params. R7: useTasks polling hook (POLL_INTERVAL_MS=5000) via { api } from lib/rpc-client; setState contract shaped so usePlanningEvents (W6 SSE) is a drop-in swap. R8: Tests (React Testing Library): board groups by status; card renders WBS+name+badges; drag triggers api.transition + optimistic move + revert on error; filters narrow + reflect in URL; polling refresh. Coverage per project standard. GATED on W2 (layout + module system) + S3 (task API live).


### Q&A



### Design

Authority: design §3.5 (Task Kanban module). finalized W3. Risk item #5 (native DnD first). The board
that clears the Phase-1.5 Wave-3 + A17 cutover gate.

**Component tree (design §3.5):**
```
TaskKanbanModule (WebModule.component)
├── KanbanBoard (columns by status)
│   └── KanbanColumn[] (one per status) -> TaskCard[] (tasks in that status)
├── TaskFilters (left-sidebar / top-bar)
└── (TaskCard click) -> RightPanel TaskDetail
```

**Columns (design §3.5):** the 7 canonical `TASK_STATUSES` from `@gobing-ai/spur-domain`:
`['backlog','todo','wip','testing','blocked','done','cancelled']`. `const KANBAN_COLUMNS = TASK_STATUSES`.

**TaskCard (design §3.5):** props `{ task: TaskSummary (from taskContract.list DTO), onClick(wbs) }`.
Renders WBS, name, status badge (daisyUI `badge` colored by status), priority badge (P0–P3), feature link.
Compact daisyUI `card` variant.

**TaskDetail (right panel, design §3.5):** rendered in `RightPanel` (via the WebModule
`rightPanelComponent` from 0083) when a task is selected. Shows full frontmatter, status transition
buttons (daisyUI `btn-group`), section viewer (markdown render). READ-ONLY initially — inline editing is
deferred.

**Drag-and-drop (design §3.5, risk #5):** native HTML5 (`onDragStart`/`onDragOver`/`onDrop`). On drop to
a new column -> `api.transition({ wbs, toStatus: newStatus })`. OPTIMISTIC update (move the card
immediately) + REVERT on error (restore the card + surface the error, e.g. a 409 guard denial from the
lifecycle). Start native; upgrade to `@dnd-kit` ONLY if real cross-browser reliability issues surface
(additive swap, not a redesign).

**Polling hook (design §3.5, Q3 — no TanStack, no SSE yet):**
```typescript
// apps/web/src/modules/task-kanban/useTasks.ts
const POLL_INTERVAL_MS = 5_000;
export function useTasks(filters?: TaskListFilters) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]); const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error|null>(null);
  const refresh = useCallback(async () => { try { const r = await api.list({ query: filters }); setTasks(r.data); setError(null); } catch(e){ setError(e as Error); } finally { setLoading(false); } }, [filters]);
  useEffect(() => { void refresh(); const i = setInterval(refresh, POLL_INTERVAL_MS); return () => clearInterval(i); }, [refresh]);
  return { tasks, loading, error, refresh };
}
```
**Shape the setState contract so the SSE swap (W6 `usePlanningEvents`) is a DROP-IN** — `usePlanningEvents`
will feed the same `setTasks` reducer (design §2.9.4). Do NOT shape it the other way around (invariant #10).

**Filters (design §3.5):** `TaskFilters` — by status / feature / parent-WBS / assignee; filter state in URL
query params (shareable). Maps to the contract `list` query -> server-side `TaskListFilters`.

**Registration:** `TaskKanbanModule` registers in the W2 registry (0083 `builtins`) with its
`component` + `rightPanelComponent` (TaskDetail) + `route:'tasks'` + icon.

**API ground-truth:** uses `{ api }` from `lib/rpc-client` (0082); `api.list({query})`,
`api.transition({wbs,toStatus})` map to the taskContract routes (0077). `TaskSummary` type from
`@gobing-ai/spur-contracts`.

**GATED on W2 (0082 layout + 0083 module system) and S3 (0078 — task API live).**

**Out of scope:** inline editing (read-only first), SSE live updates (W6 — polling now), Feature tree
module (follows incrementally), the priority/feature badge THEMING polish (W4).


### Solution



### Plan

- [ ] `apps/web/src/modules/task-kanban/index.tsx`: `TaskKanbanModule` (WebModule) — id 'tasks', route 'tasks', icon, component=KanbanBoard, rightPanelComponent=TaskDetail; register in the W2 registry builtins.
- [ ] `KanbanBoard.tsx` + `KanbanColumn`: columns = `TASK_STATUSES`; group tasks into columns.
- [ ] `TaskCard.tsx`: WBS, name, status badge (daisyUI badge by status), priority badge (P0–P3), feature link; compact daisyUI card; `onClick(wbs)`.
- [ ] `TaskDetail.tsx` (right panel): full frontmatter, status transition buttons (daisyUI btn-group), markdown section viewer; READ-ONLY.
- [ ] Native HTML5 DnD (`onDragStart/onDragOver/onDrop`): drop -> `api.transition({wbs,toStatus})`; optimistic move + revert on error (incl. 409 guard denial).
- [ ] `useTasks.ts` polling hook (5s) via `{ api }`; setState contract shaped for the W6 `usePlanningEvents` drop-in swap.
- [ ] `TaskFilters.tsx`: status/feature/parent-WBS/assignee; filter state in URL query params; map to contract `list` query.
- [ ] Tests (React Testing Library): board groups by status; card renders WBS+name+badges; drag triggers `api.transition` + optimistic move + revert on error; filters narrow + reflect in URL; polling refresh updates the board.
- [ ] Gate: `bun run lint` + `test` + `build`; coverage per project standard.
- [ ] GATE CHECK: W2 (0082+0083) + S3 (0078 task API) landed. This clears the Phase-1.5 Wave-3 board + A17 cutover gate.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


