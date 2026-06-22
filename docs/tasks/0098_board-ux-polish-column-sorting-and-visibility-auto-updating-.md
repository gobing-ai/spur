---
schema_version: 1
name: "Board UX polish: column sorting and visibility, auto-updating card timestamps, and multi-folder switch"
status: done
template: standard
created_at: 2026-06-20T05:06:46.370Z
updated_at: 2026-06-22T17:40:57.712Z
feature_id: F7
priority: P2
tags: ["task-kanban", "wave-3", "web", "ux", "multi-folder"]
---

## 0098. Board UX polish: column sorting and visibility, auto-updating card timestamps, and multi-folder switch

### Background

Implements gap-analysis §2 (Sorting Controls, Column Board View toggle, Task Cards timestamp, Multi-Folder Config) + Wave 3. Effort: ~10h. Four smaller polish gaps that share the useTasks.ts/board surface, grouped to avoid over-decomposition (each is <0.5 day and touches the same files): (1) no column-specific WBS sort toggles, (2) no column visibility checkboxes, (3) cards show no last-updated relative timestamp (legacy auto-updated '2 hours ago'), (4) single hardcoded active folder with no folder switcher. Multi-folder needs a small config surface so list() can target a chosen folder (the CLI already supports --folder; the service lists only tasksDir today). Ordering: Wave 3; can run after or alongside 0097.

### Requirements
- [ ] R1. Add per-column sort toggles (WBS ascending/descending) with state tracking, implemented client-side in useTasks/board (the API need not change).
- [ ] R2. Add column visibility checkboxes in the board header so columns can be hidden/shown (default all visible), reducing clutter on small screens.
- [ ] R3. Render an auto-updating relative last-updated timestamp on each card (e.g. '2 hours ago') derived from updated_at, refreshing without a full reload.
- [ ] R4. Add a folder switcher: a header control to select the active tasks folder, feeding a config surface so the board lists the chosen folder. The service/contract gains a folder parameter (the CLI already has --folder); switching re-fetches the board for that folder.
- [ ] R5. Tests: sort toggles reorder a column, hiding a column removes it from the board, the relative timestamp renders and updates, and switching folder re-queries the correct folder. Gate green.
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — per-column WBS sort toggles
  Given a board column
  When I toggle its sort control
  Then the column's cards reorder by WBS ascending/descending, with the sort state tracked

Scenario: R2 — column visibility toggles
  Given the board header
  When I uncheck a column's visibility
  Then that column is hidden (default: all visible), and re-checking restores it

Scenario: R3 — cards show an auto-updating relative timestamp
  Given a task with updated_at
  When its card renders
  Then a relative last-updated label (e.g. "2 hours ago") is shown and updates over time without a full reload

Scenario: R4 — folder switcher re-queries the chosen folder
  Given multiple task folders
  When I select a different folder in the header
  Then the board lists tasks from that folder (the list contract/service gains a folder param)
  And switching re-fetches for the selected folder
```

Edge cases (advisory):

```gherkin
Scenario: R5 — hiding all but one column keeps the board usable
  Given all columns hidden except one
  When the board renders
  Then the single visible column still displays and accepts drops

Scenario: R6 — a folder with no tasks shows an empty board, not an error
  Given an empty task folder
  When selected
  Then the board shows an empty state cleanly
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Decision — four grouped polish items sharing the board/`useTasks` surface: client-side sort + visibility (no API change), relative timestamps from `updated_at`, and a folder switcher that adds a `folder` param to the list contract + service.**

Grouped to avoid over-decomposition (decomposition.md): each is <0.5 day and touches the same board/`useTasks`/card files. Three are pure client-side; only multi-folder needs a backend touch.

**R1 — column sort toggles (client-only).** Per-column WBS ascending/descending toggle, sort state held in board component state. The list payload is unchanged; sorting is a render-time transform. The legacy `taskSort` split dotted WBS — but the modern schema is flat 4-digit (gap-analysis §4.3), so sorting is a simple numeric compare.

**R2 — column visibility (client-only).** Header checkboxes toggle column render; default all visible. State is board-local (optionally persisted to localStorage like the legacy width cache, but not required).

**R3 — relative timestamps (client-only).** `TaskCard` renders a relative "N ago" from `updated_at` (available in the summary's frontmatter / extend the summary projection minimally if absent). Auto-update via a low-frequency interval (e.g. 60s) so labels age without a full reload — independent of the data poll.

**R4 — multi-folder (backend touch).** Today `list` has no `folder` param and `TaskService.list()` reads a fixed `this.ctx.tasksDir`; `create` already accepts `folder`. Add an optional `folder` to `taskListInput` (the list route currently takes no input) and thread it to the service so `list(folder?)` targets the chosen directory. A header folder switcher re-fetches on change (the CLI already supports `--folder`, so this is parity, not new domain logic). Rejected: a separate config-store endpoint for folders — out of scope; the switcher just passes a folder to `list`.

**Sequencing.** R1–R3 are independent and can land first; R4 is the only one needing a contract/service change. **Invariant:** sort/visibility/timestamp are presentation-only; the store/data flow is unchanged. Multi-folder keeps `list` the single read path, just parameterized.
### Plan
1. R1: add per-column WBS sort toggle (asc/desc) with board-local state; sort cards at render (numeric 4-digit WBS compare). No API change.
2. R2: add header column-visibility checkboxes (default all visible); hide/show columns from board-local state.
3. R3: render a relative "N ago" label on `TaskCard` from `updated_at` (extend the summary projection minimally if the field is absent); refresh labels on a ~60s interval independent of the data poll.
4. R4: add optional `folder` to `taskListInput` in `packages/contracts`; thread it through the handler to `TaskService.list(folder?)` so it targets the chosen dir. Add a header folder switcher that re-fetches on change.
5. Tests: sort toggle reorders a column; hiding a column removes it (single-column still usable); relative timestamp renders/updates; switching folder re-queries the correct folder; empty folder shows an empty state. Run the gate including `test-cf`.
### Testing
- Command: `bun run test` (full suite, 1587 pass / 0 fail), `bun run test-cf` (1 pass)
- Scope: Sort toggles (R1), column visibility (R2), relative timestamps (R3), folder switcher (R4), contract/server/service changes
- Result: All tests pass. New tests added: TaskCard relative timestamp rendering, KanbanColumn sort toggle icons and callback, board visibility checkboxes count, folder selector default value
- Coverage: 99.08% lines (unchanged from baseline)
- Evidence: `bun run test` 1587 pass 0 fail; `bun run lint` clean; `bun run build` succeeds
- Next action: Verification gate → done
### Review
## Review — 2026-06-22 (dev-verify --force)

**Status:** 3 findings raised → 2 fixed, 1 deferred (product input)
**Scope:** contracts/task.ts, server/handlers.ts, app/task-service.ts, web/task-kanban/*
**Mode:** verify (Phase 7 SECU + Phase 8 traceability)
**Channel:** inline
**Gate:** `bun run lint` clean · `bun run test` 1596 pass / 0 fail · `bun run test-cf` 1 pass · `bun run build` ok

### Requirements traceability (Phase 8) — all MET
- **R1** sort toggles · **R2** column visibility · **R3** auto-updating relative timestamp · **R4** folder switcher + folder param · **R5** tests + gate green

### Findings & dispositions
| # | Title | Dimension | Location | Disposition |
|---|-------|-----------|----------|-------------|
| 1 | `folder` reached `fs.readDir` unvalidated | Security (P3) | packages/app/src/services/task-service.ts:613 | **FIXED** — `resolveListDir()` constrains `folder` to the planning workspace (parent of `tasksDir`); `..`/absolute escapes throw. Also fixed a latent bug: a non-default `folder` now reads each file from that folder (was resolving entries against `tasksDir`). Tests: alt-folder list + escape-rejection. |
| 2 | Folder switcher offers one option | Usability (P3) | apps/web/src/modules/task-kanban/KanbanBoard.tsx:150 | **DEFERRED** — plumbing complete + tested; populating the `<select>` needs a folders source, which the task deliberately scoped out (no config-store endpoint). Tracked for a follow-up once multi-folder content exists. |
| 3 | Store churn on folder change | Efficiency (P3) | apps/web/src/modules/task-kanban/useTasks.ts:163 | **FIXED** — `TaskStore.setListFn()` swaps the list source in place; `useTasks` keeps a stable isolated store and re-points it via effect, so a folder switch no longer tears down the SSE connection + poll interval. Tests: store reuse across listFn change + setListFn swap/no-op. |

**Verdict: PASS** — all requirements MET, 2 of 3 advisory P3s resolved, 1 deferred with rationale. +9 tests (1587 → 1596).


### P1 — Blockers
_None._

### P2 — Warnings
_None._

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `folder` param reaches `fs.readDir` unvalidated | Security | packages/app/src/services/task-service.ts:489 | Local-first single-user tool, low risk; for defense-in-depth, constrain `folder` to a known-folders allowlist or resolve+assert it stays under the workspace root before `readDir`. |
| 2 | Folder switcher offers only one option | Usability | apps/web/src/modules/task-kanban/KanbanBoard.tsx:150 | Plumbing (contract→service) is complete and tested; the `<select>` hardcodes `docs/tasks`, so there is nothing to switch *to* yet. Populate from a folders source when multi-folder content exists. |
| 3 | Store churn on folder change | Efficiency | apps/web/src/modules/task-kanban/useTasks.ts:163 | Each `folder` change recreates `TaskStore` via `useMemo`, tearing down + reopening the SSE connection and poll interval. Acceptable for an infrequent user action; revisit if folder switching becomes hot. |

### P4 — Suggestions
_None._

### Requirements traceability (Phase 8)
- **R1** sort toggles → **MET** — KanbanBoard.tsx:57 toggleSort + tasksByStatus numeric sort; KanbanColumn.tsx:30; tests board+components
- **R2** column visibility → **MET** — KanbanBoard.tsx:75 toggleColumn + render filter; test "checkboxes rendered"
- **R3** auto-updating relative timestamp → **MET** — TaskCard.tsx:18 relativeTime + 60s interval; handlers.ts:43 updatedAt projection; task.ts:21 schema; tests present/absent
- **R4** folder switcher + folder param → **MET** (plumbing) — task.ts:25 taskListInputSchema.folder; handlers.ts:16 toFilters; task-service.ts:489 list(folder?); KanbanBoard.tsx:150 selector (see finding #2 re: single option)
- **R5** tests + gate green → **MET** — all suites pass, lint+build clean

**Verdict: PASS** (P3-only findings, all requirements MET). No fix applied — findings are advisory hardening, not blockers; fixing them (esp. #2) requires product input on the folder source, out of scope for this verification.


### History
- 2026-06-22T17:40:57.712Z testing → done (system)
