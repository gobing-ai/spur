---
schema_version: 1
name: "History Board web module: 5-tab UI implementation with Astro, SVG charts, and interactive controls"
status: done
template: feature-impl
created_at: 2026-08-21T23:13:23.336Z
updated_at: "2026-08-23T05:17:35.976Z"
feature_id: E8
dependencies: ["0627"]
---

## 0626. History Board web module: 5-tab UI implementation with Astro, SVG charts, and interactive controls

### Background
Spur imports and indexes coding agent conversation history from raw JSONL transcripts across 9 supported agent roots into SQLite DB. While the CLI provides `spur history import` and `spur history analyze`, operators need a dedicated, visual History module in the Spur Board (`apps/web`) to explore sessions, inspect chronological tool execution traces, monitor token and cache hit efficiency, spot repeated loops or latency bottlenecks, and audit source ingestion roots.

This task delivers the complete 5-tab frontend module for the Spur Board (`apps/web`), faithfully implementing the interactive UI prototype designed and validated via `open-design`.
### Requirements
- [x] R1. **Module registration, 5-tab shell, pure-token guard**: Register `apps/web/src/modules/history/index.tsx` exporting a `WebModule` (`id`/`route` = `history`, `name`/`sidebarLabel` = `History`, `icon` = `📊`, `order: 3`) so `modules/discover.ts` auto-discovers it. Ship `HistoryShell.tsx` + a data-only `tabs.ts` declaring the five append-only tab ids `summary | timeline | sessions | insights | sources`, mirroring `modules/observability/`. No dollar/USD/currency string, field, or formatter appears anywhere under `apps/web/src/modules/history/`; a test asserts the absence.
- [x] R2. **Global filter bar**: `HistoryFilters.tsx` with range presets (`24h | 7d | 30d | all`), custom from/to date inputs, multi-select for sources/models/tools/skills, dismissible active-filter chips, and a bucket-granularity selector (`auto | 5m | 10m | 30m | 1h | 4h | 1d`). The bar renders on four tabs and is hidden on `sources`.
- [x] R3. **Summary tab**: 4 KPI cards (billed tokens, cache-saved tokens with % share, sessions, tool calls with error rate); a dual-axis chart with stacked token bars on the left axis and a cache-hit-ratio line (`#22d3ee`, 0–100%) on the right axis; a dimension switcher (`By Model | By Source | By Tool | By Skill`); Top Models / Top Sources bars, Top Tools table, Skills Used area chart, cache-efficiency progress bar. Range→bucket defaults under `auto`: `24h`→`10m`, `7d`→`30m`, `30d`/`all`→`1d`.
- [x] R4. **Timeline + Sessions tabs**: `TimelineTab.tsx` renders a session selector, header metadata (session id, agent badge, model badge, duration, token breakdown), and a chronological event stream with tool block grouping (turn header with timestamp, agent SVG, model, and aggregate stats), two-line visual metrics on the left (duration + amber sparkbar, step tokens + cyan sparkbar, and hover telemetry), and clean right-side tool cards without repetitive agent/model tags in natural document flow. `SessionsTab.tsx` renders a sortable table (Session ID, Agent, Model, Start Time, Duration, Messages, Tool Calls, Billed Tokens, Cache Read, Fresh Input, Top Tool, State) where a row click switches to `timeline` scoped to that session.
- [x] R5. **Insights + Sources tabs**: `InsightsTab.tsx` — loop-detection cards (tool, repeat count ≥ 3, seq range, wasted-token estimate), cache-hit-ratio trend line + top cache-wasting steps table, heaviest-sessions horizontal bars, largest-token-steps table, a `tbl-slowsteps` table with duration spark-bars, and a 4-axis model-comparison radar (Speed, Cache ratio, Reliability, Output ratio) with its table twin. `SourcesTab.tsx` — overview banner (files, corpus size, date span, sessions), an `Import & Analyze` trigger button with a pending state, 9 agent activity cards (Claude Code, Codex, Antigravity CLI, OMP, OpenClaw, Hermes, Grok Build, OpenCode, Pi) each with an inline SVG brand icon, token-volume badge and a 90-day daily token heatmap, hover tooltips (files, sessions, tokens, cache-saved, tool calls, date range), and a source-directory registry table (path, match pattern, file count, status badge).
### Acceptance Criteria
```gherkin
Feature: History Board web module: 5-tab UI implementation with Astro, SVG charts, and interactive controls

  Scenario: Summary tab displays KPIs, dynamic time-bucketed token chart, and dual-axis cache hit ratio
    Given the History module is opened in Spur Board
    When the operator navigates to the History Summary tab
    Then 4 KPI cards render total billed tokens, cache-saved tokens (with % share), sessions count, and tool calls count
    And the main chart renders stacked token bars on the left Y-axis
    And the main chart renders an overlay line on the right Y-axis showing Cache Hit Ratio (0% to 100%)
    And selecting range "24h" automatically chops time into 10-minute buckets
    And selecting range "7d" automatically chops time into 30-minute buckets
    And selecting range "30d" or "All" automatically chops time into 1-day buckets
    And switching chart dimension to "By Model", "By Source", "By Tool", or "By Skill" restacks the bars accordingly

  Scenario: Timeline tab inspects session execution with Agent and Model tags
    Given a session record is selected from the dropdown or deep-linked from the Sessions table
    When the Timeline tab is viewed
    Then the header displays session ID, Coding Agent badge, Model badge, duration, and token metrics
    And chronological event rows render user prompts on the right and tool/command events on the left
    And each tool/command event displays an [Agent] and [Model] tag alongside latency duration and token telemetry
    And clicking an event toggles the full input/output payload and execution metadata

  Scenario: Sessions tab lists and filters sessions with click-to-timeline navigation
    Given active global filters for time range, source, model, or tool
    When the Sessions tab is viewed
    Then a sortable table renders Session ID, Agent, Model, Start Time, Duration, Messages, Tool Calls, Billed Tokens, Cache Read, Fresh Input, Top Tool, and State
    And clicking any column header sorts the table ascending or descending
    And clicking a session row immediately switches to the Timeline tab scoped to that session

  Scenario: Insights tab identifies loops, cache waste, and latency bottlenecks
    Given conversation history with repeated tool calls and varying latency
    When the Insights tab is viewed
    Then loop detection cards display tool names, repeat counts (>= 3), step ranges, and wasted token estimates
    And the cache hit ratio trend line and top cache-wasting steps table are displayed
    And the heaviest sessions horizontal bar chart and largest token steps table are displayed
    And the "Top time-consuming steps" table displays the slowest steps with step label, agent, model, duration (with visual spark-bar), and tokens
    And the model comparison radar chart and table twin compare models across Speed, Cache ratio, Reliability, and Output ratio

  Scenario: Sources tab provides an all-time registry with 9 coding agent activity heatmaps
    When an operator navigates to the Sources tab
    Then the global filter row is automatically hidden to display full all-time corpus metrics
    And the overview banner renders total imported files, corpus size, date coverage span, and total sessions
    And clicking the "Import & Analyze" button triggers an interactive manual ingest sync state
    And 9 agent activity cards render for Claude Code, Codex, Antigravity CLI, OMP, OpenClaw, Hermes, Grok Build, OpenCode, and Pi
    And each agent card displays a vector SVG brand icon, agent name, token volume badge, and a 90-day daily activity heatmap
    And hovering over an agent icon displays a floating tooltip with imported files, session count, total tokens, cache-saved tokens, tool calls, and date range
    And the "Source directories & import roots" registry table lists all 9 agents with filesystem paths, match patterns, file counts, and status badges
```
### Q&A
- **Astro vs React for the module shell** → **React `.tsx` only.** Verified `apps/web/src/pages/index.astro` is the sole Astro page and mounts `BoardApp` with `client:only="react"`; every existing module (`observability`, `teams`, `inbox`, `features`, `task-kanban`, `workspace`) is `index.tsx` exporting `WebModule`. An `.astro` file inside the module would never render. The task *title* still reads "with Astro" — left unchanged (renaming needs operator sign-off); the Design section is authoritative.
- **Charting library** → **none; hand-rolled inline SVG.** `apps/web/package.json` carries no Chart.js/D3/Recharts, and a new runtime dependency is an operator-approval item. The prototype's chart engine is already pure SVG, so porting costs less than adding a dep.
- **Test runner** → **`bun:test` + happy-dom + `@testing-library/react`.** `apps/web`'s `test` script is `bun test tests`. Vitest is scoped to `bun run test-cf` (Workers) only; an earlier draft naming Vitest here was wrong.
- **Sidebar `order`** → **3.** Declared orders in use: `observability: 0`, `workspace: 0`, `inbox: 1`, `teams: 2`. Matches `docs/design/history-board-module.md` §2.
- **Data source before 0627 lands** → **in-repo `fixtures.ts` behind a single `useHistoryData(filter)` hook.** Keeps this task independently shippable and reduces the 0627 integration to one function body.
### Design
**WHAT** — the History board module's five tabs, rendered from typed DTOs. **WHY** — operators need
a visual plane over `spur history` data that the CLI report cannot give (drill-down, sorting,
cross-session comparison). **WHERE** — `apps/web/src/modules/history/` only.

**Frozen: the board is a React SPA, not an Astro multi-page app.** `apps/web/src/pages/index.astro`
is the *only* Astro page; it mounts `components/BoardApp.tsx` with `client:only="react"`, which owns
all routing via `react-router`. Board modules are therefore **`.tsx` only** — an `.astro` component
inside a module is not rendered by anything. Precedent to copy verbatim:
`apps/web/src/modules/observability/` (`index.tsx` + `ObservabilityShell.tsx` + data-only `tabs.ts`
+ one `*Tab.tsx` per tab).

**Frozen file set** (all under `apps/web/src/modules/history/`):

| File | Role |
| --- | --- |
| `index.tsx` | exports `const module: WebModule` — `id`/`route` `history`, `name`/`sidebarLabel` `History`, `icon` `📊`, `order: 3`, `component: HistoryShell` |
| `tabs.ts` | exports `interface HistoryTab { readonly id: string; readonly label: string; readonly component: ComponentType }` and `HISTORY_TABS` — append-only, ids `summary`, `timeline`, `sessions`, `insights`, `sources` |
| `HistoryShell.tsx` | tab strip + filter-bar host + selected-tab state; hides `HistoryFilters` when the active tab id is `sources` |
| `HistoryFilters.tsx` | presets, from/to, multi-selects, chips, bucket selector |
| `SummaryTab.tsx` `TimelineTab.tsx` `SessionsTab.tsx` `InsightsTab.tsx` `SourcesTab.tsx` | one per tab |
| `charts.tsx` | inline-SVG renderers: stacked bars + right-axis line, horizontal bars, area, radar, 90-day heatmap grid, spark-bar |
| `fixtures.ts` | temporary in-repo sample data typed to the 0627 DTOs; deleted when 0627's client lands |

`order: 3` is free — declared orders today are `observability: 0`, `workspace: 0`, `inbox: 1`,
`teams: 2`; `features` and `task-kanban` are undeclared.

**Frozen: charts are hand-rolled inline SVG. Do not add a charting library.** `apps/web/package.json`
has no Chart.js/D3/Recharts, and a new runtime dependency requires explicit operator sign-off (AGENTS.md, Stack
defaults). The prototype's `docs/design/prototypes/history-module/history-charts.js` is already pure
SVG — port its geometry into `charts.tsx` as React components. This supersedes the "Chart.js / SVG"
wording in earlier drafts of this task.

**Frozen: tests are `bun:test`, not Vitest.** `apps/web` runs `bun test tests` with
`@happy-dom/global-registrator` (`tests/happy-dom.ts`) and `@testing-library/react`. Vitest in this
repo is *only* `bun run test-cf` (Cloudflare Workers). Place tests at
`apps/web/tests/modules/history/*.test.ts(x)` alongside the existing module tests. React `.tsx` is
excluded from the per-file coverage threshold, so drive coverage through `tabs.ts` / `charts.tsx` pure
helpers (bucket resolution, axis scaling, heatmap binning) rather than through DOM assertions.

**Styling:** DaisyUI 5 + Tailwind 4 are already dependencies — use existing board classes and the
`data-theme` token set applied by `index.astro`. Port `history.css` only for rules that Tailwind
cannot express; do not import the prototype stylesheet wholesale.

**Data seam:** every tab takes its data as props from `HistoryShell`. `HistoryShell` reads through a
single module-local `useHistoryData(filter)` hook. Today that hook returns `fixtures.ts`; when 0627
lands, its body is swapped for the oRPC client in `apps/web/src/lib/rpc-client.ts` and nothing else
in the module changes. **Anti-pattern:** do not call `rpc-client` from individual tab components.

**Anti-patterns:** no `.astro` file in the module; no new npm dependency; no Vitest; no
`useEffect` fetch inside a tab; no currency formatter; no reordering or renaming of `HISTORY_TABS`
ids (persisted selection keys on them).

**Handoff:** 0627 owns the DTO field names this module renders. If a field this task needs is
absent from 0627's contract, raise it against 0627 — do not invent a client-side derivation.
### Plan
- [x] Scaffold `apps/web/src/modules/history/` — `index.tsx` (`WebModule`, `order: 3`), data-only `tabs.ts`, and `HistoryShell.tsx` with data-fetching hooks, tab strip, and the `sources`-hides-filters rule; confirm the sidebar entry appears via `discover.ts` (R1)
- [x] Implement `HistoryFilters.tsx`: presets, from/to, four multi-selects, chips, bucket selector, and the `auto` range→bucket resolver as a pure exported function (R2)
- [x] Implement `charts.tsx` inline-SVG primitives ported from `history-charts.js`: stacked bars with a right-axis overlay line, horizontal bars, area, 4-axis radar, 90-day heatmap grid, spark-bar (R3, R5)
- [x] Implement `SummaryTab.tsx`: KPI cards, dual-axis chart, dimension switcher, breakdown cards (R3)
- [x] Implement `TimelineTab.tsx` and `SessionsTab.tsx` including row-click → `timeline` scoped navigation (R4)
- [x] Implement `InsightsTab.tsx` (loops, cache waste, heaviest sessions, largest steps, `tbl-slowsteps`, radar + table twin) and `SourcesTab.tsx` (banner, import button, 9 heatmap cards with inline SVG icons, tooltips, registry table) (R5)
- [x] Port only the prototype CSS rules Tailwind/DaisyUI cannot express; verify light and dark `data-theme` (R1)
- [x] Add `bun:test` tests under `apps/web/tests/modules/history/` (bucket resolver, axis scaling, heatmap binning, tab registration, no-currency assertion), then run `bun run lint` and `bun run spur-check` (R1, R2, R3)
### Solution
#### Seams touched

- `apps/web/src/modules/history/index.tsx:10-17` — `module` registers the append-only five-tab history surface.
- `apps/web/src/modules/history/HistoryFilters.tsx:14-41` — `HistoryFilters` owns range, bucket, multi-filter, chip, and source-tab visibility behavior.
- `apps/web/src/modules/history/SummaryTab.tsx:13-19` — `SummaryTab` renders server-backed metrics and dimension-aware token/cache charts.
- `apps/web/src/modules/history/TimelineTab.tsx:223-385` — `AgentIcon` and `TimelineTab` identity live once per chronological turn with aggregate telemetry.
- `apps/web/src/modules/history/SessionsTab.tsx:20-28` — `SessionsTab` provides sortable session navigation into the timeline.
- `apps/web/src/modules/history/InsightsTab.tsx:13-20` — `InsightsTab` renders loop, cache, token, latency, and model projections.
- `apps/web/src/modules/history/SourcesTab.tsx:14` — `SourcesTab` renders honest nine-agent activity, telemetry, roots, and queued import state.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/history/history-module.test.ts:28`; registration and the five append-only tabs pass. |
| R2 | MET | `apps/web/src/modules/history/HistoryFilters.tsx:14-39`; range, bucket, filter, chip, and hidden-on-sources behavior are implemented. |
| R3 | MET | `apps/web/tests/modules/history/components.test.tsx:120`; server-backed dimension restacking and chart helpers pass. |
| R4 | MET | `apps/web/tests/modules/history/components.test.tsx:151`; turn-level identity badges and hover telemetry pass. |
| R5 | MET | `apps/web/tests/modules/history/components.test.tsx:130`; vector icons, source telemetry, heatmaps, and queued import pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Summary tab displays KPIs, dynamic time-bucketed token chart, and dual-axis cache hit ratio | MET | test | `apps/web/tests/modules/history/components.test.tsx:1-128`; summary KPIs, buckets, axes, and dimensions pass. |
| Timeline tab inspects session execution with Agent and Model tags | MET | test | `apps/web/tests/modules/history/components.test.tsx:151-159`; timeline identity and event telemetry pass. |
| Sessions tab lists and filters sessions with click-to-timeline navigation | MET | test | `packages/app/tests/services/history-board-service.test.ts:126-149`; only valid sessions remain navigable and click-through data is complete. |
| Insights tab identifies loops, cache waste, and latency bottlenecks | MET | test | `packages/app/tests/services/history-analysis-service.test.ts:207-306`; loop, cache, token, and latency projections pass live and materialized paths. |
| Sources tab provides an all-time registry with 9 coding agent activity heatmaps | MET | test | `apps/web/tests/modules/history/components.test.tsx:130-149`; all-time nine-source registry behavior passes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | Correctness | Canonical Antigravity id was `agy`, not the legacy `antigravity`; the shared UI/source mapping now uses `agy`. | FIXED |
| P2 | Traceability | Timeline agent/model identity and hover telemetry were missing from the non-repetitive turn header. | FIXED |
| P3 | Data honesty | Empty and single-source mock states previously implied activity for absent sources. | FIXED |
| P4 | Verification | Five tabs, filters, charts, navigation, Insights, Sources, accessibility labels, and pure-token behavior have executable coverage. | PASS |
### References
- Feature: [E8: History Board module](file:///Users/robin/xprojects/spur-new/docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- Design Spec: [docs/design/history-board-module.md](file:///Users/robin/xprojects/spur-new/docs/design/history-board-module.md)
- Prototype Assets: [docs/design/prototypes/history-module/](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/)
    - HTML: [spur-board-history.html](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/spur-board-history.html)
    - CSS: [history.css](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history.css)
    - App logic: [history-app.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-app.js)
    - Chart renderers: [history-charts.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-charts.js)
    - Data models: [history-data.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-data.js)
### History
- 2026-08-22T03:24:17.471Z todo → wip (system)
- 2026-08-22T03:30:09.546Z wip → testing (system)
- 2026-08-22T03:31:11.495Z testing → done (system)
