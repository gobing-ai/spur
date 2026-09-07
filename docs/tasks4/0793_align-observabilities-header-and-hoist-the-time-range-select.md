---
schema_version: 1
name: Align Observabilities header and hoist the time-range selector to the shell for all tabs
status: done
template: feature-impl
created_at: 2026-09-07T03:53:27.191Z
updated_at: "2026-09-07T06:21:52.674Z"
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

- [x] R1. Every board-facing name for this module reads `Observabilities`: the shell `<h1>`
      (`ObservabilityShell.tsx:65`) **and** the module `name` (`index.tsx:15`) rendered as the
      breadcrumb by `BoardLayout.tsx:110`, byte-identical to `sidebarLabel`.
- [x] R2. The time-range preset selector renders in `ObservabilityShell`'s header row and stays
      visible on Summary, System Events, Jobs, and Routing; the selection persists across tab
      switches (shell state is the sole owner).
- [x] R3. Every tab's server query carries a `since` derived from the shell's selected range —
      including `RoutingTab`, which must pass `timeRangeSince(timeRange)` to `routing-summary`.
      No tab may override the shell's range from local state.
- [x] R4. The `all` range sends **no** `since` bound (`timeRangeSince` returns `undefined`).

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
| ---------------------- |
| `apps/web/src/modules/observability/JobsTab.tsx:133` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:14` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:161` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:195` |
| `apps/web/src/modules/observability/ObservabilityFilters.tsx:47` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:118` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:2` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:66` |
| `apps/web/src/modules/observability/RoutingTab.tsx:228` |
| `apps/web/src/modules/observability/RoutingTab.tsx:235` |
| `apps/web/src/modules/observability/RoutingTab.tsx:242` |
| `apps/web/src/modules/observability/RoutingTab.tsx:253` |
| `apps/web/src/modules/observability/RoutingTab.tsx:4` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:1007` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:1008` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:575` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:587` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:770` |
| `apps/web/src/modules/observability/SystemEventsTab.tsx:904` |
| `apps/web/src/modules/observability/index.tsx:14` |
| `apps/web/src/modules/observability/tabs.ts:22` |
| `apps/web/src/modules/observability/tabs.ts:30` |
| `apps/web/tests/modules/observability.test.ts:23` |
| `apps/web/tests/modules/observability/components.test.tsx:1030` |
| `apps/web/tests/modules/observability/components.test.tsx:1086` |
| `apps/web/tests/modules/observability/components.test.tsx:1142` |
| `apps/web/tests/modules/observability/components.test.tsx:1153` |
| `apps/web/tests/modules/observability/components.test.tsx:1924` |
| `apps/web/tests/modules/observability/components.test.tsx:1957` |
| `apps/web/tests/modules/observability/components.test.tsx:1959` |
| `apps/web/tests/modules/observability/components.test.tsx:1961` |
| `apps/web/tests/modules/observability/components.test.tsx:1962` |
| `apps/web/tests/modules/observability/components.test.tsx:1966` |
| `apps/web/tests/modules/observability/components.test.tsx:2002` |
| `apps/web/tests/modules/observability/components.test.tsx:2081` |
| `apps/web/tests/modules/observability/components.test.tsx:2122` |
| `apps/web/tests/modules/observability/components.test.tsx:2362` |
| `apps/web/tests/modules/observability/components.test.tsx:2464` |
| `apps/web/tests/modules/observability/components.test.tsx:277` |
| `apps/web/tests/modules/observability/components.test.tsx:282` |
| `apps/web/tests/modules/observability/components.test.tsx:304` |
| `apps/web/tests/modules/observability/components.test.tsx:33` |
| `apps/web/tests/modules/observability/components.test.tsx:337` |
| `apps/web/tests/modules/observability/components.test.tsx:352` |
| `apps/web/tests/modules/observability/components.test.tsx:378` |
| `apps/web/tests/modules/observability/components.test.tsx:394` |
| `apps/web/tests/modules/observability/components.test.tsx:424` |
| `apps/web/tests/modules/observability/components.test.tsx:448` |
| `apps/web/tests/modules/observability/components.test.tsx:463` |
| `apps/web/tests/modules/observability/components.test.tsx:481` |
| `apps/web/tests/modules/observability/components.test.tsx:516` |
| `apps/web/tests/modules/observability/components.test.tsx:574` |
| `apps/web/tests/modules/observability/components.test.tsx:587` |
| `apps/web/tests/modules/observability/components.test.tsx:619` |
| `apps/web/tests/modules/observability/components.test.tsx:641` |
| `apps/web/tests/modules/observability/components.test.tsx:651` |
| `apps/web/tests/modules/observability/components.test.tsx:658` |
| `apps/web/tests/modules/observability/components.test.tsx:661` |
| `apps/web/tests/modules/observability/components.test.tsx:695` |
| `apps/web/tests/modules/observability/components.test.tsx:697` |
| `apps/web/tests/modules/observability/components.test.tsx:717` |
| `apps/web/tests/modules/observability/components.test.tsx:719` |
| `apps/web/tests/modules/observability/components.test.tsx:723` |
| `apps/web/tests/modules/observability/components.test.tsx:731` |
| `apps/web/tests/modules/observability/components.test.tsx:737` |
| `apps/web/tests/modules/observability/components.test.tsx:758` |
| `apps/web/tests/modules/observability/components.test.tsx:779` |
| `apps/web/tests/modules/observability/components.test.tsx:803` |
| `apps/web/tests/modules/observability/components.test.tsx:824` |
| `apps/web/tests/modules/observability/components.test.tsx:858` |
| `apps/web/tests/modules/observability/components.test.tsx:912` |
| `apps/web/tests/modules/observability/components.test.tsx:972` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:120` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:159` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:187` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:218` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:244` |
| `apps/web/tests/modules/observability/jobs-tab.test.tsx:264` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:105` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:12` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:136` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:181` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:2` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:210` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:222` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:234` |
| `apps/web/tests/modules/observability/routing-tab.test.tsx:238` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:127` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:171` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:192` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:221` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:233` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:253` |
| `apps/web/tests/modules/observability/summary-tab.test.tsx:269` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | Header + module name read `Observabilities`: apps/web/src/modules/observability/index.tsx:14 — `name: 'Observabilities'`, byte-identical to `sidebarLabel` (index.tsx:18); apps/web/src/modules/observability/ObservabilityShell.tsx:66 — `<h1 ...>Observabilities</h1>`; consumers read this run: apps/web/src/components/BoardLayout.tsx:110 renders `activeModule?.name` (breadcrumb), apps/web/src/components/GlobalAgentBar.tsx:32 prefers `sidebarLabel ?? name`. Tests: apps/web/tests/modules/observability.test.ts:23, apps/web/tests/modules/observability/components.test.tsx:277. |
| R2 | MET | Shell-level time-range presets visible on every tab; shell state sole owner: exported `TimeRangePresets` at apps/web/src/modules/observability/ObservabilityFilters.tsx:47-84 (aria-label "Time range presets" at :61); rendered in the shell header row at apps/web/src/modules/observability/ObservabilityShell.tsx:120 inside the header container (:62-121) and before the tab panel (:124), so it stays mounted across tab switches; sole owner is shell state (ObservabilityShell.tsx:19 — the only `useState<ObservabilityTimeRange>` under src/modules/observability, grep this run); `timeRange`/`onTimeRangeChange` are required props (apps/web/src/modules/observability/tabs.ts:30-31); zero `timeWindow` occurrences under apps/web/src (grep this run). Tests: components.test.tsx:282-289 (presets in shell, absent from tab filter bar), :304-308 and :337-343 (visible on System Events/Jobs/Routing with `24h` selection persisted), :699-711 (preset order + shell header container), :1957-1969 (filter bar no longer renders presets). |
| R3 | MET | Every tab queries `since` derived from the shell range; RoutingTab windowed; no local override: apps/web/src/modules/observability/RoutingTab.tsx:229 destructures required `timeRange`, :236 `since = timeRangeSince(timeRange)`, :237-239 appends `?since=` to routing-summary conditionally, :253 effect deps `[timeRange]`; endpoint already reads since/until (apps/server/src/modules/observability/index.ts:216 — unchanged, not part of this diff). SystemEventsTab escapes deleted: props required with no local fallback (SystemEventsTab.tsx:770; grep shows no `localTimeRange`, no `timeWindow` in apps/web/src), `serializeFilter` takes `Partial<ObservabilityFilterValues>` (SystemEventsTab.tsx:574-576) and derives `since` from the passed range (:587-588), active-filter memo depends on `[debouncedFilter, timeRange]` (:828). Summary/Jobs already windowed: SummaryTab.tsx:127 with deps `:193 [timeRange]`; JobsTab.tsx:171 with deps `:206 [timeRange, statusFilter, offset]`. Tests: apps/web/tests/modules/observability/routing-tab.test.tsx:239-256 (since present for 4h + refetch on range change), components.test.tsx:651-733 (shell preset drives System Events query: 4h default, 30s refetch filters old row, persistence on Jobs). |
| R4 | MET | `all` sends no `since` bound: apps/web/src/modules/observability/ObservabilityFilters.tsx:38 `all: null` and :41-45 `timeRangeSince` returns `undefined` for it; RoutingTab.tsx:237-239 builds the bare endpoint URL when `since` is falsy (param omitted, not empty); historyUrl skips falsy since (SystemEventsTab.tsx:146); SummaryTab.tsx:131 `if (sinceIso)`; JobsTab.tsx:175 `if (since)`. Tests: routing-tab.test.tsx:258-267 (no `since` param, bare URL), components.test.tsx:727-732 (last history call carries no `since=`), components.test.tsx:1954 (unit: `timeRangeSince('all')` undefined). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R1 — Module header matches the sidebar label | MET | test | Code: index.tsx:14 (`name` == `sidebarLabel` at :18, byte-identical), ObservabilityShell.tsx:66 (`<h1>Observabilities</h1>`), BoardLayout.tsx:110 renders `activeModule?.name`. Test: observability.test.ts:23 asserts `name === 'Observabilities'`; components.test.tsx:277 asserts the h1 text. Command: targeted bun test run green (131 pass / 0 fail). |
| R2 — The time-range selector renders for every tab | MET | test | Code: ObservabilityShell.tsx:120 renders presets in the header row above the tab panel (:124), driven solely by shell state (:19); no tab renders presets (grep: only aria-label occurrence is the component itself, ObservabilityFilters.tsx:61). Test: components.test.tsx:304-308, 337-343 (presets present and `24h` still aria-pressed across System Events → Jobs → Routing switches), :651-711, :1966-1968. Command: targeted bun test run green. |
| R3 — Every tab's data queries honor the selected time range | MET | test | Code: RoutingTab.tsx:236-239,253; SystemEventsTab.tsx:587,828 (serializeFilter from passed range; memo keyed on timeRange); SummaryTab.tsx:127,193; JobsTab.tsx:171,206. Test: routing-tab.test.tsx:239-256 (4h carries a parseable `since`; rerender with 24h triggers a second fetch), components.test.tsx:713-721 (shell 4h default drives history query; 30s click refetches and old row drops). Command: targeted bun test run green. |
| R4 — The "all" range sends no since bound | MET | test | Code: ObservabilityFilters.tsx:38,43 (`all: null` → `undefined`); RoutingTab.tsx:237-239 (bare URL); SystemEventsTab.tsx:146 (since omitted when falsy). Test: routing-tab.test.tsx:258-267 (`since` null, URL ends with bare endpoint), components.test.tsx:727-732 (history call without `since=`), components.test.tsx:1954. Command: targeted bun test run green. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review verdict: PASS

Reviewed the uncommitted working-tree diff for task 0793 (7 source + 5 test files under `apps/web`,
plus this task file) against `## Requirements` R1–R4, the `### Design` WHERE table, and the J31
satellite (`docs/design/observabilities-module-polish.md` D1/D2). All evidence anchors were re-read
at the cited lines this run; verification commands were re-run this turn (evidence below).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | correctness | `apps/web/src/modules/observability/JobsTab.tsx:133` | `timeRange = '4h'` destructuring default retained on a now-required prop (`tabs.ts:30`) — dead default that mildly contradicts the Q3 single-owner intent (`ObservabilityShell.tsx:19` is the only real default). Harmless today; drop in a follow-up. |
| P4 | efficiency | `apps/web/src/modules/observability/RoutingTab.tsx:236-238` | `resolveApiUrl()` is evaluated twice per fetch effect when `since` is defined; hoisting to one local would be marginally cleaner. Trivial cost. |
| P4 | architecture | `apps/web/src/modules/observability/tabs.ts:31` | `onTimeRangeChange` is required on `ObservabilityTabProps` but no tab consumes it now that presets render only in the shell. Frozen by task Q3 (required props), so accepted for this diff; a later task could narrow the tab-facing props to `timeRange` only. |
| P4 | correctness | `apps/web/src/modules/observability/SystemEventsTab.tsx:575` | `serializeFilter`'s `timeRange = '24h'` default parameter remains (pre-existing, not targeted by the Design table); its sole production call site `:828` passes the shell range explicitly. Latent second default; note only. |

No P1–P3 findings.

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/web/src/modules/observability/index.tsx:14` — `name: 'Observabilities'`, byte-identical to `sidebarLabel` (`index.tsx:18`); `apps/web/src/modules/observability/ObservabilityShell.tsx:66` — `<h1>Observabilities</h1>`. Consumers confirmed: `apps/web/src/components/BoardLayout.tsx:110` renders `activeModule?.name`, `GlobalAgentBar.tsx:32` prefers `sidebarLabel ?? name`. Tests: `apps/web/tests/modules/observability.test.ts:23`, `apps/web/tests/modules/observability/components.test.tsx:277`. |
| R2 | MET | Presets extracted to exported `TimeRangePresets` (`apps/web/src/modules/observability/ObservabilityFilters.tsx:47-84`) and rendered in the shell header row beside the tab strip (`apps/web/src/modules/observability/ObservabilityShell.tsx:120`), outside the tab panel, so it stays visible on every tab; sole owner is shell state (`ObservabilityShell.tsx:19`); no tab-local fallback (`SystemEventsTab.tsx:770` destructures only `timeRange`; props required at `apps/web/src/modules/observability/tabs.ts:30-31`). Tests: `components.test.tsx:282-290` (shell-owned, absent from the tab filter bar), `:304-309` and `:337-342` (visible on System Events/Jobs/Routing with selection persisted), `components.test.tsx:1957-1969` (filter bar no longer renders presets). |
| R3 | MET | `apps/web/src/modules/observability/RoutingTab.tsx:236-237` derives `since = timeRangeSince(timeRange)` and appends it to the `routing-summary` URL conditionally; effect deps `[timeRange]` (`RoutingTab.tsx:253`) refetch on change; endpoint reads `since`/`until` (`apps/server/src/modules/observability/index.ts:216-218`, unchanged). System Events escapes deleted: `serializeFilter` takes `Partial<ObservabilityFilterValues>` (`SystemEventsTab.tsx:574-575`), `since` derives from the passed range (`:587`), `filter.timeWindow` and `localTimeRange` are gone (repo-wide grep over `apps/web`: zero `timeWindow` hits); the active-filter memo depends on `timeRange` (`:828`). Summary/Jobs already windowed (`SummaryTab.tsx:127`, `JobsTab.tsx:171`). Tests: `apps/web/tests/modules/observability/routing-tab.test.tsx:239-255`, `components.test.tsx:651-740`. |
| R4 | MET | `timeRangeSince('all')` returns `undefined` (`ObservabilityFilters.tsx:41-43`); `RoutingTab.tsx:237-238` builds the bare URL when `since` is falsy, so the param is omitted rather than sent empty; `historyUrl` skips a falsy `since` (`SystemEventsTab.tsx:146`). Tests: `routing-tab.test.tsx:258-267` (no `since` param, bare endpoint URL), `components.test.tsx:731-732` (last history call carries no `since=`). |

Design conformance: 6/6 Design WHERE rows implemented as written (`index.tsx:14`; `ObservabilityShell.tsx:66,120`; `ObservabilityFilters.tsx:47-84` plus the default export dropping the range props; `SystemEventsTab.tsx:574-575,587,770`; `RoutingTab.tsx:236-253`). Frozen names intact (`TimeRangePresets`, `TIME_RANGES`, `timeRangeSince`, `aria-label="Time range presets"`, `data-observability-shell`). `tabs.ts` is touched only to make the range props required, which Q3 mandates — tab set, labels, and ordering unchanged. No server, contract, or DTO change. No scope creep: every hunk maps to an R-item or its test.

Architecture depth (sp-code-improvement lenses): no blocker or major candidates. The extraction follows the established HistoryShell pattern — the shell is the single owner of the range, locality improved (presets live beside the other filters and are rendered by the state owner), no new coupling introduced, and tests drive behavior through the shell rather than tab internals. The only structural residue is the P4 advisory above (tab-facing `onTimeRangeChange` now unused by tabs).

Verification (re-run this turn):

- `cd apps/web && bunx tsc --noEmit -p tsconfig.json` → exit 0.
- `cd apps/web && bun test tests/modules/observability.test.ts tests/modules/observability/` → 131 pass, 0 fail (791 expect calls, 7 files).
- `bun run spur-check` (root gate: lint, typecheck, full test suite, rule run) → 7633 pass, 0 fail; all 2 rules passed.

Residual risk: persistence of the selected range across page reloads remains unimplemented — explicitly deferred in Q&A, required by no R-item. Sibling task 0794 rebases `SystemEventsTab.tsx` (the one shared file); this diff's semantics pose no conflict.

Disposition: all four requirements MET, design conformance clean, only non-blocking P4 findings — review clears this task for the pipeline's next hop. The two dead-default cleanups (`JobsTab.tsx:133`, `serializeFilter` default) can fold into a later polish task.

### References

- Feature: `docs/features/J31_observabilities-module-polish-header-naming-shell-level-time-range-catalog-open-event-ingestion.md` (R1–R4)
- Design satellite: `docs/design/observabilities-module-polish.md` — D1 (header rename), D2 (shell-level time range)
- Sibling task: `0794` — catalog-open ingestion (shares `SystemEventsTab.tsx` only)
- Reference pattern: `apps/web/src/modules/history/HistoryShell.tsx:63,563` (shell owns filter, renders the bar)
- Endpoint already accepting the window: `apps/server/src/modules/observability/index.ts:216`

### History

- 2026-09-07T05:53:35.302Z todo → wip (system)
- 2026-09-07T06:21:36.523Z wip → testing (system)
- 2026-09-07T06:21:52.674Z testing → done (system)
