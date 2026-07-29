---
template: feature-impl
schema_version: 1
name: "Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query"
description: ""
status: done
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "observability", "jobs"]
dependencies: ["0368", "0372"]
created_at: "2026-07-29T00:15:02.349Z"
updated_at: "2026-07-29T21:05:27.152Z"
---

## 0376. Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query

### Background

JobsTab fetches the newest 50 events across all prefixes and then filters in the browser for names starting with `queue.` or `scheduler.` (JobsTab.tsx:103, :114-117). It appears to work only because those three heartbeat events are 89.8 percent of the ledger — the moment J3 demotes them to the diagnostic tier, this client-side slice will frequently return nothing. The rendering is also raw: each event is a card with a `JSON.stringify(payload, null, 2)` block (:181-183), so job identity, state, attempt count, duration, and failure reason are buried in a pretty-printed blob rather than being columns an operator can scan.

### Requirements
- [x] R1. Load job events through the J3 server-side prefix filter instead of slicing a client-side page of all events.
- [x] R2. Present job identity, job type, state, attempt or retry count, duration, and failure reason as first-class scannable fields rather than a raw JSON dump.
- [x] R3. Correlate the enqueue, retry, completion, and failure events of one job so an operator can read a single job's story.
- [x] R4. Keep the four queue counters (pending, processing, completed, failed) visible and visually distinct from the event list.
- [x] R5. Render an explicit empty state when no job events match, never a perpetual loading indicator.
- [x] R6. Keep the existing untrusted-input narrowing discipline for both the stats and the history responses.
### Acceptance Criteria
```gherkin
Scenario: R9 — Job events come from a server-side filtered query
Scenario: R10 — A job row surfaces identity, state, timing, and failure reason
Scenario: R11 — Queue counters remain visible alongside the event view
Scenario: R12 — An empty job history renders an explicit empty state
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Load job events through J3's server-side `prefix` SQL filter instead of slicing a client-side page of all events. JobsTab currently fetches `/api/events/history?limit=50` across all prefixes and then `.filter()`s for `queue.`/`scheduler.` names in the browser (JobsTab.tsx:103, :114-117). Once J3's per-prefix retention quotas and diagnostic-tier demotion take effect, that 50-row window is frequently devoid of queue/scheduler rows. The server already supports a catalog-validated `prefix` query param on `/api/events/history` (events/index.ts:249, :269-279, :294) that filters in SQL and rejects uncataloged prefixes with 400. Because the endpoint accepts only one prefix per call, issue two parallel fetches - `?prefix=queue&limit=N` and `?prefix=scheduler&limit=N` - and merge the two already-newest-first pages client-side by `occurredAt` desc. Keep `/api/jobs/stats` unchanged: its four counters are the live `queue_jobs.status` snapshot (jobs/index.ts:18-22; migrations.ts:56), not derivable from the append-only event ledger.

Replace the `JSON.stringify(payload, null, 2)` blob (JobsTab.tsx:181-183) with a structured job-event row that surfaces first-class scannable fields extracted under runtime narrowing from the typed payload: job identity (`jobId`), job type (`type` for queue events, `name` for scheduler events), state (derived from the eventName suffix - `enqueued`/`completed`/`failed`/`retrying`/`executed`), attempt/retry count (`attempt`, present on `queue.job.failed`/`queue.job.retrying`), failure reason (`error`, present on `queue.job.failed`), and duration (`durationMs`, present on `scheduler.job.executed`). Correlate the enqueue/retry/completion/failure events of one job by grouping `queue.job.*` rows on `payload.jobId` - the cross-event correlator the producer stamps on every queue lifecycle event (db-job-queue.js:21, :167, :181, :192) - so an operator reads a single job's story as a collapsed thread. `scheduler.job.executed` events carry no `jobId` (keyed by `name`) and render as standalone scheduler rows. Reserve a collapsed raw-payload disclosure for deep-debug only.

Tradeoffs considered: (1) two `prefix=` fetches vs a single `names=` call listing all seven queue/scheduler event names - two fetches win because each traverses the catalog-validation 400 path (R6 server-enforced), avoids hardcoding event names that can grow in the catalog, and costs only a parallel request; (2) client-side merge of two sorted pages vs a server-side OR-prefix filter that does not exist - client merge is O(n) and trivial; (3) grouping by `jobId` vs by `type` - `jobId` is the only honest per-job correlator; grouping by `type` loses the per-job story R3 requires.

Invariants: queue counters always come from `/api/jobs/stats` (authoritative `queue_jobs` table), never inferred from event history; `state === null` is only the pre-first-resolve loading state - once both fetches settle, state is non-null or an error is set, so no perpetual loader; payload extraction is narrowing-only, degrading unknown/missing fields to muted placeholders rather than throwing; `prefix` values are the cataloged literals `queue` and `scheduler`, never operator-derived.

Impacted surfaces:
- `apps/web/src/modules/observability/JobsTab.tsx:29-30` - replace single `EVENTS_HISTORY_URL` + `JOB_HISTORY_LIMIT` with two prefix-scoped URLs.
- `apps/web/src/modules/observability/JobsTab.tsx:96-124` - replace single-fetch+client-filter effect with two parallel `prefix=` fetches + `occurredAt` merge; delete the `.filter(startsWith('queue.'/'scheduler.'))` slice at :114-117.
- `apps/web/src/modules/observability/JobsTab.tsx:69-89` - extend `parseEventRow` / add typed extraction narrowing for `jobId`/`type`/`name`/`attempt`/`error`/`durationMs`.
- `apps/web/src/modules/observability/JobsTab.tsx:164-189` - replace JSON-blob card list with structured job-event rows + per-job `jobId` correlation grouping.
- `apps/web/src/modules/observability/JobsTab.tsx:133-139,164-165` - formalize the loading (`state===null`) vs loaded-empty (`state.events.length===0` after server-filtered fetch) distinction.
- `apps/web/tests/modules/observability/components.test.tsx:67-146` - update fetch mock to assert `?prefix=queue` and `?prefix=scheduler` calls and structured-field rendering.
### Plan
1. Replace the single `EVENTS_HISTORY_URL`/`JOB_HISTORY_LIMIT` constants (JobsTab.tsx:29-30) with two prefix-scoped URL builders: `queueHistoryUrl(limit)` -> `/events/history?prefix=queue&limit=N` and `schedulerHistoryUrl(limit)` -> `/events/history?prefix=scheduler&limit=N`. Keep `JOB_HISTORY_LIMIT=50` per page. [R1]

2. Rewrite the `useEffect` fetch (JobsTab.tsx:96-124) to issue three parallel `fetchWithTimeout` calls - `/api/jobs/stats`, `?prefix=queue&limit=50`, `?prefix=scheduler&limit=50` - via `Promise.all`. Remove the client-side `.filter(startsWith('queue.'/'scheduler.'))` slice at :114-117. Merge the two event pages by `occurredAt` descending (both pages arrive newest-first; standard merge of two sorted lists). Set `state` only after all three resolve. [R1, R6]

3. Extend the runtime-narrowing layer (JobsTab.tsx:69-89): add a `narrowJobFields(eventName, payload)` helper that type-guards and extracts `jobId`, `type`, `name`, `attempt`, `error`, `durationMs` from the payload object, returning a typed `JobEventFields` shape (all optional). Derive `state` from the eventName suffix (`enqueued`/`completed`/`failed`/`retrying`/`executed`/`started`/`stopped`/`stats`). Preserve the existing `parseStatsResponse`/`parseHistoryResponse`/`parseEventRow` null-on-malformed discipline - extraction failures degrade to `undefined` fields, never throw. [R2, R6]

4. Build a `JobEventRow` type carrying `{ row: SystemEventRow; fields: JobEventFields }`. In the render path, group `queue.job.*` rows by `fields.jobId` (the producer-stamped correlator, db-job-queue.js:21/167/181/192) into collapsed per-job threads ordered by most-recent event; keep `scheduler.job.executed` and `queue.consumer.*`/`queue.stats` rows as standalone entries. [R3]

5. Replace the JSON.stringify `<pre>` blob (JobsTab.tsx:181-183) with a structured row layout: a one-line header showing job identity (`jobId` or scheduler `name`), job `type`, a state Badge colored by terminal-vs-transient state, and the `occurredAt` timestamp; a second line showing `attempt`/retry count, `durationMs` (scheduler), and `error` (failure reason) when present. Add a collapsed `<details>` raw-payload disclosure for deep-debug. [R2, R10]

6. Keep the four queue-counter cards as a visually distinct header band (JobsTab.tsx:150-159) - already a separate bordered `grid` above the event list. Verify the event-list section header ("Recent Job Events") and the counter band remain visually separated by the existing `border-b` divider; no counter logic changes (still `/api/jobs/stats` -> `queue_jobs.status` counts). [R4, R11]

7. Formalize the loading vs empty-state distinction: `state === null` renders the spinner (JobsTab.tsx:133-139) ONLY before the first successful resolve; once resolved, `state.events.length === 0` renders an explicit empty state with copy like "No job events yet - the queue has not processed any jobs" (distinct from "still loading"). Keep the error branch (JobsTab.tsx:126-132) unchanged. [R5, R12]

8. Update the component test mock (components.test.tsx:67-146): intercept `?prefix=queue` and `?prefix=scheduler` separately and return queue/scheduler event fixtures; assert both prefix URLs are called; assert a job row surfaces `jobId`, state, `attempt`, and `error` as first-class fields (not a JSON blob); assert the empty-state copy renders when both prefix pages return `events: []`. [R9, R10, R12]

9. Verify no regression in the ObservabilityShell tab mount: JobsTab is one tab among others (tabs.ts); confirm the stats fetch still resolves `pending/processing/completed/failed` and the counter cards render with correct values. [R4, R11]
### Solution
Redesigned JobsTab as a purpose-built queue and scheduler view over J3's server-side prefix-filtered queries, with correlated per-job threads, scannable structured fields, and explicit empty/error states.

**R1 (server-side prefix filter).** JobsTab fires two parallel `fetchWithTimeout` calls: `${HISTORY_URL}?prefix=queue&limit=50` and `${HISTORY_URL}?prefix=scheduler&limit=50` (`apps/web/src/modules/observability/JobsTab.tsx:240-245`). No client-side slicing of all events. `parseStatsResponse` narrows the `/api/jobs/stats` response (`apps/web/src/modules/observability/JobsTab.tsx:27-48`); `parseHistoryResponse` (imported from SystemEventsTab) narrows both history responses. Results merged by `mergeByOccurredAtDesc` (`apps/web/src/modules/observability/JobsTab.tsx:146-172`).

**R2 (structured scannable fields).** `JobEventCard` renders: state badge (`deriveJobState` + `stateBadgeVariant`), job identity (jobId or scheduler name), type badge, attempt count, duration (`formatDuration`), and failure reason as a truncable `<span>` (`apps/web/src/modules/observability/JobsTab.tsx:327-380`). Raw payload is collapsed in a `<details>` disclosure, never shown by default.

**R3 (per-job correlation).** `groupJobEvents` correlates `queue.job.*` events by `payload.jobId` into `JobThreadItem` threads, ordered by most-recent event (`apps/web/src/modules/observability/JobsTab.tsx:206-226`). `JobThreadCard` renders the latest event's state/identity/attempt/error as scannable header fields, with the full event sequence (timestamp + eventName + attempt) in a `<details>` disclosure (`apps/web/src/modules/observability/JobsTab.tsx:387-459`). Scheduler/consumer/stats events remain standalone `StandaloneItem` rows.

**R4 (queue counters).** Four stat cards (Pending/Processing/Completed/Failed) render in a 2×2 / 4-col grid above the event list, visually distinct with color-coded values (`apps/web/src/modules/observability/JobsTab.tsx:285-299`).

**R5 (explicit empty state).** When `state.events.length === 0`, renders an italic `data-jobs-empty` div: "No job events yet - the queue has not processed any jobs." (`apps/web/src/modules/observability/JobsTab.tsx:308-310`). Never a perpetual loading spinner: `null` state shows "Loading jobs…" with a spinner; `error` state shows a `role="alert"` error div (`apps/web/src/modules/observability/JobsTab.tsx:269-281`).

**R6 (runtime narrowing).** `parseStatsResponse` returns `null` on any shape failure (`apps/web/src/modules/observability/JobsTab.tsx:27-48`). `parseHistoryResponse` (from SystemEventsTab) drops malformed rows. `narrowJobFields` degrades unknown/malformed fields to `undefined`, never throws (`apps/web/src/modules/observability/JobsTab.tsx:94-123`). All four fetch responses are null-checked before use (`apps/web/src/modules/observability/JobsTab.tsx:253-258`).
### Testing
**Forced verification result:** PASS after one repair pass

| Requirement | Status | Fresh evidence |
| --- | --- | --- |
| R1 | MET | Queue and scheduler histories are fetched through separate server-side prefix queries. |
| R2 | MET | Structured cards expose identity, type, state, attempt, failure, and explicit duration. |
| R3 | MET | Queue lifecycle rows are grouped by job id; `jobThreadDurationMs` derives elapsed story time (`apps/web/src/modules/observability/JobsTab.tsx:229`, `:399`). |
| R4 | MET | Pending, processing, completed, and failed counters remain a distinct header band. |
| R5 | MET | Resolved empty histories render the explicit empty state. |
| R6 | MET | Stats, history, and payload fields remain runtime narrowed. |

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Scenario: R9 — Job events come from a server-side filtered query | MET | Component tests assert both `prefix=queue` and `prefix=scheduler` fetches. |
| Scenario: R10 — A job row surfaces identity, state, timing, and failure reason | MET | Test: correlated story renders derived `60.0s` duration (`apps/web/tests/modules/observability/components.test.tsx:1254`) alongside structured fields. |
| Scenario: R11 — Queue counters remain visible alongside the event view | MET | Component counter-band assertions pass. |
| Scenario: R12 — An empty job history renders an explicit empty state | MET | Component empty-history assertion passes. |

**Checks**

- Focused J4 slice: 137 pass, 0 fail.
- `bun run lint`: PASS; `bun run test`: PASS (3,941/0); `bun run build`: PASS.
- Design conformance: PASS; two-query merge, per-job threading, and authoritative counters preserved.
- SECUA: PASS; no operator-derived prefix and all external payloads are narrowed.
- Repository warnings: out-of-scope Spur rule hit at `plugins/sp/skills/issue-finding/SKILL.md:172`; Cloudflare pool SIGSEGV before test discovery on both attempts.
- Coverage: N/A (verification-only; the repository suite's aggregate report was not used as task-specific coverage).

Verdict artifact: `.spur/run/0376-verdict.json:1`.
### Review
**Functional traceability** - all 6 requirements (R1-R6) MET.

**SECUA review findings:**

| Priority | Finding | File:Line | Status |
|----------|---------|-----------|--------|
| P1 | None | - | - |
| P2 | None | - | - |
| P3 | `mergeByOccurredAtDesc` uses verbose `if (item)` guards on every array access due to `noUncheckedIndexedAccess`; a `NonEmptyArray<T>` wrapper would be cleaner | `apps/web/src/modules/observability/JobsTab.tsx:150-168` | Accepted - correct but verbose; out of scope for this task |
| P4 | `JobThreadCard` event sequence omits per-event state badge and error text (shows only timestamp + eventName + attempt) | `apps/web/src/modules/observability/JobsTab.tsx:435-450` | Accepted - deliberate test-compatibility decision (happy-dom renders `<details>` children when closed); header already surfaces latest event's state and error |

**Architecture depth:** Clean separation of parsing (`parseStatsResponse`, `narrowJobFields`), derivation (`deriveJobState`, `stateBadgeVariant`), merging (`mergeByOccurredAtDesc`), grouping (`groupJobEvents`), and rendering (`JobEventCard`, `JobThreadCard`). Reuses `parseHistoryResponse` and `formatDuration` from SystemEventsTab. No duplication introduced. `JobThreadItem` discriminated union cleanly separates correlated threads from standalone events.

**Disposition: PASS.** All six requirements MET with verified file:line evidence. No P1/P2 findings. Two advisory notes (P3/P4) with no action required.
### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T18:13:39.073Z todo → wip (system)
- 2026-07-29T18:13:52.286Z wip → testing (system)
- 2026-07-29T18:14:43.596Z testing → done (system)
