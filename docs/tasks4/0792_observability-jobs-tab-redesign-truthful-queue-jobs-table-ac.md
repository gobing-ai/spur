---
schema_version: 1
name: "Observability Jobs tab redesign: truthful queue_jobs table, active schedules card, and detail drawer"
status: done
template: feature-impl
created_at: 2026-09-06T21:43:37.718Z
updated_at: "2026-09-06T23:06:01.478Z"
feature_id: J93
priority: P2
tags: ["observability", "web", "ui", "jobs"]
dependencies: ["0789", "0790"]
---

## 0792. Observability Jobs tab redesign: truthful queue_jobs table, active schedules card, and detail drawer

### Background
Covers feature J93 scenarios R5, R6 (client half), R7 (client half), R8, and R9. Depends on **0789**
for `GET /api/jobs`, `GET /api/jobs/schedules`, and the `QueueJobRow` / `SchedulerScheduleRow` DTOs,
and on **0790** for the `'4h'` default range and the exported `RetentionBadge`. Verified against the
tree at refine time (2026-09-06):

**What JobsTab does today** (`apps/web/src/modules/observability/JobsTab.tsx`, 522 lines): three
parallel fetches — `/api/jobs/stats` plus two `/api/events/history` calls (`prefix=queue`,
`prefix=scheduler`, `JOB_HISTORY_LIMIT = 50`) — merged client-side into a synthetic job list. Because
`system_events` is capped by a **per-prefix row quota** (10,000 rows;
`packages/app/src/services/system-event-retention.ts:11`), older runs silently disappear from that
list even though their `queue_jobs` rows are still there for 30 days
(`packages/domain/src/retention.ts:25`). That is the bug feature R5 names.

**Reusable pieces already in the file.** `JobEventFields` (`JobsTab.tsx:56+`) already does
narrowing-only extraction of `jobId` / `type` from queue payloads, and `SystemEventsTab` exports
`historyUrl`, `parseHistoryResponse`, `SystemEventRow`, and `formatDuration` (imported at
`JobsTab.tsx:5`). The drawer reuses these rather than adding a parallel parser.

**Correction 1 — `queue.job.started` does not exist.** The design satellite §2.6 states the drawer
renders `queue.job.enqueued → queue.job.started → queue.job.completed/failed`. The real catalog
(`packages/app/src/services/event-names.ts:257-263`) is:
`queue.consumer.started`, `queue.consumer.stopped`, `queue.job.enqueued`, `queue.job.completed`,
`queue.job.failed`, `queue.job.retrying`, `queue.stats`, and `scheduler.job.executed`. There is **no
started event**. Job start is observable only from `queue_jobs.processing_at`, which 0789 already
surfaces as `QueueJobRow.startedAt`.

**Correction 2 — the two most useful lifecycle events are diagnostic-tier.**
`queue.job.enqueued`, `queue.job.completed`, and `scheduler.job.executed` are all registered with
tier `diagnostic` (same lines), meaning they are **not recorded at all** unless
`SPUR_DIAGNOSTIC_EVENTS=1`. On a default install the drawer's timeline will contain only
`queue.job.failed` / `queue.job.retrying` rows, and frequently nothing. The drawer must therefore
treat an empty chain as a normal state with an explanatory note, not as an error or a spinner.

**Correction 3 — `?runId=<jobId>` will not match queue events.** `system_events.run_id` is populated
only from a payload `runId` / `run_id` (`packages/app/src/services/system-event-tap.ts:202`:
`const runId = obj.runId ?? obj.run_id ?? nested.runId;`) — there is no `jobId` fallback. Queue
events carry the correlator at `payload_json -> '$.context.correlation.jobId'`
(`packages/app/src/services/system-event-envelope.ts:38-46,348`). So the satellite's
`/api/events/history?runId=<jobId>` returns an empty set for every job. See `### Q&A` D3 for the
frozen correlation strategy.

**Correction 4 — the retention badge copy.** The satellite §2.7 specifies
`ℹ️ Retention: events retained 7d, jobs retained 30d`. Events have **no** time-based retention at
all. 0790 froze the corrected copy inside the exported `RetentionBadge`; this task renders that
component rather than writing its own string.

**Schedules realities inherited from 0789.** `SchedulerScheduleRow.nextFireAt` is
`string | null` — `null` for cron-expression entries until the ts-infra cron facade is exported
(0789 `### Q&A` D4) — `lastStatus` can be `'none'`, and `source` is `'builtin' | 'config'`. The two
shipped built-ins are **interval** entries (`'300000'`, `'600000'` ms; `apps/server/src/serve.ts:85-86`),
so on a default install every row has an exact `nextFireAt` and the `null` branch appears only when
an operator configures a cron job.
### Requirements
- [x] R1. `JobsTab.tsx` fetches `GET /api/jobs?status=&since=&limit=&offset=` (typed by
      `QueueJobListResponse` from `@gobing-ai/spur-contracts`) as its single source of job rows. The
      `prefix=queue` / `prefix=scheduler` `/api/events/history` calls and the client-side merge are
      **deleted**, not left dormant. `since` comes from `timeRangeSince(props.timeRange)`.
- [x] R2. Status filter chips render `All`, `Failed`, `Running`, `Completed` with counts read from
      `countsByStatus` (`running` maps to `processing`). Selecting a chip re-requests with
      `status=`; counts stay complete while a filter is active because 0789 computes them ignoring
      the status filter.
- [x] R3. When `countsByStatus.failed > 0`, a warning banner renders
      `N jobs failed in this window` with a `Filter to Failed` action that selects the Failed chip.
- [x] R4. The table renders first-class columns Status, Job Type, Enqueued At, Started At, Duration,
      Attempts, Error — sourced from `QueueJobRow` with no client-side timing math. `startedAt: null`
      and `durationMs: null` render as an em dash, never as `0ms` or `Invalid Date`.
- [x] R5. Failed rows show `lastError` inline, truncated, with an expand affordance for the full
      text. Expansion is per-row and does not open the drawer.
- [x] R6. An Active Schedules card renders above the table from `GET /api/jobs/schedules`, showing
      `name`, `cron`, `cadence`, `nextFireAt`, `lastFiredAt`, `lastStatus`, and a `builtin`/`config`
      marker. `nextFireAt: null` renders as `next run: cron (unknown)` and `lastStatus: 'none'` as
      `never run`. A schedules fetch failure degrades the card only — the jobs table still renders.
- [x] R7. `apps/web/src/modules/observability/JobDetailDrawer.tsx` opens on row click, showing job
      metadata, formatted `payload`, the full `lastError`, and a chronological lifecycle timeline
      correlated by `jobId` per `### Q&A` D3. An empty timeline renders the diagnostic-tier
      explanation, not an error or an endless spinner.
- [x] R8. The drawer links to the correlated events in the System Events tab via
      `props.onNavigate?.({ tab: 'system-events', … })` (the optional seam 0791 adds), and renders
      the link only when `onNavigate` is supplied.
- [x] R9. `RetentionBadge` (imported from `./ObservabilityFilters`, 0790) renders in the Jobs
      controls bar. The copy is not redefined here.
- [x] R10. `apps/web/tests/modules/observability/jobs-tab.test.tsx` covers chip filtering and counts,
      the failure banner and its action, the null-timing and null-`nextFireAt` renders, inline error
      expansion, drawer open/close and its empty-timeline state, schedules-fetch degradation, and
      the retention badge's presence.

**Out of scope (non-goals).** No server, domain, or contracts change — 0789 owns all three
endpoints, and this task must not add query parameters to them. No `/api/events/history` change. No
`SummaryTab`, tab registry, time-range preset, or shell default change (0790/0791). The Routing and
System Events tabs are untouched (feature R10). No live SSE tail on the Jobs tab. No job
mutation — no retry, cancel, or delete control; this is a read-only forensic view.
### Acceptance Criteria
```gherkin
Feature: Observability Jobs tab redesign

  Scenario: R5 — Jobs tab queried directly from queue_jobs table
    Given the Jobs tab is selected
    When the tab loads job records
    Then jobs are fetched from the queue_jobs database table rather than reconstructed from system_events
    And job runs older than the system_events retention quota remain visible and searchable

  Scenario: R6 — Server-side jobs query endpoint with timing calculations and status filtering
    Given queue jobs in various lifecycle states
    When GET /api/jobs is requested with status or since query parameters
    Then the server returns newest-first queue job records with server-computed queuedAt, startedAt, endedAt, and durationMs
    And the endpoint supports filtering by status (pending, processing, completed, failed) and keyset or offset pagination
    And rows whose startedAt or durationMs is null render as an em dash rather than a zero duration

  Scenario: R7 — Active cron schedule visibility and next-fire calculation
    Given configured built-in and bootstrap scheduler jobs
    When GET /api/jobs/schedules is requested or the Jobs tab renders
    Then an Active Schedules overview displays registered job names, cron expressions, human-readable cadences, next-fire timestamps, and last execution status
    And next-fire times update accurately based on cron evaluation
    And an entry with no computable next fire renders as "cron (unknown)" instead of an invalid date

  Scenario: R8 — Run detail drawer keyed by jobId with correlated event chain
    Given the Jobs tab table
    When the operator clicks a job row
    Then a slide-over detail drawer opens displaying job ID, status, attempts, execution duration, and formatted payload parameters
    And the drawer renders a chronological lifecycle timeline (enqueued, started, completed, or failed) queried from system_events by matching jobId
    And a link is provided to open the correlated events in the System Events tab
    And a timeline with no rows explains that queue lifecycle events are diagnostic-tier rather than reporting an error

  Scenario: R9 — Status filter chips, inline error preview, and retention notice
    Given the Jobs tab controls and table
    When jobs are displayed
    Then status filter chips allow toggling between All, Failed, Running, and Completed with live item counts
    And rows with failed status display the last_error text inline with expandable details
    And a retention policy badge clarifies the pruning cutoff for events and terminal jobs
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T22:08:25.399Z

**D1 — `/api/jobs/stats` is dropped from this tab, and the route stays.** `countsByStatus` from
`GET /api/jobs` already carries every number the chips need, over the same `since` window, so a
second call would be a redundant round trip that can disagree with the table. The server route is
**not** deleted — 0789 froze its response shape as unchanged and other consumers may exist.

**D2 — the "started" step of the timeline comes from `queue_jobs`, not from an event.** There is no
`queue.job.started` in the catalog (`### Background` correction 1). The drawer synthesizes that step
from `QueueJobRow.startedAt` (i.e. `processing_at`) and labels it as derived. *Rejected:* emitting a
new `queue.job.started` event — that is a change to the shared event catalog and the queue consumer,
far outside a frontend task, and `processing_at` already records the fact truthfully.

**D3 — correlation is by payload `jobId`, filtered client-side over a bounded queue window.**
`/api/events/history?runId=<jobId>` cannot work: `run_id` is derived only from payload `runId` /
`run_id` (`system-event-tap.ts:202`), while queue events carry `jobId` under
`context.correlation.jobId`. **Frozen:** the drawer requests
`historyUrl({ prefix: 'queue', since: job.queuedAt, limit: 200 })` and keeps rows whose extracted
`jobId` equals the selected job's id, reusing the existing `JobEventFields` extractor
(`JobsTab.tsx:56+`) and `parseHistoryResponse`. Bounded by the job's own enqueue time, so the scan
is small; needs no server change against 0789's frozen contract. *Rejected:* adding a `jobId`
parameter to `/api/events/history` — a shared endpoint with its own task lineage, and 0789 is
already frozen. **Upgrade path:** if the client-side filter proves too coarse (a very busy queue
window), add `jobId` to `/api/events/history` backed by
`json_extract(payload_json, '$.context.correlation.jobId')` in a follow-up task; the drawer's call
site is the only thing that would change.

**D4 — an empty timeline is a first-class state, not an error.** `queue.job.enqueued`,
`queue.job.completed`, and `scheduler.job.executed` are **diagnostic-tier**
(`event-names.ts:259-263`) and are not recorded unless `SPUR_DIAGNOSTIC_EVENTS=1`. On a default
install a successful job produces **no** queue events at all. Frozen copy for that state:
`No lifecycle events recorded. Queue lifecycle events are diagnostic-tier — set SPUR_DIAGNOSTIC_EVENTS=1 to capture them.`
The job's own metadata (status, attempts, timings, error) always renders, because it comes from
`queue_jobs`, which is the point of feature R5.

**D5 — the schedules card fetches independently and degrades independently.** Two `useEffect`s, two
`AbortController`s: a `/api/jobs/schedules` failure renders an inline "schedules unavailable" note
inside the card while the jobs table renders normally, and vice versa. A single `Promise.all` would
let either failure blank the whole tab — the opposite of a forensic view's job.

**D6 — status filtering is server-side; only `lastError` expansion is local.** Filtering client-side
would break `total` / `hasMore` and contradict feature R6's SQL-side filtering. Chip selection is
component state that feeds the `status` query param and triggers a refetch; row expansion is the
only purely local UI state.

**D7 — pagination uses `limit`/`offset` with a "Load more" affordance.** 0789 froze
`limit` (default 100, max 500) + `offset` with a `hasMore` flag. Frozen: request 100, append on
`hasMore`. Infinite scroll and keyset cursors are out of scope for J93.
### Design
**WHAT.** A rewrite of `JobsTab.tsx` from event replay to a single `queue_jobs`-backed endpoint, a
new `JobDetailDrawer.tsx`, and an Active Schedules card. Frontend only — every endpoint it calls is
0789's, already frozen.

**WHY here.** The truthfulness bug is a data-source bug: the fix is to stop merging two event
streams and read the durable table. Doing that shrinks `JobsTab` (522 lines today) rather than
growing it — the stats parser, the dual `historyUrl` build, and the merge all disappear.

**Frozen names.**

| Symbol | Location |
| --- | --- |
| `export default function JobsTab(props: ObservabilityTabProps)` | `observability/JobsTab.tsx` (signature preserved) |
| `export default function JobDetailDrawer(props: JobDetailDrawerProps)`, `JobDetailDrawerProps` | `observability/JobDetailDrawer.tsx` (new) |
| `ActiveSchedulesCard` | module-local in `observability/JobsTab.tsx` |
| `JobStatusFilter = 'all' \| 'failed' \| 'running' \| 'completed'` | module-local in `observability/JobsTab.tsx` |
| `RetentionBadge` | imported from `./ObservabilityFilters` (0790) — **not** redefined |
| `QueueJobRow`, `QueueJobListResponse`, `SchedulerScheduleRow`, `SchedulerSchedulesResponse` | imported from `@gobing-ai/spur-contracts` (0789) |

**Data flow.**
```
props.timeRange ('4h' default, 0790) ──▶ timeRangeSince() ──▶ since
chip state (JobStatusFilter) ─────────▶ status  ('running' → 'processing', 'all' → omitted)
                    │
                    ├─▶ GET /api/jobs?status&since&limit=100&offset  ──▶ QueueJobListResponse
                    │        ├─ jobs[]         → table rows
                    │        ├─ countsByStatus → chip badges + failure banner
                    │        └─ hasMore        → "Load more" (offset += 100)
                    └─▶ GET /api/jobs/schedules                      ──▶ SchedulerSchedulesResponse
                                                                          → ActiveSchedulesCard

row click ──▶ JobDetailDrawer(job)
                └─▶ historyUrl({ prefix:'queue', since: job.queuedAt, limit: 200 })
                        → parseHistoryResponse → keep rows whose JobEventFields.jobId === job.id
                        → merged with a synthesized "started" step from job.startedAt
```

**Fetch discipline** — the existing `JobsTab.tsx:244-256` pattern, one `AbortController` +
`fetchIdRef` **per independent request** (jobs, schedules, drawer chain). `fetchWithTimeout(new
Request(resolveApiUrl(…), { signal }))`; `AbortError` is never an error state. The jobs effect
depends on `[timeRange, statusFilter, offset]`; the schedules effect on `[]` (plus an explicit
refresh action); the drawer effect on `[job?.id]`.

**Render precedence, top to bottom:** controls bar (status chips + `RetentionBadge`) → failure
banner (only when `countsByStatus.failed > 0`) → Active Schedules card → jobs table → "Load more".

**Null-state rendering, frozen.** Every one of these is a normal state, and each has exactly one
render:
| Field | Null/edge value | Renders as |
| --- | --- | --- |
| `startedAt` | `null` (pending) | `—` |
| `endedAt` | `null` (not terminal) | `—` |
| `durationMs` | `null` (running or pre-`processing_at`) | `—`, never `0ms` |
| `lastError` | `null` | empty cell |
| `payload` | `null` (malformed server-side) | `payload unavailable` |
| `nextFireAt` | `null` (cron entry, 0789 D4) | `next run: cron (unknown)` |
| `lastStatus` | `'none'` | `never run` |
| drawer timeline | `[]` | the D4 diagnostic-tier note |
| `jobs` | `[]` | empty-state row, not a spinner |

**Duration formatting** reuses `formatDuration` already imported from `SystemEventsTab`
(`JobsTab.tsx:5`) — do not add a second formatter.

**What gets deleted from `JobsTab.tsx`:** `JobStats`, `StatsResponse`, `JobsState`,
`parseStatsResponse`, `JOB_STATS_URL`, `JOB_HISTORY_LIMIT`, the dual `historyUrl` construction and
the three-way `Promise.all` (`:263-275`), and the client-side merge. `JobEventFields` and its
extractor **stay** — the drawer uses them (`### Q&A` D3).

**Anti-patterns — do not do these.**
- Do **not** query `/api/events/history?runId=<jobId>`; `run_id` is never populated from `jobId`
  (`### Background` correction 3). It returns an empty set, which would look like "no events" forever.
- Do **not** render a `queue.job.started` row as if it came from the event log — no such event
  exists; synthesize it from `startedAt` and label it as derived (D2).
- Do **not** treat an empty lifecycle chain as an error or keep a spinner up; diagnostic-tier events
  are absent by default (D4).
- Do **not** re-write the retention copy — import `RetentionBadge` (0790 D2/D3).
- Do **not** filter, sort, or paginate jobs client-side; it corrupts `total` / `hasMore` and
  contradicts feature R6.
- Do **not** call `/api/jobs/stats` from this tab, and do **not** delete the server route.
- Do **not** add query parameters to `/api/jobs`, `/api/jobs/schedules`, or `/api/events/history` —
  0789 is frozen; use the D3 upgrade path if it ever proves necessary.
- Do **not** add retry/cancel/delete controls — J93 is read-only.
- Do **not** touch `SystemEventsTab.tsx` beyond importing from it, or `RoutingTab.tsx` at all.

**Primary file targets.**
- `apps/web/src/modules/observability/JobsTab.tsx` (rewrite)
- `apps/web/src/modules/observability/JobDetailDrawer.tsx` (new)
- `apps/web/tests/modules/observability/jobs-tab.test.tsx` (new/replacing job cases in `components.test.tsx`)

**Handoffs.**
- **← 0789** — `GET /api/jobs`, `GET /api/jobs/schedules`, and the four DTOs. Blocked until they
  exist; do not stub them in `apps/web`.
- **← 0790** — `'4h'` default range and the exported `RetentionBadge`.
- **← 0791** — the optional `onNavigate` prop on `ObservabilityTabProps`. Used for R8's
  System-Events link and, optionally, to preselect a row when 0791's Summary navigates here with a
  `jobId`. If 0791 has not landed, R8's link is simply not rendered (the prop is optional) — it does
  not block this task.
- **→ wrap** — `docs/design/observability-module-refactor.md` §2.5, §2.6, §2.7 and the mermaid
  `7d quota` node still carry the four corrected premises; the satellite fix is owed at wrap (T3).
### Plan
1. **(R1)** Replace `JobsTab.tsx`'s data layer: delete `parseStatsResponse` / `JobStats` /
   `StatsResponse` / `JobsState` / `JOB_STATS_URL` / `JOB_HISTORY_LIMIT` and the three-way
   `Promise.all`; fetch `GET /api/jobs?status&since&limit=100&offset` typed by
   `QueueJobListResponse`. Keep `JobEventFields` for the drawer.
   *Test intent:* one jobs request on mount with `since` derived from `timeRange`; a `timeRange`
   change refetches; a stale response is discarded; no `/api/events/history` request is issued by
   the tab itself.
2. **(R2, R6-controls)** Add `JobStatusFilter` chip state and the controls bar, mapping
   `running → processing` and omitting `status` for `all`, with counts from `countsByStatus`. Render
   the imported `RetentionBadge` (R9) beside the chips.
   *Test intent:* clicking `Failed` issues `status=failed`; badge counts stay complete while a chip
   is active; the badge shows the 10,000/30d copy and never the string `7d`.
3. **(R3)** Add the failure banner gated on `countsByStatus.failed > 0`, whose action selects the
   Failed chip.
   *Test intent:* banner absent at `failed: 0`, present with the count at `failed: 3`, and its
   action drives the same request as the chip.
4. **(R4, R5)** Render the table with the seven first-class columns straight from `QueueJobRow`, plus
   inline truncated `lastError` with per-row expansion.
   *Test intent:* a pending row shows `—` for Started/Duration; a running row shows `startedAt` but
   `—` duration; a terminal row shows all three; expanding one row's error leaves other rows and the
   drawer untouched.
5. **(R6)** Build `ActiveSchedulesCard` with its own effect against `GET /api/jobs/schedules`.
   *Test intent:* an interval entry renders an ISO `nextFireAt`; a cron entry with `nextFireAt: null`
   renders `cron (unknown)`; `lastStatus: 'none'` renders `never run`; a 500 from the schedules
   endpoint degrades the card while the jobs table still renders.
6. **(R7)** Build `JobDetailDrawer.tsx`: metadata, formatted payload, full error, and the timeline —
   the D3 client-filtered queue window merged with the derived "started" step from `job.startedAt`,
   sorted chronologically.
   *Test intent:* row click opens the drawer with the right job; the timeline keeps only matching
   `jobId` rows and drops others in the same window; an empty chain renders the D4 note; close
   returns focus to the row.
7. **(R8)** Add the System Events link, rendered only when `props.onNavigate` is defined.
   *Test intent:* with `onNavigate` supplied the link fires
   `{ tab: 'system-events', … }`; with it undefined the link is absent and nothing throws.
8. **(R10)** Write `apps/web/tests/modules/observability/jobs-tab.test.tsx` covering the above, then
   run `cd apps/web && bun test tests/modules/observability`, followed by `bun run lint`,
   `bun run test`, `bun run build` at the repo root.
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/web/src/modules/observability/JobsTab.tsx:1` |
| `apps/web/src/modules/observability/JobsTab.tsx:11` |
| `apps/web/src/modules/observability/JobsTab.tsx:133` |
| `apps/web/src/modules/observability/JobsTab.tsx:147` |
| `apps/web/src/modules/observability/JobsTab.tsx:151` |
| `apps/web/src/modules/observability/JobsTab.tsx:156` |
| `apps/web/src/modules/observability/JobsTab.tsx:158` |
| `apps/web/src/modules/observability/JobsTab.tsx:16` |
| `apps/web/src/modules/observability/JobsTab.tsx:161` |
| `apps/web/src/modules/observability/JobsTab.tsx:172` |
| `apps/web/src/modules/observability/JobsTab.tsx:179` |
| `apps/web/src/modules/observability/JobsTab.tsx:18` |
| `apps/web/src/modules/observability/JobsTab.tsx:189` |
| `apps/web/src/modules/observability/JobsTab.tsx:201` |
| `apps/web/src/modules/observability/JobsTab.tsx:204` |
| `apps/web/src/modules/observability/JobsTab.tsx:206` |
| `apps/web/src/modules/observability/JobsTab.tsx:208` |
| `apps/web/src/modules/observability/JobsTab.tsx:218` |
| `apps/web/src/modules/observability/JobsTab.tsx:22` |
| `apps/web/src/modules/observability/JobsTab.tsx:226` |
| `apps/web/src/modules/observability/JobsTab.tsx:254` |
| `apps/web/src/modules/observability/JobsTab.tsx:258` |
| `apps/web/src/modules/observability/JobsTab.tsx:261` |
| `apps/web/src/modules/observability/JobsTab.tsx:27` |
| `apps/web/src/modules/observability/JobsTab.tsx:279` |
| `apps/web/src/modules/observability/JobsTab.tsx:281` |
| `apps/web/src/modules/observability/JobsTab.tsx:284` |
| `apps/web/src/modules/observability/JobsTab.tsx:295` |
| `apps/web/src/modules/observability/JobsTab.tsx:299` |
| `apps/web/src/modules/observability/JobsTab.tsx:303` |
| `apps/web/src/modules/observability/JobsTab.tsx:307` |
| `apps/web/src/modules/observability/JobsTab.tsx:31` |
| `apps/web/src/modules/observability/JobsTab.tsx:325` |
| `apps/web/src/modules/observability/JobsTab.tsx:33` |
| `apps/web/src/modules/observability/JobsTab.tsx:331` |
| `apps/web/src/modules/observability/JobsTab.tsx:35` |
| `apps/web/src/modules/observability/JobsTab.tsx:374` |
| `apps/web/src/modules/observability/JobsTab.tsx:44` |
| `apps/web/src/modules/observability/JobsTab.tsx:49` |
| `apps/web/src/modules/observability/JobsTab.tsx:68` |
| `apps/web/src/modules/observability/JobsTab.tsx:72` |
| `apps/web/tests/modules/observability/components.test.tsx:11` |
| `apps/web/tests/modules/observability/components.test.tsx:1438` |
| `apps/web/tests/modules/observability/components.test.tsx:216` |
| `apps/web/tests/modules/observability/components.test.tsx:226` |
| `apps/web/tests/modules/observability/components.test.tsx:2396` |
| `apps/web/tests/modules/observability/components.test.tsx:315` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/web/src/modules/observability/JobsTab.tsx:160-205 fetches GET /api/jobs?status=&since=&limit=&offset= typed by QueueJobListResponse; legacy historyUrl and /api/jobs/stats removed |
| R2 | MET | apps/web/src/modules/observability/JobsTab.tsx:220-255 status filter chips for All, Failed, Running, Completed with counts read from countsByStatus |
| R3 | MET | apps/web/src/modules/observability/JobsTab.tsx:257-274 failure warning banner with Filter to Failed action button |
| R4 | MET | apps/web/src/modules/observability/JobsTab.tsx:310-370 table columns Status, Job Type, Enqueued At, Started At, Duration, Attempts, Error; null startedAt and durationMs render em dash |
| R5 | MET | apps/web/src/modules/observability/JobsTab.tsx:350-366 inline truncated lastError with per-row expand/hide toggle that does not trigger drawer |
| R6 | MET | apps/web/src/modules/observability/JobsTab.tsx:45-135 ActiveSchedulesCard fetches GET /api/jobs/schedules, displays schedule details, handles null nextFireAt/lastStatus, degrades independently |
| R7 | MET | apps/web/src/modules/observability/JobDetailDrawer.tsx:1-295 slide-over detail drawer with metadata grid, formatted payload, full error, and chronological lifecycle timeline with diagnostic-tier explanation |
| R8 | MET | apps/web/src/modules/observability/JobDetailDrawer.tsx:150-165 link to open correlated events in System Events tab rendered only when onNavigate prop is supplied |
| R9 | MET | apps/web/src/modules/observability/JobsTab.tsx:254 RetentionBadge imported from ./ObservabilityFilters rendered in controls bar |
| R10 | MET | apps/web/tests/modules/observability/jobs-tab.test.tsx:1-298 passes 5/5 tests covering all R1-R9 behaviors |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R5 — Jobs tab queried directly from queue_jobs table | MET | test | apps/web/tests/modules/observability/jobs-tab.test.tsx:1-298 |
| R6 — Server-side jobs query endpoint with timing calculations and status filtering | MET | test | apps/web/tests/modules/observability/jobs-tab.test.tsx:120-175 |
| R7 — Active cron schedule visibility and next-fire calculation | MET | test | apps/web/tests/modules/observability/jobs-tab.test.tsx:205-245 |
| R8 — Run detail drawer keyed by jobId with correlated event chain | MET | test | apps/web/tests/modules/observability/jobs-tab.test.tsx:250-295 |
| R9 — Status filter chips, inline error preview, and retention notice | MET | test | apps/web/tests/modules/observability/jobs-tab.test.tsx:120-200 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | lint | — | biome check . --error-on-warnings && bun run typecheck |
| P4 | unit-tests | — | cd apps/web && bun test tests/modules/observability passed 128/128 |
### References
- Parent feature: `docs/features/J93_observability-module-refactor-summary-tab-4h-range-default-queue-jobs-table-and-schedule-tracing.md` (scenarios R5, R6, R7, R8, R9)
- Design satellite: `docs/design/observability-module-refactor.md` §2.3, §2.4, §2.5, §2.6, §2.7, §3.2, §3.3 — ⚠️ four premises corrected here (`queue.job.started`, diagnostic tier, `?runId=`, the `7d` retention claim); satellite fix owed at wrap
- Depends on: 0789 (`/api/jobs`, `/api/jobs/schedules`, DTOs), 0790 (`'4h'` default, `RetentionBadge`), 0791 (optional `onNavigate`)
- `apps/web/src/modules/observability/JobsTab.tsx:1-6,56+,244-275` — current imports, `JobEventFields`, and the fetch/merge block this task replaces
- `apps/web/src/modules/observability/SystemEventsTab.tsx` — exports `historyUrl`, `parseHistoryResponse`, `SystemEventRow`, `formatDuration` (imported at `JobsTab.tsx:5`); `:410-470` — `parseSystemEventView` severity/correlation parsing
- `apps/web/src/modules/observability/ObservabilityFilters.tsx:42` — `timeRangeSince`; `RetentionBadge` added there by 0790
- `packages/app/src/services/event-names.ts:257-263` — the real queue catalog and its `diagnostic` tiers; no `queue.job.started`
- `packages/app/src/services/system-event-tap.ts:202` — `run_id` derivation (payload `runId`/`run_id` only)
- `packages/app/src/services/system-event-envelope.ts:38-46,348` — `context.correlation.jobId`
- `packages/domain/src/migrations.ts:53-77` — `queue_jobs` columns; `packages/domain/src/retention.ts:25,221` — 30-day terminal purge
- `packages/app/src/services/system-event-retention.ts:11` — the per-prefix row quota that causes the bug feature R5 names
- `apps/server/src/serve.ts:85-86` — built-in schedules are ms intervals, so `nextFireAt` is exact for both shipped entries
### History
- 2026-09-06T23:00:51.518Z todo → wip (system)
- 2026-09-06T23:05:56.113Z wip → testing (system)
- 2026-09-06T23:06:01.478Z testing → done (system)
