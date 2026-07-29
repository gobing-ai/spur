---
template: feature-impl
schema_version: 1
name: "Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "observability", "jobs"]
dependencies: ["0368", "0372"]
created_at: "2026-07-29T00:15:02.349Z"
updated_at: "2026-07-29T05:51:39.307Z"
---

## 0376. Redesign the Jobs tabview as a purpose-built queue and scheduler view over a filtered query

### Background

JobsTab fetches the newest 50 events across all prefixes and then filters in the browser for names starting with `queue.` or `scheduler.` (JobsTab.tsx:103, :114-117). It appears to work only because those three heartbeat events are 89.8 percent of the ledger — the moment J3 demotes them to the diagnostic tier, this client-side slice will frequently return nothing. The rendering is also raw: each event is a card with a `JSON.stringify(payload, null, 2)` block (:181-183), so job identity, state, attempt count, duration, and failure reason are buried in a pretty-printed blob rather than being columns an operator can scan.

### Requirements
- [ ] R1. Load job events through the J3 server-side prefix filter instead of slicing a client-side page of all events.
- [ ] R2. Present job identity, job type, state, attempt or retry count, duration, and failure reason as first-class scannable fields rather than a raw JSON dump.
- [ ] R3. Correlate the enqueue, retry, completion, and failure events of one job so an operator can read a single job's story.
- [ ] R4. Keep the four queue counters (pending, processing, completed, failed) visible and visually distinct from the event list.
- [ ] R5. Render an explicit empty state when no job events match, never a perpetual loading indicator.
- [ ] R6. Keep the existing untrusted-input narrowing discipline for both the stats and the history responses.
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
