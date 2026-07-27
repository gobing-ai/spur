---
schema_version: 1
id: "K"
name: "Observability System Events Table Redesign"
status: done
priority: P2
tags: []
created_at: "2026-07-07T23:15:49.635Z"
updated_at: "2026-07-25T19:33:17.564Z"
---

# K: Observability System Events Table Redesign

## Goal
Redesign the Observability > System Events tab from a card list to a dense, accessible table with a liveness status strip, color-coded event names by prefix, expandable row details reusing existing typed renderers, and a redesigned intuitive filter bar. Preserve all existing runtime behavior (HISTORY_LIMIT, cap-and-prune, SSE malformed-frame drop, untrusted-payload narrowing, endpoint contracts).

## Scope
Liveness status strip (SSE connection pulse, rolling events/60s rate, N of M shown); card list to dense table view (Time, Event, Actor, Prefix, Tier, sticky header, compact rows, expandable row detail); color-coded event names via stable prefix-to-color map; tooltip on event name hover/focus showing compact typed detail summary; expandable row detail reusing existing EventDetails renderers and RawPayloadView; filter redesign with prefix multi-select pill chips, tier segmented toggle, search with inline scope selector, live time-window quick filter, clear-filters action, and inline result count; WCAG keyboard accessibility and responsive collapse under 640px. Out of scope: changes to /api/events/history or /api/events/planning endpoints, server-side cap-and-prune or HISTORY_LIMIT changes, new event types or catalog expansion, and server-side event bus changes.

## Acceptance Criteria
```gherkin
Feature: Observability System Events Table Redesign

  # ── Liveness status strip ──

  Scenario: SSE connection state is visible in the header
    Given the System Events tab is open
    When the operator views the header bar
    Then a connection indicator shows one of: live (green pulse), connecting (gray), or errored (red)
    And the indicator sits immediately after the "newest first · live tail" label

  Scenario: Rolling event rate is displayed
    Given the SSE tail is connected and receiving events
    When the header is rendered
    Then the header shows a rolling "N events / 60s" rate updated every second
    And the rate reflects events received in the trailing 60-second window, not a cumulative total

  Scenario: Filtered count is shown
    Given filters are applied that reduce the visible set
    When the header renders the count
    Then the header shows "N of M shown" where N is the filtered count and M is the total loaded

  # ── Table view ──

  Scenario: Events render as a dense table
    Given the System Events tab has events loaded
    When the events are rendered
    Then events display in a table with columns: Time | Event | Actor | Prefix | Tier
    And row height is compact (approximately 28px) so at least 20 rows are visible without scroll
    And the table header is sticky on vertical scroll

  Scenario: Event names are color-coded by prefix
    Given events from multiple prefixes (workflow, task, agent, rule, message, process, queue, bus, api)
    When the events are rendered
    Then each event name is rendered in a color determined by a stable prefix-to-color map
    And the prefix label text is always rendered alongside the color (color is never the only signal)
    And unknown prefixes fall back to a neutral color

  Scenario: Row expand reveals full event details
    Given a table row is displayed
    When the operator clicks the row or focuses it and presses Enter
    Then the row expands to reveal the typed EventDetails renderer output and the RawPayloadView
    And pressing Enter or Space toggles the expansion via keyboard

  Scenario: Tooltip shows compact typed detail summary on hover and focus
    Given a table row event name is displayed
    When the operator hovers over or keyboard-focuses the event name
    Then a tooltip shows a compact 3-to-4 field summary from the active EventDetails renderer
    And the tooltip does not show raw JSON (raw JSON remains in the expandable row)
    And the tooltip is capped so it never overflows the viewport

  # ── Filter redesign ──

  Scenario: Prefix filter uses multi-select pill chips
    Given the filter bar is displayed
    When the operator views the prefix control
    Then prefix filtering is presented as clickable pill chips, one per known prefix
    And each chip is colored to match the prefix-to-color map, doubling as a color legend
    And multiple prefixes can be selected simultaneously
    And selecting no chips shows all prefixes

  Scenario: Tier filter uses a segmented toggle
    Given the filter bar is displayed
    When the operator views the tier control
    Then the tier filter is a 3-button segmented control: All | Default | Diagnostic
    And selecting a tier filters the visible events accordingly

  Scenario: Search input has an inline scope selector
    Given the filter bar is displayed
    When the operator views the search input
    Then the search input has an inline scope toggle with options: name | actor | payload | all
    And the default scope is "all"
    And the search filters events based on the selected scope

  Scenario: Live time-window quick filter
    Given the filter bar is displayed
    When the operator views the time-window control
    Then a time-window quick filter offers: 30s | 5m | all
    And the default selection is "all"
    And selecting 30s or 5m restricts visible events to those occurred within the trailing window

  Scenario: Clear-filters action and result count
    Given one or more filters are active
    When the operator views the filter bar
    Then a "Clear" button is visible and resets all filters to their defaults
    And an inline result count shows the number of currently visible events

  # ── Accessibility and responsive ──

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

  # ── Preservation of existing behavior ──

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

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
_No linked tasks._
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-07-25T19:33:17.100Z backlog → active (system)
- 2026-07-25T19:33:17.331Z active → verifying (system)
- 2026-07-25T19:33:17.564Z verifying → done (system)
