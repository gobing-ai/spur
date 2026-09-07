---
schema_version: 1
name: Align Observabilities header and hoist the time-range selector to the shell for all tabs
status: todo
template: feature-impl
created_at: 2026-09-07T03:53:27.191Z
updated_at: "2026-09-07T03:53:27.197Z"
feature_id: J31
priority: P2

---

## 0793. Align Observabilities header and hoist the time-range selector to the shell for all tabs

### Background

Covers feature J31 scenarios R1–R4. The module header reads `Observability` while the sidebar label is `Observabilities` (`apps/web/src/modules/observability/index.tsx:18`). The time-range selector lives inside System Events (`ObservabilityFilters`), yet `ObservabilityShell` already owns `timeRange` state and passes it to every tab; RoutingTab ignores the prop while `GET /api/observability/routing-summary` already accepts `since`/`until` (`apps/server/src/modules/observability/index.ts:216`). The History module demonstrates the target pattern: `HistoryShell` owns filter state and renders the filter bar for every tab.

### Requirements

R1. Module header title reads `Observabilities`, byte-identical to the sidebar label.
R2. The time-range selector renders in the shell header and stays visible across Summary, System Events, Jobs, and Routing tab switches; the selection persists across switches.
R3. Every tab's server query carries a `since` window derived from the selected range; RoutingTab passes it to `routing-summary`.
R4. The `all` range sends no `since` bound.

### Acceptance Criteria

```gherkin
Scenario: R1 — Module header matches the sidebar label
  Given the Observabilities module is open on the Board
  When the module header renders
  Then the header title reads "Observabilities"
  And it matches the sidebar menu label exactly

Scenario: R2 — The time-range selector renders for every tab
  Given the Observabilities module is open
  When the operator switches between the Summary, System Events, Jobs, and Routing tabs
  Then the time-range selector stays visible on every tab
  And the selected range persists across tab switches

Scenario: R3 — Every tab's data queries honor the selected time range
  Given a time range is selected in the shell
  When any tab loads or refreshes its data
  Then that tab's server query carries a since window derived from the selected range
  And the Routing tab passes the derived since to the routing-summary endpoint

Scenario: R4 — The "all" range sends no since bound
  Given the "all" time range is selected
  When a tab queries its data
  Then no since parameter is sent
  And the full retained history is eligible for the result
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

D1: one-line header change in `ObservabilityShell.tsx`. D2 (satellite `docs/design/observabilities-module-polish.md`): extract the `TIME_RANGES` preset chip group from `ObservabilityFilters` into a shell-level control rendered in `ObservabilityShell`'s header row beside the tab strip, bound to the shell's existing `timeRange` state; `SystemEventsTab` drops its range chips and keeps the remaining filters; `RoutingTab` consumes the existing `timeRange` prop and passes `timeRangeSince(timeRange)` as `since` on its fetch (`undefined` for `all`). No server or contract change.

### Plan

1. Rename the header in ObservabilityShell.tsx. 2. Extract the preset chip group into a shell-level control; render it in ObservabilityShell. 3. Remove the chips from ObservabilityFilters/SystemEventsTab. 4. Wire RoutingTab's fetch to `timeRangeSince(timeRange)`. 5. Extend/refresh the observability module tests (shell exact-list test, RoutingTab fetch test) and run the web test suite.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
