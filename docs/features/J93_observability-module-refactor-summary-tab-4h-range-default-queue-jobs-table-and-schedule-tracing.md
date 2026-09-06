---
schema_version: 1
id: "J93"
name: "Observability module refactor: Summary tab, 4h range default, queue_jobs table, and schedule tracing"
status: backlog
priority: P2
tags: []
created_at: "2026-09-06T21:37:11.496Z"
updated_at: "2026-09-06T21:39:13.711Z"
---

# J93: Observability module refactor: Summary tab, 4h range default, queue_jobs table, and schedule tracing

## Goal
Elevate the Observability board module to match the design caliber of the History module with a new Summary tab as the primary default view, a standardized 4h default time range, a truthful Jobs execution table queried directly from queue_jobs with server-computed timing and status filters, active cron schedule visibility, and a slide-over job detail drawer correlating lifecycle telemetry.
## Scope
- In:
  - Add a new `Summary` tab as the first and default tab in `apps/web/src/modules/observability/tabs.ts` (`id: 'summary'`).
  - Implement `SummaryTab.tsx` with top KPI cards (Total Events, In-flight Jobs, Success Rate, Error/Warning count), time-bucketed event prefix stacked area/column charts, severity breakdown, top event types table, and a recent failure feed.
  - Add server-side aggregation endpoint `GET /api/observability/summary` in `apps/server/src/modules/observability/index.ts` to compute KPI tallies and prefix time-buckets over `system_events` in SQL.
  - Add `4h` preset to `ObservabilityTimeRange` (`'30s' | '5m' | '1h' | '4h' | '24h' | '7d' | 'all'`) and set `4h` as the default time range across `ObservabilityShell.tsx` and `ObservabilityFilters.tsx`.
  - Redesign `JobsTab.tsx` to query persistent `queue_jobs` directly instead of replaying transient `system_events`.
  - Add server-side query endpoint `GET /api/jobs` in `apps/server/src/modules/jobs/index.ts` with server-side status filtering (`all`, `failed`, `running`, `completed`), time range filtering (`since`), pagination, and server-computed timing columns (`queuedAt`, `startedAt`, `endedAt`, `durationMs`).
  - Add server endpoint `GET /api/jobs/schedules` exposing registered built-in and configured cron jobs with next-fire timestamps and last run statuses, rendered as an Active Schedules overview card in `JobsTab.tsx`.
  - Implement a slide-over `JobDetailDrawer.tsx` keyed by `jobId` showing job metadata, formatted payload inspection, error stack, and the correlated `queue.job.*` event chain.
  - Surface status filter chips with count badges, inline `last_error` previews in the jobs table, and a retention policy badge in the filter/footer bar.
  - Preserve the `Routing` tab as-is without modification.
- Out:
  - Modifications to the `Routing` tab logic or its backend queries.
  - Destructive changes to SQLite database schemas (all changes use existing tables and indexes).
  - Web UI redesigns of unrelated modules (History, Features, Teams, Tasks).
## Acceptance Criteria
```gherkin
Feature: Observability module refactor: Summary tab, 4h range default, queue_jobs table, and schedule tracing

  Scenario: R1 — Summary tab as the first and default view
    Given the Observability board module is rendered
    When the module initializes without an active tab specified in the URL
    Then the active tab defaults to "Summary"
    And the tab order is "Summary", "System Events", "Jobs", and "Routing"

  Scenario: R2 — Summary tab KPI metrics and trend charts
    Given the Summary tab is open with a selected time range
    When the summary metrics load
    Then top KPI cards render for Total Events, Active In-Flight Jobs, Success Rate, and Error/Warning count
    And KPI cards display trend sparklines and period-over-period delta badges
    And a stacked area or column chart displays event volume bucketed over time grouped by event prefix
    And a severity distribution bar displays proportional info, warning, and error counts
    And a recent failure list allows one-click filtering in Jobs or System Events

  Scenario: R3 — 4h time range preset and module-wide default
    Given the Observability module controls
    When the time range selector renders
    Then presets include 30s, 5m, 1h, 4h, 24h, 7d, and all
    And 4h is selected as the default time range across all Observability tabs

  Scenario: R4 — Server-side observability summary aggregation endpoint
    Given persisted system events and queue jobs in SQLite
    When GET /api/observability/summary is requested with since and until parameters
    Then the server returns an aggregated JSON payload containing KPI totals, time-bucketed prefix distributions, and top event frequencies
    And all aggregations are calculated in SQL using indexed queries without returning raw event lists

  Scenario: R5 — Jobs tab queried directly from queue_jobs table
    Given the Jobs tab is selected
    When the tab loads job records
    Then jobs are fetched from the queue_jobs database table rather than reconstructed from system_events
    And job runs older than the system_events retention quota remain visible and searchable

  Scenario: R6 — Server-side jobs query endpoint with timing calculations and status filtering
    Given queue jobs in various lifecycle states
    When GET /api/jobs is requested with status or since query parameters
    Then the server returns newest-first queue job records with server-computed queuedAt, startedAt, endedAt, and durationMs
    And the endpoint supports filtering by status (pending, processing, completed, failed) and keyset or offset pagination

  Scenario: R7 — Active cron schedule visibility and next-fire calculation
    Given configured built-in and bootstrap scheduler jobs
    When GET /api/jobs/schedules is requested or the Jobs tab renders
    Then an Active Schedules overview displays registered job names, cron expressions, human-readable cadences, next-fire timestamps, and last execution status
    And next-fire times update accurately based on cron evaluation

  Scenario: R8 — Run detail drawer keyed by jobId with correlated event chain
    Given the Jobs tab table
    When the operator clicks a job row
    Then a slide-over detail drawer opens displaying job ID, status, attempts, execution duration, and formatted payload parameters
    And the drawer renders a chronological lifecycle timeline (enqueued, started, completed, or failed) queried from system_events by matching jobId
    And a link is provided to open the correlated events in the System Events tab

  Scenario: R9 — Status filter chips, inline error preview, and retention notice
    Given the Jobs tab controls and table
    When jobs are displayed
    Then status filter chips allow toggling between All, Failed, Running, and Completed with live item counts
    And rows with failed status display the last_error text inline with expandable details
    And a retention policy badge clarifies the pruning cutoff for events and terminal jobs

  Scenario: R10 — Routing tab preserved unchanged
    Given the Observability board module
    When the operator navigates to the Routing tab
    Then the routing attribution view and its backend queries function exactly as before without modification
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0789 | Observability backend data layer: summary aggregations, queue_jobs query, and schedule endpoints | todo |
| 0790 | Observability frontend shell: Summary tab registration, 4h default range, and retention badge | todo |
| 0791 | Observability Summary tab: KPI metrics, event volume trend charts, and error hotspots | todo |
| 0792 | Observability Jobs tab redesign: truthful queue_jobs table, active schedules card, and detail drawer | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
