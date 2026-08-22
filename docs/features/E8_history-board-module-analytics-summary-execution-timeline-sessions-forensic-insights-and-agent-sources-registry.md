---
schema_version: 1
id: "E8"
name: "History Board module: Analytics Summary, Execution Timeline, Sessions, Forensic Insights, and Agent Sources Registry"
status: done
priority: P2
tags: []
created_at: "2026-08-21T23:12:38.032Z"
updated_at: "2026-08-22T03:42:14.505Z"
---

# E8: History Board module: Analytics Summary, Execution Timeline, Sessions, Forensic Insights, and Agent Sources Registry

## Goal
Provide a comprehensive, local-first History module in the Spur Board (`apps/web`) to visualize, analyze, and troubleshoot coding agent conversation history imported from raw JSONL transcripts into SQLite DB via `spur history`. Enables operators and developers to understand execution processes, track pure token and cache efficiency across dynamic time buckets, inspect chronological session skeletons, detect execution loops and high-latency bottlenecks, and audit all supported coding agent source repositories.

The module consists of 5 dedicated tabs:
1. **Summary**: High-level execution metrics, dual-axis stacked token consumption & cache-hit ratio charts with dynamic time-bucket granularity (`5m` to `1d`), model/source/tool/skill breakdowns, and efficiency indicators.
2. **Timeline**: Chronological session skeleton displaying user prompts, tool calls, command runs (with exit codes), file edits, latency durations, and input/cache/output token telemetry, explicitly tagged with Coding Agent & Model identifiers.
3. **Sessions**: Sortable, filterable session explorer table with token breakdowns and click-through deep links into the Timeline view.
4. **Insights**: Automated forensic findings including repeat loop detection, cache waste hotspots, heaviest sessions, largest token steps, top time-consuming steps (`tbl-slowsteps`), and multi-dimensional model comparison radar chart.
5. **Sources**: System-wide conversation history overview across 9 supported coding agents (Claude Code, Codex, Antigravity CLI, OMP, OpenClaw, Hermes, Grok Build, OpenCode, Pi) featuring 90-day daily token activity heatmaps (GitHub-style calendar skyline), agent summary tooltips, filesystem import root registry, and a manual `Import & Analyze` trigger button.
## Scope
- In:
    - **Frontend (`apps/web`)**:
        - Single-page tabview navigation with 5 tabs: `Summary`, `Timeline`, `Sessions`, `Insights`, `Sources`.
        - Multi-dimensional global filter bar with presets (`24h`, `7d`, `30d`, `All`), custom calendar date picker, multi-select for Coding Agent Sources, searchable multi-select for Models, multi-select for Tools/Skills, and dismissible active filter chips.
        - Automatic filter bar hiding on `Sources` tab to present all-time system history.
        - Dynamic time-bucket granularity selector (`Auto`, `5m`, `10m`, `30m`, `1h`, `4h`, `1d`) for stacked token consumption bars.
        - Secondary right Y-axis (`0%–100%`) overlay line for Cache Hit Ratio (`#22d3ee`).
        - Timeline event stream with Coding Agent and Model badges, duration metrics, tool input/cache/output tokens, and expanded inspection.
        - Insights panel with loop detection cards, cache waste table, heaviest sessions, largest token steps, top time-consuming steps table (`tbl-slowsteps`), and model comparison radar chart + table twin.
        - Sources panel with 9 coding agent activity heatmap cards (90-day daily token skyline with hover tooltips), summary popovers on agent icons, source directory registry table, and manual `Import & Analyze` trigger button.
    - **oRPC Seam (`packages/contracts`, `apps/server`, `packages/app`)**:
        - Typed contracts and server routers for `history.getSummary`, `history.getTimeline`, `history.getSessions`, `history.getInsights`, `history.getSources`, and `history.triggerImport`.
        - Clean DTOs strictly using pure token accounting (`billedTokens`, `cacheSavedTokens`, `cacheReadTokens`, `freshInputTokens`, `outputTokens`) with zero currency references.
    - **Database & Domain (`packages/domain`)**:
        - SQLite schema extensions and indexes for fast time-series aggregation, timeline event filtering, and session querying.
        - DAOs for pre-aggregated daily token activity, session lists, step latency ranking, and loop pattern queries.
    - **CLI & Pre-computation (`apps/cli`, `packages/app`)**:
        - Enhanced `spur history analyze` command to compute forensic derived variables (loops, cache efficiency, slowest steps) and index daily summary rollups for instant API responses.
- Out:
    - Dollar / USD currency cost calculation (pure token metrics only).
    - Remote/cloud multi-tenant sync (SQLite database remains local-first).
    - Modification of raw transcript files (read-only ingestion via `spur history import`).
## Acceptance Criteria
```gherkin
Feature: History Board module: Analytics Summary, Execution Timeline, Sessions, Forensic Insights, and Agent Sources Registry

  Scenario: Summary tab displays KPIs, dynamic time-bucketed token chart, and dual-axis cache hit ratio
    Given imported conversation history exists in SQLite database
    When an operator navigates to the History Summary tab
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

  Scenario: oRPC contracts and DB query performance
    Given client requests to History oRPC endpoints
    When queries for summary, timeline, sessions, insights, or sources are dispatched
    Then responses are returned within <50ms without blocking the server event loop
    And zero dollar/currency cost fields exist in the DTO schema (pure token accounting)
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0626 | History Board web module: 5-tab UI implementation with Astro, SVG charts, and interactive controls | done |
| 0627 | History Board oRPC API contracts, mock router, and DTO seam | done |
| 0628 | History database access: schema optimization, domain DAOs, and live oRPC service implementation | done |
| 0629 | History analytics pre-computation: enhance spur history analyze and import pipeline | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-22T03:42:13.683Z backlog → active (system)
- 2026-08-22T03:42:14.092Z active → verifying (system)
- 2026-08-22T03:42:14.505Z verifying → done (system)
