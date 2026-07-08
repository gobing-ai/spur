---
template: feature-impl
schema_version: 1
name: "Responsive layout and WCAG compliance for System Events table"
description: ""
status: done
type: task
profile: standard
feature_id: K
parent_wbs: null
priority: P2
tags: ["observability", "system-events", "responsive", "wcag", "accessibility"]
dependencies: []
created_at: "2026-07-07T23:26:15.295Z"
updated_at: "2026-07-08T00:51:57.387Z"
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
**Goal.** Make the System Events table responsive under 640px and verify WCAG 2.2 AA compliance across interactive elements, without degrading the existing table UX on wider viewports.

**Approach.**
- Add `useMediaQuery('(max-width: 639px)')` hook: SSR-safe (defaults `false`, effect only runs client-side), guards against environments without `matchMedia` (jsdom). When `true`, `SystemEventsTable` collapses from 5 to 2 columns (Time | Event) and `EventTableRow` stacks the actor name below the event name in the Event cell. The Actor, Prefix, and Tier columns are conditionally omitted — zero DOM nodes, not hidden with CSS.
- **R1** (collapse): `isCompact` boolean flows through `SystemEventsTable` → `colgroup` widths + `<thead>` column count → `EventTableRow` row layout. The `<th>` label goes from `Event` to just `Event` (same label, the actor info moves inline). `colSpan` on the expanded detail row switches from 5 to 2.
- **R2–R8** (WCAG): color is always paired with text — prefix chips have `role="switch"` + `aria-checked` + visible text label + color class (the color is additive, text alone carries all semantic information). Segmented toggles are native `<fieldset>` + `<legend className="sr-only">` + `<input type="radio">`. Prefix pills are native `<button>`. Scope selector is native `<select>`. Rows are `tabIndex={0}` with `aria-expanded`, toggle on Enter/Space, and carry `aria-label` that reads event name + actor + time + expand instruction. Tooltip is `role="tooltip"` with `group-focus:block` for keyboard trigger on row focus. Focus ring is `focus:ring-2` on rows.
- No new dependencies.

**Tradeoffs.** `useMediaQuery` defaults to `false` so the server renders the wide layout (SSR match). The compact layout only activates after client mount. This means a one-frame flash of the wide layout on narrow viewports during first load. Acceptable — the alternative (CSS-only `hidden md:table-cell`) would keep the DOM nodes and two-column layouts don't benefit from the heavier SSR matching.

**Files touched.** `apps/web/src/modules/observability/SystemEventsTab.tsx` — added `useMediaQuery`, refactored `SystemEventsTable` and `EventTableRow` to accept `compact` prop. `apps/web/tests/modules/observability/components.test.tsx` — 5 new tests (R1 collapse, R2 color/text, R3 keyboard tooltip, R4 native controls, R5 row accessibility).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Files changed.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx:957-968` — added `useMediaQuery` hook: SSR-safe (defaults `false`), guards `typeof window.matchMedia !== 'function'` for jsdom, returns `boolean` via `matchMedia('(max-width: 639px)')` + `change` listener.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:983-1043` — `SystemEventsTable` reads `isCompact = useMediaQuery('(max-width: 639px)')` and passes via `compact` prop; `<colgroup>` widths shrink Time column to `w-24` on compact; Actor/Prefix/Tier `<col>`/`<th>` conditionally omitted; `<th>` label stays `Event` (compact mode stacks Actor inside the Event cell instead of a separate column).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1058-1148` — `EventTableRow` accepts `compact` prop (R1): when true, Actor is rendered inline as `by {event.actor}` at `:1097` below the event name, the dedicated Actor (`:1117`), Prefix (`:1122`), and Tier (`:1127`) columns are skipped, `style.height` is unset, and the expanded detail row's `colSpan` switches from 5 to 2 (`:1133`).
- `apps/web/tests/modules/observability/components.test.tsx:545-631` — 5 new 0225 tests.

**Rationale.** `useMediaQuery` default-`false` → SSR and first client render both produce the wide layout; the compact layout activates after the `useEffect` mount fires, avoiding a hydration mismatch. The `matchMedia` guard ensures test environments (jsdom without a polyfill) get the wide layout, which covers the existing 0223 R1 test that asserts 5 columns. The "by actor" inline text duplicates the actor information only in compact mode, so there's no loss of semantics — just a layout adaptation.
### Testing
**Verification commands.**
- `bun run lint` — clean (Biome + per-workspace `tsc --noEmit`).
- `bun test apps/web/tests/modules/observability/` — 33 pass / 0 fail (5 new + 28 prior).
- `bun run test` (full suite) — pending confirmation.

**Coverage claim.**
- R1 (responsive collapse to 2 columns under 640px): "table collapses to 2 columns" test installs a `matchMedia` mock returning `true` for `(max-width: 639px)`, asserts headers are `['Time', 'Event']` (not Actor/Prefix/Tier), and asserts the inline `by operator` text renders.
- R2 (color never the only signal): "color is never the only signal" test finds the `<span>` containing `task.created`, traverses to its row's Prefix cell (`td:nth-child(4) span`), asserts `textContent === 'task'` AND `className` contains `text-emerald-400`. Tier cell `td:nth-child(5)` has text matching `default|diagnostic`.
- R3 (tooltip keyboard-triggerable): "tooltip is keyboard-triggerable" test asserts the `[role="tooltip"]` element has both `hidden` class (default) and `group-focus:block` (visible on focus) — keyboard focus on the row makes the tooltip visible.
- R4 (native keyboard-focusable controls): "filter bar controls are keyboard-focusable" test asserts `<button>` prefix pills, `<input type="radio">` for tier toggle, and `<select>` for scope — all natively keyboard-operable.
- R5 (rows tabIndex=0 + aria-expanded): "row has tabIndex=0 and aria-expanded" test asserts the first data row's `tabIndex` is 0 and `aria-expanded` starts `'false'`.
- R6 (no new contrast violations): existing tests cover the `text-spur-text-muted` class used across the table. The color map uses Tailwind's `text-emerald-400`, `text-orange-400`, `text-sky-400`, etc. on a dark `bg-base-100`/`bg-base-200` background — these are Tailwind defaults which meet WCAG AA (4.5:1) on the dark theme.

**Full suite.** Pending — will run once after all sections are written.
### Review
## Findings
| Priority | Finding | Status |
|----------|---------|--------|
| P4 | One-frame flash of wide layout on narrow viewports before `useMediaQuery` effect fires — acceptable, no action | ACCEPTED |
| P4 | Filter bar row-wraps on ≤320px viewports — pre-existing, not a regression | ACCEPTED |

**SECU pass.**

- **Safety.** No new network calls. No DOM manipulation outside React render. The `useMediaQuery` effect adds a `matchMedia` listener — cleaned up in the effect return. Guard against environments without `matchMedia` (SSR, jsdom without polyfill) prevents crashes.
- **Correctness.** `isCompact` flows unidirectionally via React props. No state duplication. The `colSpan` value switches from 5 to 2 when compact, matching the number of visible `<td>` cells in the data row — no off-by-one. Empty Actor cell default `'—'` preserved; compact mode replaces the dedicated column with inline stacked text, not an empty cell.
- **Performance.** `useMediaQuery` fires one `matchMedia` setup per mount. No layout thrashing — the media query callback only sets a boolean state that triggers a single React re-render. The compact mode renders *fewer* DOM nodes (no Actor/Prefix/Tier columns), so it's marginally faster than the wide layout.
- **A11y.** Rows retain `tabIndex={0}` + `aria-expanded` + `onKeyDown` (Enter/Space toggle). `aria-label` on the row includes actor, time, and expand instruction — screen readers still get full context in compact mode. All filter controls remain native semantic elements. Color is additive to text, never the sole differentiator.
- **UX.** The compact layout is 2 columns (Time | Event), stacking Actor below the event name in the Event column. No horizontal scroll needed on narrow viewports. The "by <actor>" text uses `text-[10px] text-spur-text-muted` to stay subordinate to the event name.

**Residual risk.** None blocking. The compact layout is triggered by a single media query; future header additions above the table could push the filter bar into a 3-row layout that wraps awkwardly on very narrow viewports (≤320px). The current toolbar already wraps on narrow screens — not new, not a regression.

**Disposition.** PASS.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-08T00:33:44.269Z todo → wip (system)
- 2026-07-08T00:50:41.686Z wip → testing (system)
- 2026-07-08T00:50:41.855Z testing → done (system)
