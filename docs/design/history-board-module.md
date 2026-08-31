---
doc: design/history-board-module
feature_id: E8
tasks: [0626, 0627, 0628, 0629, 0630, 0634, 0635, 0636, 0637, 0638]
owns: SURFACE + mechanism for the History Board module (conversation analytics, timeline, insights, and agent sources)
authority: derived (ADR wins on conflict)
updated_at: 2026-08-23
---

# History Board module — Conversation Analytics & Agent Forensic Plane

Feature **E8** introduces a dedicated `History` module in the Spur Board (`apps/web`) to explore, analyze, and troubleshoot coding agent execution history imported from raw JSONL transcripts across 9 supported agent roots into SQLite DB via `spur history`.

---

## 1. Prototype Reference Assets

The UI prototype has been fully implemented, styled, and verified using `open-design`. All source prototype assets are committed directly in the repository for offline, self-contained reference by coding agents:

- **HTML Skeleton & Markup:** [`docs/design/prototypes/history-module/spur-board-history.html`](prototypes/history-module/spur-board-history.html)
- **Theme & Stylesheet:** [`docs/design/prototypes/history-module/history.css`](prototypes/history-module/history.css)
- **App Controller & UI Interactions:** [`docs/design/prototypes/history-module/history-app.js`](prototypes/history-module/history-app.js)
- **Dual-Axis & SVG Chart Engines:** [`docs/design/prototypes/history-module/history-charts.js`](prototypes/history-module/history-charts.js)
- **Dataset Generators & Schema Models:** [`docs/design/prototypes/history-module/history-data.js`](prototypes/history-module/history-data.js)

---

## 2. Module Registration (`apps/web`)

The History module is auto-discovered via `apps/web/src/modules/history/index.tsx` exporting `WebModule`:

| Field | Value |
| :--- | :--- |
| `id` / `route` | `history` |
| `name` / `sidebarLabel` | `History` |
| `icon` | `📊` |
| `order` | `3` (alongside Tasks, Features, Teams) |

---

## 3. Tab Structure & Capabilities

The module contains 5 tabs with append-only stable IDs:

```ts
export const HISTORY_TABS = [
  { id: 'summary',  label: 'Summary' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'insights', label: 'Insights' },
  { id: 'sources',  label: 'Sources' },
] as const;
```

### 3.1 Tab 1: Summary

- **KPI Metrics (4 Cards):** Total Billed Tokens, Cache-Saved Tokens (with % share), Sessions Count, Tool Calls Count (with error rate).
- **Dual-Axis Time Series:**
  - **Left Y-Axis (Volume):** Stacked bar columns partitioned by active dimension (`By Model | By Source | By Tool | By Skill`).
  - **Right Y-Axis (Secondary):** Cyan neon line chart (`#22d3ee`) rendering Cache Hit Ratio (`0%–100%`).
- **Dynamic Bucket Granularity:** `Auto | 5m | 10m | 30m | 1h | 4h | 1d`. Range defaults: `1h` $\rightarrow$ 5m, `4h`/`24h` $\rightarrow$ 10m, `7d` $\rightarrow$ 30m, `30d`/`All` $\rightarrow$ 1d.
- **Breakdown Cards:** Top Models horizontal bars, Top Sources horizontal bars, Top Tools ranked table, Skills Used area chart, Cache Efficiency progress bar.

### 3.2 Tab 2: Timeline

- **Modes:** Single Session view (with session selector and prev/next buttons) vs Consolidated Mode (multi-agent cross-session event stream scoped to a task, run, or active filter).
- **Timeline Scrubber:** 96-bin interactive SVG activity histogram displaying event density across the time window with range slider controls.
- **Header & Navigation (Conversation):** Single panel titled `Conversation` containing mode toggle (`Single Session | Consolidated`), global `Expand all` / `Collapse all` button (`aria-pressed`), filter checkboxes (`Hide assistant`, `Hide unknown`, `Hide other empty`), native session selector (`<first8…last4> · <source> · <UTC month/day time> · <formatted token load>`), and bounded Previous/Next buttons.
- **Nine-Field Metadata Strip:** Ordered fields `SESSION`/`SESSIONS`, `AGENT`, `MODEL`, `STARTED`, `DURATION`, `TOTAL TOKENS` (`fresh + cache read + output`), `CACHE READ` (`cache / (fresh + cache) * 100`), `OUTPUT TOKENS`, and `TOOL CALLS`.
- **Honest Gutter Duration:** Gutter step duration evaluates strictly within each `(source, sessionId)`:
  - `measured`: finite positive imported duration (`⏱ 5.0s`, bold amber $\ge 5$s).
  - `inferred`: positive timestamp delta to the next event in the same session $\le 10$ minutes (`⏱ ~12s`).
  - `unmeasured`: gaps $> 10$ minutes, negative deltas, or missing next event (`⏱ —`).
- **User Prompt Cards:** 80% width (`w-[80%]`) card aligned to the right side (`flex justify-end`) with interactive `UserTokenBadge` popover (displaying prompt lines, characters, fresh input, cache read, output, and full turn load), prompt summary, and expandable verbatim dark monospace drawer (`#0d141f`).
- **Distinct Assistant vs Tool Cards:**
  - **Assistant Cards:** Left-aligned response cards displaying `AgentIcon`, model tag, output tokens, and message preview. No tool badges and no exit codes.
  - **Tool Cards:** Left-aligned action cards displaying `AgentIcon`, as-is tool tag (`glob`, `grep`, `edit`, `read`, `write`, `bash`, `search`, `run`), title, exit code (`EXIT_CODE=0` emerald / `EXIT_CODE=N` rose), and expandable verbatim drawer.
- **Verbatim Tool Payload Precedence:** Payloads prioritize raw error text $\rightarrow$ retained raw arguments $\rightarrow$ formatted multiline digest metadata $\rightarrow$ null (collapses drawer).
- **Consolidated Multi-Agent Traces:** Renders chronological multi-agent blocks carrying correlation exactness badges (`Exact` emerald / `Estimated` amber) and session markers. Truncation banner renders if stream exceeds 5,000 newest events.
- **Session Identity Extraction:** Canonical session IDs extracted from JSONL paths (`brain/<uuid>` for AGY, `rollout-*-<uuid>.jsonl` or `session_meta.payload.id` for Codex).

### 3.3 Tab 3: Sessions

- **Sortable DataTable:** Columns for Session ID, Agent, Model, Start Time, Duration, Messages, Tool Calls, Billed Tokens, Cache Read, Fresh Input, Top Tool, and State badge.
- **Navigation:** Clicking any row immediately switches to the `Timeline` tab scoped to that session.

### 3.4 Tab 4: Insights

- **Loop Detection:** Cards for repeated tool calls (same tool + args digest $\ge 3$ times), showing repeat count, sequence range, and wasted token estimate.
- **Cache Efficiency:** Cache hit ratio trend line and top cache-wasting steps table.
- **Cost Hotspots:** Top 5 heaviest sessions (horizontal bars) and top 5 largest token steps.
- **Top Time-Consuming Steps (`tbl-slowsteps`):** Ranked table of slowest execution steps with duration sparkbars, agent/model tags, and token telemetry.
- **Model Comparison:** 4-axis radar/spider chart comparing models across Speed, Cache ratio, Reliability, and Output ratio, paired with a datatable twin.

### 3.5 Tab 5: Sources

- **Overview Banner:** Total files, corpus size, date span, and total sessions.
- **Manual Action:** Interactive `Import & Analyze` trigger button (`#btn-run-import`) with sync spinning state.
- **9-Agent Activity Heatmaps:** Compact cards for Claude Code, Codex, Antigravity CLI, OMP, OpenClaw, Hermes, Grok Build, OpenCode, and Pi featuring 90-day daily token activity heatmaps and vector SVG brand icons.
- **Agent Summary Tooltip:** Hovering over an agent icon displays imported files, sessions count, total tokens, cache-saved tokens, tool calls, and first/last session date.
- **Source Directory Registry:** Table listing all 9 agent filesystem roots, match patterns, file counts, and status badges.
- **Filter Behavior:** Global filter bar is automatically hidden on the `Sources` tab to present the full all-time corpus.

---

## 4. API Seam & Contracts (`packages/contracts`)

All endpoints use strictly pure token accounting (zero currency/USD fields):

```ts
export const historyFilterSchema = z.object({
  range: z.enum(['1h', '4h', '24h', '7d', '30d', 'all', 'custom']).default('4h'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sources: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  bucket: z.enum(['auto', '5m', '10m', '30m', '1h', '4h', '1d']).default('auto'),
  dimension: z.enum(['model', 'source', 'tool', 'skill']).default('model'),
});
```

Endpoints:

1. `history.getSummary(filter)` $\rightarrow$ Summary KPIs, time buckets, breakdowns.
2. `POST history.getTimeline({ mode: 'session', source, sessionId } | { mode: 'consolidated', filter, taskWbs?, runId? })` $\rightarrow$ Source-safe session or bounded newest-5,000 multi-agent blocks with nullable duration source, prompt attribution, and correlation exactness.
3. `history.getSessions(filter, pagination, sort)` $\rightarrow$ Paginated, sortable session records.
4. `history.getInsights(filter)` $\rightarrow$ Loop findings, cache waste, slow steps, model comparison.
5. `history.getSources()` $\rightarrow$ Corpus summary, 9 agent sources, 90-day daily token matrices, directory registry.
6. `history.triggerImport({ mode })` $\rightarrow$ Asynchronous import & analysis execution receipt.

`history.getSummary` additionally returns the following additive telemetry:

| Field | Shape |
| :--- | :--- |
| `kpiTrend` | 30 daily `HistoryKpiTrendPoint` rows for KPI sparklines and cache-hit trend |
| `previousKpis` | `HistorySummaryKpis \| null`; null only when no bounded comparison window exists |
| `skillTimeSeries` | Bucketed `HistoryTimeSeriesPoint[]` projected on the skill dimension |

`history.getSources().overview.lastImportedAt` is a nullable ISO timestamp used by the global live-status chip.

`HistoryAgentSourceCard.sizeMb` is nullable: the live projection reports the SQLite corpus byte size
in `overview.corpusSizeBytes` and does not fabricate per-source raw-file sizes.

### 4.1 Live read path (`packages/domain` + `packages/app`)

`LiveHistoryBoardService` implements the six-procedure seam. It maps the board filter to the existing
`ArtifactSelector`, including `models`, `tools`, and `skills`; `apps/server` handlers only delegate.
The raw-query migration is `0020_spur_cli_history_board_query_indexes`:

| Index | Query path |
| :--- | :--- |
| `idx_history_message_session_id_seq` | Timeline session/sequence lookup |
| `idx_history_message_duration_rank` | Insights slow-step ranking |
| `idx_history_message_token_rank` | Insights token-step ranking |
| `idx_history_message_input_rank` | Insights cache-waste ranking |

`history.triggerImport` enqueues the existing `history.refresh` job with the requested `full` or
`incremental` import mode. The job runs `HistoryService.daily()`; no import runs in the request path.
Generic importer sentinels (`session_id = 'unknown' | 'session'`) retain their tokens in corpus-wide
aggregates but are excluded from navigable session rows, Timeline, and session-level loop findings.

### 4.2 Materialized read models (`0021_spur_cli_history_board_rollups`)

`HistoryService.analyze()` invokes `refreshHistoryRollups()`. The refresh is keyed by the aggregate
import checkpoint: an unchanged checkpoint is a no-op. `LiveHistoryBoardService` uses the following
tables only while `history_board_rollup_meta.history_version` matches the current projection version
and checkpoint, and falls back to the exact live queries when the read models are absent or stale.

---

## 4.3 Path corrections (task 0627/0628 refine, 2026-08-22)

Earlier revisions of this document named paths that do not exist in the tree. Corrected here so the
tasks and the doc agree:

| Named previously | Actual | Why |
| :--- | :--- | :--- |
| `packages/contracts/src/history/history.contracts.ts` | `packages/contracts/src/history.ts` | `packages/contracts/src` is flat |
| `apps/server/src/routes/history.ts` | `apps/server/src/modules/history/{index.ts,handlers.ts}` + `registry.ts` + `router.ts` | no `routes/` directory |
| `packages/domain/src/daos/history/` | extend `packages/domain/src/analytics/forensic-query.ts` | dir is `dao/` (singular) |
| `packages/domain/src/schema/history.ts` | `packages/domain/src/migrations.ts` | history DDL ships from `@gobing-ai/ts-llm-jsonl-importer` |

---

## 5. Workstream Mapping

| Task | Title | Surfaces | Implementation Reference |
| :--- | :--- | :--- | :--- |
| **0626** | Pure UI Implementation | `apps/web/src/modules/history/` | [`prototypes/history-module/`](prototypes/history-module/) |
| **0627** | oRPC Contracts & Mock Router | `packages/contracts/src/history.ts`, `apps/server/src/modules/history/` | Section 4 & `history-data.js` |
| **0628** | Live DB Access & Query Layer | `packages/domain/src/analytics/forensic-query.ts`, `packages/app/src/services/history-board-service.ts` | Extend the existing analytics queries; indexes via `migrations.ts` + `drizzle/` |
| **0629** | Analytics Pre-Computation | `packages/app/src/services/history-analysis-service.ts`, `packages/domain/src/analytics/history-board-rollup.ts`, `drizzle/0021_spur_cli_history_board_rollups.sql` | `HistoryService.analyze()` refresh; no CLI surface change |
| **0630** | Frontend Parity Refinement | `apps/web/src/modules/history/`, additive Summary/Sources telemetry above | Prototype parity, accessibility, and data-driven deltas/trends |
| **0634** | Timeline Tab Prototype-Parity Rebuild | `apps/web/src/modules/history/TimelineTab.tsx`, `HistoryShell.tsx` | Conversation skeleton header, nine-field metadata, 136px continuous rail, assistant block headers, prompt rows, and tool presentation map |
| **0635** | Timeline Tab Compact Antigravity-CLI Stream | `apps/web/src/modules/history/TimelineTab.tsx` | Compact single-line cards, Sources AgentIcon tooltips, as-is tool telemetry tooltips, USER prompt cards, and conversation item filters |
| **0636** | Timeline Tab Filter Defaults, 80% Alignment & Top-Layer Tooltips | `apps/web/src/modules/history/TimelineTab.tsx` | Default-checked filters, Hide other empty label, 80% width with right/left alignment, and z-50 unclipped tooltips |
| **0637** | Timeline Tab Prompt Token Tooltip & Redundant Tag Removal | `apps/web/src/modules/history/TimelineTab.tsx` | UserTokenBadge token breakdown tooltip, eliminate redundant USER badge, and single-line prompt row |
| **0638** | Honest & Consolidated History Timeline | contracts, domain analytics, app projection, observer, server, and Timeline UI | Discriminated POST seam; canonical AGY/Codex identity; authority-table correlation; measured/inferred/unmeasured duration; source-safe prompt telemetry; bounded scrubber and consolidated view |
