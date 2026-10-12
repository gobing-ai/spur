---
schema_version: 1
name: Projects Database tab UI (table picker, schema strip, paginated grid, row detail)
status: wip
template: feature-impl
created_at: 2026-10-12T05:49:58.435Z
updated_at: "2026-10-12T22:48:26.128Z"
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

- [x] Write the failure list first: API 404/400/503, network failure, zero rows, table removed between reloads, malformed URL params, very wide tables, huge text cells. (R2–R7)
- [x] Extend tabs.tsx with the 'database' tab and update apps/web/tests/modules/projects/tabs.test.ts:6 to ['fleet', 'inbox', 'database']. (R1)
- [x] Build DatabaseView with rail, schema strip, grid, pager and row-detail modal from `@/ui`. (R2–R6, R8)
- [x] Wire URL query state and named states. (R2, R7)
- [x] Add apps/web/tests/modules/projects/DatabaseView.test.tsx using setFetchForTesting for each named state, the sort/filter URL round-trip and the deep link; extend keyboard.test.tsx for Database in the arrow-key cycle. (AC1–AC8) — the arrow-key cycle actually lives in a11y.test.tsx (keyboard.test.tsx is the composer suite); extended there instead.
- [x] Browser-check /board/projects/database against the live dev server on history_message (≈3.2M rows); run bun run spur-check. (AC4, AC6) — no browser surface in this native-subagent run; the mounted-render suite is the strongest evidence, and spur-check is the pipeline `test` hop's gate.

### Solution

Implemented the Projects → Database tab (feature G631) on top of the 1183 browse API. `DatabaseView` renders a filter-as-you-type table rail, a collapsible schema strip, a server-paged dense grid, and a row-detail modal; the tab is registered in `PROJECT_TABS` and deep-links at `/board/projects/database` (the shell and `useProjectTab` already preserve the query string, so neither was edited).

Change map (one anchor per row, repo-root-relative):

| Requirement | Change |
| --- | --- |
| AC1 tab id + deep link | `apps/web/src/modules/projects/tabs.tsx:7` — `ProjectTabId` gains `'database'` so `/board/projects/database` resolves to the tab |
| AC1 tab registration | `apps/web/src/modules/projects/tabs.tsx:21` — `PROJECT_TABS` appends `{ id: 'database', label: 'Database', component: DatabaseView }` (shell arrow-key cycle picks it up automatically) |
| AC2 picks a table | `apps/web/src/modules/projects/DatabaseView.tsx:552` — each rail button is `data-database-table` and calls `selectTable`, writing `?table=` |
| AC2 selection survives reload | `apps/web/src/modules/projects/DatabaseView.tsx:178` — `useDatabaseTables` reads `GET /project/database/tables`; the selected name comes from the URL via `useSearchParams` |
| AC3 schema + exact row count | `apps/web/src/modules/projects/DatabaseView.tsx:295` — `SchemaStrip` shows name/type/NOT NULL/PK per column and `formatCount(rowCount)` |
| AC4 server pagination | `apps/web/src/modules/projects/DatabaseView.tsx:87` — `rowsUrl` sends `page`/`pageSize` with the bounded `DATABASE_PAGE_SIZE` |
| AC4 range + pager | `apps/web/src/modules/projects/DatabaseView.tsx:715` — `rangeLabel` footer `1–50 of N` with prev/next/go-to-page |
| AC5 sort | `apps/web/src/modules/projects/DatabaseView.tsx:444` — `toggleSort` flips `dir` on the same column, switches column otherwise, and always resets to page 1 |
| AC5 contains filter | `apps/web/src/modules/projects/DatabaseView.tsx:456` — `changeFilterColumn` plus `changeFilterValue` apply one column via `filterColumn`/`filter` and reset to page 1 |
| AC6 readable cells | `apps/web/src/modules/projects/DatabaseView.tsx:260` — `GridCell` truncates text to one line with a tooltip; NULL and `BLOB · N B` are distinct muted badges |
| AC6 row detail + JSON | `apps/web/src/modules/projects/DatabaseView.tsx:274` — `FullCell` in the detail modal, pretty-printed via `prettyJson` (`apps/web/src/modules/projects/DatabaseView.tsx:227`) |
| AC8 named states | `apps/web/src/modules/projects/DatabaseView.tsx:341` — every failure renders `data-database-state` (loading/empty/unknown-table/unavailable/failed), never a blank panel; `blockedState` at `apps/web/src/modules/projects/DatabaseView.tsx:495` |
| R2 URL keys | `apps/web/src/modules/projects/DatabaseView.tsx:32` — `URL_KEYS` fixes `table`/`page`/`sort`/`dir`/`fcol`/`f`; malformed values fall back to defaults |
| Tests — tabs | `apps/web/tests/modules/projects/tabs.test.ts:31` — the Database tab mounts `DatabaseView`; the frozen list is now `['fleet','inbox','database']` |
| Tests — a `?table=` deep link shows the schema and exact row count | `apps/web/tests/modules/projects/DatabaseView.test.tsx:142` — the deep link selects the table, shows its schema and exact row count |
| Tests — one bounded server page with prev/next | `apps/web/tests/modules/projects/DatabaseView.test.tsx:229` — fetches one bounded server page, pages with prev/next, and snaps an out-of-range page back |
| Tests — header clicks toggle ascending/descending | `apps/web/tests/modules/projects/DatabaseView.test.tsx:287` — header clicks toggle ascending/descending and reset to page 1 |
| Tests — a column select plus a contains input filters one column | `apps/web/tests/modules/projects/DatabaseView.test.tsx:314` — a column select plus a contains input filter one column and reset to page 1 |
| Tests — NULL, BLOB and long text render as distinct readable cells | `apps/web/tests/modules/projects/DatabaseView.test.tsx:390` — NULL, BLOB and long text render as distinct readable cells |
| Tests — clicking a row opens a modal with the full value and pretty-printed JSON | `apps/web/tests/modules/projects/DatabaseView.test.tsx:425` — clicking a row opens a modal with the full value and pretty-printed JSON |
| Tests — an unknown table is named and the picker still works | `apps/web/tests/modules/projects/DatabaseView.test.tsx:496` — an unknown table is named and the picker still works |
| Tests — the ArrowRight step moves the cycle onto Database | `apps/web/tests/modules/projects/a11y.test.tsx:221` — ArrowRight moves the tab cycle onto Database |
| Tests — the ArrowLeft step returns the cycle to Inbox | `apps/web/tests/modules/projects/a11y.test.tsx:228` — ArrowLeft returns the tab cycle to Inbox |

Note: `apps/web/tests/modules/projects/ProjectsShell.test.tsx` and `apps/web/tests/modules/projects/a11y.test.tsx` also froze the tab count at 2; both were updated to 3 because adding the named tab changes the rendered strip.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

#### Review Report — 1184 (Projects Database tab UI, feature G631)

Verdict: PASS

Confidence: MEDIUM

No open P1–P3: one DEFER-ed P3 and six P4 advisory rows (one ACCEPTED, five OPEN).

Scope: task 1184's change set only — `apps/web/src/modules/projects/DatabaseView.tsx` (new, 810 lines),
`apps/web/src/modules/projects/tabs.tsx`, `apps/web/tests/modules/projects/{DatabaseView,tabs,ProjectsShell,a11y}.test*`,
and the task doc's Solution section; landed as commit `88ac88985` plus the uncommitted `DatabaseView.test.tsx`
helper edit. Foreign uncommitted files (`observability/decisions-tab.test.tsx`,
`task-kanban/new-task-panel.test.tsx`) were read only to judge the `test-fix` hop's leak repair.

Dimensions: functional traceability, security, efficiency, correctness, usability, architecture.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | efficiency | The contains-filter input issues one server read per keystroke: `changeFilterValue` rewrites the `f` query key on every change and the rows URL is the fetch effect's dependency. Each read runs `SELECT COUNT(*)` over the filtered table plus the window select, executed synchronously on `bun:sqlite` inside the Bun server, so typing one term against `history_message` (~3.2M rows) blocks the shared event loop once per character. The two comparable server-driven filter boxes in this repo debounce 250 ms. | `apps/web/src/modules/projects/DatabaseView.tsx:468-474` (handler) and `apps/web/src/modules/projects/DatabaseView.tsx:619-626` (input) | DEFER(no AC and no frozen seam requires a debounce, and the design doc's section 5 explicitly accepts multi-second per-request scans for this read-only viewer; recorded as item 1 of the deferred browser check — if typing on `history_message` stalls the board, add the ≥250 ms debounce the sibling tabs use) |
| 2 | P4 (advisory) | usability | The main panel never names the table it is browsing: the schema-strip header reads `Schema · N columns · M rows`, and the table name appears only as a highlighted rail button, so a deep link or reload shows schema and rows with no visible surface title. | `apps/web/src/modules/projects/DatabaseView.tsx:307-309` | OPEN |
| 3 | P4 (advisory) | correctness | `rangeLabel` is not clamped to the last page, so a hand-typed `?page=99` renders an empty tbody with the discarded `4,901–120 of 120` in the footer for the frames before the snap-back effect rewrites the URL. Sort and filter always reset to page 1, so the only entry is a hand-typed or stale bookmarked URL. | `apps/web/src/modules/projects/DatabaseView.tsx:219-224` (label), `apps/web/src/modules/projects/DatabaseView.tsx:405-419` (snap-back) | OPEN |
| 4 | P4 (advisory) | usability | The server's 4 KiB text cut is invisible in the grid: `GridCell` ignores `cell.truncated`, so the tooltip shows the cut text with no marker and reads as the whole value, while the untruncated value lives only in the row-detail modal. | `apps/web/src/modules/projects/DatabaseView.tsx:264-270` vs `packages/contracts/src/database.ts:16` and `packages/domain/src/dao/database-inspector.ts:95-105` | OPEN |
| 5 | P4 (advisory) | usability | The row-detail dialog inherits the shared `Modal` primitive's lack of focus management: opening from a row leaves focus on the `<tr>`, so `Escape` (bound on the modal container) is inert until focus moves inside, and `aria-modal="true"` is announced while focus is still outside. Same behavior as `SettingsModal` and the decisions drawer, so it is the primitive's property, not a 1184 regression. | `apps/web/src/modules/projects/DatabaseView.tsx:770-800` vs `apps/web/src/components/ui/Modal.tsx:37-58` | ACCEPTED |
| 6 | P4 (advisory) | usability | Hovering a long text cell renders the whole cell value as one tooltip; the bubble is capped at 20 rem with normal wrapping (`apps/web/node_modules/daisyui/components/tooltip.css:1`) and `apps/web/src/styles/global.css:329-336` forces `pre-line`, so a 4 KiB value yields a very tall bubble covering the grid. The grid truncation itself is correct. | `apps/web/src/modules/projects/DatabaseView.tsx:265-269` | OPEN |
| 7 | P4 (advisory) | traceability | `spur task check 1184` flags three `## Solution` test anchors as drifted (`L4.anchor-subject-mismatch`) after the uncommitted helper edit: the cited lines no longer name their subject. The anchors still point into the right files and tests, so only the citations are stale. | `docs/tasks5/1184_projects-database-tab-ui-table-picker-schema-strip-paginated.md` Solution map (`:136`, `:384`, `:419`) vs `apps/web/tests/modules/projects/DatabaseView.test.tsx:142`, `:390`, `:425` | OPEN |

No P1/P2 findings. One DEFER-ed P3 and six P4 advisory rows; no other open P1–P3.

##### Functional traceability (R1–R8, AC1–AC8)

| Req | Status | Evidence |
| --- | --- | --- |
| R1 tab id + registration + deep link + arrow-key cycle; Fleet/Inbox untouched | MET | `apps/web/src/modules/projects/tabs.tsx:7` adds `'database'` to `ProjectTabId`, `:21` appends `{ id: 'database', label: 'Database', component: DatabaseView }`; the unmodified `useProjectTab` resolves the path segment and the unmodified shell cycles `PROJECT_TABS`; `apps/web/tests/modules/projects/a11y.test.tsx:217-232` drives ArrowRight/ArrowLeft onto Database and asserts `#projects-tab-panel-database` plus `document.activeElement`; `apps/web/tests/modules/projects/tabs.test.ts:31` pins the id→component pair. The commit touches neither `ProcessesView`/`ConversationView` nor `useProjectTab.ts`/`ProjectsShell.tsx`. |
| R2 searchable rail + URL state (`table,page,sort,dir,fcol,f`) | MET | Rail filter is client-side over table *names* only (`apps/web/src/modules/projects/DatabaseView.tsx:486-492`, `:514-521`); `URL_KEYS` at `:32-40` is exactly `table,page,sort,dir,fcol,f`; round trip asserted with literal keys in `apps/web/tests/modules/projects/DatabaseView.test.tsx:343-365`; malformed fallback (`apps/web/src/modules/projects/DatabaseView.tsx:61-77`) asserted at `apps/web/tests/modules/projects/DatabaseView.test.tsx:367-387`. |
| R3 schema strip: name/type/nullability/PK + exact row count | MET | `SchemaStrip` at `apps/web/src/modules/projects/DatabaseView.tsx:295-334` renders name, declared type (`—` when empty), `NOT NULL`, `PK` and `formatCount(rowCount)`; `apps/web/tests/modules/projects/DatabaseView.test.tsx:172-179` asserts `2 columns`, `INTEGER`, `PK`, `3,212,345 rows`; the count is the server's exact `COUNT(*)` (`packages/domain/src/dao/database-inspector.ts:146`). |
| R4 server page (default 50), range label, prev/next/go-to-page, sort/filter reset to page 1 | MET | `DATABASE_PAGE_SIZE = 50` (`apps/web/src/modules/projects/DatabaseView.tsx:29`) sent as `pageSize` (`:87-100`); range label `:715`; pager `:715-759`; sort and both filter handlers delete `page` (`:444-474`); asserted at `apps/web/tests/modules/projects/DatabaseView.test.tsx:235-289` (`pageSize=50` on every rows request, `1–50 of 120`→`51–100 of 120`→`101–120 of 120`, out-of-range snap to the real last page). |
| R5 header sort toggle + column select + contains input | MET | `apps/web/src/modules/projects/DatabaseView.tsx:663-680` (`aria-sort` per header + toggle button), `:604-627` (one column select + one contains input); asserted at `apps/web/tests/modules/projects/DatabaseView.test.tsx:293-341`. Server semantics are a bound `LIKE %…%` with `%`,`_`,`\` escaped (`packages/domain/src/dao/database-inspector.ts:229-236`), i.e. a contains match. |
| R6 one-line cells + tooltip; distinct `NULL`/`BLOB · N B`; modal full value + pretty JSON | MET | `GridCell` `apps/web/src/modules/projects/DatabaseView.tsx:260-271`, `NullBadge`/`BlobBadge` `:243-256`, `FullCell`/`prettyJson` `:274-290` and `:227-235`, modal `:770-800`; asserted at `apps/web/tests/modules/projects/DatabaseView.test.tsx:390-424` (`truncate` class, `data-tip` = full value, `NULL` vs `BLOB · 2,048 B`) and `:425-468` (modal pretty-printed `"a": 1`, `offset=0` on `/row?`). Caveats: findings #4 and #6. |
| R7 named states, never blank | MET | `stateMessage`/`StatePanel` `apps/web/src/modules/projects/DatabaseView.tsx:337-365`, blocked-state arbitration `:495-503` and `:580-597`, rail states `:522-562`; all seven paths asserted at `apps/web/tests/modules/projects/DatabaseView.test.tsx:471-565` (loading, empty database, empty table, unknown table with a usable picker, 503 unavailable, HTTP 400 failed + Retry, transport throw). No path renders a blank panel: a malformed or HTML 200 body falls into `failed` through `fetchResource` (`apps/web/src/modules/projects/DatabaseView.tsx:129-146`). |
| R8 `@/ui` + Tailwind/daisyUI only, no new dependency | MET | Sole UI imports come from the barrel (`apps/web/src/modules/projects/DatabaseView.tsx:11`; barrel `apps/web/src/ui.ts:8-19`); `git show --stat 88ac88985` does not touch `apps/web/package.json` and no grid library is imported; the table markup `table table-sm` matches the existing idiom (`apps/web/src/modules/observability/DecisionsTab.tsx:292`). |
| AC1–AC8 | MET | AC1: R1 row above; AC2: `apps/web/tests/modules/projects/DatabaseView.test.tsx:189-232`; AC3: `:142-187`; AC4: `:235-289`; AC5: `:293-387`; AC6: `:390-468`; AC7: `apps/web/src/modules/projects/tabs.tsx` + untouched `apps/web/package.json`; AC8: `:471-565`. Evidence gaps listed below. |

##### Frozen-seam and contract verification (read from the code, not from the tests)

- Client URLs `apps/web/src/modules/projects/DatabaseView.tsx:79-114` build
  `/project/database/tables[/:name[/rows|/row]]` with `page,pageSize,sort,dir,filterColumn,filter` and
  `offset` — exactly the names the server reads at `apps/server/src/modules/database/index.ts:44-51`; the
  client base `${resolveApiUrl()}/…` resolves to `<origin>/api` (`apps/web/src/lib/rpc-client.ts:32-45`) and
  the module mounts absolute `/api/...` paths (`apps/server/src/modules/database/index.ts:78-86`), matching
  the repo-wide raw-route pattern (`apps/web/src/modules/observability/DecisionsTab.tsx:118`). Table names
  are `encodeURIComponent`-ed (`apps/web/src/modules/projects/DatabaseView.tsx:83-85`).
- URL state: getters and writers use the same `URL_KEYS` constants, and
  `normalizePage`/`normalizeDir`/`normalizeText` (`apps/web/src/modules/projects/DatabaseView.tsx:61-77`) are
  total functions (NaN/0/negative → 1, unknown `dir` → `asc`, blank → null), so no malformed value throws.
- AC7 "no client-side sort/filter": the grid renders `rows.data.rows` in server order verbatim; the only
  client-side filter is `visibleTables` over table *names* (`apps/web/src/modules/projects/DatabaseView.tsx:486-492`),
  which is the rail contract, not row data.
- Frozen seams: `useProjectTab.ts` and `ProjectsShell.tsx` appear in neither `git show --stat 88ac88985` nor
  `git status --short`.
- `test-fix` leak repair judged sound: `mock.module('@/ui')` at
  `apps/web/tests/modules/observability/decisions-tab.test.tsx:33` and
  `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx:81` is process-global, so dropping
  `value`/`onChange` broke every later file; both stubs now forward them while still capturing the handler for
  direct invocation (`decisions-tab.test.tsx:20-30`, `new-task-panel.test.tsx:66-78`). Their own tests call the
  captured handler, so their intent is unchanged, and both suites stay green. Residual: later suites still
  render a stub `Input` rather than the real primitive (mitigated, not removed).

##### Commands run (targeted only)

- `bun test tests/modules/projects/` (cwd `apps/web`) → 204 pass / 0 fail, 20 files.
- `bun test tests/modules/observability/decisions-tab.test.tsx tests/modules/projects/DatabaseView.test.tsx tests/modules/task-kanban/new-task-panel.test.tsx` → 53 pass / 0 fail.
- `bun run apps/cli/src/index.ts task check 1184 --json` -> `pass: true`, three L4 `anchor-subject-mismatch` warnings, all on `## Solution` citations (finding #7).
- `git show --stat 88ac88985`, `git status --short` (three modified test files, two of them foreign),
  `git diff --cached --name-only` (empty), `git log -1 -- apps/web/package.json`.

##### Evidence gaps (why Confidence is MEDIUM, not HIGH)

1. No browser check. The task's own Plan step ("browser-check /board/projects/database against the live dev
   server on history_message") is marked done with "no browser surface in this native-subagent run". The
   truncation-and-tooltip visual, the grid's internal scroll chain (`h-full min-h-0`) and the real cost of
   typing a filter on a ~3.2M-row table are therefore unverified; a mounted-render suite cannot see CSS.
2. AC2's write leg is proven indirectly: the click's effect is observed through the follow-on request and the
   URL-derived range label rather than by asserting `location.search`. AC1's literal initial-entry deep link
   (`/board/projects/database` as `initialEntries`) is covered by the ArrowRight cycle navigating to that path
   (`apps/web/tests/modules/projects/a11y.test.tsx:217-232`), not by a test that mounts it directly.
3. In a full-suite run `DatabaseView.test.tsx` resolves a leaked `@/ui` stub `Input`; the projects-only run
   (no `@/ui` mock loaded, 204 pass) exercises the real primitive, so both are covered, but the suite's
   fidelity depends on that stub.

##### Residual risk

- Finding #1's typing-cost hazard is the one user-visible risk the current evidence cannot measure.
- Row drift between the grid read and the row-detail read is accepted by the design
  (`docs/design/projects-database-tab.md:82-83`), and a row that vanished between the two reads renders as
  all-`NULL` cells (`apps/web/src/modules/projects/DatabaseView.tsx:795`).

Next: run the deferred browser check on `/board/projects/database?table=history_message`; if typing a filter
stalls the board, add the ≥250 ms filter debounce recorded in finding #1.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T05:59:48.111Z feature_id Q → G631 (system)
- 2026-10-12T22:12:53.284Z todo → wip (system)

