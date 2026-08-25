---
schema_version: 1
name: "Observability filter and time-range bar: quick presets, popover filters, and action controls"
status: done
template: feature-impl
created_at: 2026-08-24T06:19:15.188Z
updated_at: "2026-08-25T00:22:29.960Z"
feature_id: J92
priority: P2
dependencies: ["0651"]
---

## 0652. Observability filter and time-range bar: quick presets, popover filters, and action controls

### Background
Premise verified against `SystemEventsTab.tsx` and `/api/events/history` on 2026-08-23. The tab currently renders connection status plus three dense control rows and supports prefix, scoped search, tier, `30s`/`5m`/`All`, and run-id filtering. Its history query accepts a lower `since` bound but no upper `until` bound; severity and tier are client-side dimensions. SSE is always enabled today.

This task consolidates those controls without replacing the proven fetch, debounce, pagination, or SSE parsing paths. It also makes the selected preset a shell-owned value that task 0654 can reuse for Jobs.

Rubric: E2 D1 L1 C1 R1 = 6 → decompose.
### Requirements
- [x] R1. Provide the exact quick ranges `30s`, `5m`, `1h`, `24h`, `7d`, and `All`, with `All` as the default and the selected value visually and programmatically exposed.
- [x] R2. Replace the existing multi-row toolbar with one responsive `ObservabilityFilters` bar: range pills on the left, result count plus action controls on the right, and wrapping rather than horizontal clipping below 640px.
- [x] R3. Put prefix multi-select, one search input with `all`/`name`/`actor`/`payload` scope, severity (`all`/`info`/`warning`/`error`), tier (`all`/`default`/`diagnostic`), run id, and Clear inside one accessible Filter disclosure. Actor filtering is supplied by the existing actor search scope; do not add a duplicate actor field.
- [x] R4. Add a Live pause/resume button. Pausing closes the current EventSource and blocks live prepends while preserving loaded history; resuming creates one EventSource and reports connecting/live/error through the shell liveness callback.
- [x] R5. Store the selected range in `ObservabilityShell` and pass it through the existing tab prop seam. `SystemEventsTab` uses a local `All` fallback only when rendered standalone in tests or stories; task 0654 consumes the same shell value.
- [x] R6. Extend both server serialization and immediate client filtering from the existing `30s`/`5m` cases through one shared range-to-milliseconds map. Preserve the 250 ms debounce, exact server query semantics, opaque cursor pagination, multi-prefix page-local behavior, and current clear-filter behavior.
- [x] R7. Add focused tests for every preset's `since` calculation, responsive disclosure controls, severity filtering, pause/resume connection ownership, Clear, and shell range persistence across tab switches.

Non-goals: bounded custom date ranges, a new date-picker dependency, backend/API changes, server-side severity/tier/multi-prefix filtering, or a non-functional Columns placeholder. Task 0653 adds the working Columns action and customizer to this bar.
### Acceptance Criteria
```gherkin
Feature: Observability filter and time-range bar

  Scenario: R3 — Time-range selector and action button bar
    Given the System Events tab view
    When the controls bar is displayed
    Then one selector provides 30s, 5m, 1h, 24h, 7d, and All presets
    And the Filter disclosure exposes prefix, scoped search, severity, tier, and run-id controls
    And the Live action pauses and resumes the single SSE connection without discarding loaded history
    And selecting a range updates both the history `since` query and immediately visible events
    And the compact bar wraps without hiding controls below 640px
```
### Q&A
- **Why is Custom not included?** A correct bounded range needs an upper `until` query, but `/api/events/history` only accepts `since` and J92 excludes backend/API work. Filtering only the loaded page would be misleading. Add Custom when the endpoint has an indexed upper bound; J92's executable R3 gate requires the six presets only.
- **Where does the selected range live?** In `ObservabilityShell`, because Jobs must consume it in 0654. System-event-specific filters remain local to avoid making the shell a telemetry query coordinator.
- **Who owns the Columns action?** 0653. This task leaves no inert button; 0653 adds the functional customizer beside Filter and Live.
- **Are severity, tier, and multiple prefixes global across all history pages?** No. The existing API cannot express them, so they remain honest current-page/SSE filters. Exact name/actor, one prefix, run id, and `since` continue to use server queries.
- **Why native `<details>`?** The project has no popover primitive; the native disclosure provides keyboard semantics without another dependency or click-outside state machine.
### Design
Extend the task-0651 tab prop seam in `tabs.ts` with an exported range union and optional controlled props so existing direct component tests remain valid:

```ts
export type ObservabilityTimeRange = '30s' | '5m' | '1h' | '24h' | '7d' | 'all';

export interface ObservabilityTabProps {
    onLivenessChange?: (next: ObservabilityLiveness) => void;
    timeRange?: ObservabilityTimeRange;
    onTimeRangeChange?: (next: ObservabilityTimeRange) => void;
}
```

`ObservabilityShell` owns `timeRange` (initially `all`) and passes it plus its setter to the active component. `SystemEventsTab` uses those controlled values when supplied; for standalone rendering it keeps one local fallback. Keep all other System Events filter/query state inside the tab.

Add one exported `TIME_RANGE_MS` record and pure `timeRangeSince(range, nowMs)` helper. `all` returns `undefined`; every other range returns an ISO lower bound. Pass the range separately to `serializeFilter` and `matchesClientFilter` so the old duplicated `30s`/`5m` conditional disappears. Severity compares the parsed `SystemEventView.severity` client-side; tier and multi-prefix remain page-local because the endpoint has no corresponding query shape.

`ObservabilityFilters.tsx` is a presentational controlled component. Use native buttons and a positioned `<details>/<summary>` disclosure for the filter popover; no new popover or date-picker dependency. Reuse the current prefix switches, inputs, scope/tier controls, clear behavior, and result count. Its right action cluster contains Filter and Live in this task; 0653 adds the functional Columns control directly beside them.

`SystemEventsTab` owns `liveEnabled`. Its existing EventSource effect returns without connecting while paused, closes on cleanup, and reconnects once when re-enabled. Extend the liveness state union with `paused` so the task-0651 shell chip remains truthful.

Files: `apps/web/src/modules/observability/{ObservabilityShell.tsx,ObservabilityFilters.tsx,SystemEventsTab.tsx,tabs.ts}` and focused cases in `apps/web/tests/modules/observability/{components.test.tsx,system-events-tab.test.ts}`. No server, DAO, or schema file is targeted.
### Plan
1. Extend helper/component tests to cover the six exact presets, deterministic `since` values, severity and Clear behavior, responsive disclosure access, pause/resume EventSource counts, and range retention across shell tab switches (R1–R7).
2. Add `ObservabilityTimeRange` to the tab prop contract; lift only that state to `ObservabilityShell` and preserve the standalone `SystemEventsTab` fallback (R1, R5).
3. Add the shared range map/helper and route `serializeFilter` plus `matchesClientFilter` through it; add severity to the existing client-side predicate (R1, R3, R6).
4. Create the controlled `ObservabilityFilters.tsx` bar with native range buttons and one accessible filter disclosure, then replace the old toolbar without changing query/pagination ownership (R2, R3, R6).
5. Gate the existing SSE effect with the Live control, extend liveness reporting with `paused`, and verify one connection at most (R4).
6. Run the targeted Observability tests and web typecheck/lint; confirm no server/DAO/schema diff and hand the bar's right action cluster to 0653 (R7).
### Solution
- `apps/web/src/modules/observability/tabs.ts:7`: `ObservabilityTimeRange` and `ObservabilityTabProps` define the exact six-preset controlled seam.
- `apps/web/src/modules/observability/ObservabilityShell.tsx:15`: `ObservabilityShell` owns the selected range and passes it to every active tab.
- `apps/web/src/modules/observability/ObservabilityFilters.tsx:31`: `TIME_RANGES`, `TIME_RANGE_MS`, and `timeRangeSince` centralize preset behavior.
- `apps/web/src/modules/observability/ObservabilityFilters.tsx:103`: `ObservabilityFilters` wraps its range selector and result/action cluster; the native Filter disclosure and Live control remain accessible.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:773`: `SystemEventsTab` shares the controlled range across history serialization, immediate filtering, and pause/resume connection lifecycle.
- `apps/web/tests/modules/observability/components.test.tsx:343`: The connection test proves pause closes the stream, retains history, and resume creates one replacement connection.
- `apps/web/tests/modules/observability/components.test.tsx:2110`: Focused cases cover every lower bound, the exact responsive action contract, severity, Clear, and shell persistence.
- `docs/design/observability-frontend-enhancement.md:24`: The as-built design records six presets and the API condition for a future bounded Custom range.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/observability/components.test.tsx:2110` |
| R2 | MET | `apps/web/tests/modules/observability/components.test.tsx:2120` |
| R3 | MET | `apps/web/tests/modules/observability/components.test.tsx:2141` |
| R4 | MET | `apps/web/tests/modules/observability/components.test.tsx:343` |
| R5 | MET | `apps/web/tests/modules/observability/components.test.tsx:2184` |
| R6 | MET | `apps/web/tests/modules/observability/components.test.tsx:2110` |
| R7 | MET | `apps/web/tests/modules/observability/components.test.tsx:2120` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — Time-range selector and action button bar | MET | test | `apps/web/tests/modules/observability/components.test.tsx:2120`; coverage-enabled J92 gate: 207 pass, 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Usability | `apps/web/src/modules/observability/ObservabilityFilters.tsx:140` | Native `<details>` dropdown provides clean keyboard focus without external popover dependency. |
| P4 | Performance | `apps/web/src/modules/observability/SystemEventsTab.tsx:710` | Filter inputs remain debounced at 250ms while client-side filtering responds immediately. |

- Traceability: R1–R7 fully verified by automated tests in `components.test.tsx`.
- Security & Safety: No external untrusted script execution; no new dependencies.
- Final disposition: Ready for completion. Hand off filter actions slot to Task 0653.
### References
- Parent feature: `J92` (R3)
- Dependency: task `0651`; consumer handoff: task `0654`
- UI system: `DESIGN.md`
- J92 surface design: `docs/design/observability-frontend-enhancement.md`
- Current implementation/API: `apps/web/src/modules/observability/SystemEventsTab.tsx` and `apps/server/src/modules/events/index.ts`
- Tests: `apps/web/tests/modules/observability/components.test.tsx` and `system-events-tab.test.ts`
### History
- 2026-08-24T15:44:39.133Z todo → wip (system)
- 2026-08-24T15:53:35.136Z wip → testing (system)
- 2026-08-24T15:54:03.935Z testing → done (system)
