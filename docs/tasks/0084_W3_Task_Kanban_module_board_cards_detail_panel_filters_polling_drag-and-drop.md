---
name: "W3: Task Kanban module — board, cards, detail panel, filters, polling, drag-and-drop"
description: "W3: Task Kanban module — board, cards, detail panel, filters, polling, drag-and-drop"
status: done
created_at: 2026-06-15T16:57:15.341Z
updated_at: 2026-06-17T16:35:07.708Z
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

## Requirements

Post-fix verdict (2026-06-17) — verify mode Phase 8 traceability.

- [x] **R1** — Module registered in W2 registry → **MET** | Evidence: `registry.ts:8` builtins includes `TaskKanbanModule`; `index.tsx:41`
- [x] **R2** — Board columns = 7 `TASK_STATUSES`, tasks grouped → **MET** | Evidence: `KanbanBoard.tsx:7` `KANBAN_COLUMNS=TASK_STATUSES`, `:23-24` grouping; test `board.test.tsx` "groups tasks into their status columns"
- [x] **R3** — TaskCard WBS/name/status+priority badges/feature link/onClick → **MET** | Evidence: `TaskCard.tsx`; test `components.test.tsx` "renders WBS, name, status badge…"
- [x] **R4** — TaskDetail right panel, status buttons, read-only, wired to selection → **MET** | Evidence: `TaskDetail.tsx` (props-driven) + `index.tsx:34-39` `TaskKanbanDetail` resolves `?selected`; tests in `components.test.tsx`
- [x] **R5** — Native HTML5 DnD → `api.transition`, optimistic + revert on error → **MET** | Evidence: `KanbanColumn.tsx:17-25` (dragOver/drop), `TaskCard.tsx:27-30` (dragStart), `KanbanBoard.tsx:39-55` (optimistic + revert); tests `board.test.tsx` "optimistically moves" + "rejected transition reverts"
- [x] **R6** — TaskFilters by status/feature/parent/assignee, URL query params → **MET (client-side)** | Evidence: `TaskFilters.tsx` + `useTaskParams.ts`; tests `useTaskParams.test.tsx` (URL round-trip) + `board.test.tsx` "filters narrow". **Note:** filtering is client-side — `taskContract.list` has no query input (carry-forward gap).
- [x] **R7** — `useTasks` polling (5s), SSE-swap-shaped `setTasks` contract → **MET** | Evidence: `useTasks.ts:5,42-47` poll + `setTasks` reducer exposed for W6 `usePlanningEvents` drop-in; tests `useTasks.test.ts`
- [x] **R8** — RTL tests: board groups / card render / drag+optimistic+revert / filters+URL / polling → **MET** | Evidence: `components.test.tsx`, `board.test.tsx`, `useTaskParams.test.tsx`, `useTasks.test.ts` — 23 kanban tests, all pass

**Scope drift:** none — all code maps to R1–R8. `assignee` filter is in-scope (R6) but inert pending a contract/DTO field (documented).


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

## Solution

W3 Task Kanban module — implemented + verified (dev-verify, 2026-06-17). All 8 requirements MET; gates green.

**Component tree (per design §3.5):**
- `index.tsx` — `TaskKanbanModule` (id `tasks`, route `tasks`, 📋). Two containers: `TaskKanbanView` (board) and `TaskKanbanDetail` (right panel). Registered in the W2 registry (`registry.ts`).
- `KanbanBoard.tsx` / `KanbanColumn.tsx` — columns = `TASK_STATUSES`; tasks grouped by status; native HTML5 DnD.
- `TaskCard.tsx` — WBS, name, status badge (daisyUI, status-colored), priority + feature badges, draggable, `onClick`.
- `TaskDetail.tsx` — presentational, prop-driven; status transition buttons (read-only otherwise).
- `TaskFilters.tsx` — status/feature/parent/assignee controls.

**Selection + filter seam — URL query params (`useTaskParams.ts`):** board and right panel are siblings under `BoardLayout` with no shared React state, so `?selected=<wbs>` links a card click to the detail panel, and `?status/feature/parent/assignee` hold shareable filter state. This is the seam that wires R4 (detail) and R6 (filters).

**Polling (`useTasks.ts`):** 5s `setInterval`; exposes the `setTasks` reducer so the W6 SSE `usePlanningEvents` is a drop-in swap (invariant #10). `listFn` is injectable for tests.

**DnD (R5):** drop → optimistic move → `api.task.transition({wbs,toStatus})` → revert + `api-error` event on rejection (e.g. 409 lifecycle-guard denial).

**Key decisions / deviations:**
1. **Filtering is client-side.** `taskContract.list` declares no `.input()` (no query params), so R6 filtering runs against the polled rows. Server-side filtering + an `assignee` DTO field are deferred to S3/0077-0078 (carry-forward, documented in Review).
2. **Browser-safe domain import.** Constants come from `@gobing-ai/spur-domain/schema` (not the package barrel) to keep the Node `ts-runtime`/`ts-db` stack out of the SSR/Cloudflare bundle — without this the web build fails.

**Tests (R8):** `components.test.tsx`, `board.test.tsx`, `useTaskParams.test.tsx`, `useTasks.test.ts` — 23 kanban tests (board grouping, card render, drag→optimistic→revert, filter→URL round-trip, polling). All pass.

**Gates:** `lint` ✓ · `test` ✓ (1638) · `test-cf` ✓ · `build` ✓.


### Plan

## Plan

All items complete (2026-06-17).

- [x] `apps/web/src/modules/task-kanban/index.tsx`: `TaskKanbanModule` (WebModule) — id 'tasks', route 'tasks', icon, component + rightPanelComponent (TaskDetail via `TaskKanbanDetail`); registered in the W2 registry builtins.
- [x] `KanbanBoard.tsx` + `KanbanColumn`: columns = `TASK_STATUSES`; group tasks into columns.
- [x] `TaskCard.tsx`: WBS, name, status badge (daisyUI badge by status), priority badge (P0–P3), feature link; compact daisyUI card; `onClick(wbs)`.
- [x] `TaskDetail.tsx` (right panel): frontmatter (WBS/name/priority/feature/file), status transition buttons (daisyUI btn), READ-ONLY.
- [x] Native HTML5 DnD (`onDragStart/onDragOver/onDrop`): drop -> `api.task.transition({wbs,toStatus})`; optimistic move + revert on error (incl. 409 guard denial).
- [x] `useTasks.ts` polling hook (5s) via `{ api }`; `setTasks` reducer shaped for the W6 `usePlanningEvents` drop-in swap.
- [x] `TaskFilters.tsx`: status/feature/parent-WBS/assignee; filter state in URL query params (`useTaskParams`). NOTE: filtering is client-side — `taskContract.list` has no query input (carry-forward to S3/0077-0078).
- [x] Tests (React Testing Library): board groups by status; card renders WBS+name+badges; drag triggers `api.transition` + optimistic move + revert on error; filters narrow + reflect in URL; polling refresh. — 23 tests, all pass.
- [x] Gate: `bun run lint` + `test` + `test-cf` + `build`; coverage per project standard.
- [x] GATE CHECK: W2 (0082+0083) + S3 (0078 task API) landed. This clears the Phase-1.5 Wave-3 board + A17 cutover gate.


### Review

## Review — 2026-06-17

**Status:** 6 findings (all fixed)
**Scope:** `apps/web/src/modules/task-kanban/**` + tests
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline (current)
**Gate:** `bun run lint` + `test` + `test-cf` + `build` → all pass (1638 tests, 0 fail)

### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Detail-panel selection never wired (card click swallowed, `wbs` hardcoded `null`) | Correctness | `index.tsx` (pre-fix L8,L20) | Lift selection to URL `?selected=<wbs>`; container resolves task from polled list. **FIXED** via `useTaskParams` + `TaskKanbanDetail`. |
| 2 | `TaskDetail` read state from a `[data-wbs]` DOM node nothing renders (dead path) | Correctness | `TaskDetail.tsx` (pre-fix L18-22) | Drop the DOM hack; take `task` by prop. **FIXED** — `TaskDetail` is now presentational. |
| 3 | `TaskFilters` (R6) entirely missing — no component, no URL params | Correctness | — | Add `TaskFilters.tsx` + URL-param state. **FIXED** — new component + `useTaskParams`. |
| 4 | Component tests (R8) missing — only `useTasks` covered; 0% on board/card/detail | Correctness | `tests/` | Add RTL suites. **FIXED** — `components.test.tsx`, `board.test.tsx`, `useTaskParams.test.tsx` (+18 tests). |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 5 | `useCallback` empty-deps lie — captured `listFn`/`filtersRef` never re-bound on filter change | Correctness | `useTasks.ts` (pre-fix L44-48) | Remove the stale-closure hook; move filtering client-side, key effect on `listFn`. **FIXED**. |
| 6 | Barrel import `@gobing-ai/spur-domain` drags the Node `ts-runtime`/`ts-db` stack into the SSR/CF bundle → `bun run build` fails | Efficiency | `KanbanBoard/TaskDetail/TaskFilters` | Import `TASK_STATUSES` from the browser-safe `@gobing-ai/spur-domain/schema` subpath (same seam the contract uses). **FIXED**. |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 7 | DnD/transition state previously read via DOM JSON (anti-React) | Usability | `TaskDetail.tsx` | Resolved by P1-2 fix (props-driven). **FIXED**. |

### Contract gap (carry-forward, not a 0084 blocker)
`taskContract.list` declares **no `.input()`** — it accepts no query params, so R6 server-side filtering is impossible today. Filtering is implemented **client-side** against the polled rows; `assignee` is parsed into the URL but inert until `TaskSummary` carries an assignee field. Growing the `list` contract + server filter is S3/0077-0078 surface, tracked separately.

**Fix-pass 2026-06-17:** 7 fixed, 0 failed, 0 skipped.


### Testing

## Testing

Verified 2026-06-17 (dev-verify). RTL + `bun:test` under happy-dom; full repo gate green.

**Kanban suite — 23 tests, 0 fail** (`apps/web/tests/modules/task-kanban/`):

| File | Covers | Requirement |
|------|--------|-------------|
| `useTasks.test.ts` | poll load / mount / error / `setTasks` optimistic | R7 |
| `useTaskParams.test.ts` | `?selected` + filter parse, write, clear (URL round-trip) | R4, R6 |
| `components.test.tsx` | TaskCard render+click+dragStart; KanbanColumn count/empty/drop; TaskDetail empty+transition | R3, R4, R5 |
| `board.test.tsx` | board grouping by status; drag → `api.transition` + optimistic move; **rejected transition reverts**; filters narrow; TaskFilters controls | R2, R5, R6 |

**Coverage** (per-file, project standard ≥90% line/func): `useTasks.ts` 100/100, `useTaskParams.ts` 100/100, `registry.ts` 100/100. `.tsx` components are excluded from the coverage threshold by `bunfig.toml` (`coveragePathIgnorePatterns: ["**/*.tsx"]`) but are behaviorally tested via the RTL suites above.

**Full repo gate:**
- `bun run lint` — Biome + per-workspace `tsc --noEmit` clean.
- `bun run test` — 1480 + 158 = 1638 tests pass, 0 fail.
- `bun run test-cf` — server Workers runtime pass.
- `bun run build` — cli + server + web all succeed (web SSR/CF bundle builds after the `/schema` subpath fix).

**Environment note (carry-forward for future web tests):** happy-dom + React 19 does not fire `onChange` for controlled `<input type=text>` via `fireEvent` — text-filter behavior is asserted through `useTaskParams` (URL state) and by reading rendered `value`. `@testing-library/user-event` is not installed.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


