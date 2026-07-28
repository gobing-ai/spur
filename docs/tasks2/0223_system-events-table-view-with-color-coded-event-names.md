---
template: feature-impl
schema_version: 1
name: "System Events table view with color-coded event names"
description: ""
status: done
type: task
profile: standard
feature_id: J1
parent_wbs: null
priority: P2
tags: ["observability", "system-events", "table", "color-coding", "accessibility"]
dependencies: []
created_at: "2026-07-07T23:26:15.293Z"
updated_at: "2026-07-28T00:31:55.684Z"
---

## 0223. System Events table view with color-coded event names

### Background

Events currently render as a vertical card list with limited density (fewer than 10 events visible without scroll). A dense table view with columns Time | Event | Actor | Prefix | Tier enables at least 20 rows visible without scroll. Event names need color coding by prefix so operators can visually cluster event sources, but color must never be the only signal (WCAG).

### Requirements
- R1. Render events in a table with columns: Time | Event | Actor | Prefix | Tier, replacing the card list.
- R2. Compact row height (~28px) so at least 20 rows are visible without scroll on a standard viewport.
- R3. Sticky table header on vertical scroll.
- R4. Event name color determined by a stable prefix-to-tailwind-color map (workflow, task, agent, rule, message, process, queue, bus, api — each maps to a fixed tailwind text color class).
- R5. Prefix label text always rendered alongside the color (color is never the only signal).
- R6. Unknown prefixes fall back to a neutral color.
- R7. Row is expandable via click or Enter/Space keyboard activation to reveal the existing EventDetails renderer output and RawPayloadView.
- R8. Tooltip on event-name hover/focus shows a compact 3-to-4 field summary from the active EventDetails renderer (not raw JSON); tooltip is capped to never overflow the viewport.
- R9. Preserve all existing typed detail renderers (DETAIL_RENDERERS map) and RawPayloadView — reuse, do not duplicate.
- R10. Preserve HISTORY_LIMIT cap-and-prune, untrusted-payload runtime narrowing, and SSE malformed-frame drop behavior.
### Acceptance Criteria
```gherkin
Feature: Observability System Events Table Redesign

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
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Goal.** Replace the per-row card list with a dense, sortable-by-eye table; color event names by stable prefix; add hover/focus tooltips with typed detail summaries; rows expand on click or Enter/Space to reveal the existing EventDetails + RawPayloadView.

**Approach.**
- `PREFIX_COLOR_MAP` (`Record<string, string>`) maps the 9 known prefixes to fixed Tailwind text-color classes (R4). Not a hash of the event name — hand-curated so the color is deterministic. Unknown prefixes fall through to `text-spur-text-muted` (R6). The same color class is applied to the event-name cell AND the Prefix column so color is never the only signal (R5 — the prefix label is always rendered in its own column).
- New `SystemEventsTable` component renders `<table>` inside a `<section aria-label="System events">` (sticky `<thead>` per R3, scroll host on the section). Column widths chosen so a 1280px viewport shows ≥20 rows at ~28px row height (R2). The table reuses the existing `EventDetails` and `RawPayloadView` components — no duplicate detail layout (R9).
- `EventTableRow` is one `<tr tabIndex={0} aria-expanded={...}>` per row. Click or Enter/Space toggles an expanded second `<tr>` below with `colSpan={5}` showing EventDetails + RawPayloadView (R7). `aria-label` describes the row in full.
- `buildTooltipSummary(eventName, payload, renderer)` is a renderer-aware projection of the payload into up to 4 `(label, value)` pairs (R8). Mirrors the active `DETAIL_RENDERERS` choice — planning events surface Entity + Transition, queue events surface Job Kind + Job ID, etc. Generic fallback surfaces the first 3 non-empty scalars. Returns `null` for empty payloads so the tooltip is suppressed.
- Tooltip itself uses CSS `group-hover`/`group-focus` (no JS portal), with `max-w-[min(360px,90vw)]` to clamp overflow (R8) and `pointer-events-none` so it doesn't block clicks on the row underneath.
- Cap-and-prune / runtime narrowing / SSE malformed-frame drop are untouched (R10).

**Tradeoffs.** Tooltip uses CSS hover/focus (no JS state) — simpler than a portal, but means there's no programmatic open/close for tests. Tests assert via `[role="tooltip"]` DOM presence and content (`<dl>` exists, no `<pre>` JSON). The `tabIndex={0}` on `<tr>` is non-standard but follows the disclosure-row pattern (row is keyboard-focusable, Enter/Space toggles) — a `<button>` inside the row would be the alternative but breaks the table's grid layout.

**Files touched.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx` — added `PREFIX_COLOR_MAP`, `getPrefixColor`, `buildTooltipSummary`, `SystemEventsTable`, `EventTableRow`; removed `Card`/`CardBody`/`Badge` imports and the `<ul>`/`<Card>` event-list block; passed `filteredEvents` + `catalog` into the new table.
- `apps/web/tests/modules/observability/components.test.tsx` — converted existing `getByText('eventname')` assertions to `queryAllByText(...).length > 0` because the tooltip's `<dl>` repeats the event payload summary (still text-matched by happy-dom), and added 5 new tests for R1/R3, R4/R5/R6, R7 expand + reuse, R7 Enter toggle, R8 tooltip content shape.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Files changed.**
- `apps/web/src/modules/observability/SystemEventsTab.tsx:46-70` — `PREFIX_COLOR_MAP` (Record literal, 10 entries) + `FALLBACK_COLOR` + `getPrefixColor(prefix)` helper.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:455-563` — `buildTooltipSummary(eventName, payload, renderer)` renderer-aware projection returning up to 4 `(label, value)` pairs (planning/queue/message/process/agent/rule/bus/api/workflow-* branches + generic fallback).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:773` — replaced `<ul>/<Card>` block with `<SystemEventsTable rows={filteredEvents} catalog={catalog} />`.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:869-908` — `SystemEventsTable` component (`<section>` scroll host, sticky `<thead>`, 5 `<th>` columns Time/Event/Actor/Prefix/Tier).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:920-996` — `EventTableRow` (one `<tr tabIndex={0} aria-expanded>` per row with click/Enter/Space toggle, CSS hover/focus tooltip on the event-name cell via `group-hover:block group-focus:block`, expanded `<tr colSpan={5}>` panel reusing `EventDetails` + `RawPayloadView`).
- `apps/web/src/modules/observability/SystemEventsTab.tsx:2` — dropped unused `Card`/`CardBody`/`Badge` imports.
- `apps/web/tests/modules/observability/components.test.tsx:131-225` — converted `getByText('task.created'/'queue.job.completed'/'bus.handler.error')` to `queryAllByText(...).length > 0` so assertions still pass when the tooltip DOM contains payload-derived text. Repaired an inadvertent break in the tier-filter test (missing `}` and `});`).
- `apps/web/tests/modules/observability/components.test.tsx:227-318` — five new tests covering R1/R3 (table + sticky header + 5 columns), R4/R5/R6 (stable color mapping + prefix label alongside color), R7/R9 (click expands + reuses `EventDetails`/`RawPayloadView`), R7 (Enter/Space toggles), R8 (tooltip DOM contains `<dl>` summary, no `<pre>` JSON).

**Rationale.** Color is stable per-prefix (R4) and the prefix label sits in its own column (R5). Tooltip uses CSS hover/focus rather than a portal — simpler, no JS open/close, but tests assert via `[role="tooltip"]` presence instead of hover. `<tr tabIndex={0}>` is non-standard HTML but follows the disclosure-row pattern; a `<button>` inside the row would break the table grid.
### Testing
**Verification commands.**
- `bun run lint` — clean (Biome + per-workspace `tsc --noEmit`).
- `bun test apps/web/tests/modules/observability/` — 22 pass / 0 fail (5 new + 17 prior).
- `bun run test` (full suite) — 2475 pass / 0 fail across 176 files.
- `bun run format` then `bun run lint` — no remaining formatting drift after `PREFIX_COLOR_MAP` and `<section>` insertion.

**Coverage claim.**
- R1 (table with Time | Event | Actor | Prefix | Tier) — "renders a table with sticky header and the 5 columns" test asserts headers exactly equal `['Time', 'Event', 'Actor', 'Prefix', 'Tier']`.
- R2 (compact ~28px row height, ≥20 rows visible) — row style is `height: 28` on the `<tr>`; column widths chosen so 5 columns fit a 1280px viewport at 28px row height.
- R3 (sticky table header on scroll) — `<thead>` has `sticky top-0`; test asserts the `sticky` className on `<thead>`.
- R4 (stable prefix → color map) — "event names are colored by a stable prefix-to-color map" test asserts `text-emerald-400` for `task.created` and `text-orange-400` for `queue.job.completed` (deterministic across renders — not a hash).
- R5 (prefix label text always rendered alongside the color) — same test asserts `task`/`queue` text is rendered in the Prefix column (independent of the color-bearing `<span>`).
- R6 (unknown prefix → neutral color) — `getPrefixColor` falls back to `text-spur-text-muted` for unknown prefixes (logic is unit-traceable from the code).
- R7 (click + Enter/Space expand) — "row click expands typed EventDetails + RawPayloadView" asserts `Raw JSON Payload` button appears after `fireEvent.click(row)`; "row Enter key toggles expansion" asserts `Enter` toggles, ` ` (space) toggles back.
- R8 (tooltip typed summary, not raw JSON, viewport-capped) — "event-name cell carries a tooltip with a typed summary" asserts (a) `[role="tooltip"]` exists, (b) no `<pre>` JSON appears inside any tooltip, (c) a `<dl>` summary is present. Viewport clamp is CSS (`max-w-[min(360px,90vw)]`) and code-traceable.
- R9 (reuse existing detail renderers + RawPayloadView) — expanded panel calls `EventDetails` and `RawPayloadView` directly (same imports as before), no duplicate layout code.
- R10 (preserve HISTORY_LIMIT cap-and-prune, runtime narrowing, SSE malformed-frame drop) — covered by the prior SSE test (`FakeEventSource.instances).toHaveLength(1)`) and the live-tail append test, both still passing.
### Review
**SECU pass.** Self-review on the diff:
- **Safety.** External input still flows through `parseSseEnvelope` (runtime narrow) and malformed frames are still dropped silently. The new code does not introduce new network surface.
- **Correctness.** Color map is a `Record<string, string>` literal — O(1) lookup, deterministic. `buildTooltipSummary` mirrors `EventDetails`'s renderer-resolution logic (same `task.*` / `feature.*` fallback to `planning`) so a tooltip and the expanded-row view agree on what fields to surface. Empty / null payload returns `null` and suppresses the tooltip entirely.
- **Performance.** `tierByName` Map built once via `useMemo` keyed on `catalog`. `summary` per row is `useMemo` keyed on `(eventName, payload, renderer)`. Tooltip uses CSS hover/focus, no per-row listeners.
- **A11y.** `<section aria-label>` instead of `<div role="region">` (Biome `useSemanticElements`). Dropped invalid `role="button"` on `<tr>` — relied on `tabIndex={0}` + `aria-expanded` + Enter/Space handler + visible `cursor-pointer` for the disclosure-row pattern. Tooltip is `role="tooltip"`. Color is paired with a text label in its own column (R5/WCAG 1.4.1).
- **UX.** `flex-1 overflow-y-auto` on the section + sticky `<thead>` keeps column labels visible during scroll. 28px rows let ≥20 rows fit on a standard viewport. Empty-state ("No system events yet…") preserved for the zero-row case.

**Residual risk.** None blocking. The CSS tooltip approach means there's no programmatic open/close — the tooltip is purely hover/focus-driven. If a future use case needs a click-to-pin tooltip, that would be a follow-up task.

**Disposition.** PASS — ready to record and move to 0224.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-07T23:48:49.866Z todo → wip (system)
- 2026-07-07T23:59:55.613Z wip → testing (system)
- 2026-07-07T23:59:55.808Z testing → done (system)
