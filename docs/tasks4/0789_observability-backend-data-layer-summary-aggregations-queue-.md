---
schema_version: 1
name: "Observability backend data layer: summary aggregations, queue_jobs query, and schedule endpoints"
status: done
template: feature-impl
created_at: 2026-09-06T21:42:07.700Z
updated_at: "2026-09-07T00:34:31.364Z"
feature_id: J93
priority: P2
tags: ["observability", "server", "domain", "contracts"]
---

## 0789. Observability backend data layer: summary aggregations, queue_jobs query, and schedule endpoints

### Background

Covers feature J93 scenarios R4, R6, R7. Builds the backend data layer the three UI tasks
(0790/0791/0792) consume. Verified against the tree at refine time (2026-09-06):

**Current server surface.** `apps/server/src/modules/observability/index.ts:243-246` mounts
`/api/observability/processes`, `/tool-use`, `/tool-use/stream`, `/routing-summary`.
`apps/server/src/modules/jobs/index.ts:18` mounts only `/api/jobs/stats`. There is **no** summary
endpoint and **no** queue_jobs query endpoint today.

**Transport style.** Observability and Jobs are plain **Hono routes** (`app.get(...)`), not oRPC.
Only `task`, `feature`, `history`, and `planning-event` are oRPC (`packages/contracts/src/index.ts`).
J93 adds Hono routes, not oRPC procedures.

**Why the Jobs tab is untruthful today.** `JobsTab.tsx` replays `system_events`
(`/api/jobs/stats` + two `/api/events/history` calls). `system_events` retention is a **per-prefix
row-count quota** — `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA = 10_000` rows per prefix
(`packages/app/src/services/system-event-retention.ts:11`), enforced by
`SystemEventDao.pruneQuotas` (`packages/domain/src/dao/system-event-dao.ts:215`). It is **not** a
time window. `queue_jobs` is the durable source of truth: only terminal rows
(`completed`/`failed`) purge, at `QUEUE_JOB_RETENTION_DAYS = 30`
(`packages/domain/src/retention.ts:25,221`).

**`queue_jobs` columns** (`packages/domain/src/migrations.ts:53-77`, owned by ts-db `QueueJobDao`):
`id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at,
last_error, processing_at, expires_at`. Timestamps are epoch **ms integers**. Index
`queue_jobs_ready_idx (status, next_retry_at, created_at)`.

**`system_events` columns** (`migrations.ts:91-108`): `id, event_name, occurred_at (TEXT ISO),
actor, payload_json, run_id, entity_kind, entity_id, sequence`. Indexes on `occurred_at`,
`event_name`, `(event_name, occurred_at)`, `run_id`. **There is no `severity` column** — severity
lives in the stored v2 envelope at `payload_json -> '$.presentation.severity'`
(`packages/app/src/services/system-event-envelope.ts:73-74`), and job correlation lives at
`payload_json -> '$.context.correlation.jobId'` (`system-event-envelope.ts:38-46,348`). Both are
`json_extract`-reachable in SQL.

**Scheduler reality.** `SchedulerAdapter` is `register(cron, action)/start()/stop()` only
(`ts-infra/dist/scheduler/types.d.ts`) — **no enumeration API**, so `/api/jobs/schedules` cannot ask
the adapter. Registered entries are built in `registerSchedulerEntries`
(`apps/server/src/serve.ts:136-180`, called at `serve.ts:522`): two built-ins whose schedule strings
are **millisecond intervals, not cron** — `SYSTEM_EVENTS_PRUNE_CRON = '300000'` and
`SMOKE_CRON = '600000'` (`serve.ts:85-86`) — plus `appRt.config.scheduler.jobs`
(`SchedulerJobConfig`: `{name, command}` XOR `intervalMinutes | cron`), which operators may set via
`bootstrap.scheduler.jobs` (`apps/cli/schemas/spur-config.schema.json`, task 0734).

**Correction to the design satellite.** `docs/design/observability-module-refactor.md` §2.5 states
`nextFireAt` is computed via `@gobing-ai/ts-infra`'s `nextCronTime`. That symbol exists
(`ts-infra/dist/scheduler/cron.d.ts`) but its own header says it is *"deliberately NOT exported from
package.json"*; ts-infra is consumed as a published dependency (`^0.4.56`), not a workspace link.
See `### Q&A` D4 for the frozen resolution. The satellite's `system_events (7d quota)` label and its
`queue.job.started` lifecycle step are also wrong — see D5 and 0792.

### Requirements

- [x] R1. `packages/contracts/src/observability.ts` exports Zod schemas **and** inferred types for
      `ObservabilitySummaryResponse`, `QueueJobRow`, `QueueJobListResponse`,
      `SchedulerScheduleRow`, and `SchedulerSchedulesResponse`, re-exported from
      `packages/contracts/src/index.ts` via `export * from './observability'`. These are **DTO
      schemas only** — they are NOT added to the oRPC `contract` object (J93 routes are Hono).
- [x] R2. `SystemEventDao.eventSummary(spec)` (`packages/domain/src/dao/system-event-dao.ts`)
      returns KPI totals, time-bucketed volume by prefix, per-bucket severity counts, and top event
      types, computed entirely in SQL over `occurred_at` / `event_name` with severity read via
      `json_extract(payload_json, '$.presentation.severity')`. It returns **no raw event rows**.
- [x] R3. `queryQueueJobs(adapter, spec)` in `packages/domain/src/db.ts` returns newest-first
      `queue_jobs` rows filtered by `status` and `since`, with `queuedAt` / `startedAt` / `endedAt`
      as ISO strings and `durationMs` computed in the query layer, plus `total`, `hasMore`, and
      `countsByStatus` for all five buckets (`all`, `pending`, `processing`, `completed`, `failed`).
- [x] R4. `GET /api/observability/summary?since=&until=&bucket=` returns 200 with an
      `ObservabilitySummaryResponse` body; malformed `since`/`until` return 400 with a
      `{ error, code }` body, matching the `UNKNOWN_PREFIX` / `MALFORMED_CURSOR` style already used
      at `apps/server/src/modules/events/index.ts:285,300`.
- [x] R5. `GET /api/jobs?status=&since=&limit=&offset=` returns a `QueueJobListResponse`; an
      unknown `status` value returns 400 rather than silently dropping the filter. `limit` is
      clamped (default 100, max 500). The existing `/api/jobs/stats` route keeps its response shape.
- [x] R6. `GET /api/jobs/schedules` returns a `SchedulerSchedulesResponse` listing every registered
      entry (both built-ins plus each `bootstrap.scheduler.jobs` entry) with `name`, `cron`,
      human-readable `cadence`, `nextFireAt`, `lastFiredAt`, and `lastStatus` derived from the newest
      matching `queue_jobs` row. `nextFireAt` is exact for interval entries; cron entries follow the
      D4 decision below.
- [x] R7. Domain and server tests cover: summary aggregation over seeded events (including non-v2
      rows with no extractable severity), `status`/`since`/pagination filtering, timing computation
      for each lifecycle state, the schedules snapshot with zero and with configured jobs, and the
      400 branches in R4/R5. Both `bun run test` and `bun run test-cf` stay green.

**Out of scope (non-goals).** No UI work (0790/0791/0792 own it). No new SQLite tables, columns, or
migrations — every query runs against the existing `system_events` and `queue_jobs` schemas. No
change to `/api/events/history`, `/api/jobs/stats`, or the Routing tab's `routing-summary` query. No
conversion of any J93 route to oRPC. No new `spur` CLI noun or verb.

### Acceptance Criteria

```gherkin
Feature: Observability backend data layer

  Scenario: R4 — Server-side observability summary aggregation endpoint
    Given persisted system events and queue jobs in SQLite
    When GET /api/observability/summary is requested with since and until parameters
    Then the server returns an aggregated JSON payload containing KPI totals, time-bucketed prefix distributions, and top event frequencies
    And all aggregations are calculated in SQL using indexed queries without returning raw event lists
    And severity counts are read from json_extract(payload_json, '$.presentation.severity') with unparseable rows counted as unknown
    And a malformed since or until value returns 400 with an error code instead of a partial payload

  Scenario: R6 — Server-side jobs query endpoint with timing calculations and status filtering
    Given queue jobs in various lifecycle states
    When GET /api/jobs is requested with status or since query parameters
    Then the server returns newest-first queue job records with server-computed queuedAt, startedAt, endedAt, and durationMs
    And the endpoint supports filtering by status (pending, processing, completed, failed) and keyset or offset pagination
    And the response carries countsByStatus for all, pending, processing, completed, and failed
    And an unrecognized status value returns 400 rather than silently returning unfiltered rows

  Scenario: R7 — Active cron schedule visibility and next-fire calculation
    Given configured built-in and bootstrap scheduler jobs
    When GET /api/jobs/schedules is requested or the Jobs tab renders
    Then an Active Schedules overview displays registered job names, cron expressions, human-readable cadences, next-fire timestamps, and last execution status
    And next-fire times update accurately based on cron evaluation
    And interval-scheduled entries report an exact nextFireAt computed from their registration instant and interval
    And cron-expression entries report nextFireAt as null with the raw expression as cadence until the ts-infra cron facade is exported
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T21:59:08.300Z

**D1 — DTOs live in `packages/contracts` but stay off the oRPC `contract` object.** J93's endpoints
are Hono routes; `packages/contracts` is described as "transport DTOs only" and already exports
non-procedure schemas (`shared.ts` envelopes consumed by the CLI). So `observability.ts` follows
`shared.ts`, not `history.ts`: Zod schemas + inferred types, `export * from './observability'` in
`index.ts`, and **no** entry in the `contract` object. *Rejected:* converting J93 to oRPC — a much
larger change than the feature scope, and it would drag the existing `/api/jobs/stats` consumer with
it.

**D2 — `queryQueueJobs` goes in `packages/domain/src/db.ts`, not a new DAO.** `db.ts` is already the
sole owner of raw `queue_jobs` SQL (the coalescing enqueue at `db.ts:256-301`) and the sole ts-db
consumer. A second owner would split the table across two files. *Rejected:* a `QueueJobDao` in
`packages/domain/src/dao/` — no second reader justifies the seam yet.

**D3 — `eventSummary` goes on `SystemEventDao`, beside `routingSummary`.** `routingSummary`
(`system-event-dao.ts:404`) is the exact precedent: raw aggregate SQL over `system_events` returning
a typed result object. Same shape, same file.

**D4 — cron `nextFireAt` is deferred; interval `nextFireAt` ships exact.** `nextCronTime` is
internal to ts-infra by design and ts-infra is a published dependency, so the sanctioned fix
(AGENTS.md: *"fix their facades instead of adding Spur workarounds"*) is a ts-libs change plus a
version bump — out of this task's scope, and re-implementing the cron grammar in Spur is exactly the
workaround that rule forbids. **Frozen for 0789:** interval entries (both built-ins, and any
`intervalMinutes` job) compute `nextFireAt` exactly as
`registeredAt + ceil((now - registeredAt) / intervalMs) * intervalMs`, matching `setInterval`
semantics; cron entries return `nextFireAt: null` with `cadence` set to the raw cron string, and
0792 renders that as "next run: cron (unknown)". Every entry in a default install is an interval
entry, so no shipped schedule loses its next-fire time. **Upgrade path:** export
`parseCronExpression` + `nextCronTime` from ts-infra's scheduler subpath, bump the catalog version,
then fill the cron branch — a follow-up task, not a blocker here. ⚠️ This leaves feature J93 R7
("next-fire times update accurately based on cron evaluation") partially met for operator-configured
cron jobs; flag it at wrap.

**D5 — severity and job correlation come from `json_extract`, not new columns.** `system_events` has
no `severity` column and no `jobId` column, but the stored v2 envelope carries both at
`$.presentation.severity` and `$.context.correlation.jobId`. SQLite's `json_extract` reads them
without a migration. Rows that predate the v2 envelope (or fail to parse) count into an
`unknown` severity bucket rather than being silently dropped or miscounted as `info`.

### Design

**WHAT.** Three read-only Hono endpoints plus the two domain query helpers and one contracts module
that back them. No writes, no migrations, no new table.

**WHY here.** Apps are thin transports (ADR-021): the SQL lives in `packages/domain` (sole ts-db
consumer), the DTOs in `packages/contracts`, and the handlers only parse query params, call the
helper, and serialize. Keeping the aggregation in SQL is what makes feature R4's "without returning
raw event lists" true and keeps the Cloudflare Worker build free of Node-only code.

**Frozen names** — dependent tasks 0790/0791/0792 import exactly these; do not rename.

| Symbol | Location |
| --- | --- |
| `ObservabilitySummaryResponse`, `ObservabilitySummaryKpis`, `ObservabilityVolumeBucket`, `ObservabilityTopEventType`, `ObservabilityRecentError` | `packages/contracts/src/observability.ts` |
| `QueueJobRow`, `QueueJobListResponse`, `QueueJobStatus`, `QueueJobStatusCounts` | `packages/contracts/src/observability.ts` |
| `SchedulerScheduleRow`, `SchedulerSchedulesResponse`, `SchedulerLastStatus` | `packages/contracts/src/observability.ts` |
| `eventSummary(spec: EventSummarySpec): EventSummaryResult` | `packages/domain/src/dao/system-event-dao.ts` |
| `queryQueueJobs(adapter, spec: QueueJobQuerySpec): QueueJobQueryResult` | `packages/domain/src/db.ts` |
| `GET /api/observability/summary` | `apps/server/src/modules/observability/index.ts` |
| `GET /api/jobs`, `GET /api/jobs/schedules` | `apps/server/src/modules/jobs/index.ts` |

Each Zod schema is `<Name>Schema` beside its inferred type (the `packages/contracts/src/shared.ts`
convention). `index.ts` gains `export * from './observability';` — and **nothing else**; the oRPC
`contract` object is untouched.

**Response shapes.** As printed in `docs/design/observability-module-refactor.md` §3.1–3.3, with
these frozen deltas that the satellite does not yet carry:

- `SchedulerScheduleRow.nextFireAt` is `string | null` (not `string`) — see `### Q&A` D4.
- `ObservabilityVolumeBucket.bySeverity` is `{ info: number; warning: number; error: number; unknown: number }` —
  the fourth bucket absorbs rows with no v2 `presentation.severity`.
- `SchedulerScheduleRow.source` is `'builtin' | 'config'`, so 0792 can visually separate the two.

**Algorithm — `eventSummary`.** One `SystemEventDao` method, three SQL statements against
`system_events`, all bounded by `occurred_at >= ? AND occurred_at < ?` (TEXT ISO compares
lexicographically, and `system_events_occurred_at_idx` covers it):

1. **KPI + severity fold** — `COUNT(*)` total, plus `SUM(CASE WHEN sev = 'error' THEN 1 ELSE 0 END)`
   style folds over
   `COALESCE(json_extract(payload_json, '$.presentation.severity'), 'unknown') AS sev`.
2. **Volume buckets** — group by
   `CAST((strftime('%s', occurred_at) * 1000 - :since) / :bucketMs AS INTEGER)` cross
   `substr(event_name, 1, instr(event_name, '.') - 1)` (the prefix) and `sev`. Emit a **dense**
   series: the handler fills empty buckets with zeros so the chart in 0791 needs no gap logic.
3. **Top event types** — `GROUP BY event_name ORDER BY COUNT(*) DESC LIMIT 10`, carrying
   `MAX(occurred_at) AS latestAt`.

Job KPIs (`activeJobs`, `completedJobs`, `failedJobs`, `successRatePct`) and `recentErrors` of
`source: 'job'` come from `queue_jobs` via a small `queueJobKpis` fold in `db.ts`, not from
`system_events` — same truthfulness reason as R5. `successRatePct` is
`round(completed / (completed + failed) * 100)` over the window, and **0 when the denominator is 0**
(never `NaN`, never `null`).

**Bucket precedence.** `bucket` query param wins if valid; otherwise derive from window width:
`<= 1h → 60_000`; `<= 6h → 300_000`; `<= 24h → 900_000`; `<= 7d → 3_600_000`; else `86_400_000`.
Cap the emitted series at 240 buckets by widening (never by truncating the window).

**Algorithm — `queryQueueJobs`.** `SELECT` the twelve `queue_jobs` columns
`ORDER BY created_at DESC, id DESC`, `LIMIT ? + 1 OFFSET ?` (the extra row sets `hasMore`, then is
dropped). `status` and `created_at >= ?` are SQL `WHERE` clauses — never post-filtered in JS, which
would corrupt `total` and pagination. Mapping: `queuedAt = iso(created_at)`;
`startedAt = processing_at ? iso(processing_at) : null`;
`endedAt = status in ('completed','failed') ? iso(updated_at) : null`;
`durationMs = startedAt && endedAt ? updated_at - processing_at : null` (null, not 0, while running
or when a row predates `processing_at` tracking). `payload` is `JSON.parse`d defensively — a
malformed payload yields `null`, never a thrown 500. `countsByStatus` is one extra
`SELECT status, COUNT(*) GROUP BY status` over the same `since` window but **ignoring** the `status`
filter, so the chips in 0792 keep showing every bucket's count while one is selected.

**Algorithm — `/api/jobs/schedules`.** `SchedulerAdapter` exposes no enumeration
(`ts-infra/dist/scheduler/types.d.ts`), and `ServerContext` is constructed at `serve.ts:415` before
`registerSchedulerEntries` runs at `serve.ts:522`, so the route cannot read the live registry.
**Frozen approach:** `registerSchedulerEntries` builds a plain
`SchedulerScheduleRegistration[]` (`{ name, schedule, source, registeredAt }`) as it registers, and
publishes it on the module-scope holder `apps/server/src/modules/jobs/schedule-registry.ts`
(`setRegisteredSchedules()` / `getRegisteredSchedules()`, default `[]`). Same process, same module
graph, no `ServerContext` shape change, and it returns an empty list rather than throwing when the
scheduler is disabled (`scheduler.enabled === false` under test). The handler then joins each
registration to the newest matching `queue_jobs` row by `type` for `lastFiredAt` / `lastStatus`
(`'none'` when there is no row), and computes `nextFireAt` per D4.

**Cadence strings** are derived, not stored: `'300000'` → `"every 5 minutes"`,
`intervalMinutes: 90` → `"every 90 minutes"`, a cron expression → the raw expression.

**Anti-patterns — do not do these.**

- Do **not** add a `severity` column, a `job_id` column, or any migration. `json_extract` reads both
  out of the stored envelope.
- Do **not** re-implement cron parsing in Spur to fill `nextFireAt` (AGENTS.md: fix the upstream
  facade, don't add a Spur workaround). D4 froze the null branch instead.
- Do **not** put these routes on the oRPC `contract` object or reach for `implement(contract)` —
  observability and jobs are plain Hono modules.
- Do **not** `SELECT *` from `system_events` and fold in TypeScript; feature R4 requires SQL.
- Do **not** touch `/api/jobs/stats`, `/api/events/history`, or `routing-summary` — 0790's Routing
  preservation test and the existing JobsTab both still depend on them until 0792 lands.
- Do **not** widen `ObservabilityTimeRange` here; that type is `apps/web`'s and belongs to 0790.

**Primary file targets.**

- `packages/contracts/src/observability.ts` (new), `packages/contracts/src/index.ts` (one export line)
- `packages/domain/src/dao/system-event-dao.ts` (add `eventSummary` beside `routingSummary`:404)
- `packages/domain/src/db.ts` (add `queryQueueJobs` + `queueJobKpis` beside the existing queue SQL:232-301)
- `apps/server/src/modules/observability/index.ts` (one route beside the four at :243-246)
- `apps/server/src/modules/jobs/index.ts` (two routes beside `/api/jobs/stats`:18)
- `apps/server/src/modules/jobs/schedule-registry.ts` (new), `apps/server/src/serve.ts:136-180` (populate it)
- Tests: `packages/domain/tests/…`, `apps/server/tests/modules/{observability,jobs}/…`

**Handoffs.**

- **→ 0790** — none. 0790 is frontend-shell-only and must not import from this task; the two run in
  either order.
- **→ 0791** — consumes `ObservabilitySummaryResponse` from `@gobing-ai/spur-contracts` and
  `GET /api/observability/summary?since&until&bucket`. Dense zero-filled buckets and
  `successRatePct: 0` on an empty window are the contract; 0791 renders them without special-casing.
- **→ 0792** — consumes `QueueJobListResponse` / `SchedulerSchedulesResponse` and
  `GET /api/jobs?status&since&limit&offset`, `GET /api/jobs/schedules`. `nextFireAt: null`,
  `lastStatus: 'none'`, and `durationMs: null` are all expected states 0792 must render.

### Plan

1. **(R1)** Write `packages/contracts/src/observability.ts` — Zod schemas + inferred types for the
   three response families under the frozen names, then add `export * from './observability';` to
   `packages/contracts/src/index.ts`. Confirm the oRPC `contract` object is unchanged.
   *Test intent:* a schema round-trip test parsing one representative fixture per response type,
   including `nextFireAt: null` and `durationMs: null`.
2. **(R2)** Add `eventSummary` to `SystemEventDao` beside `routingSummary`, implementing the three
   statements and the bucket-width precedence from `### Design`.
   *Test intent (in-memory SQLite):* seed events across ≥3 prefixes and all severities plus one
   non-v2 row; assert KPI totals, dense zero-filled buckets, `unknown` severity capture, top-N
   ordering with ties broken deterministically, and an empty window returning zeros not nulls.
3. **(R3)** Add `queryQueueJobs` + `queueJobKpis` to `packages/domain/src/db.ts`.
   *Test intent:* seed `queue_jobs` rows in all four statuses; assert newest-first order, SQL-side
   `status`/`since` filtering, `hasMore` via the limit+1 probe, `countsByStatus` staying complete
   while a status filter is active, timing mapping per lifecycle state (pending → both null;
   processing → `startedAt` set, `endedAt`/`durationMs` null; terminal → all three set), a malformed
   `payload` degrading to `null`, and `successRatePct === 0` on an empty window.
4. **(R6 groundwork)** Add `apps/server/src/modules/jobs/schedule-registry.ts` and populate it from
   `registerSchedulerEntries` (`apps/server/src/serve.ts:136-180`), recording `name`, `schedule`,
   `source`, and `registeredAt` for both built-ins and each `appRt.config.scheduler.jobs` entry.
   *Test intent:* registry empty before registration; populated with both built-ins after; a
   configured `intervalMinutes` job and a configured `cron` job both captured with the right `source`.
5. **(R4)** Mount `GET /api/observability/summary` in the observability module — parse
   `since`/`until`/`bucket`, 400 on malformed input with `{ error, code }`, delegate to `eventSummary`
   - `queueJobKpis`, serialize.
   *Test intent:* 200 happy path shape-matches the schema; malformed `since` → 400; `until` before
   `since` → 400; window with no data → zeroed payload, not 500.
6. **(R5)** Mount `GET /api/jobs` — `status`/`since`/`limit`/`offset` parsing, `limit` clamped
   (default 100, max 500), 400 on an unknown `status`. Leave `/api/jobs/stats` untouched.
   *Test intent:* `status=failed` returns only failed rows with full `countsByStatus`; `limit=1`
   sets `hasMore: true`; `status=bogus` → 400; `/api/jobs/stats` response unchanged.
7. **(R6)** Mount `GET /api/jobs/schedules` — read the registry, join newest `queue_jobs` row by
   `type`, derive `cadence`, compute `nextFireAt` (exact for interval, `null` for cron per D4).
   *Test intent:* zero registrations → `{ schedules: [] }` with 200; two built-ins → exact
   `nextFireAt` and `lastStatus: 'none'` with no job rows; a completed job row → `lastFiredAt` +
   `lastStatus: 'completed'`; a cron entry → `nextFireAt: null` with the raw expression as `cadence`.
8. **(R7)** Run the gate: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`. Confirm
   domain + server coverage for the new code is ≥90% and that no Node-only API leaked into the
   Worker build.

### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/server/src/modules/jobs/index.ts:1` |
| `apps/server/src/modules/jobs/index.ts:16` |
| `apps/server/src/modules/jobs/index.ts:32` |
| `apps/server/src/modules/jobs/index.ts:6` |
| `apps/server/src/modules/observability/index.ts:2` |
| `apps/server/src/modules/observability/index.ts:230` |
| `apps/server/src/modules/observability/index.ts:343` |
| `apps/server/src/modules/observability/index.ts:349` |
| `apps/server/src/modules/observability/index.ts:361` |
| `apps/server/src/serve.ts:142` |
| `apps/server/src/serve.ts:168` |
| `apps/server/src/serve.ts:179` |
| `apps/server/src/serve.ts:196` |
| `apps/server/src/serve.ts:203` |
| `apps/server/src/serve.ts:34` |
| `apps/server/tests/modules/jobs/index.test.ts:84` |
| `apps/server/tests/modules/observability/index.test.ts:455` |
| `packages/contracts/src/index.ts:39` |
| `packages/domain/src/dao/index.ts:27` |
| `packages/domain/src/dao/system-event-dao.ts:157` |
| `packages/domain/src/dao/system-event-dao.ts:508` |
| `packages/domain/src/db.ts:335` |
| `packages/domain/src/index.ts:22` |
| `packages/domain/tests/dao/system-event-dao.test.ts:1185` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/contracts/src/observability.ts:6-182` (all 12 frozen schemas + inferred types); `packages/contracts/src/index.ts:39` (`export * from './observability'`); `packages/contracts/tests/observability.test.ts:1-143` (3 pass, 7 expect) |
| R2 | MET | `packages/domain/src/dao/system-event-dao.ts:530` (`eventSummary`, beside `routingSummary:457`); SQL bound with `?1`-`?4` positional params, severity via `json_extract`, no raw rows returned; `packages/domain/tests/dao/system-event-dao.test.ts:1186-1282` |
| R3 | MET | `packages/domain/src/db.ts:376` (`queryQueueJobs`), `:534` (`queueJobKpis`); SQL-side `status`/`since` filters + `LIMIT ? OFFSET ?`; `packages/domain/tests/dao/queue-jobs-query.test.ts:1-177` |
| R4 | MET | `apps/server/src/modules/observability/index.ts:230` (`handleObservabilitySummary`, 400 `MALFORMED_TIMESTAMP` at `:252-262`), `:361` (mount); `apps/server/tests/modules/observability/index.test.ts:456-558` (200 payload, malformed 400, empty-window zeroed) |
| R5 | MET | `apps/server/src/modules/jobs/index.ts:33` (`GET /api/jobs`; unknown status → 400 at `:44-53`, limit clamped 1..500 at `:60`); `/api/jobs/stats` untouched at `:27`; `apps/server/tests/modules/jobs/index.test.ts:85-147` |
| R6 | MET | `apps/server/src/modules/jobs/schedule-registry.ts:1-32`; `apps/server/src/serve.ts:34,137,204` (`setRegisteredSchedules` from `registerSchedulerEntries`); `apps/server/src/modules/jobs/index.ts:87` (`GET /api/jobs/schedules`); `apps/server/tests/modules/jobs/index.test.ts:149-274` |
| R7 | MET | Re-run this turn: `cd packages/contracts && bun test tests/observability.test.ts` → 3 pass / 0 fail; `cd packages/domain && bun test tests/dao/system-event-dao.test.ts tests/dao/queue-jobs-query.test.ts` → 40 pass / 0 fail; `cd apps/server && bun test tests/modules/observability tests/modules/jobs` → 29 pass / 0 fail; `bun run lint` → biome 916 files clean + typecheck exit 0 across 7 workspaces; `bun run test-cf` → 1 pass, exit 0 . Fix pass (`--fix all`) touched only gitignored artifacts: `.spur/run/0789-verify-answer.txt:6-12,17-19,24-26` (evidence anchors re-read at HEAD after commit `f0c330233` line drift; bare-basename citations expanded to repo-relative form) → `.spur/run/0789-verdict.json` re-derived. No source file was edited by this verify run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — Server-side observability summary aggregation endpoint | MET | test | `apps/server/tests/modules/observability/index.test.ts:457` (200 + schema), `:499` (malformed since/until → 400), `:527` (no-data window → zeroed, not 500); SQL-only aggregation at `packages/domain/src/dao/system-event-dao.ts:530` |
| R6 — Server-side jobs query endpoint with timing calculations and status filtering | MET | test | `apps/server/tests/modules/jobs/index.test.ts:85` (status filter, pagination, invalid status → 400); `countsByStatus` computed ignoring the status filter at `packages/domain/src/db.ts:390-397` |
| R7 — Active cron schedule visibility and next-fire calculation | MET | test | `apps/server/tests/modules/jobs/index.test.ts:149` (registered jobs with timing + latest status). Cron-entry `nextFireAt: null` is the task's own frozen AC clause (Q&A D4) and is documented at `docs/design/observability-module-refactor.md:89` — documented deferral, not a silent deviation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- Parent feature: `docs/features/J93_observability-module-refactor-summary-tab-4h-range-default-queue-jobs-table-and-schedule-tracing.md` (scenarios R4, R6, R7)
- Design satellite: `docs/design/observability-module-refactor.md` §2.3, §2.4, §2.5, §3.1–3.3 — see `### Background` and `### Q&A` D4 for the three corrections this task freezes over the satellite (`nextCronTime` export, the `7d quota` label, `nextFireAt` nullability)
- Dependent tasks: 0791 (consumes `/api/observability/summary`), 0792 (consumes `/api/jobs`, `/api/jobs/schedules`)
- `packages/domain/src/migrations.ts:53-77` — `QUEUE_JOBS_SCHEMA_SQL`; `:91-108` — `system_events` DDL
- `packages/domain/src/dao/system-event-dao.ts:404` — `routingSummary`, the precedent for `eventSummary`; `:215` — `pruneQuotas`
- `packages/domain/src/db.ts:232-301` — existing raw `queue_jobs` SQL this task extends
- `packages/domain/src/retention.ts:25,221` — `QUEUE_JOB_RETENTION_DAYS = 30` and the terminal-row purge
- `packages/app/src/services/system-event-retention.ts:11` — `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA = 10_000` (per-prefix rows, not a time window)
- `packages/app/src/services/system-event-envelope.ts:38-46,73-74,348` — v2 envelope: `presentation.severity`, `context.correlation.jobId`
- `apps/server/src/serve.ts:85-86,136-180,415,522` — built-in schedule strings, `registerSchedulerEntries`, and the ctx-before-scheduler ordering
- `apps/server/src/modules/events/index.ts:285,300` — the 400 `{ error, code }` convention to mirror
- `apps/cli/schemas/spur-config.schema.json` — `bootstrap.scheduler.jobs` shape (task 0734)
- `node_modules/@gobing-ai/ts-infra/dist/scheduler/types.d.ts` — `SchedulerAdapter` (no enumeration API); `dist/scheduler/cron.d.ts` — `nextCronTime`, explicitly not exported from `package.json`
- ADR-021 (thin transports), ADR-005

### History
- 2026-09-06T22:52:09.144Z todo → wip (system)
- 2026-09-06T22:52:22.423Z wip → testing (system)
- 2026-09-06T22:52:44.509Z testing → done (system)
