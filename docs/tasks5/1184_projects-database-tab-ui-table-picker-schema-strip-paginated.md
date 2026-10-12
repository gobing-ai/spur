---
schema_version: 1
name: Projects Database tab UI (table picker, schema strip, paginated grid, row detail)
status: todo
template: feature-impl
created_at: 2026-10-12T05:49:58.435Z
updated_at: "2026-10-12T06:05:36.330Z"
feature_id: G631
priority: P2
tags:
  - board
  - projects
  - database
  - web
estimate_hours: 4

dependencies: ["1183"]
---

## 1184. Projects Database tab UI (table picker, schema strip, paginated grid, row detail)

### Background

Feature G631 adds a Database tab to the Projects module. This task delivers the web half over the browse API from the server task. Design: docs/design/projects-database-tab.md §3.4 and DESIGN.md's dense diagnostic table idiom (System Events / Decisions). Covers scenarios R1–R6, R8 and R9 on the client side.

Premises (verified against the tree):

- Tabs are registered in `PROJECT_TABS` — apps/web/src/modules/projects/tabs.tsx:17.
- `useProjectTab` maps the path segment to a tab and preserves the query string on select — apps/web/src/modules/projects/useProjectTab.ts:13.
- Web reads of raw Hono routes use `resolveApiUrl` and `fetchWithTimeout(request)` — apps/web/src/lib/rpc-client.ts:32 and apps/web/src/lib/rpc-client.ts:47.

**Refine corrections (2026-10-12)**

- "`@/ui` primitives" was unanchored → `@/ui` is the barrel apps/web/src/ui.ts (Badge :8, Input :12, Loading :14, Modal :15, Select :16, Tooltip :19) → Design names the barrel as the only UI import.
- Adding a tab was unscoped for existing tests → apps/web/tests/modules/projects/tabs.test.ts:6 freezes the tab list as ['fleet', 'inbox'] → Plan updates that expectation to ['fleet', 'inbox', 'database'].
- "Stubbed fetch" named no seam → the sanctioned seam is `setFetchForTesting` / `resetFetchForTesting` (apps/web/src/lib/rpc-client.ts:15 and :20); mutating globalThis.fetch is forbidden by the http-boundaries rule → Plan re-pointed.
- Keyboard cycling claim verified: ProjectsShell iterates PROJECT_TABS for ArrowLeft/ArrowRight (apps/web/src/modules/projects/ProjectsShell.tsx:55–61), so no shell change is needed.
- Feature id Q → G631 (moved under G63) → Background updated; no scenario titles changed.

### Requirements

- [ ] R1. `PROJECT_TABS` gains a Database tab (`ProjectTabId` 'database') rendering `DatabaseView`; /board/projects/database deep-links to it; arrow-key cycling covers Fleet, Inbox and Database; Fleet/Inbox and their processes/conversation aliases are unchanged.
- [ ] R2. A left rail lists every table from GET /api/project/database/tables with a filter-as-you-type box; the selected table, page, sort, dir, filter column and filter value live in the URL query so reload and deep links restore the view.
- [ ] R3. A collapsible schema strip shows each column's name, declared type, nullability and primary-key flag plus the exact row count.
- [ ] R4. The row grid shows the server page (default 50), a range label such as 1–50 of N, and previous/next/go-to-page controls; changing sort or filter resets to page 1.
- [ ] R5. Column headers toggle ascending/descending sort; a column select plus text input apply a contains filter.
- [ ] R6. Cells truncate to one line with a tooltip; NULL and BLOB (with byte length) render as distinct muted badges; clicking a row opens a modal with every column's full value and pretty-printed JSON when the text parses as JSON.
- [ ] R7. Loading, empty table, unknown table (picker still usable), database unavailable and request failed are named visible states, never a blank panel.
- [ ] R8. The view uses only existing `@/ui` primitives and Tailwind/daisyUI tokens; apps/web/package.json gains no dependency.

### Acceptance Criteria

- [ ] AC1 — The Projects module shows a Database tab with a deep link
- [ ] AC2 — The user picks any table of the project database and the choice survives reload
- [ ] AC3 — The selected table shows its schema and exact row count
- [ ] AC4 — Rows are paginated on the server with a bounded page size
- [ ] AC5 — The user sorts by one column and filters one column by a contains match
- [ ] AC6 — Long, null and binary cell values stay readable
- [ ] AC7 — The tab reuses the board table idiom without a new grid dependency
- [ ] AC8 — Empty, unknown and unavailable states are named, never blank

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T05:50:40.859Z

- **Grid component:** existing dense-table markup and `@/ui` primitives; no TanStack/AG Grid (Scope § Out of scope).
- **URL state:** query params on the existing `/board/projects/database` route; no router change.
- **Dependency:** starts after 1183 lands (consumes its routes).
- **open-design pass:** deferred — MCP server unavailable during planning; layout follows DESIGN.md and can be refined later without contract change.

#### Q&A entry — 2026-10-12T06:05:36.329Z

- **Feature id:** Q renamed to G631 under G63 on 2026-10-12; scope unchanged.
- **Fetch test seam:** setFetchForTesting from lib/rpc-client, not globalThis.fetch; closed.

### Design

Chosen: one `DatabaseView.tsx` in apps/web/src/modules/projects plus a small fetch helper using the existing `fetchWithTimeout`/`resolveApiUrl` from lib/rpc-client, URL state via react-router `useSearchParams`, and the dense-table markup already used by Observability tabs. Reason: the Projects tab registry and `selectTab` already preserve the query string, so URL state needs no router change, and DESIGN.md already specifies the table idiom. Rejected: TanStack Table / AG Grid / Glide (new dependency for paging + one sort column the server already does); client-side sort or filter (tables reach ~4M rows); a separate Board module (the ask is a Projects tab). Invariants: the client never requests more than one page; every failure maps to a named state; keyboard reachability for rail, headers, pager and modal. Key signatures: `export default function DatabaseView(): JSX.Element`; `useDatabaseTables()`, `useTableSchema(name)`, `useTableRows(name, query)` returning `{ state: 'loading' | 'ready' | 'empty' | 'unknown-table' | 'unavailable' | 'failed', data? }`.

Frozen imports: UI comes only from the `@/ui` barrel (apps/web/src/ui.ts); fetches go through `resolveApiUrl()` + `fetchWithTimeout(new Request(...))` from `@/lib/rpc-client`. URL keys are exactly `table`, `page`, `sort`, `dir`, `fcol`, `f`; malformed values fall back to defaults (page 1, no sort, no filter) without throwing. Anti-patterns: no client-side sorting/filtering of fetched rows; no edits to useProjectTab.ts or ProjectsShell.tsx (both already iterate PROJECT_TABS); no direct globalThis.fetch. Assumes from 1183: the four routes and DTOs in packages/contracts/src/database.ts exactly as docs/design/projects-database-tab.md §3.3 specifies; the web task re-owns none of them.

### Plan

- [ ] Write the failure list first: API 404/400/503, network failure, zero rows, table removed between reloads, malformed URL params, very wide tables, huge text cells. (R2–R7)
- [ ] Extend tabs.tsx with the 'database' tab and update apps/web/tests/modules/projects/tabs.test.ts:6 to ['fleet', 'inbox', 'database']. (R1)
- [ ] Build DatabaseView with rail, schema strip, grid, pager and row-detail modal from `@/ui`. (R2–R6, R8)
- [ ] Wire URL query state and named states. (R2, R7)
- [ ] Add apps/web/tests/modules/projects/DatabaseView.test.tsx using setFetchForTesting for each named state, the sort/filter URL round-trip and the deep link; extend keyboard.test.tsx for Database in the arrow-key cycle. (AC1–AC8)
- [ ] Browser-check /board/projects/database against the live dev server on history_message (≈3.2M rows); run bun run spur-check. (AC4, AC6)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T05:59:48.111Z feature_id Q → G631 (system)

