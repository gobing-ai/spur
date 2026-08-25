---
schema_version: 1
id: "J92"
name: "Observability frontend enhancement: unified header, customizable table, and tab consolidation"
status: done
priority: P2
tags: []
created_at: "2026-08-24T06:17:40.546Z"
updated_at: "2026-08-25T00:41:34.374Z"
---

# J92: Observability frontend enhancement: unified header, customizable table, and tab consolidation

## Goal
Elevate the Observability module (`apps/web`) frontend to match the modern layout of the History module with a unified header, clean time-range selector and labelled action controls, consolidated high-signal tabs (`System Events`, redesigned `Jobs`, preserved `Routing`, dropping obsolete `Tasks` and `Tool Using`), customizable and sortable event table columns, and polished cell ergonomics.
## Scope
- In:
    - Unified module header in `ObservabilityShell.tsx`: container layout and maximum width (`max-w-[1600px] mx-auto w-full`) matching History module, icon (`📡`), title ("Observability"), subtitle ("System event streams, queue execution telemetry, and routing attribution"), live connection chip (`last event ...` / `live tail`), and tab switch buttons on the right.
    - Tab consolidation in `tabs.ts`:
        - Retain `System Events` (primary real-time SSE + SQLite historical telemetry log).
        - Redesign `Jobs` around current queue-state statistics plus a focused queue/scheduler event feed.
        - Drop obsolete `Tasks` tab (deprecated run list; workflows/tasks are now tracked on Task Kanban and System Events).
        - Drop obsolete `Tool Using` tab (deprecated token-ledger activity; now fully owned and analyzed by the History module).
        - Retain `Routing` tab as-is (do not alter its code or logic; preserved for a future dedicated enhancement cycle).
    - Clean filter and time-range selection bar:
        - Replace the cluttered 3-row filter bar in `SystemEventsTab.tsx` with a cohesive filter bar matching History module patterns.
        - Quick time-range presets (`30s`, `5m`, `1h`, `24h`, `7d`, `All`).
        - Labelled controls on the right: Columns disclosure (toggle column visibility), Filter disclosure (search scope, prefix multi-select, severity, tier, actor, runId), and Live pause/resume toggle.
    - Customizable and sortable table (`SystemEventsTable`):
        - Column visibility customization with persistent `localStorage` storage.
        - Default visible columns: `Time`, `Severity`, `Event`, `Summary`, `Correlation`, `Outcome` (with `Agent`, `Producer`, `Action`, `Actor` available as optional toggleable columns).
        - Value sorting across columns (Time, Severity, Event, Summary, Correlation, Agent, Outcome) with visual sort indicators (▲/▼).
        - Polished cell presentation: clean severity pills, monospace badges for correlators/agents/runs, readable relative/absolute timestamps, compact truncated text with hover tooltips, and copy buttons.
    - UI contract documentation: keep root `DESIGN.md` and `docs/design/observability-frontend-enhancement.md` aligned with the as-built layout, interactions, and backend boundaries.
- Out:
    - A bounded Custom date range until `/api/events/history` supports an indexed upper `until` bound.
    - Changes to the `Routing` tab implementation or its backend queries (kept untouched for its own upcoming milestone).
    - Modifications to backend event persistence or database schema (all changes use existing SQLite schemas and APIs).
    - Alterations to other modules (History, Teams, Features, Task Kanban).
## Acceptance Criteria
```gherkin
Feature: Observability frontend enhancement: unified header, customizable table, and tab consolidation

  Scenario: R1 — Unified module header and navigation
    Given the Observability board module is rendered
    When the operator views the module header
    Then the header uses the max-w-[1600px] mx-auto layout matching the History module
    And the left side displays an icon, the module title "Observability", subtitle, and an SSE liveness chip
    And the right side displays tab switch buttons in a pill container

  Scenario: R2 — Tab consolidation and legacy tab removal
    Given the Observability tab configuration
    When the tab list is loaded
    Then tabs for "Tasks" and "Tool Using" are removed from the tab strip
    And tabs for "System Events", "Jobs", and "Routing" remain present
    And the "Routing" tab component and behavior are preserved unchanged

  Scenario: R3 — Time-range selector and action button bar
    Given the System Events tab view
    When the controls bar is displayed
    Then a time-range selector provides presets including 30s, 5m, 1h, 24h, 7d, and All
    And labelled controls at the right provide column selection, filter toggling, and live stream pause/resume

  Scenario: R4 — Customizable column visibility with persistence
    Given the System Events table
    When the operator toggles column visibility in the column selection dropdown
    Then only checked columns are rendered in the table header and body rows
    And the chosen column visibility configuration is persisted across page reloads

  Scenario: R5 — Default column composition
    Given default settings with no saved column preferences
    When the System Events table renders
    Then the default visible columns are Time, Severity, Event, Summary, Correlation, and Outcome
    And Agent, Producer, Action, and Actor are available as toggleable optional columns

  Scenario: R6 — Column value sorting
    Given loaded System Events rows
    When the operator clicks a sortable column header
    Then the rows are sorted ascending or descending by that column value
    And a visual sort direction arrow is displayed on the active column header

  Scenario: R7 — Cell visual formatting and ergonomics
    Given System Events table cells
    When values are rendered
    Then Severity displays a distinct colored status badge
    And technical IDs and event names use monospace font with color-coded prefix tags
    And long summaries truncate with full content accessible via hover tooltip or expanded detail
    And correlators and event names support one-click copy

  Scenario: R8 — Redesigned Jobs tab
    Given the Jobs tab is selected
    When the tab renders
    Then it displays responsive Pending, Processing, Completed, and Failed cards labelled as current queue state
    And it displays a focused newest-first feed containing queue job threads and scheduler events
    And the selected time range bounds the event feed while KPI values remain current queue aggregates

  Scenario: R9 — Responsive table layout
    Given a narrow viewport below 640px
    When the System Events table is displayed
    Then the layout collapses to compact Time and Event columns with secondary fields accessible in expandable detail
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0651 | Observability shell layout alignment: unified module header, live status chip, and tab consolidation | done |
| 0652 | Observability filter and time-range bar: quick presets, popover filters, and action controls | done |
| 0653 | System Events table enhancement: customizable columns, value sorting, and cell presentation refinement | done |
| 0654 | Jobs tab visual redesign: queue and scheduler execution metrics with focused telemetry feed | done |
| 0656 | Prevent System Events overscroll from displacing the Board viewport | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-24T16:05:26.533Z backlog → active (system)
- 2026-08-24T16:05:26.787Z active → verifying (system)
- 2026-08-24T16:05:27.021Z verifying → done (system)
- 2026-08-25T00:14:01.002Z done → active (system)
- 2026-08-25T00:41:34.046Z active → verifying (system)
- 2026-08-25T00:41:34.374Z verifying → done (system)
