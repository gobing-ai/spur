---
template: feature-impl
schema_version: 1
name: "Responsive layout and WCAG compliance for System Events table"
description: ""
status: wip
type: task
profile: standard
feature_id: K
parent_wbs: null
priority: P2
tags: ["observability", "system-events", "responsive", "wcag", "accessibility"]
dependencies: []
created_at: "2026-07-07T23:26:15.295Z"
updated_at: "2026-07-08T00:33:44.269Z"
---

## 0225. Responsive layout and WCAG compliance for System Events table

### Background

The redesigned table must remain usable on narrow viewports and must meet WCAG 2.2 AA for keyboard accessibility, focus management, and color contrast. The table must collapse to a 2-column stacked layout under 640px, and all interactive elements (chips, toggles, row expand, tooltip) must be operable via keyboard. This task cross-cuts the liveness strip, table, and filter bar tasks.

### Requirements
- R1. Table collapses to a 2-column stacked layout (Time | Event+Actor stacked) under 640px viewport width with no horizontal scroll.
- R2. Tooltip is keyboard-triggerable via focus on the event name, not only on hover.
- R3. Row expansion works via Enter and Space keys.
- R4. All filter chips, segmented toggles, search input, and clear button are operable via keyboard with visible focus indicators.
- R5. Color is never the only signal in the table, filter pills, or liveness strip — text labels always accompany color.
- R6. aria-live='polite' region for rate/count changes in the liveness strip.
- R7. Expandable row uses button semantics (aria-expanded) so screen readers announce state.
- R8. No new color contrast violations against WCAG 2.2 AA (verify with axe or equivalent).
- R9. Preserve all existing behavior: HISTORY_LIMIT, untrusted-payload narrowing, SSE malformed-frame drop, endpoint contracts.
### Acceptance Criteria
```gherkin
Feature: Observability System Events Table Redesign

  Scenario: Keyboard accessibility
    Given the operator navigates the table via keyboard
    When the operator focuses a row or event name
    Then the tooltip is triggerable via focus, not only hover
    And row expansion works via Enter or Space
    And the filter chips and toggles are operable via keyboard

  Scenario: Responsive collapse under 640px
    Given the viewport width is less than 640px
    When the table renders
    Then the table collapses to a 2-column stacked layout: Time | (Event + Actor stacked)
    And no horizontal scroll is introduced

  Scenario: History limit and cap-and-prune preserved
    Given events are loaded from /api/events/history
    When the client applies the history cap
    Then the HISTORY_LIMIT of 100 cap-and-prune contract remains in effect
    And the initial fetch and SSE append behavior is unchanged

  Scenario: Untrusted payload narrowing preserved
    Given events with untrusted payloads arrive via SSE
    When the client processes each frame
    Then the existing runtime narrowing of untrusted payload fields is preserved
    And malformed SSE frames are dropped as before

  Scenario: Existing endpoints unchanged
    Given the System Events tab fetches data
    When the client calls the backend
    Then the existing /api/events/history and /api/events/planning endpoints are used without modification
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-08T00:33:44.269Z todo → wip (system)
