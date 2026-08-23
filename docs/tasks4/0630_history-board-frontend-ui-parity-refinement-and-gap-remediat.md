---
schema_version: 1
name: "History Board frontend UI parity refinement and gap remediation"
status: done
template: feature-impl
created_at: 2026-08-22T13:17:58.379Z
updated_at: "2026-08-23T14:22:51.359Z"
feature_id: E8
---

## 0630. History Board frontend UI parity refinement and gap remediation

### Background
Following the implementation of Feature E8 (History Board module across tasks 0626, 0627, 0628, 0629), a comprehensive headless browser audit and DOM comparison was performed against the original design prototype (`docs/design/prototypes/spur-board-history.html`), with findings recorded in `docs/design/prototypes/gap_analysis.md`.

While the core functionality, live database query engine, and oRPC data contracts are fully operational and verified, several visual, interactive, and ergonomic gaps remain across all five tabs (`Summary`, `Timeline`, `Sessions`, `Insights`, `Sources`) and the global navigation/filtering surfaces:

1. **Global Header & Filters Bar:** Tab navigation buttons lack dynamic count pills (`.cnt` badges for Sessions, Insights, Sources); the `last import` status livechip with pulsing indicator is absent; granularity bucket chips (`Auto`, `5m`, `10m`, `30m`, `1h`, `4h`, `1d`) are located in the global filter row instead of directly controlling the Tab 1 Time Series chart; and multi-select filter dropdowns lack search filtering, brand color swatches, and clear `All` tallies.
2. **Tab 1 (Summary):** The 4 KPI cards lack 30-day mini SVG sparkline trends and period-over-period delta badges (`▲ +X% vs previous period`); the Time Series chart lacks a `Table view` toggle button; the Top Tools table is missing volume sparkbars; the Skills section uses static pill tags instead of a temporal stacked area chart; and the Efficiency panel is missing 3 of the 4 prototype metrics.
3. **Tab 2 (Timeline):** Missing sequential session stepper buttons (`←` / `→`); missing a global `Expand all` / `Collapse all` accordion toggle; and user prompt turns are rendered as generic events instead of distinct right-aligned prompt bubbles.
4. **Tab 3 (Sessions):** Minor typographic, alignment, and column width adjustments needed to match the prototype's high-density tabular presentation.
5. **Tab 4 (Insights):** Missing a standalone daily Cache Hit Ratio trend line chart in the cache waste row; missing latency minibars in the Top Time-Consuming Steps table.
6. **Tab 5 (Sources):** Heatmap cell sizing, tooltip positioning, and directory registry status badge alignment need final polish.

This task remediates these concrete findings across `apps/web/src/modules/history/` to bring the live board to full visual and interactive parity with the design prototype while strictly preserving theme compatibility (Dark/Light mode) and pure-token accounting discipline.
### Requirements
- **R1 (Global Header & Filter Bar Refinements):**
  - **R1.1:** Add dynamic count badge pills (`.cnt`) to the tab navigation strip in `HistoryShell.tsx` for `Sessions` (e.g. `160`), `Insights` (e.g. `6`), and `Sources` (`9`), updating dynamically based on filtered corpus state.
  - **R1.2:** Add the `last import` status chip (`.livechip`) to the header with a pulsing indicator dot and formatted relative timestamp (e.g. `last import 12m ago` or formatted timestamp from sources metadata).
  - **R1.3:** Relocate the Granularity / Bucket selector (`Auto`, `5m`, `10m`, `30m`, `1h`, `4h`, `1d`) out of the global filter bar and into the Tab 1 (Summary) Time Series chart header, providing direct contextual control over bucket aggregation.
  - **R1.4:** Upgrade the multi-select filter dropdowns in `HistoryFilters.tsx` (`Agents`, `Models`, `Tools`, `Skills`) to include instant text search filtering, agent brand color swatches, SVG icons, `Select all` / `Clear all` actions, and display `All` / `Any` when unconstrained instead of misleading `(0)` count tallies.
  - **R1.5:** Add a right-aligned dynamic scope summary label on the filter bar (e.g. `May 24 – Aug 21, 2026 · 120 sessions · 9 sources`).

- **R2 (Tab 1 Summary Analytics & Chart Controls):**
  - **R2.1:** Embed mini SVG sparkline trend charts inside each of the 4 KPI cards (`Total billed tokens`, `Cache-saved tokens`, `Sessions`, `Tool calls`) representing the 30-day daily velocity curve.
  - **R2.2:** Calculate and display period-over-period delta badges (`▲ +X% vs previous period` / `▼ -X%` with green/red status styling) on all 4 KPI cards.
  - **R2.3:** Replace static card notes with data-driven token component breakdowns (e.g. `Cache read 28.3M · Fresh input 6.5M · Output 2.1M` and `Share of billed 78.9% · Hit ratio 81.3%`).
  - **R2.4:** Add a `Table view` toggle button in the Time Series panel header that smoothly toggles between the dual-axis stacked SVG columns chart and a detailed data table (`Bucket`, dimension series columns, `Total`, `Cache Hit %`).
  - **R2.5:** Add horizontal volume sparkbars in the `Top Tools` table (`td:nth-child(2)`) to visually illustrate relative tool invocation counts.
  - **R2.6:** Implement a temporal stacked area chart (`<StackedAreaChart>`) for the `Skills Used` section to show token attribution over time across skills, accompanied by total token legend metrics.
  - **R2.7:** Expand the `Efficiency` panel into a 4-metric grid: `Cache hit ratio` (with progress meter bar), `Avg tokens / session`, `Avg tokens / step`, and `Loop detection findings` (redundant calls and wasted tokens).

- **R3 (Tab 2 Timeline Stepper & Accordion Controls):**
  - **R3.1:** Add sequential navigation stepper buttons (`←` Previous and `→` Next) beside the Session selector dropdown in `TimelineTab.tsx` to enable rapid session browsing.
  - **R3.2:** Add a global `Expand all` / `Collapse all` toggle button in the timeline header that expands or collapses all event detail accordions in a single click.
  - **R3.3:** Style user prompt turns with a dedicated right-aligned bubble layout, distinct `PROMPT` kind tag, input token count badge, and expandable prompt payload.
  - **R3.4:** Add hover tooltip previews on the left telemetry cells showing full step metadata (Action, Agent/Model, Latency Cost, Total Tokens, Fresh Input, Cache Read, Output Tokens).

- **R4 (Tab 3 Sessions Table Precision & Aesthetics):**
  - **R4.1:** Refine `SessionsTab.tsx` table column formatting, aligning numeric token and count columns right with strict `tabular-nums` monospace formatting.
  - **R4.2:** Ensure active sort direction indicators (`▲` / `▼`) are visibly highlighted in primary accent color on active sort headers.
  - **R4.3:** Format session IDs with ellipsis truncation and hover tooltip displaying full session UUID.

- **R5 (Tab 4 Forensic Insights Trends & Metrics):**
  - **R5.1:** Add a standalone daily Cache Hit Ratio trend line chart (`<LineChart>`) beside the Top Cache-Wasting incidents table in `InsightsTab.tsx`.
  - **R5.2:** Add inline orange latency minibars to the `Top Time-Consuming Steps` table to visually represent execution duration relative to the maximum observed step duration.
  - **R5.3:** Maintain synchrony between the 4-axis Model Comparison `<RadarChart>` and its side-by-side benchmark table twin.

- **R6 (Tab 5 Sources Registry Polish & Visual Consistency):**
  - **R6.1:** Ensure the 90-day daily activity calendar heatmaps render 7x13 grids with 5-level graded intensity squares, month labels (`May`, `Jun`, `Jul`, `Aug`), day labels (`Mon`, `Wed`, `Fri`), and `Less` → `More` legend.
  - **R6.2:** Polish agent icon hover tooltip popovers (`source-tooltip-${id}`) to ensure high-contrast, accessible layout across both light and dark themes.
  - **R6.3:** Verify the async `Import & Analyze` trigger button provides real-time progress feedback and status messages upon dispatching jobs to the backend.
### Acceptance Criteria
#### Scenario 1: Tab Navigation Count Badges and Livechip (R1.1, R1.2)
- **GIVEN** the History Board module is loaded at `/board/history`
- **WHEN** sessions, loops, and agent sources are retrieved from the backend
- **THEN** the tab strip displays count badge pills (`.cnt`) next to `Sessions`, `Insights`, and `Sources` representing active filtered counts
- **AND** the header displays a `last import` status chip with a green indicator dot and relative timestamp.

#### Scenario 2: Chart-Coupled Granularity and Table View Toggle (R1.3, R2.4)
- **GIVEN** the user is viewing Tab 1 (Summary)
- **WHEN** the user observes the Token Consumption panel
- **THEN** the bucket granularity controls (`Auto`, `5m`, `10m`, `30m`, `1h`, `4h`, `1d`) are embedded directly in the chart panel header
- **AND** clicking `Table view` toggles the visualization into a full data table displaying bucketed token breakdown and cache hit percentages.

#### Scenario 3: Upgraded Filter Popovers with Search and Brand Swatches (R1.4, R1.5)
- **GIVEN** the user opens any multi-select filter dropdown (`Agents`, `Models`, `Tools`, `Skills`)
- **WHEN** the popover opens
- **THEN** it displays a search input filter, agent brand color swatches, SVG icons, and `Select all` / `Clear all` quick actions
- **AND** unconstrained filters display `All` or `Any` rather than `(0)`.

#### Scenario 4: Summary KPI Sparklines, Deltas, and Skills Area Chart (R2.1, R2.2, R2.3, R2.5, R2.6, R2.7)
- **GIVEN** the Summary tab is populated with metrics
- **WHEN** the KPI cards and breakdowns are rendered
- **THEN** each of the 4 KPI cards contains a 30-day mini SVG sparkline trend curve and a period-over-period delta badge (`▲ +X% vs previous period`)
- **AND** the Top Tools table displays inline horizontal call volume sparkbars
- **AND** the Skills Used panel renders a `<StackedAreaChart>` showing skill token attribution over time
- **AND** the Efficiency panel renders all 4 metrics (`Cache hit ratio`, `Avg tokens / session`, `Avg tokens / step`, `Loop detection findings`).

#### Scenario 5: Timeline Navigation Stepper and Expand All Controls (R3.1, R3.2, R3.3, R3.4)
- **GIVEN** the user is inspecting a session in Tab 2 (Timeline)
- **WHEN** the user clicks `←` or `→`
- **THEN** the timeline switches to the immediately preceding or succeeding session without opening the dropdown
- **AND** clicking `Expand all` opens all event payload accordions across all turns in the session
- **AND** user prompts are styled with dedicated right-aligned bubble layouts and `PROMPT` badges.

#### Scenario 6: Sessions and Insights Forensic Charts (R4, R5)
- **GIVEN** Tab 3 (Sessions) and Tab 4 (Insights) are viewed
- **WHEN** the data tables and forensic cards render
- **THEN** Sessions table columns align numbers to the right with `tabular-nums` formatting and sort caret indicators
- **AND** Tab 4 renders a standalone daily Cache Hit Ratio line chart beside the Cache Waste table
- **AND** the Top Time-Consuming Steps table renders orange duration minibars.

#### Scenario 7: Sources Registry and Heatmaps Fidelity (R6)
- **GIVEN** Tab 5 (Sources) is opened
- **WHEN** the 9 agent activity cards render
- **THEN** 7x13 daily heatmap grids display 5-level graded intensity squares with month and day labels
- **AND** hovering an agent icon displays a detailed summary tooltip with total files, sessions, tokens, cache saved, and date span
- **AND** clicking `Import & Analyze` triggers background ingestion and reports live status feedback.
### Q&A
**Q: Why relocate the granularity bucket selector from the global filter bar into the Tab 1 chart header?**
A: In the prototype, granularity bucket size (`5m`, `10m`, `30m`, `1h`, `4h`, `1d`) specifically dictates the column aggregation width of the Time Series chart in Tab 1. Placing it in the global filter row implied it altered tabular views on Tabs 2–5, causing user confusion. Moving it into the Tab 1 chart panel couples the control directly to its visual output.

**Q: Should the UI use DaisyUI theme variables or hardcoded hex colors from the prototype?**
A: Semantic DaisyUI tokens (`bg-base-100`, `bg-base-200`, `bg-base-300`, `text-primary`, `text-base-content`, `border-base-content/10`) must be preserved for structural surfaces to ensure flawless dark and light mode theme switching. Specific data visualization hues (e.g. secondary-axis cyan `#22d3ee` for Cache Hit Ratio, agent brand colors, and model family colors) remain fixed across themes to preserve categorical identification.

**Q: How does this task preserve the pure-token accounting contract?**
A: Zero dollar, price, costUsd, or currency fields are permitted anywhere in frontend DTOs, interfaces, or rendered components. All metrics are strictly expressed in pure token units (`billedTokens`, `cacheSavedTokens`, `freshInputTokens`, `outputTokens`), invocation counts, duration (`ms`, `min`, `h`), and percentage ratios (`cacheHitRatio`, `errorRate`).

**Q: What is deliberately NOT in this task?**
A: Backend schema alterations, database query changes, and oRPC procedure additions. The backend contracts and live query services implemented in tasks 0627 and 0628 already supply all requisite telemetry fields; this task is strictly a frontend presentation and UX interaction refinement.
### Design

The refinement is localized to `apps/web/src/modules/history/`:

```text
apps/web/src/modules/history/
├── HistoryShell.tsx          # Top header, tab buttons with .cnt badges, livechip, view router
├── HistoryFilters.tsx        # Filter popovers with search, swatches, clear all, scope summary
├── SummaryTab.tsx            # KPI sparklines & deltas, chart bucket header, table toggle, skills area chart
├── TimelineTab.tsx           # Session prev/next stepper, expand-all button, prompt bubble styling
├── SessionsTab.tsx           # Monospace column alignment, sort carets, pagination
├── InsightsTab.tsx           # Loop detection cards, daily cache hit line chart, latency minibars, radar twin
├── SourcesTab.tsx            # 9-agent grid, 90-day heatmaps with labels, icon hover tooltips, import button
├── charts.tsx                # Pure SVG chart primitives: StackedColumnsChart, StackedAreaChart, LineChart, RadarChart, HeatmapGrid, Sparkline, SparkBar
└── tabs.ts                   # Tab definition constants
```

#### Key Design Patterns & Invariants:
1. **Pure SVG Data Visualizations (`charts.tsx`):** All charts (`StackedColumnsChart`, `StackedAreaChart`, `LineChart`, `RadarChart`, `HeatmapGrid`, `Sparkline`, `SparkBar`) are rendered via pure React SVG elements with responsive `viewBox` attributes and zero external heavyweight charting dependencies.
2. **Accessible Popover Dialogs:** Multi-select filter menus utilize floating dropdown containers with instant local search filtering, keyboard accessibility, and clean backdrop dismissals.
3. **Session Traversal Seam:** `TimelineTab` coordinates session selection with `HistoryShell`, allowing cross-tab row-clicks from `SessionsTab` and `InsightsTab` to seamlessly set the active session ID and navigate to the Timeline view.
4. **Theme Adaptation:** Structural backgrounds and typography utilize Tailwind / DaisyUI tokens (`base-100`, `base-200`, `base-300`, `primary`, `base-content`), while dataviz series maintain deterministic categorical colors matching the prototype design system.
### Plan
- [x] **Phase 1 (Global Navigation & Filters):** Add `.cnt` tab badges, `last import` livechip, relocate granularity bucket selector into Tab 1 chart header, and upgrade filter popovers with search and brand swatches (R1).
- [x] **Phase 2 (Tab 1 Summary Analytics):** Embed 30-day KPI sparklines, period delta badges, `Table view` toggle, Top Tools volume sparkbars, Skills Used `<StackedAreaChart>`, and 4-metric efficiency panel (R2).
- [x] **Phase 3 (Tab 2 Timeline Controls):** Implement sequential session navigation stepper (`←` / `→`), global `Expand all` toggle, dedicated prompt bubble styling, and telemetry hover tooltips (R3).
- [x] **Phase 4 (Tab 3 Sessions & Tab 4 Insights):** Refine monospace column precision, embed daily Cache Hit Ratio `<LineChart>` in Tab 4, add latency minibars, and verify radar chart/table synchrony (R4, R5).
- [x] **Phase 5 (Tab 5 Sources & Verification):** Polish 90-day activity heatmaps with intensity levels/labels, agent icon hover tooltips, and verify against full test suite (`spur-check-new`) (R6).
### Solution
Curated change-map — one row per changed file, anchored at the primary symbol each change implements.

| Change | Anchor |
|--------|--------|
| `HistoryShell` / `SummaryTab` / `TimelineTab` / `SessionsTab` / `InsightsTab` / `SourcesTab` — UI parity refinement, accessibility, data-driven deltas and trends | `apps/web/src/modules/history/TimelineTab.tsx:309` |
| Component tests for History Board module search, filters, deltas, and telemetry | `apps/web/tests/modules/history/components.test.tsx:249` |
| History Board design satellite synchronization | `docs/design/history-board-module.md:10` |
| 04_DESIGN.md satellite index update | `docs/04_DESIGN.md:66` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1.1 | MET | apps/web/src/modules/history/HistoryShell.tsx:257-278,349-371 derives Sessions, Insights, and Sources badges from filtered API responses and renders loading/error/zero states. |
| R1.2 | MET | apps/web/src/modules/history/HistoryShell.tsx:280-286,333-345 renders sources metadata as a last-import status chip with a pulsing emerald indicator and honest loading/error/never-imported states. |
| R1.3 | MET | apps/web/src/modules/history/SummaryTab.tsx:243-261 owns Auto/5m/10m/30m/1h/4h/1d controls in the Time Series header; HistoryFilters no longer owns bucket controls. |
| R1.4 | MET | apps/web/src/modules/history/HistoryFilters.tsx:44-137,291-326 implements searchable accessible dialogs, Select all/Clear all, swatches/icons, and All/Any labels; apps/web/tests/modules/history/components.test.tsx:247 proves typing retains focus. |
| R1.5 | MET | apps/web/src/modules/history/HistoryFilters.tsx:228-254 renders the right-aligned range/session/source scope summary from HistoryShell's filtered data. |
| R2.1 | MET | apps/web/src/modules/history/SummaryTab.tsx:57-84,116-134 maps the daily KPI trend into a pure-SVG Sparkline on each of four KPI cards. |
| R2.2 | MET | apps/web/src/modules/history/SummaryTab.tsx:29-55,181-230 calculates and renders directional period deltas with honest no-baseline handling; components.test.tsx:352 verifies measured deltas. |
| R2.3 | MET | apps/web/src/modules/history/SummaryTab.tsx:181-230 renders fresh/output, billed-share/hit-ratio, and measured session/tool-call notes from response data. |
| R2.4 | MET | apps/web/src/modules/history/SummaryTab.tsx:263-350 switches the same bucket series between chart and detailed table views; components.test.tsx:337 verifies both transitions. |
| R2.5 | MET | apps/web/src/modules/history/SummaryTab.tsx:410-450 renders Top Tools invocation volume with relative SparkBars. |
| R2.6 | MET | apps/web/src/modules/history/SummaryTab.tsx:500-520 renders skillTimeSeries through StackedAreaChart with per-skill token totals; components.test.tsx:352 verifies the measured total. |
| R2.7 | MET | apps/web/src/modules/history/SummaryTab.tsx:453-497 renders cache ratio/meter, averages per session and step, and loop redundant-call/wasted-token findings. |
| R3.1 | MET | apps/web/src/modules/history/TimelineTab.tsx:170-205 implements bounded Previous/Next traversal over the loaded session roster; components.test.tsx:461 verifies both boundary states. |
| R3.2 | MET | apps/web/src/modules/history/TimelineTab.tsx:147-159,208-223 provides one session-global Expand all/Collapse all control keyed across every turn; components.test.tsx:297 verifies expansion and session reset. |
| R3.3 | MET | apps/web/src/modules/history/TimelineTab.tsx:294-337 renders right-aligned PROMPT bubbles with input-token badge and expandable payload; components.test.tsx:297 verifies the bubble and payload. |
| R3.4 | MET | apps/web/src/modules/history/TimelineTab.tsx:18-96 exposes focus/hover tooltips containing action, agent/model, duration, total, fresh, cache-read, and output telemetry; components.test.tsx:297 verifies it. |
| R4.1 | MET | apps/web/src/modules/history/SessionsTab.tsx:64-154 right-aligns numeric columns and applies tabular-nums formatting. |
| R4.2 | MET | apps/web/src/modules/history/SessionsTab.tsx:53-56 preserves the active sort caret in the primary accent. |
| R4.3 | MET | apps/web/src/modules/history/SessionsTab.tsx:122-154 truncates long IDs and retains the complete ID in title; components.test.tsx:448 verifies long and short forms. |
| R5.1 | MET | apps/web/src/modules/history/InsightsTab.tsx:114-164 places the daily cache-hit LineChart beside the cache-waste table; components.test.tsx:401 verifies data/no-data behavior. |
| R5.2 | MET | apps/web/src/modules/history/InsightsTab.tsx:194-246 renders orange duration minibars normalized against the displayed maximum step duration. |
| R5.3 | MET | apps/web/src/modules/history/InsightsTab.tsx:31-65,295-341 derives the bounded 0-100 radar and adjacent raw benchmark table from one modelComparison source; components.test.tsx:401 verifies speed inversion and bounds. |
| R6.1 | MET | apps/web/src/modules/history/charts.tsx:488-598 renders sequential 7-row chunks, 13 columns for 90 days, five intensity levels, month/weekday labels, tooltips, and Less-to-More legend; components.test.tsx:425 verifies the 13-column calendar. |
| R6.2 | MET | apps/web/src/modules/history/AgentIcon.tsx:3-73 and SourcesTab.tsx:120-153 provide labeled SVG icons and a focus/hover tooltip with semantic theme surfaces and high-contrast telemetry. |
| R6.3 | MET | apps/web/src/modules/history/SourcesTab.tsx:14-29,92-106 reports dispatching, queued, and failed import states through aria-live without inventing backend progress; components.test.tsx:276 verifies queued feedback. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario 1: Tab Navigation Count Badges and Livechip | MET | command | bun run build passed; static trace at HistoryShell.tsx:257-286,333-371 proves the three API-backed badges and formatted last-import chip. |
| Scenario 2: Chart-Coupled Granularity and Table View Toggle | MET | test | apps/web/tests/modules/history/components.test.tsx:337,387 verifies chart/table switching and contextual bucket selection; the 12-test component file passed. |
| Scenario 3: Upgraded Filter Popovers with Search and Brand Swatches | MET | test | apps/web/tests/modules/history/components.test.tsx:247 verifies searchable filter keyboard behavior; HistoryFilters.tsx:44-137 statically verifies swatches/icons/actions and All/Any labels. |
| Scenario 4: Summary KPI Sparklines, Deltas, and Skills Area Chart | MET | test | apps/web/tests/modules/history/components.test.tsx:337-384 verifies KPI baselines/deltas, measured notes, skill token totals, loop efficiency, and distinct sub-day buckets. |
| Scenario 5: Timeline Navigation Stepper and Expand All Controls | MET | test | apps/web/tests/modules/history/components.test.tsx:297-334,461 verifies bounded traversal, a single global expansion control, prompt bubbles, payload reset, and telemetry tooltips. |
| Scenario 6: Sessions and Insights Forensic Charts | MET | test | apps/web/tests/modules/history/components.test.tsx:401-422,448-459 verifies bounded radar/cache trend and Sessions ID/loading/error behavior; source trace covers right alignment, sort caret, and latency bars. |
| Scenario 7: Sources Registry and Heatmaps Fidelity | MET | test | apps/web/tests/modules/history/components.test.tsx:276-294,396-398,425-445 verifies SVG icons, telemetry tooltip, import feedback, never-imported state, labels, digest, and 13 heatmap columns. |
| Summary tab displays KPIs, dynamic time-bucketed token chart, and dual-axis cache hit ratio | MET | test | Web component tests plus packages/app/tests/services/history-board-service.test.ts verify the chart controls and live/previous KPI series projection, including a preset previous window. |
| Timeline tab inspects session execution with Agent and Model tags | MET | test | components.test.tsx:297-334 verifies agent/model chips, prompt presentation, stable per-turn event keys, expansion, and full telemetry. |
| Sessions tab lists and filters sessions with click-to-timeline navigation | MET | test | components.test.tsx:448-471 verifies Sessions rendering and Timeline roster boundaries; HistoryShell.tsx:224-231 routes a selected session into Timeline. |
| Insights tab identifies loops, cache waste, and latency bottlenecks | MET | test | components.test.tsx:401-422 verifies cache trend and radar normalization; InsightsTab.tsx:114-246 traces cache-waste and latency visualizations. |
| Sources tab provides an all-time registry with 9 coding agent activity heatmaps | MET | test | components.test.tsx:276-294,396-445 and history-board-mock-service.test.ts verify registry telemetry, dispatch state, and 90-day calendar behavior over the canonical source response. |
| oRPC contracts and DB query performance | MET | test | packages/contracts/tests/history-contract.test.ts verifies required additive fields and the unchanged six-procedure seam; packages/app/tests/services/history-board-service.test.ts:199 keeps live endpoint queries under 50 ms; full suite passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Review (2026-08-22, inline /sp:dev-review 0630 --auto — three-dimensional)**

**Dimension 1 — Functional requirements traceability (vs ## Requirements):**

- **R1 PASS** — `historyKpiTrendPointSchema`/`HistoryKpiTrendPoint`, `HistorySummaryKpis` export, `kpiTrend`/`previousKpis`/`skillTimeSeries` on summary response, `lastImportedAt` on sources overview: all present in `packages/contracts/src/history.ts` (additive, required-not-optional). Rollup + exact `historyKpiTrend` queries in domain; `projectKpiTrend` zero-fills 30 UTC days; `previousWindowSelector` returns null for unbounded windows; `lastImportedAt` = max non-null source rollup value. No migration/table/procedure/route/currency added.
- **R2 PASS** — HistoryShell badges use the three fixed definitions (`kpis.sessionsCount`, `loops.length`, `agents.length`) with loading (ellipsis) / error (em dash) / zero states; header chip `never imported` for null; bucket control removed from filters, owned by SummaryTab panel header; single private `MultiSelectFilter` (Escape/outside dismissal, Select all/Clear all, source swatches, All/Any labels, API-derived options); right-aligned scope summary (range/sessions/sources).
- **R3 PASS** — pure-SVG `Sparkline` on all four KPI cards from `kpiTrend`; `No prior baseline` on zero/missing previous denominator; real breakdown notes; local Chart/Table toggle sharing series rows; `SparkBar` call-volume in Top Tools; `skillTimeSeries` via `StackedAreaChart` + skillsUsed legend; four efficiency metrics with honest zero/N/A.
- **R4 PASS** — roster traversal bounded by `timelineRoster` (disabled at boundaries, no wrap, no DB neighbor query); expansion keys `turnIndex:seq` with reset on session change; `kind==='user'` right-aligned PROMPT bubble with telemetry + details; keyboard+pointer tooltip `timeline-step-tooltip-<turnIndex>-<seq>` (focus-visible ring, Action/Agent/Model/Duration/Total/Fresh/CacheRead/Output).
- **R5 PASS** — Sessions ID truncation `>18 → 16…` with full `title`; tabular-nums/right-align/primary-caret preserved; Insights `cacheHitTrend` → `LineChart`; orange duration minibars normalized to displayed max; one radar adapter with inverted Speed (fastest=100, all-equal=100) and 0–100 clamps, raw values in table.
- **R6 PASS** — HeatmapGrid 13×7 Monday-first weekday-aligned padding, month labels, Mon/Wed/Fri, levels 0–4 vs maxDailyTokens quartiles, Less→More legend; shared `AgentIcon.tsx` module component; import dispatch `aria-live="polite"` reporting dispatching/queued/failed only.
- **R7 PASS** — six oRPC procedure names unchanged (getSummary/getTimeline/getSessions/getInsights/getSources/triggerImport verified at packages/contracts/src/history.ts:425-475); no package.json dependency changes; zero prototype JS/CSS copied; no currency naming; semantic DaisyUI/Tailwind tokens for structure with fixed hues only in categorical dataviz (Sparkline default `#3987e5`).

**Dimension 2 — SECUA:**

- Security: read-only additive projections; no new trust boundary, no client-supplied SQL, `buildRollupWhere` parameterization unchanged. `qualityGateCmd` surface untouched.
- Efficiency: extras computed in one bounded `Promise.all` beside existing reads; no per-row fan-out; no client-side raw scans. Skill-dimension series now routes to the indexed live attribution query (`bucketedTokenSeries`) — equality by construction instead of a second materialized split.
- Correctness: the test stage fixed the one real defect — rollup skill series pre-divided by ALL tool links (`tools_in_message`) while the skill view must divide by skill links only; live read is SSOT (task 0629 decision). `history-board-service.ts:398` passes `skillBuckets` (model-keyed) to `projectSkillTimeSeries`; domain test contract corrected to full attribution (100/900/50). Gate green: 6218 tests / 0 fail / biome clean / post-check rules pass.
- Usability: loading/error/zero count states, keyboard-accessible popovers and tooltips, stable aria relationships, text+icon status (not color-only).
- Architecture: SQL stays in `packages/domain`; contracts carry transport DTOs only; mock service parity maintained; apps stay thin (ADR-021).

**Dimension 3 — Architecture depth:**

- Layering clean: contract schema → domain query (`historyBoardKpiTrendFromRollup` + exact `historyKpiTrend` fallback) → app projection (`projectKpiTrend`, `previousWindowSelector`, `previousExactKpis`) → web components. No layer skipped, no seam duplicated.
- The skill-series fix is the minimal correct seam: one conditional in `historyBoardSummaryFromRollup` routing dimension==='skill' to `bucketedTokenSeries`; no schema/insert/migration change, tool/model/source dimensions and KPI aggregates untouched.
- `activeBuckets` parameter retained at history-board-service.ts:390 — still consumed by the primary series projection; removal would have broken model-dimension parity.

**Residual risk (accepted / out of scope):**

1. `buildRollupWhere` treats `since: undefined` as bounded (`undefined !== null`) → NULL comparison → no rows. Latent sharp edge pre-dating 0630; all production callers pass explicit `since`/`until` via `toArtifactSelector`. Noted for a future hardening task, not patched here (R7 surgical scope).
2. Wider done-stage gates (`spur-check-new`, `test-cf`, `build`) judged at the done state per pipeline contract.

**Disposition: PASS — no blocking findings; proceed to verify.**

**Findings table:**

| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | (none — no blocking findings across all three dimensions) | n/a |
### References
- **Gap Analysis Report:** [docs/design/prototypes/gap_analysis.md](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/gap_analysis.md)
- **Original Design Prototype:** [docs/design/prototypes/spur-board-history.html](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/spur-board-history.html)
- **Prototype Logic & Styles:** `docs/design/prototypes/history-app.js`, `docs/design/prototypes/history-charts.js`, `docs/design/prototypes/history.css`
- **Parent Feature:** [docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md](file:///Users/robin/xprojects/spur-new/docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- **Preceding Tasks:** Task 0626 (Web UI), Task 0627 (Contracts), Task 0628 (Database queries), Task 0629 (Analytics benchmarks)
### History
- 2026-08-22T18:25:26.529Z todo → wip (system)
- 2026-08-22T18:25:44.061Z wip → testing (system)
- 2026-08-22T18:27:08.924Z testing → done (system)
