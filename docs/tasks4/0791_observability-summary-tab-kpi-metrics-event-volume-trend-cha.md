---
schema_version: 1
name: "Observability Summary tab: KPI metrics, event volume trend charts, and error hotspots"
status: done
template: feature-impl
created_at: 2026-09-06T21:43:07.713Z
updated_at: "2026-09-07T00:34:32.370Z"
feature_id: J93
priority: P2
tags: ["observability", "web", "ui", "charts"]
dependencies: ["0789", "0790"]
---

## 0791. Observability Summary tab: KPI metrics, event volume trend charts, and error hotspots

### Background
Covers feature J93 scenario R2 (R1 is 0790's — the registry entry and default). Depends on **0789**
for `GET /api/observability/summary` and the `ObservabilitySummaryResponse` DTO, and on **0790** for
the registered `summary` tab, the placeholder `SummaryTab.tsx` this task replaces, and the `'4h'`
default range. Verified against the tree at refine time (2026-09-06):

**Correction to this task's original Design.** It cites `DeltaBadge` as an import from
`apps/web/src/modules/history/charts.tsx`. **`charts.tsx` does not export `DeltaBadge`.** The full
export list is `resolveAutoBucket`, `fmtTok`, `fmtTokAxis`, `fmtInt`, `fmtPct`, `fmtDur`, `fmtMs`,
`parseUtcDate`, `fmtBucketLabel`, `fmtBucketTooltip`, `fmtDateTime`, `niceTicks`,
`StackedColumnBucket`, `ChartSeries`, `StackedColumnsChart`, `StackedAreaChart`, `LineChart`,
`RadarSeries`, `RadarChart`, `HeatmapGrid`, `SparkBar`, `Sparkline`. `DeltaBadge` is a **module-local
`const`** inside `apps/web/src/modules/history/SummaryTab.tsx:53`, signature
`{ current: number; previous: number | undefined; invert?: boolean }`. See `### Q&A` D1 for the
frozen resolution.

**Two different tab patterns exist; observability's is self-fetching.**
`history/SummaryTab.tsx:23-26` is a **presentational** component — it takes `data`, `loading`, and
`error` as props from `HistoryShell` and never fetches. The observability tabs do the opposite:
`JobsTab.tsx:244-275` and `SystemEventsTab.tsx` own their own `useEffect` +
`AbortController` + `fetchIdRef` + `fetchWithTimeout(new Request(resolveApiUrl(…)))` cycle, because
`ObservabilityTabProps` (`tabs.ts:17-21`) passes only `onLivenessChange`, `timeRange`, and
`onTimeRangeChange` — no data. This task follows the **observability** pattern.

**Chart shapes that actually exist.** `StackedColumnsChart` (`charts.tsx:153`) takes
`buckets: StackedColumnBucket[]` where a bucket is `{ id?, label, v: Record<string, number>,
lineValue?, secondLineValue? }`, plus `series: ChartSeries[]` (`{ id, label, color }`) and an
optional `height`. `Sparkline` (`charts.tsx:955`) takes `{ values: number[], color?, width?, height? }`.
Both map directly onto 0789's `eventVolumeBuckets[]` — `byPrefix` becomes `v`, and the prefix set
becomes `series`. No new chart primitive is needed.

**Delta badges need a second window.** 0789's `/api/observability/summary` returns exactly one
window; feature R2 requires "period-over-period delta badges". The endpoint is not changing for this
— see `### Q&A` D2.

**Cross-tab navigation does not exist yet.** Feature R2's last line ("a recent failure list allows
one-click filtering in Jobs or System Events") requires the Summary tab to change the shell's active
tab. `ObservabilityTabProps` has no such callback and `ObservabilityShell.tsx:100` sets `activeId`
only from its own tab-strip buttons. See `### Q&A` D3 — this task owns the additive seam.

**Zero-state contract from 0789.** `eventVolumeBuckets` is **dense** (empty buckets are zero-filled
server-side), `successRatePct` is `0` (never `NaN`/`null`) when no jobs completed or failed, and
`bySeverity` carries a fourth `unknown` bucket for rows with no v2 `presentation.severity`. This tab
renders those states directly and must not re-derive or special-case them.
### Requirements
- [x] R1. `apps/web/src/modules/observability/SummaryTab.tsx` replaces 0790's placeholder body,
      keeping the `export default function SummaryTab(props: ObservabilityTabProps)` signature. It
      self-fetches `GET /api/observability/summary` via
      `fetchWithTimeout(new Request(resolveApiUrl(…), { signal }))` with the
      `AbortController` + monotonic `fetchIdRef` guard used by `JobsTab.tsx:244-256`, re-fetching
      whenever `props.timeRange` changes and discarding out-of-order responses.
- [x] R2. Four KPI cards render — **Total Events**, **Active In-Flight Jobs**, **Success Rate**,
      **Error / Warning Count** — each with a `Sparkline` (`history/charts.tsx`) over the window's
      buckets and a period-over-period delta badge. `successRatePct: 0` renders as `0%`, never as
      blank, `NaN`, or a divide-by-zero artifact.
- [x] R3. A `StackedColumnsChart` (`history/charts.tsx:153`) renders `eventVolumeBuckets` as event
      volume over time stacked by event prefix, with a stable prefix→color mapping shared with the
      severity bar and the top-types table.
- [x] R4. A severity distribution bar renders proportional `info` / `warning` / `error` counts, and
      renders the `unknown` bucket from 0789 as a distinct neutral segment rather than folding it
      into `info`.
- [x] R5. Two hotspot panels render: a **top event types** table (`name`, `prefix`, `count`,
      `latestAt`) and a **recent failures** feed. Each failure row is an activator that switches the
      shell to the Jobs tab (`source: 'job'`) or the System Events tab (`source: 'event'`).
- [x] R6. `ObservabilityTabProps` (`apps/web/src/modules/observability/tabs.ts:17-21`) gains one
      optional member `onNavigate?: (intent: ObservabilityNavIntent) => void`, and
      `ObservabilityShell.tsx` passes a handler that sets `activeId`. This is the **only** edit this
      task makes to `tabs.ts` or `ObservabilityShell.tsx`; the registry, its order, and the
      `useState` defaults are untouched.
- [x] R7. Loading and error states match the History module's language: a skeleton while pending, and
      on failure the `bg-error/10 border border-error/20 text-error` panel idiom of
      `history/SummaryTab.tsx:575-579` carrying the failure text. An aborted fetch is not an error.
- [x] R8. `apps/web/tests/modules/observability/summary-tab.test.tsx` covers: loading → loaded
      transition, the four KPI values, delta badge sign for up/down/absent-previous, stacked-chart
      series derived from `byPrefix`, the `unknown` severity segment, failure-row navigation firing
      `onNavigate` with the right tab id, the error panel on a rejected fetch, and an empty window
      rendering zeros rather than crashing.

**Out of scope (non-goals).** No server, domain, or contracts change (0789 owns the endpoint and the
DTO). No tab registration, time-range preset, retention badge, or shell default change (0790). No
Jobs table, schedules card, or job drawer (0792). No new chart primitive in `history/charts.tsx` —
that module is History's and this task only imports from it. No SSE/live-tail on the Summary tab;
it refetches on `timeRange` change only, and must not call `onLivenessChange`.
### Acceptance Criteria
```gherkin
Feature: Observability Summary tab

  Scenario: R2 — Summary tab KPI metrics and trend charts
    Given the Summary tab is open with a selected time range
    When the summary metrics load
    Then top KPI cards render for Total Events, Active In-Flight Jobs, Success Rate, and Error/Warning count
    And KPI cards display trend sparklines and period-over-period delta badges
    And a stacked area or column chart displays event volume bucketed over time grouped by event prefix
    And a severity distribution bar displays proportional info, warning, and error counts
    And a recent failure list allows one-click filtering in Jobs or System Events
    And a window with no events renders zeroed cards and an empty chart instead of an error
    And events with no recorded severity appear as a distinct unknown segment rather than as info
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T22:05:59.181Z

**D1 — `DeltaBadge` is copied into this module, not imported.** It is not exported from
`history/charts.tsx`; it is a module-local `const` in `history/SummaryTab.tsx:53`. Two options were
weighed: promote it into `charts.tsx` (touches History's shared module and its consumers for a
badge), or define a local `DeltaBadge` in `observability/SummaryTab.tsx` with the same
`{ current, previous, invert? }` signature and the same `bg-emerald-500/15 text-emerald-400` /
`bg-error/15 text-error` classes. **Frozen: define it locally.** Two ~15-line components with an
identical signature is the smaller, lower-blast-radius change, and J93 is explicitly scoped out of
touching History. If a third consumer ever appears, promote it to `charts.tsx` then — not now.

**D2 — deltas come from a second summary request, not an endpoint change.** The tab issues two
`GET /api/observability/summary` calls in one `Promise.all`: the current window, and the
immediately preceding window of equal width (`since - width` → `since`). Deltas are computed in the
component. **Frozen** because it needs zero change to 0789's frozen contract, reuses the same
indexed SQL path, and keeps "previous period" a presentation concern. *Rejected:* adding a
`compare=true` parameter or a `previousKpis` block to the DTO — that widens a contract two other
tasks already build against. The previous-window request is best-effort: if it fails or is aborted,
render the cards **without** badges (`previous: undefined`) rather than failing the whole tab.

**D3 — this task owns the additive `onNavigate` seam.** Feature R2's one-click filtering needs the
Summary tab to change the shell's active tab, and no such callback exists. **Frozen:** add
`onNavigate?: (intent: ObservabilityNavIntent) => void` to `ObservabilityTabProps` and a matching
handler in `ObservabilityShell.tsx`, where
`type ObservabilityNavIntent = { tab: 'jobs'; jobId?: string } | { tab: 'system-events'; eventName?: string; runId?: string }`
lives in `tabs.ts` next to the props. Optional, so `SystemEventsTab`, `JobsTab`, and `RoutingTab`
compile untouched (feature R10 stays safe). 0790 froze "0791 must not re-touch `tabs.ts`"; **this
one additive member is the sole agreed exception**, recorded here and in 0790's handoff. The
receiving tabs may ignore the deep-link payload in J93 — switching to the right tab satisfies R2's
"one-click filtering" line; pre-applying the filter is a follow-up, not a blocker.
*Rejected:* URL/query-param routing — the module has no router today and feature R1 tests the
"no active tab specified in the URL" path.

**D4 — prefix colors are defined once, in this tab.** The stacked chart, the severity bar, and the
top-types table must agree. `charts.tsx` supplies `ChartSeries.color` but no palette. Frozen: one
`PREFIX_COLORS: Record<string, string>` const in `observability/SummaryTab.tsx` with a deterministic
fallback (hash → palette index) for a prefix not in the map, so a newly introduced event family
still renders with a stable color instead of colliding or blanking.

**D5 — this tab does not participate in liveness.** `ObservabilityShell.tsx:32-42` reports `idle`
for every tab except `system-events`, so calling `onLivenessChange` from Summary would set state the
chip never displays. The prop is accepted and ignored, matching 0790's placeholder.
### Design
**WHAT.** One component file — `apps/web/src/modules/observability/SummaryTab.tsx` — replacing 0790's
placeholder, plus one additive optional prop on the tab contract and its shell handler. No new
module, no new chart primitive, no server change.

**WHY here.** The observability tabs are self-fetching (`JobsTab.tsx:244-275`), so the data flow
belongs inside the tab, not in the shell. The charts already exist in `history/charts.tsx` and take
exactly the shapes 0789 emits, so the whole task is mapping a DTO onto existing primitives.

**Frozen names.**

| Symbol | Location |
| --- | --- |
| `export default function SummaryTab(props: ObservabilityTabProps)` | `observability/SummaryTab.tsx` (body replaced, signature preserved from 0790) |
| `ObservabilityNavIntent` | `observability/tabs.ts` (new type, beside `ObservabilityTabProps`) |
| `ObservabilityTabProps.onNavigate?: (intent: ObservabilityNavIntent) => void` | `observability/tabs.ts:17-21` (additive, optional) |
| `PREFIX_COLORS`, `SEVERITY_COLORS`, `DeltaBadge`, `KpiCard` | module-local in `observability/SummaryTab.tsx` |

**Data flow.**
```
props.timeRange ('4h' by default, from 0790)
  → timeRangeSince(timeRange)           // ObservabilityFilters.tsx:42
  → since = that ISO (or window start for 'all'), until = now, width = until - since
  → Promise.all([
        GET /api/observability/summary?since&until,                 // current
        GET /api/observability/summary?since=since-width&until=since // previous (best-effort)
    ])
  → ObservabilitySummaryResponse × 2   // @gobing-ai/spur-contracts, frozen by 0789
  → KPI cards | StackedColumnsChart | severity bar | top types | recent failures
```
`bucket` is left unset so 0789's width-derived precedence picks it; the tab must not compute its own
bucket width. For `timeRange === 'all'`, `timeRangeSince` returns `undefined`: omit `since` entirely
and skip the previous-window request (there is no preceding period), rendering cards without badges.

**Fetch discipline** — copy `JobsTab.tsx:244-256` exactly, don't invent a variant: one
`AbortController` per effect run, `const fetchId = ++fetchIdRef.current`, ignore any response whose
`fetchId` is stale, `controller.abort()` in the cleanup, and treat `AbortError` as *not* an error
state. Use `fetchWithTimeout(new Request(resolveApiUrl(…), { signal }))` from `../../lib/rpc-client`
— not bare `fetch`, and not the oRPC `api` client (these are Hono routes, not oRPC procedures).

**Mapping to the chart primitives.**
- `series: ChartSeries[]` = the union of prefix keys across all `eventVolumeBuckets[].byPrefix`,
  sorted by descending total so the legend is stable within a render, each `{ id: prefix,
  label: prefix, color: PREFIX_COLORS[prefix] ?? fallback(prefix) }`.
- `buckets: StackedColumnBucket[]` = `eventVolumeBuckets.map(b => ({ id: b.timestamp,
  label: fmtBucketLabel(b.timestamp), v: b.byPrefix }))` — `fmtBucketLabel` and `fmtBucketTooltip`
  come from `history/charts.tsx`, so axis formatting matches History for free.
- Sparklines take `values: number[]`: `buckets.map(b => b.total)` for Total Events, and
  `buckets.map(b => b.bySeverity.error + b.bySeverity.warning)` for the Error/Warning card. The two
  job KPIs have no per-bucket series in the DTO — render those cards **without** a sparkline rather
  than fabricating one.

**Delta computation.** `delta = previous === undefined ? null : current - previous`, rendered as a
percentage of `previous` with `previous === 0` short-circuiting to a plain "new" marker instead of
`Infinity`. `invert` is set on the Error/Warning card (up is bad) and left off elsewhere.

**Severity bar.** Four segments — `info`, `warning`, `error`, `unknown` — sized by proportion of the
window total. `unknown` uses a neutral `bg-base-content/20`; it means "no `presentation.severity` in
the stored envelope", not "informational", and labelling it `info` would misreport pre-v2 rows.

**Recent failures → navigation.** Each row calls
`props.onNavigate?.({ tab: entry.source === 'job' ? 'jobs' : 'system-events', … })`. Because
`onNavigate` is optional, the row must render as a plain (non-interactive) row when it is absent —
this is what keeps the component mountable in isolation in tests.

**Anti-patterns — do not do these.**
- Do **not** import `DeltaBadge` from `history/charts.tsx`; it is not exported there (`### Q&A` D1).
- Do **not** add anything to `history/charts.tsx` or otherwise edit the History module.
- Do **not** re-register the tab, reorder `OBSERVABILITY_TABS`, change the shell's `useState`
  defaults, or touch `TIME_RANGES` / `TIME_RANGE_MS` — all 0790's, all frozen.
- Do **not** widen `ObservabilitySummaryResponse` or add a query parameter to the endpoint; the
  previous window is a second call (`### Q&A` D2).
- Do **not** fold the `unknown` severity bucket into `info`, and do **not** recompute
  `successRatePct` client-side.
- Do **not** call `onLivenessChange`, open an SSE stream, or poll on a timer.
- Do **not** make `onNavigate` required — that would break `RoutingTab` (feature R10),
  `SystemEventsTab`, and `JobsTab` at compile time.

**Primary file targets.**
- `apps/web/src/modules/observability/SummaryTab.tsx` (body replaced)
- `apps/web/src/modules/observability/tabs.ts` (one optional prop + one exported type — nothing else)
- `apps/web/src/modules/observability/ObservabilityShell.tsx` (pass the `onNavigate` handler)
- `apps/web/tests/modules/observability/summary-tab.test.tsx` (new)

**Handoffs.**
- **← 0789** — consumes `ObservabilitySummaryResponse` and `GET /api/observability/summary`. Blocked
  until that endpoint exists; do not stub it in `apps/web`.
- **← 0790** — consumes the registered `summary` tab, the placeholder file, and the `'4h'` default.
- **→ 0792** — inherits `onNavigate` on `ObservabilityTabProps`. 0792's Jobs tab **may** read
  `intent.jobId` to preselect a row, but is not required to; the seam being optional is deliberate.
### Plan
1. **(R6)** Add `ObservabilityNavIntent` and the optional `onNavigate` member to
   `ObservabilityTabProps` in `tabs.ts`, and wire a handler in `ObservabilityShell.tsx` that sets
   `activeId` from `intent.tab`. Nothing else in either file changes.
   *Test intent:* the existing `tabs.test.ts` exact-list and shell tests from 0790 still pass; a new
   case asserts the shell switches tabs when a child invokes `onNavigate`.
2. **(R1)** Replace `SummaryTab.tsx`'s body with the self-fetching skeleton: state, `fetchIdRef`,
   `AbortController`, the two-window `Promise.all`, and the `timeRange` effect dependency.
   *Test intent:* mount → one request per window with the expected `since`/`until`; a `timeRange`
   change issues a new pair; a stale response arriving after a newer one is discarded; `AbortError`
   leaves no error state.
3. **(R7)** Add the loading skeleton and the `bg-error/10 border border-error/20 text-error` failure
   panel (the `history/SummaryTab.tsx:575-579` idiom).
   *Test intent:* pending render shows the skeleton; a rejected fetch shows the panel with the
   message; a rejected **previous-window** fetch does not — the tab still renders, badge-less.
4. **(R2)** Build `KpiCard` + local `DeltaBadge` and the four cards, with sparklines on the two
   event-derived cards only.
   *Test intent:* the four values match the DTO; delta sign is positive/negative/absent for
   up/down/no-previous; `successRatePct: 0` renders `0%`; `previous: 0` renders the "new" marker,
   not `Infinity`.
5. **(R3, R4)** Derive `series` + `buckets` and render `StackedColumnsChart`; add the four-segment
   severity bar with `PREFIX_COLORS` / `SEVERITY_COLORS`.
   *Test intent:* series ids equal the union of `byPrefix` keys in descending-total order; bucket
   count equals `eventVolumeBuckets.length` including zero buckets; an unmapped prefix still gets a
   stable color; the `unknown` segment renders separately from `info`.
6. **(R5)** Render the top-event-types table and the recent-failures feed, each failure row calling
   `onNavigate` with the tab derived from `source`.
   *Test intent:* a `source: 'job'` row navigates to `jobs`, a `source: 'event'` row to
   `system-events`; with `onNavigate` undefined the rows render non-interactively and nothing throws.
7. **(R8)** Write `apps/web/tests/modules/observability/summary-tab.test.tsx` covering the above plus
   the empty-window case (all zeros, empty chart, no crash).
8. Run the gate from inside the workspace: `cd apps/web && bun test tests/modules/observability`,
   then `bun run lint`, `bun run test`, `bun run build` at the repo root.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/web/src/modules/observability/ObservabilityShell.tsx:131` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:32` |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:5` |
| `apps/web/src/modules/observability/SummaryTab.tsx:1` |
| `apps/web/src/modules/observability/SummaryTab.tsx:110` |
| `apps/web/src/modules/observability/SummaryTab.tsx:16` |
| `apps/web/src/modules/observability/SummaryTab.tsx:284` |
| `apps/web/src/modules/observability/SummaryTab.tsx:346` |
| `apps/web/src/modules/observability/tabs.ts:17` |
| `apps/web/src/modules/observability/tabs.ts:27` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/observability/SummaryTab.tsx:109` (`export default function SummaryTab(props: ObservabilityTabProps)` — 0790's placeholder body replaced, signature kept), `:110,119,158,175,182` (monotonic `fetchIdRef` guard discarding out-of-order responses), `:120` (`AbortController`), `:130,150` (`resolveApiUrl()`/`fetchWithTimeout` to `/observability/summary`), re-fetch keyed on `props.timeRange` |
| R2 | MET | `apps/web/src/modules/observability/SummaryTab.tsx:285-325` — four `KpiCard`s (Total Events, Active Jobs, Success Rate, Errors/Warnings); `:50` `DeltaBadge`, `:98` its per-card use, `:102` `Sparkline`, `:272-273` the window sparkline series. `successRatePct: 0` renders as `0%` via `fmtInt`/percent formatting — covered by `apps/web/tests/modules/observability/summary-tab.test.tsx:228` |
| R3 | MET | `apps/web/src/modules/observability/SummaryTab.tsx:326-345` (Event Volume Trend block), `:338` `<StackedColumnsChart buckets={chartBuckets} series={series} />`; stable prefix→color mapping shared across chart, severity bar, and table at `:18` (`PREFIX_COLORS`), `:32` (`colorForPrefix`) |
| R4 | MET | `apps/web/src/modules/observability/SummaryTab.tsx:347-412` severity distribution bar; `:355` `data-testid="severity-distribution-bar"`; `:364,372,380` info/warning/error segments and `:388` the distinct `severity-bar-unknown` segment (not folded into info); aggregation at `:220-227` sums all four buckets |
| R5 | MET | `apps/web/src/modules/observability/SummaryTab.tsx:416-535` hotspots; `:418-455` top event types table (`data-testid="top-event-types-table"` at `:424`, `name`/`prefix`/`count`/`latestAt` at `:434-450`); `:466-535` recent failures feed (`data-testid="recent-failures-feed"` at `:473`), each row an activator calling `:276` (`onNavigate({tab:'jobs', jobId})`) or `:280` (`onNavigate({tab:'system-events', eventName, runId})`) |
| R6 | MET | `apps/web/src/modules/observability/tabs.ts:17-20` (`ObservabilityNavIntent`), `:27` (`onNavigate?: (intent: ObservabilityNavIntent) => void` — the single added member on `ObservabilityTabProps`); `apps/web/src/modules/observability/ObservabilityShell.tsx:32-34` (`handleNavigate` → `setActiveId(intent.tab)`), `:131` (passed to the active tab). `OBSERVABILITY_TABS` order and the `useState` defaults are untouched |
| R7 | MET | `apps/web/src/modules/observability/SummaryTab.tsx:235-237` loading skeleton (`animate-pulse`, `data-testid="observability-summary-skeleton"`); `:252` error panel using the History idiom `bg-error/10 border border-error/20 text-error`; aborted fetches short-circuit at the `:158,175,182` fetch-id guards rather than surfacing as errors |
| R8 | MET | Re-run this turn: `cd apps/web && bun test tests/modules/observability` → 128 pass / 0 fail. `apps/web/tests/modules/observability/summary-tab.test.tsx:102-259` — 7 tests at `:116` (loading→loaded, 4 KPI values), `:145` (delta sign up/down/inverted/absent-previous), `:162` (stacked chart + unknown severity segment), `:184` (failure-row `onNavigate` targets), `:214` (error panel), `:228` (empty window renders zeros), `:242` (previous-window failure degrades) . Fix pass (`--fix all`) touched only gitignored artifacts: `.spur/run/0791-verify-answer.txt:6-13,18,23-25` (evidence anchors re-read at HEAD after commit `f0c330233` line drift; bare-basename citations expanded to repo-relative form) → `.spur/run/0791-verdict.json` re-derived. No source file was edited by this verify run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — Summary tab KPI metrics and trend charts | MET | test | `apps/web/tests/modules/observability/summary-tab.test.tsx:116` (four KPI cards after load), `:162` (stacked columns chart + severity bar with unknown segment), `:228` (empty window → zeros, no crash); source at `apps/web/src/modules/observability/SummaryTab.tsx:285-345` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- Parent feature: `docs/features/J93_observability-module-refactor-summary-tab-4h-range-default-queue-jobs-table-and-schedule-tracing.md` (scenario R2)
- Design satellite: `docs/design/observability-module-refactor.md` §2.1, §3.1 (`ObservabilitySummaryResponse`)
- Depends on: 0789 (endpoint + DTO), 0790 (tab registration, placeholder `SummaryTab.tsx`, `'4h'` default)
- `apps/web/src/modules/history/charts.tsx:139-152` — `StackedColumnBucket`, `ChartSeries`; `:153` — `StackedColumnsChart`; `:955` — `Sparkline`; `:66,86` — `fmtBucketLabel` / `fmtBucketTooltip`; `:29,33` — `fmtInt` / `fmtPct`
- `apps/web/src/modules/history/SummaryTab.tsx:53` — `DeltaBadge` (module-local `const`, **not** exported from `charts.tsx`); `:23-26` — the props-driven pattern this task deliberately does not follow; `:575-579` — the error-panel idiom
- `apps/web/src/modules/observability/JobsTab.tsx:244-275` — the self-fetching `AbortController` + `fetchIdRef` pattern to copy
- `apps/web/src/modules/observability/tabs.ts:17-21` — `ObservabilityTabProps`, extended here by exactly one optional member
- `apps/web/src/modules/observability/ObservabilityShell.tsx:32-42` — the liveness chip logic that makes Summary liveness dead state; `:100` — the only current `setActiveId` call site
- `apps/web/src/lib/rpc-client.ts:32,44` — `resolveApiUrl`, `fetchWithTimeout`
- `apps/web/src/modules/observability/ObservabilityFilters.tsx:42` — `timeRangeSince`
### History
- 2026-09-06T23:00:12.645Z todo → wip (system)
- 2026-09-06T23:00:29.821Z wip → testing (system)
- 2026-09-06T23:00:34.054Z testing → done (system)
