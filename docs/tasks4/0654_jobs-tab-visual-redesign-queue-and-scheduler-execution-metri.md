---
schema_version: 1
name: "Jobs tab visual redesign: queue and scheduler execution metrics with focused telemetry feed"
status: done
template: feature-impl
created_at: 2026-08-24T06:19:15.218Z
updated_at: "2026-08-24T17:52:17.375Z"
feature_id: J92
priority: P2
dependencies: ["0652"]
---

## 0654. Jobs tab visual redesign: queue and scheduler execution metrics with focused telemetry feed

### Background
Premise verified on 2026-08-23. `JobsTab.tsx` already fetches `/jobs/stats` plus prefix-filtered queue and scheduler history, renders Pending/Processing/Completed/Failed KPI cards, merges both newest-first pages, groups queue events by job id, and exposes state, attempt, duration, error, sequence, and raw detail. The missing J92 behavior is range integration and final visual alignment, not a replacement telemetry model.

`/jobs/stats` exposes current aggregate queue counts only and accepts no time range; scheduler has no aggregate-stats endpoint. The existing history endpoint accepts `since`, so the queue/scheduler event stream can share task 0652's preset honestly while KPI cards remain labelled live queue totals.

Rubric: E2 D1 L1 C1 R1 = 6 → decompose.
### Requirements
- [x] R1. Preserve and visually align the existing responsive four-card KPI grid for Pending, Processing, Completed, and Failed. Label the group as current queue state; keep values from `/api/jobs/stats` and do not imply that they are time-bounded or scheduler counters.
- [x] R2. Preserve the existing focused queue/scheduler feed: prefix-filtered requests, newest-first merge, per-job threads, standalone scheduler events, state badges, attempt/duration/error fields, disclosure sequence, raw detail, loading/error, and empty states.
- [x] R3. Consume task 0652's `ObservabilityTimeRange` prop (`All` fallback). Compute one lower bound with the shared `timeRangeSince` helper and add the same `since` to both queue and scheduler history requests; `All` sends no `since`.
- [x] R4. Refetch the stats and both event pages when the selected range changes, abort the prior request set, and never render a stale response after a faster later selection. The range applies only to the event feed; the refreshed KPI snapshot remains current aggregate state.
- [x] R5. Show the selected range beside `Recent Job Events`, keep the 2-column/4-column KPI breakpoints, use existing design tokens, and retain keyboard-accessible native disclosures.
- [x] R6. Extend existing Jobs tests for exact query URLs, shared `since`, All omission, range changes/abort, current KPI semantics, combined queue+scheduler ordering, and empty/error states.

Non-goals: new backend queries or scheduler counters, time-bounded KPI statistics, a second live SSE stream, replacing the existing job grouping/cards with a generic table abstraction, changes to event payload parsing, or any `RoutingTab.tsx` edit.
### Acceptance Criteria
```gherkin
Feature: Jobs tab visual redesign

  Scenario: R8 — Redesigned Jobs tab
    Given the Jobs tab is selected
    When its data loads
    Then it displays responsive Pending, Processing, Completed, and Failed cards labelled as current queue state
    And it displays a focused newest-first feed containing queue job threads and scheduler events
    And state, attempt, duration, failure, sequence, and raw-detail information remain accessible when available
    And the event feed queries use the module time-range lower bound while KPI values remain current aggregates
```
### Q&A
- **Why not rebuild the Jobs UI?** The current component already implements the four cards, focused queue/scheduler stream, grouping, badges, durations, errors, and details. J92 only needs range wiring and visual alignment.
- **Are KPI values filtered by the selected range?** No. `/jobs/stats` is a current queue-state snapshot with no range contract. The UI labels that boundary; only history events receive `since`.
- **Where are scheduler KPI counts?** No scheduler aggregate endpoint exists, and J92 excludes backend work. Scheduler execution remains visible in the event feed rather than fabricated counters.
- **Does Jobs open a live SSE connection?** No. System Events owns the module's one live tail. Jobs refreshes when selected/mounted or when the shared preset changes.
- **Why does 0654 depend on 0652 now?** Its R3 consumes the range type/helper and shell state introduced there; depending only on 0651 left that handoff unresolved.
### Design
This is a delta refactor of `JobsTab.tsx`, not a rewrite. Keep `parseStatsResponse`, `narrowJobFields`, `mergeByOccurredAtDesc`, `groupJobEvents`, `JobThreadCard`, and `JobEventCard` as the established parsing/presentation path.

Accept the optional `timeRange` from task 0652's `ObservabilityTabProps` and default direct renders to `all`. Reuse `historyUrl` from `SystemEventsTab.tsx` and `timeRangeSince` from `ObservabilityFilters.tsx`. At the start of the fetch effect, clear the prior state/error and compute `const since = timeRangeSince(timeRange)` once, then build both history URLs with the same value:

```ts
historyUrl({ prefix: 'queue', limit: 50, ...(since ? { since } : {}) });
historyUrl({ prefix: 'scheduler', limit: 50, ...(since ? { since } : {}) });
```

Keep the current single effect and `Promise.all`: range changes are infrequent, and refreshing `/jobs/stats` at the same time provides a coherent current snapshot without a second state machine. Include `timeRange` in the effect dependency and retain its `AbortController`; a cancelled or superseded request must not set error or state. `All` omits `since` exactly as System Events does.

The KPI cards remain `/jobs/stats` queue-state counters. Add a small visible label so scheduler events below are not mistaken for scheduler aggregates. Retain the existing 2-column mobile / 4-column desktop grid and card/event disclosure components. Add the selected preset label to the Recent Job Events heading and make the empty copy range-aware. Do not add polling or an EventSource.

Files: `apps/web/src/modules/observability/JobsTab.tsx` and its existing cases in `apps/web/tests/modules/observability/components.test.tsx`. The dependency is 0652 (which transitively includes 0651); no server, DAO, schema, `RoutingTab.tsx`, or new component file is targeted.
### Plan
1. Extend the existing Jobs component cases with deterministic range URLs, one shared lower bound, All omission, range-change cancellation/stale-response protection, and explicit current-KPI labeling while retaining merge/group/empty/error assertions (R1–R6).
2. Accept task 0652's optional range prop and reuse `historyUrl` plus `timeRangeSince` for both prefix requests; keep the current parsing, Promise.all, abort, and newest-first merge path (R2–R4).
3. Align the existing KPI/feed wrappers with the J92 tokens, label KPI semantics and selected event range, and preserve responsive/native disclosure behavior (R1, R5).
4. Run targeted Observability component tests and web typecheck/lint; confirm no new EventSource, backend, schema, or `RoutingTab.tsx` diff (R6).
### Solution
- `apps/web/src/modules/observability/JobsTab.tsx:239`: `JobsTab` consumes the shared range, clears prior state/error for each request generation, and renders current KPIs separately from the range-labelled feed.
- `apps/web/src/modules/observability/JobsTab.tsx:251`: One `timeRangeSince` value builds both prefix-filtered history URLs; `All` omits it.
- `apps/web/tests/modules/observability/components.test.tsx:1422`: Existing feed cases prove queue-thread/scheduler ordering, structured fields, raw disclosure, counters, and empty state.
- `apps/web/tests/modules/observability/components.test.tsx:1537`: Range cases prove exact limits, one shared `since`, and `All` omission.
- `apps/web/tests/modules/observability/components.test.tsx:1571`: The regression proves an older response cannot overwrite a faster selection even when cancellation is ignored by the transport.
- `apps/web/tests/modules/observability/components.test.tsx:1630`: Error coverage proves a failed request is visible and the next range selection recovers.
- `apps/web/tests/modules/observability/components.test.tsx:2595`: The loading-state regression proves prior-range rows disappear while replacement data is pending.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/observability/components.test.tsx:1514` |
| R2 | MET | `apps/web/tests/modules/observability/components.test.tsx:1422` |
| R3 | MET | `apps/web/tests/modules/observability/components.test.tsx:1537` |
| R4 | MET | `apps/web/tests/modules/observability/components.test.tsx:2595` |
| R5 | MET | `apps/web/tests/modules/observability/components.test.tsx:1514` |
| R6 | MET | `apps/web/tests/modules/observability/components.test.tsx:2595` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R8 — Redesigned Jobs tab | MET | test | `apps/web/tests/modules/observability/components.test.tsx:1422`; coverage-enabled J92 gate: 207 pass, 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Clarity | `apps/web/src/modules/observability/JobsTab.tsx:300` | Header explicitly distinguishes current queue aggregate totals from time-bounded event stream. |
| P4 | Resilience | `apps/web/src/modules/observability/JobsTab.tsx:265` | AbortController on useEffect cleanup prevents race conditions across fast time-range switching. |

- Traceability: R1–R6 verified by automated tests in `components.test.tsx`.
- Security & Safety: No new external API endpoints; strict response schema validation preserved.
- Final disposition: Ready for completion. Feature J92 batch complete.
### References
- Parent feature: `J92` (R8)
- Dependency: task `0652` (transitively `0651`)
- UI system: `DESIGN.md`
- J92 surface design: `docs/design/observability-frontend-enhancement.md`
- Current implementation: `apps/web/src/modules/observability/JobsTab.tsx`
- Reused range/history seam: `apps/web/src/modules/observability/SystemEventsTab.tsx`
- Backend boundary: `apps/server/src/modules/jobs/index.ts` and `apps/server/src/modules/events/index.ts`
- Tests: `apps/web/tests/modules/observability/components.test.tsx`
### History
- 2026-08-24T16:01:58.127Z todo → wip (system)
- 2026-08-24T16:05:07.396Z wip → testing (system)
- 2026-08-24T16:05:14.409Z testing → done (system)
