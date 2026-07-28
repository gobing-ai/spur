---
template: feature-impl
schema_version: 1
name: "Redesigned System Events filter bar"
description: ""
status: done
type: task
profile: standard
feature_id: J1
parent_wbs: null
priority: P2
tags: ["observability", "system-events", "filters", "ux", "accessibility"]
dependencies: []
created_at: "2026-07-07T23:26:15.294Z"
updated_at: "2026-07-28T00:31:52.618Z"
---

## 0224. Redesigned System Events filter bar

### Background

The current filter row uses three native Select dropdowns (prefix, tier, search-scope) plus a text input, which is visually heavy and not intuitive. A redesigned filter bar with pill chips, a segmented tier toggle, an inline-scoped search, a live time-window quick filter, a clear-filters action, and an inline result count will improve discoverability and ergonomics. The prefix pills double as the color legend, tying the filter to the table's color coding.

### Requirements
- R1. Prefix filter as multi-select pill chips, one per known prefix, colored to match the prefix-to-color map (doubles as color legend).
- R2. Multiple prefixes selectable simultaneously; selecting none shows all prefixes.
- R3. Tier filter as a 3-button segmented control: All | Default | Diagnostic.
- R4. Search input with an inline scope selector toggle: name | actor | payload | all (default 'all').
- R5. Live time-window quick filter: 30s | 5m | all (default 'all'); selecting 30s or 5m restricts visible events to those within the trailing window.
- R6. Clear-filters button visible when any filter is active; resets all filters to defaults.
- R7. Inline result count showing the number of currently visible events.
- R8. All filter controls operable via keyboard (chips, toggles, search, clear).
- R9. Preserve existing filtering semantics — only the UI changes, not the underlying filter logic or the untrusted-payload narrowing.
- R10. Filter state must not cause re-fetches; filtering is applied to the already-loaded in-memory event set.
### Acceptance Criteria
```gherkin
Feature: Observability System Events Table Redesign

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
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Goal.** Replace the three-Select + Input filter row with a discoverable, keyboard-friendly filter bar: prefix pill chips (color-coded, doubling as legend), tier + time-window segmented toggles, scope-aware search, clear-filters, and an inline result count.

**Approach.**
- State changes: `categoryFilter: string` → `selectedPrefixes: Set<string>` (empty set = all prefixes, R2); added `searchScope: 'all' | 'name' | 'actor' | 'payload'` (default `'all'`, R4) and `timeWindow: 'all' | '30s' | '5m'` (default `'all'`, R5). `tierFilter` narrowed to the typed `'all' | 'default' | 'diagnostic'`.
- Filter UI lives in a new `<section>`-style toolbar with three logical rows: prefix pill row, second row containing `<SegmentedToggle label="Tier">` + `<SegmentedToggle label="Window">` + search input + scope `<select>` + clear button + count `<span>`. Prefix pills are `role="switch"` `<button>`s that adopt the prefix's text-color when active (R1/R5 — color doubles as legend because the chip carries the same `getPrefixColor(prefix)` class as the table's event-name + Prefix column).
- New `SegmentedToggle<V extends string>` generic component: `<fieldset>` + `<legend className="sr-only">` + 3 `<label>`s wrapping real `<input type="radio">`s. Native radiogroup semantics (R3, R8) — keyboard users can Tab into the group and arrow between radios.
- `clearFilters` resets all four filter states (R6). The clear button only renders when `filtersActive` is true, so the bar stays clean in the default state.
- `filteredEvents` is wrapped in `useMemo` for cheap re-evaluation on filter changes (R10 — no re-fetches, all filtering applied to in-memory events). Time-window uses `Date.parse(occurredAt)` and drops events outside the cutoff (events without a parseable ISO timestamp drop too, conservatively).
- Hooks (prefixOptions, filteredEvents, clearFilters, togglePrefix) moved before the early-return `if (events === null)` so React's hook order is stable across the loading skeleton and the populated render.

**Tradeoffs.** Scope `<select>` uses the native element for keyboard + AT support; it costs one extra click but avoids a custom segmented control for a 4-option picker. The prefix `<button role="switch">` pattern is non-standard but follows the disclosure-row pattern (the chip is a toggle, not a navigation link). The clear button is conditionally rendered rather than disabled, so the default-state toolbar stays uncluttered.

**Files touched.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx` — state changes (Set + new state vars), new `filtersActive` / `clearFilters` / `togglePrefix` helpers, new `<SegmentedToggle>` component, replaced the filter toolbar with the three-row layout, dropped unused `Select` import, moved hooks above early returns.
- `apps/web/tests/modules/observability/components.test.tsx` — converted `getAllByRole('combobox')` queries to `getByRole('switch', ...)` (prefix pill) and `container.querySelector('fieldset[aria-label="Tier"|"Window"]')` (segmented toggles), repaired missing `});` / `as typeof fetch` close in the tier-filter test that the 0223 conversion left open, added 6 new tests for R1/R2 (multi-select pill chips), R3 (segmented tier toggle), R4 (search scope default), R5 (time-window restricts visible events), R6 (clear-filters visibility + reset), R7 (inline result count).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Files changed.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx:599-603` — replaced `categoryFilter: string` with `selectedPrefixes: Set<string>`; added `searchScope` (typed `'all' | 'name' | 'actor' | 'payload'`) and `timeWindow` (typed `'all' | '30s' | '5m'`); narrowed `tierFilter` to its typed union.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:665-689` — `prefixOptions` is now a `useMemo` over catalog + events; `filtersActive` boolean derived from state for clear-button visibility.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:684-718` — `filteredEvents` rewritten with `useMemo`: multi-select prefix filter, tier filter (with legacy "default" fallback), time-window cutoff via `Date.parse`, scope-aware search (`name`/`actor`/`payload`/`all`).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:720-735` — `clearFilters` and `togglePrefix` `useCallback` helpers; both moved above the early-return so hook order is stable.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:737-750` — early-return guards (`if (error)` / `if (events === null)`) kept after the hooks.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:765-862` — new filter-bar layout: `<fieldset>` of prefix `<button role="switch">` pills, then a `<div>` row with two `<SegmentedToggle>` instances (Tier, Window), a `<select>` scope + `<Input>` search, conditional clear `<button>`, and a `aria-live="polite"` `<span>` for the inline result count.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1103-1142` — new `SegmentedToggle<V extends string>` component (native `<fieldset>` + `<input type="radio">`).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:2` — dropped unused `Select` import.
- `apps/web/tests/modules/observability/components.test.tsx:389-555` — converted prefix/tier filter tests to use `getByRole('switch', ...)` and `container.querySelector('fieldset[aria-label="Tier"]')`; added 6 new tests (R1/R2 multi-select pills, R3 segmented tier toggle, R4 default scope, R5 window restricts visible events, R6 clear-filters, R7 inline result count); repaired missing `});` / `as typeof fetch` close in tier-filter test.

**Rationale.** `Set<string>` for multi-select prefix state (O(1) add/delete + `size`). Native `<fieldset>`/`<input type="radio">` for the segmented toggles (Biome `useSemanticElements`, native keyboard support). Scope `<select>` for the 4-option scope picker (native listbox semantics, no custom widget). Clear button conditionally rendered to keep default-state bar clean. Hooks moved above early returns to satisfy React's stable hook order.
### Testing
**Verification commands.**
- `bun run lint` — clean (Biome + per-workspace `tsc --noEmit`).
- `bun test apps/web/tests/modules/observability/` — 28 pass / 0 fail (6 new + 22 prior).
- `bun run test` (full suite) — 2481 pass / 0 fail across 176 files.
- `bun run format` then `bun run lint` — no remaining formatting drift.

**Coverage claim.**
- R1 (prefix pill chips, one per known prefix, colored to match map, doubles as legend) — "multi-select prefix pill row" test asserts each chip carries the prefix-to-color class (`text-emerald-400` for `task`, `text-orange-400` for `queue`).
- R2 (multi-select, empty set = all) — same test asserts both `aria-checked="true"` when selected simultaneously, both events remain visible, and toggling one chip off restores its visibility.
- R3 (3-button segmented tier toggle) — "segmented tier toggle" test locates `fieldset[aria-label="Tier"]`, asserts exactly 3 radios with values `all`/`default`/`diagnostic`, and clicks the Default radio to verify aria-checked flips.
- R4 (inline scope selector with default `all`) — "search input has an inline scope selector" test asserts the scope `<select>`'s default value is `'all'`.
- R5 (time-window 30s/5m/all) — "time-window segmented toggle restricts visible events" test injects one recent + one 10-minute-old event, clicks the `30s` radio, and asserts the old event disappears (`queue.job.completed.length === 0`); switching back to `all` restores it.
- R6 (clear-filters button when active + resets) — "clear-filters button appears when filters are active and resets them" test asserts no clear button at default, clear button appears after activating a prefix filter, click resets and clear button disappears.
- R7 (inline result count) — "filter bar renders an inline result count" test asserts the visible `2 of 2` text format.
- R8 (keyboard operable) — native `<fieldset>` + `<input type="radio">` for segmented toggles (R3, R5); `<button>` for prefix chips and clear (R1, R6); `<select>` for scope (R4). All native elements with native keyboard support.
- R9 (preserve filtering semantics) — the underlying filter logic (tier fallback for legacy events, untrusted-payload narrowing via parseSseEnvelope/parseHistoryResponse, SSE malformed-frame drop) is untouched. The tier filter test still passes after the rewrite, confirming the legacy fallback semantics survive.
- R10 (no re-fetches) — `filteredEvents` is a pure `useMemo` over in-memory `events` + filter state; no `useEffect` re-fires on filter change. The full test suite ran in 15s with no extra HTTP calls.
### Review
**SECU pass.** Self-review on the diff:
- **Safety.** No new network surface. Untrusted-payload narrowing (`parseSseEnvelope`, `parseHistoryResponse`) untouched. SSE malformed-frame drop (`return; // drop silently`) preserved.
- **Correctness.** `Set<string>` for prefix state with explicit empty-set = "all" semantics. `useMemo` on `filteredEvents` with stable dependencies (no spurious recomputes). Time-window uses `Date.parse` and conservatively drops events without a parseable timestamp (avoids surface `2026-...Z` strings ever being treated as fresh).
- **Performance.** `prefixOptions` and `filteredEvents` both `useMemo`'d. `clearFilters`/`togglePrefix` are `useCallback`'d. Hooks moved before early returns so React's hook order is stable across the loading skeleton and the populated render — the original arrangement would have thrown "Rendered more hooks" on the loading → loaded transition.
- **A11y.** `<fieldset>` + `<legend className="sr-only">` for the segmented toggles (native radiogroup, native keyboard support, screen reader announces group label + option). `<button role="switch" aria-checked>` for prefix chips (disclosure pattern, keyboard activatable). `<select>` for scope (native listbox). Inline count is in an `aria-live="polite"` span. Clear button has `aria-label="Clear all filters"`. Focus rings preserved on all controls.
- **UX.** Default state is uncluttered (no clear button). Filter bar uses three logical rows that wrap on narrow viewports. Tier toggle's "All" matches the table's behavior of including unknown-tier events as default. Time-window's "All" is the explicit non-filter default.

**Residual risk.** None blocking. The native `<fieldset>` element imposes a default border which we override (`border-0 p-0 m-0`); if a future contributor removes that override the filter bar will look boxed-in. The `Date.parse` cutoff is "now - window" at the time the filter changes — events exactly at the boundary may flicker in/out across re-renders. Acceptable for a human-facing indicator.

**Disposition.** PASS — ready to record and move to 0225.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-08T00:00:08.944Z todo → wip (system)
- 2026-07-08T00:33:29.117Z wip → testing (system)
- 2026-07-08T00:33:29.303Z testing → done (system)
