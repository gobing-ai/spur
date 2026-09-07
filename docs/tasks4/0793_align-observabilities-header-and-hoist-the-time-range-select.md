---
schema_version: 1
name: Align Observabilities header and hoist the time-range selector to the shell for all tabs
status: todo
template: feature-impl
created_at: 2026-09-07T03:53:27.191Z
updated_at: "2026-09-07T04:06:20.754Z"
feature_id: J31
priority: P2

---

## 0793. Align Observabilities header and hoist the time-range selector to the shell for all tabs

### Background
Covers feature J31 scenarios R1–R4.

**Naming.** The module renders its own title as `<h1>Observability</h1>`
(`apps/web/src/modules/observability/ObservabilityShell.tsx:65`) while the sidebar label is
`Observabilities` (`apps/web/src/modules/observability/index.tsx:18`). A **second** naming surface
exists that the feature satellite's D1 does not name: `index.tsx:15` declares
`name: 'Observability'`, which `apps/web/src/components/BoardLayout.tsx:110` renders as the board
breadcrumb. `GlobalAgentBar.tsx:32` already prefers `sidebarLabel ?? name`, so it is correct today.
Renaming only the `<h1>` therefore leaves the breadcrumb inconsistent — R1 needs both surfaces.

**Time range.** `ObservabilityShell` already owns `timeRange`/`setTimeRange` state
(`ObservabilityShell.tsx:18`) and passes `timeRange` + `onTimeRangeChange` to every tab
(`ObservabilityShell.tsx:126-133`), but the preset chip group renders inside `ObservabilityFilters`
(`ObservabilityFilters.tsx:31` `TIME_RANGES`, chips at `:167`), which only System Events mounts.
Current per-tab state:

- `SummaryTab.tsx:127` and `JobsTab.tsx:171` **already** call `timeRangeSince(timeRange)` — R3 is
  met for those two; no change needed beyond the chips moving.
- `RoutingTab.tsx:235-236` fetches `/observability/routing-summary` with **no query params**,
  ignoring the `timeRange` prop, even though the endpoint reads `since`/`until`
  (`apps/server/src/modules/observability/index.ts:216`).
- `SystemEventsTab` carries two legacy escapes that would silently defeat the hoist:
  `:588-589` lets `filter.timeWindow` **override** the shell's `timeRange`, and `:778-779`
  falls back to a local `useState('24h')` when the prop is absent (shell default is `'4h'`,
  `ObservabilityShell.tsx:18`). Both are dead in practice — `timeWindow` has **no producer**
  anywhere under `apps/web/src` (only the branch and its param type at `:575`), and
  `SystemEventsTab` is mounted solely through `tabs.ts:49` under the shell, so `propTimeRange` is
  always supplied. Verified by grep against the current tree, 2026-09-07.

**Target pattern.** History already does this: `HistoryShell` owns `filter` state
(`HistoryShell.tsx:63`) and renders `<HistoryFilters>` itself (`HistoryShell.tsx:563`) for every tab.

Design satellite: `docs/design/observabilities-module-polish.md` (D1, D2).
### Requirements
- [ ] R1. Every board-facing name for this module reads `Observabilities`: the shell `<h1>`
      (`ObservabilityShell.tsx:65`) **and** the module `name` (`index.tsx:15`) rendered as the
      breadcrumb by `BoardLayout.tsx:110`, byte-identical to `sidebarLabel`.
- [ ] R2. The time-range preset selector renders in `ObservabilityShell`'s header row and stays
      visible on Summary, System Events, Jobs, and Routing; the selection persists across tab
      switches (shell state is the sole owner).
- [ ] R3. Every tab's server query carries a `since` derived from the shell's selected range —
      including `RoutingTab`, which must pass `timeRangeSince(timeRange)` to `routing-summary`.
      No tab may override the shell's range from local state.
- [ ] R4. The `all` range sends **no** `since` bound (`timeRangeSince` returns `undefined`).

**Out of scope / non-goals**

- No server, contract, or DTO change — `routing-summary` already accepts `since`/`until`.
- No change to the tab set, tab labels, or `tabs.ts` ordering.
- No `until` / custom absolute-range picker; presets only (`TIME_RANGES` unchanged).
- No change to the remaining System Events filters (prefix, severity, search, tier) or to
  `ColumnCustomizer` / column persistence.
- No catalog or ingestion work — that is task 0794 under the same feature.
- No change to the History module; it is the reference pattern, not a target.
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

#### Q&A entry — 2026-09-07T04:06:20.265Z

**Q1 — Does R1 cover the board breadcrumb, or only the shell `<h1>`?**
**Closed: both.** `index.tsx:15` `name: 'Observability'` is rendered by `BoardLayout.tsx:110`.
Renaming only the `<h1>` would leave a visibly inconsistent breadcrumb, contradicting the feature
goal ("the header matches the sidebar label"). Satellite D1 says "one line"; this task extends it to
two one-word edits. `sidebarLabel` stays the single source of the spelling.

**Q2 — After the hoist, what wins when `filter.timeWindow` is set?**
**Closed: the shell wins; the `timeWindow` branch is deleted.** `SystemEventsTab.tsx:588-589` is a
legacy override with **no producer** in `apps/web/src` (grep, 2026-09-07). Keeping it would let a
stale filter silently defeat R3. The `timeWindow?: string` member of the `serializeFilter` param
(`:575`) goes with it.

**Q3 — Keep `SystemEventsTab`'s local `useState('24h')` fallback?**
**Closed: delete it.** The tab mounts only via `tabs.ts:49` under the shell, so `propTimeRange` is
always supplied. Two defaults (`'24h'` local vs `'4h'` shell) is a latent inconsistency, and R2
requires a single owner. `timeRange`/`onTimeRangeChange` become **required** props on this tab.

**Q4 — Where does the selector render in the shell?**
**Closed: the existing header row, beside the tab strip** (satellite D2), inside the
`justify-between` flex container at `ObservabilityShell.tsx:61`. It is a third flex child, so no
layout restructure.

**Deferred:** URL/localStorage persistence of the selected range across page reloads — not required
by any R-item; revisit only if operators ask.
### Design
**WHAT/WHY.** Make every naming surface read `Observabilities`, and make the shell the single owner
of the time range so all four tabs query one window. WHY: the module is inconsistent with its own
sidebar label, and three of four tabs cannot be time-filtered at all today.

**WHERE (primary targets).**

| File | Change |
| --- | --- |
| `apps/web/src/modules/observability/index.tsx:15` | `name: 'Observability'` → `'Observabilities'` (R1) |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:65` | `<h1>` text → `Observabilities` (R1) |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:61-89` | render `<TimeRangePresets>` as a third flex child in the header row (R2) |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:160-185` | extract the preset `<fieldset>` into an exported `TimeRangePresets`; `ObservabilityFilters` stops rendering it (R2) |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:575,587-589,775-780` | drop the `filter.timeWindow` override + `timeWindow?` param member + `localTimeRange` fallback; `timeRange`/`onTimeRangeChange` become required props (R3) |
| `apps/web/src/modules/observability/RoutingTab.tsx:235-236` | append `since=timeRangeSince(timeRange)` to the `routing-summary` URL when defined (R3, R4) |

**Frozen names.** New export `TimeRangePresets` from `ObservabilityFilters.tsx`, props
`{ timeRange: ObservabilityTimeRange; onTimeRangeChange: (r: ObservabilityTimeRange) => void }`.
Reused unchanged: `TIME_RANGES`, `timeRangeSince(range, nowMs?)`, `ObservabilityTimeRange`,
`ObservabilityTabProps`, `data-observability-shell`, `aria-label="Time range presets"`. **No new
API**: no server route, contract, DTO, or config key.

**Precedence (the non-obvious part).** After this task the shell's `timeRange` is the **only**
source of the window for every tab. Order is flat, not layered: shell state → tab prop →
`timeRangeSince(range)` → query param. `all` ⇒ `timeRangeSince` returns `undefined` ⇒ the `since`
param is **omitted**, not sent empty (R4). `RoutingTab` must build the URL conditionally rather than
interpolating `undefined`.

**Anti-patterns — do not implement.**

- Do not add a second `useState` for the range in any tab, or reintroduce a `?? localRange` fallback.
- Do not keep `filter.timeWindow` "for compatibility" — it has no producer and defeats R3 silently.
- Do not send `since=undefined` / `since=` for the `all` range (R4 asserts the param is absent).
- Do not touch the server, `routing-summary`, or any contract — the endpoint already accepts `since`.
- Do not lift the remaining System Events filters (prefix/severity/search/tier) into the shell;
  they are tab-scoped and out of scope.
- Do not rename `sidebarLabel`, the route, the module `id`, or `data-observability-shell`.

**Handoff / cross-task.** Sibling task 0794 (catalog-open ingestion) shares the feature but not a
file: 0794 owns `packages/app`, `apps/server/src/serve.ts`, `apps/cli`, and the `SystemEventsTab`
**renderer/tier** path. This task owns only naming + range plumbing in `apps/web`. `dependencies[]`
is empty by design — the two can land in either order; whoever lands second rebases
`SystemEventsTab.tsx`, the one shared file.
### Plan
- [ ] 1. **(R1)** Rename both naming surfaces: `index.tsx:15` `name` and `ObservabilityShell.tsx:65`
      `<h1>` → `Observabilities`.
- [ ] 2. **(R2)** Extract the preset `<fieldset>` from `ObservabilityFilters.tsx:160-185` into an
      exported `TimeRangePresets` component; leave the remaining filters in place.
- [ ] 3. **(R2)** Render `<TimeRangePresets timeRange onTimeRangeChange />` in
      `ObservabilityShell.tsx`'s header row beside the tab strip.
- [ ] 4. **(R3)** In `SystemEventsTab.tsx`, delete the `filter.timeWindow` override (`:587-589`),
      its param member (`:575`), and the `localTimeRange` fallback (`:778-780`); make
      `timeRange`/`onTimeRangeChange` required.
- [ ] 5. **(R3, R4)** In `RoutingTab.tsx`, compute `timeRangeSince(timeRange)` and append `since`
      to the `routing-summary` request only when it is defined; add `timeRange` to the effect deps.
- [ ] 6. **Verify:** shell test asserts the `<h1>` text and that the presets render for each tab id;
      `RoutingTab` test asserts the fetch URL carries `since` for `4h` and omits it for `all`;
      `SystemEventsTab` test asserts a shell range change drives the `since` it queries.
      Run `bun test` from inside `apps/web`, then the root gate `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/J31_observabilities-module-polish-header-naming-shell-level-time-range-catalog-open-event-ingestion.md` (R1–R4)
- Design satellite: `docs/design/observabilities-module-polish.md` — D1 (header rename), D2 (shell-level time range)
- Sibling task: `0794` — catalog-open ingestion (shares `SystemEventsTab.tsx` only)
- Reference pattern: `apps/web/src/modules/history/HistoryShell.tsx:63,563` (shell owns filter, renders the bar)
- Endpoint already accepting the window: `apps/server/src/modules/observability/index.ts:216`
### History
