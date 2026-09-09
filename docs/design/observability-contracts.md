# Observability and HTTP read contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="78a-process-inventory-observability--processes"></a>

### 7.8a Process inventory (Observability → Processes)

Task **0243**. The Processes tab is a **read-only** serve-rooted runtime inventory — not the
team control plane (`/api/team/*`).

| Surface                            | Contract                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/observability/processes` | Snapshot of the serve PID tree + supervisor overlay                                                                                                                                        |
| Success body                       | `{ processes: ProcessInventoryRow[], rootPid: number, capturedAt: string }`                                                                                                                |
| Row fields                         | `pid`, `ppid`, `depth`, `source` (`serve` \| `supervisor` \| `descendant`), `label`, optional `agentId`, `command` (may be truncated), `status`, `rssBytes`, `elapsedSeconds`, `startedAt` |
| Unsupported OS                     | `501` + `{ error, code: "UNSUPPORTED_PLATFORM" }` (macOS + Linux only in v1)                                                                                                               |
| Team APIs                          | Unchanged — `GET /api/team/processes` remains supervised-agents-only for control clients                                                                                                   |

**Mechanism:** `ProcessInventoryService` (`packages/app`) walks OS processes via a
`ProcessInspector` port (default: `ps -axo pid=,ppid=,rss=,etime=,command=`), filters to
descendants of `process.pid`, and overlays `SupervisorService.list()` by pid for agent labels.
Board UI polls every ~3s. Threads/%CPU, host-wide shell `spur` CLIs, and ProcessExecutor live
registry enrichment are deferred.

<a id="78b-tool-use-ledger-observability--tool-using"></a>

### 7.8b Tool-use ledger (Observability → Tool Using)

Tasks **0245** / **0246** / **0247** / **0248**. The Tool Using tab is a **read-only** tail of the
project token ledger written by indexed-context hooks (task 0232) — not a second event store and not
a control plane.

> This is the **Observability** module's tab. The History Board has a separate tab of the same name
> (feature E81, `design/history-board-tool-using-tab.md`) reading the imported forensic corpus over
> `POST /history/tool-sequence`. Different store, different surface — do not conflate them.

| Surface                                          | Contract                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/observability/tool-use?limit=&before=` | Newest-first page; `before` = exclusive ISO cursor for older pages                                                                                                                                                       |
| Query                                            | `limit` default **200** max **1000**; optional `before`                                                                                                                                                                  |
| Success body                                     | `{ events, count, limit, truncated, path, capturedAt, sparseToolActivity, nextBefore }`                                                                                                                                  |
| `nextBefore`                                     | Oldest `ts` in page when more older events exist; else `null` (load-more cursor)                                                                                                                                         |
| Event fields                                     | `seq` (0=newest in page), `ts`, `session`, `type`, optional `file`, `summary`, `tokens`, `action`, `totals`, `sessionId`, `agent`, `model`                                                                               |
| Types                                            | `session_start` / `session_end` / `read` / `write` / `bash` / `grep` / `glob` (Edit → `write` + `action=edit`)                                                                                                           |
| Token semantics                                  | Present only when estimated; **omit** when unknown (UI shows `—`). Cascade: response → Write input → Edit strings → Read stat; Bash/Grep/Glob from **capped** response size only                                         |
| Capture tools                                    | PostToolUse matcher `Bash\|Grep\|Glob\|Read\|Write\|Edit` — no `*` / MCP without allowlist                                                                                                                               |
| Redaction                                        | Summary only (command / pattern / glob, ≤~200 chars); never full stdout; cap estimate input **4 KiB**; strip secret-like patterns                                                                                        |
| `GET /api/observability/tool-use/stream`         | SSE: `connected` then `tool-use` frames when the JSONL grows (`fs.watch` + byte poll)                                                                                                                                    |
| Missing file                                     | `200` + empty `events` (calm empty UI — not an error)                                                                                                                                                                    |
| Hard I/O failure                                 | `500` + `{ error }`                                                                                                                                                                                                      |
| Write path                                       | Hooks append JSONL only; Board never writes; no HTTP from hooks                                                                                                                                                          |
| UI                                               | Live prefers **SSE** (poll fallback if `EventSource` missing); **Load older** uses `before=nextBefore`; columns Time \| Type \| **Target** (file basename or summary) \| Action \| Tokens \| Session \| Agent? \| Model? |

**Mechanism:** `TokenLedgerService` reverse-tails with optional `before` filter; `TokenLedgerWatcher`
fans out appends to SSE subscribers. The Node-only watcher loads only when a local SSE request has a
`ServerContext`; Worker bootstrap does not import its `node:fs` graph. The `connected` frame follows
watcher subscription, so an immediate append cannot race initialization. Hooks stay file-append only
with privacy default **summary over body**.

<a id="78c-observability-summary-aggregations"></a>

### 7.8c Observability Summary aggregations

`GET /api/observability/summary` — Summary tab KPI, volume-bucket, and hotspot aggregations
(including per-type `avgDurationMs` and `failureCount`). Contract:
[`observability-module-refactor.md`](observability-module-refactor.md) §3.1.

<a id="79-system-event-catalog"></a>

### 7.9 System Event catalog

The `System Events` tab on the observability board subscribes to events on the
canonical server `EventBus<ServerEventMap>` exposed by `ServerContext.eventBus()`.
Only events registered in `SYSTEM_EVENT_CATALOG` (`packages/app/src/services/event-names.ts`)
are persisted to `system_events` and pushed over `/api/events/planning`. The catalog
is the single source of truth — both the tap (`registerSystemEventTap`) and the SSE
module derive their subscriptions from it.

**Quota events (0799; ADR-111).** `agent.quota.exhausted` / `agent.quota.recovered` ride the
app/CLI run bus and feed the durable executor-update pipeline — they are **not**
`SYSTEM_EVENT_CATALOG` entries (bus-consumed, no board persistence until ADR-110 catalog-open
ingestion ships). Trusted-shape schemas ship on `@gobing-ai/spur-config/agent-quota-events`
(Workers-safe subpath, like `./loader`); payload fields and contracts live in
[`executor-availability.md`](executor-availability.md) §4.

**Tier rules (task 0221 R5).**

| Tier             | Meaning                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `default`        | Persisted and streamed on the SSE channel without extra runtime config.                                  |
| `diagnostic`     | Persisted and streamed only when `SPUR_DIAGNOSTIC_EVENTS=1` (or `true`) is set on the server runtime.    |
| (out of catalog) | Emit is not part of the board contract — CLI-local buses, browser store notifications, raw Node signals. |

The `SPUR_DIAGNOSTIC_EVENTS` flag ships through `serverBootstrapConfig(env).events.diagnostic`
(`apps/server/src/bootstrap.ts`) and is consulted in two places: the system-event tap
(`registerSystemEventTap(bus, dao, logger, { diagnosticEnabled })`) and the SSE module when
building the stream name list. Diagnostic entries remain in the catalog so the UI can
filter them by `tier` once the toggle is enabled — no CLI restart required.

**Envelope v2 and payload projection (task 0526).** Fresh persistence and SSE use the same
`buildSystemEventEnvelope(entry, payload, project, secretValues?)` boundary. The payload becomes
`{ schemaVersion: 2, data, context, presentation }`; catalog metadata supplies the concrete producer
package/subsystem, last-resort default severity, description, retained presentation fields, and
remediation kind. Fresh envelopes prefer a producer-stamped payload `severity` (ts-libs 0.4.30+)
over that catalog default.
`metadata-only` is a real allow-list with recursive depth/array/object/node/string bounds. Content
bodies, prompts, commands/environment, arbitrary business payloads, complete rule finding arrays,
and stdout/stderr are excluded; credential patterns and configured secrets are redacted before those
bounds. Server and CLI composition roots inject both project name/root and configured secret values.

The current `projectStoredSystemEventEnvelope` preserves canonical v2 rows and wraps legacy raw rows at the
history response only. ADR-067's accepted J9 replacement is indexed below; neither path rewrites stored history. Correlation accepts direct and nested
run/execution/action/entity/job identifiers, with indexed ledger columns remaining query authority.
Unknown names and malformed optional payloads degrade to a bounded generic envelope without failing
the product operation. Canonical shape, projection paths, and pending consumer contracts live in
[`actionable-observability-context.md`](actionable-observability-context.md).

**J9 semantic presentation (built — tasks 0601/0602).** Event-specific presenter shapes, outcome support,
producer enrichment, exact planning/workflow/queue summaries, and the two-sided 71-event matrix live in
[`event-tracking.md`](event-tracking.md). History reprojection and generic tooltip identity live in
[`actionable-observability-context.md`](actionable-observability-context.md); visual tooltip placement lives
in root `DESIGN.md`. Envelope v2 and the ledger schema do not change.

**J91 human table projection (built — task 0605; ADR-073/074).** Table cells are
human-only; optional `presentation.correlators` / `actionLabel` / `agent` and the Agent column live in
[`system-events-human-table.md`](system-events-human-table.md). `context` stays closed. No new CLI
noun. Tooltip remediation and raw ids stay out of the table.

**J31 Observabilities polish (proposed; ADR-110).** Header/sidebar naming alignment, shell-level
time-range selector for all tabs (Routing wires `since` into `routing-summary`), and catalog-open
event ingestion with a generic-entry catch-all live in
[`observabilities-module-polish.md`](observabilities-module-polish.md).

**Routing decision attribution (task 0545).** Agent-run lifecycle rows carry the routing decision as
envelope metadata — no new table or column. `agent.invoke.start` / `agent.invoke.exit` payloads gain
a `routing` block (`role?`, `tier`, `executor`, `source`) merged at the per-run invoke bridge in
`AgentService.executeRun` from the resolution funnel's result (`resolveExecutorSelector` and
siblings — the only place that knows role, tier, executor, and source together). The selection
source distinguishes a declared role resolution (`role`) from an explicit pin (`explicit`) from an
`agent.default` selection (`default`); stage/phase/priority resolutions record their own source.
Runs join to the history plane over the indexed `run_id` column (task 0557 threads the correlation;
0547 consumes the join). An escalation is its **own** default-tier record
(`agent.invoke.escalated`, emitted by the Spur agent-service bridge, producer-attributed to
`spur`): originating tier, resulting tier, and the objective trigger (`gate-fail`, `timeout`,
`insufficient-evidence`, `retry-exhausted`, plus the class-level `resource-exhaustion`/`auth`
members of the registry vocabulary). A run that never escalates emits no such row — absence and
not-recorded are distinguishable (R2). Attribution carries identifiers, tiers, and counts only:
prompt text, command lines, and configured secrets are excluded by the J5 bounds and recursive
redaction before persistence (R4).

**Routing aggregate read path (task 0546).** `SystemEventDao.routingSummary({ since?, until? })`
answers "which executor served which role, how often, and how often did it escalate" in **one
indexed round trip** — the aggregate is computed in SQL (`GROUP BY` over `json_extract` of the
routing envelope), never by sifting a fixed row window client-side (the failure mode feature J3
fixed on this ledger). The `event_name` + window predicates ride the composite
`idx_system_events_name_occurred (event_name, occurred_at)` index and the escalation join rides
the indexed `run_id` column, so work is bounded to the attribution families (measured via
EXPLAIN QUERY PLAN: every family-filtered scan is served by the composite index).
Per pair it reports `{ role, executor, source, runs, escalations }`: `runs` counts
`agent.invoke.start` dispatches (start, not exit, is the dispatch moment; an escalated re-dispatch
is its own serve on the executor it landed on), and `escalations` counts
`agent.invoke.escalated` rows whose `fromExecutor` matches the pair — "this pairing started too
cheap", not "was escalated to". Selection sources stay separate (R4): a pinned (`source:
'explicit'`) run is not counted as evidence that role routing chose that executor. Pre-attribution
rows and malformed payloads are excluded rather than imputed as an unknown role (R5), and the
covered `window` is reported on the result; `since`/`until` default to a bounded recent 7-day
range. No new CLI noun or verb — this rides the observability read API (ADR-051 gates noun
additions). Task 0547 joins the same rows to the history plane over `run_id` for the token
dimension; task 0552 renders this aggregate.

**Role token aggregate (task 0547).** `roleTokenSummary({ since?, until? })`
(`packages/domain/src/analytics/role-tokens.ts`) attributes token consumption to the role each
attributed run served, over the same bounded window and source rows as `routingSummary`. The
join is attribution → run→session mapping → typed columns: `agent.invoke.start` rows carrying a
routing block join `history_run_session` by the indexed `run_id` (task 0557 boundary observation /
task 0558 retroactive correlation), and each mapped session's `history_message` typed token
columns (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) are folded
per role. Per role it reports `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }`
plus coverage (`totalRuns`, `matchedRuns` — matched of attributed, R5) and the never-fabricate
state (R3): a bucket is present only when its matched rows carried usage
(`recordsWithUsage > 0`), so a role with no matched rows — or rows without a provider `usage`
object — reports **unmeasured** with the matched-run count, never zero tokens as an observed
fact. Exact and estimated mappings are folded into separate buckets and never summed (R4,
mirroring `attributeActionCost`'s split). No dollar figure is computed, stored, or displayed
(R2): `history_message.cost_usd` and the pricing tables stay unread, and the result type carries
no currency field. Missing tables (unmigrated DB / dead history plane per feature E1) read as
empty — best-effort like the rest of the trace path. Task 0552 renders these totals.

**Board render — routing and token consumption (task 0552).** The observability module's Routing
tab (`apps/web/src/modules/observability/RoutingTab.tsx`, registered as the `routing` tab in
`OBSERVABILITY_TABS`) consumes the two J6 aggregates through
`GET /api/observability/routing-summary` (`apps/server/src/modules/observability`), which forwards
`since`/`until` to `routingSummary` + `roleTokenSummary` and returns `{ routing, tokens }` — the
route adds no query of its own, and the domain surfaces keep their bounded defaults. The tab is
render-only: it narrows the envelope once (`parseRoutingSummaryResponse`) and never re-derives a
count. Honest states render as themselves, per the J6 contract: the pair table keeps selection
sources distinct (`explicit` renders as *pinned*, `role` as *resolved*, `default` as *default*;
a `role: null` group renders as `—`), a role with no measured bucket renders **unmeasured** with
its matched-of-total coverage and no token figures (never zero-as-fact), exact and estimated
buckets render side by side as separate labelled rows (never summed), and an empty result states
that no attribution has been recorded rather than rendering zeroes. No currency symbol can appear:
the DTOs carry no currency field and the surface formats plain token counts only (R2, asserted by
test).

**Board projection (task 0527).** The web client narrows envelope v2 once in its history/SSE parser.
Desktop renders `Time | Severity | Event | Summary | Producer | Correlation | Outcome |
Action`; below 640 px it keeps `Time | Event` and stacks the semantic fields. The Producer
column title and value are package / subsystem only. Project name/root are omitted from the
table and tooltip (constant for a Board view) and remain in expanded detail. Severity always pairs
icon and text. The event-name tooltip uses the server-owned description, fields, producer, outcome,
and remediation, with equivalent hover/focus/pin interactions; raw redacted envelope JSON and
prefix/tier/actor stay in expanded detail. Canonical `data` is unwrapped for the existing Jobs/Tasks
consumers, while malformed or legacy client input receives explicit `unavailable` sentinels and no
fabricated action. The Board renders those sentinels as `-`.

**Source families (tasks 0221/0526).** `SystemEventSource` is the producer family
(`planning | queue | scheduler | message | process | workflow | rule | agent | team | history | bus |
api`). Each catalog entry additionally fixes its concrete producer package and subsystem. The catalog
declaration order is canonical; `SYSTEM_EVENT_PREFIXES` is derived and powers the UI prefix filter.

**Event-name alias policy (task 0221 R4).** Where upstream and canonical names diverge
(e.g. engine `workflow.action.start` vs. observability adapter `workflow.action.started`),
the engine-native names are catalog-canonical and the alternates get their own row — one
per logical moment — to avoid silently collapsing two lifecycle moments into one row.
The persistence-side `ObservableWorkflowAdapter` continues to feed live consumers via
its own typed bus; it produces a separate `system_events` row only if the engine did not.

**Producer invariant (R3).** Board-visible server work receives the canonical bus,
directly or through a typed adapter. Each app service has an optional `events?()`:

| Service                                             | Wiring                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AgentService.run()` / `runCapture()` (0219 + 0221) | `AiRunner({ events: bridge(events), processEvents: bridge(events) })`                               |
| `RuleService.evaluate()` / `evaluateVerbose()`      | `RuleEngine({ events: bridge(events) })` plus a forwarding subscription over the verbose local bus. |
| `WorkflowAppService.run()`                          | `EngineWorkflowService.runFile({ events: bridgeEngineEvents(events) })` via `createEngineService`.  |
| `TaskActionJob` (server-side queued job)            | `new AgentService({ events: ctx.eventBus(), ... })` in `serve.ts:runTaskActionJob`.                 |
| `JobQueue` / `QueueConsumer` (0190)                 | Already wired via `createServerContext` (forwards `queue.*`).                                       |

**Server-context integration tests (0219 AC).** `apps/server/tests/context.test.ts`
proves that `task.*` events flow through the canonical bus into `system_events`;
analogous tests for `rule.run.start`, `agent.invoke.start`, and `workflow.run.started`
are added in 0221 by emitting the upstream event through a service constructed with
`events: ctx.eventBus()` and asserting `dao.query({ name })` returns a row.

<a id="710-system-event-correlation-columns-task-0369"></a>

### 7.10 System event correlation columns (task 0369)

`system_events` carries four nullable correlation columns beside the original five,
so a run- or entity-scoped read is one indexed round trip instead of a client-side
scan of the newest-N window:

| Column        | Type      | Source                                              |
| ------------- | --------- | --------------------------------------------------- |
| `run_id`      | `TEXT`    | 0365 envelope `runId` (`workflow.*`, agent events)  |
| `sequence`    | `INTEGER` | 0365 envelope `sequence` — monotonic within one run |
| `entity_kind` | `TEXT`    | Planning event `entity.kind` (`task`, `feature`)    |
| `entity_id`   | `TEXT`    | Planning event `entity.id`                          |

Indexes: `idx_system_events_run_id` and the pair index `idx_system_events_entity
(entity_kind, entity_id)` — the pair, because entity ids are only unique within a kind.

**Derivation.** `extractSystemEventCorrelation` (`packages/app/src/services/system-event-tap.ts`)
is the single derivation, shared by both write paths — the server tap
(`registerSystemEventTap`) and the CLI planning emitter (`SystemEventEmitter`) — the
same one-canonical-derivation contract `extractSystemEventActor` holds for actor. Every
column is nullable: an event carrying neither run nor entity identity persists nulls.

**Migration.** `0008_spur_cli_system_events_correlation` adds the columns and indexes to
pre-0369 ledgers. It is columns-and-indexes only — no payload rewrite or backfill, so
pre-migration rows keep their `payload_json` and read back with nulls. Fresh databases
get the columns from the `0000` foundation DDL, so the migration carries
`addColumnIfMissing: { table: 'system_events', column: 'sequence' }` and journals itself
without executing the ALTERs (the `runs.external_key` precedent).

**Read surface.** `SystemEventDao.query` accepts `run_id`, `entity_kind`, and `entity_id`
filters, composed with `name`/`since` under AND. `GET /api/events/history` projects the
columns additively as `runId`, `entityKind`, `entityId`, `sequence`; no existing response
field is renamed, dropped, or re-typed.

**Server-side filters + keyset pagination (task 0372).** Filters run in SQL (never by
post-filtering a prefetched page). Order is `occurred_at DESC, id DESC` so a keyset
cursor is a total order under concurrent inserts.

| Surface                   | Contract                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/events/history` | Newest-first page over `system_events`                                                                 |
| Query (v1, preserved)     | `name`, `since`, `limit` (default **100**, max **500**)                                                |
| Query (0372)              | `prefix`, `names` (comma or repeated), `runId`, `actor`, `cursor`                                      |
| Success body              | `{ events, count, catalog, nextCursor, hasMore }` — `nextCursor`/`hasMore` are additive                |
| `nextCursor`              | Opaque base64url keyset of the last returned row when `hasMore`; else `null`                           |
| `prefix`                  | Cataloged family only (`SYSTEM_EVENT_PREFIXES`); unknown → **400** `{ error, code: "UNKNOWN_PREFIX" }` |
| `cursor`                  | Malformed → **400** `{ error, code: "MALFORMED_CURSOR" }` — never falls back to unfiltered             |
| DAO filters               | `prefix` (`LIKE 'prefix.%'`), `names` (`IN`), `actor`, `before: { occurred_at, id }` exclusive keyset  |
| Stability                 | Newer concurrent inserts do not reappear on later pages; rows older than the cursor are not skipped    |

<a id="workflow-run-store-read-api-0373"></a>

## Workflow run-store read API (0373)

The durable record of what a pipeline did lives in the workflow run store
(`runs`, `phase_runs`, `transition_runs`, `action_runs`, `task_run_links`) —
not in the `system_events` ledger. Task 0373 exposes a **raw Hono** read surface
over that store so the Board (J4 Tasks tabview) can show a task digest with
progress and action log. Query composition and `result_json` redaction live in
`RunStoreService` (`packages/app`); the server module is transport-only and does
not import `ts-db` (ADR-021).

| Surface                     | Contract                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/runs`             | Newest-first list over `runs`                                                                                                                                |
| Query                       | `status`, `limit` (default **50**, max **200**), `cursor` (opaque keyset)                                                                                    |
| Success body                | `{ runs, count, nextCursor, hasMore }`                                                                                                                       |
| List entry                  | `{ id, workflowName, status, mode, agent, startedAt, completedAt }`                                                                                          |
| `cursor`                    | Malformed → **400** `{ error, code: "MALFORMED_CURSOR" }`                                                                                                    |
| Order                       | `started_at DESC, id DESC` exclusive keyset (stable under concurrent inserts)                                                                                |
| `GET /api/runs/:runId`      | One run + ordered `phases`, `transitions`, `actions`                                                                                                         |
| Action fields               | `id, node, kind, status, durationMs, ok, resultSummary, startedAt, completedAt`                                                                              |
| `resultSummary`             | Redacted/bounded projection of `result_json`: sensitive-key blanking plus recursive credential-pattern and configured-secret replacement; never the raw blob |
| Unknown id                  | **404** `{ error, code: "RUN_NOT_FOUND", runId }` — no partial/fabricated object                                                                             |
| `GET /api/runs/by-wbs/:wbs` | Every `task_run_links` row for the WBS with link `kind` + run digest                                                                                         |
| Empty WBS                   | **200** `{ wbs, links: [], count: 0 }` — not an error                                                                                                        |
| Optional query              | `limit` (default **50**, max **200**) on the WBS lookup                                                                                                      |

**Layering.** Domain DAOs own SQL (`RunDao.traceRows` / `traceRowById` with `agent` +
keyset `before`; `PhaseRunDao` / `TransitionRunDao` / `ActionRunDao` /
`TaskRunLinkDao`). `RunStoreService({ getDb, secretValues? })` composes them and redacts.
`summarizeActionResult(resultJson, secretValues?)` owns the trace-safe projection. `runsModule`
maps HTTP ↔ service results only.

<a id="team--message-http-routes-0256"></a>

## Team + Message HTTP Routes (0256)

The board's team supervision and inter-agent messaging surface is **raw Hono handlers** (not oRPC).
oRPC stays the planning-CRUD convention; the live board/streaming surface is raw + SSE (which oRPC
can't express). Web consumes via `fetchWithTimeout` + `resolveApiUrl` and native `EventSource`.

<a id="team-routes-appsserversrcmodulesteamindexts"></a>

### Team routes (`apps/server/src/modules/team/index.ts`)

| Method | Path                             | Body / Query            | Response                                                                     | Notes                                                         |
| ------ | -------------------------------- | ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/team/processes`            | —                       | `{ processes: [{agentId, pid, status, startedAt, exitCode}], count }`        | List supervised processes (0243).                             |
| POST   | `/api/team/agents/:id/start`     | —                       | `{ ok, pid, status }` (201) or `{ error }` (400)                             | Spawn a supervised agent.                                     |
| POST   | `/api/team/agents/:id/stop`      | —                       | `{ ok }` or `{ error }` (400)                                                | Stop a supervised agent.                                      |
| POST   | `/api/team/processes/:id/stdin`  | `{ line: string }`      | `{ ok }` or `{ error }` (400)                                                | Forward a line to the process stdin.                          |
| GET    | `/api/team/processes/:id/stream` | —                       | SSE stream of `{stream, ts, line, seq}` frames                               | Ring-buffer replay + live tail. Heartbeat every 15s.          |
| GET    | `/api/team/teams`                | —                       | `{ teams: [{teamId, name, members: [{id, type, status, pid?, role?, executor?}]}], count }` | Teams grouped by `team:<id>` tag + config (0256 R2); member payload carries the declared role + resolved executor, omitted when unset (0544 R3/R4). |
| POST   | `/api/team/:team/up`             | `?check=true` (dry-run) | `{ materialized: {upserted, orphaned, written}, started: [{id, ok, pid?}] }` | Materialize + best-effort start (0256 R3/R5).                 |
| POST   | `/api/team/:team/down`           | `?purge=true`           | `{ stopped: string[], purged: string[] }`                                    | Stop members + optional purge (0256 R3).                      |
| GET    | `/api/team/health`               | —                       | `{ ok: true }`                                                               | Liveness probe for CLI `team up` best-effort start (0256 R4). |

<a id="message-routes-appsserversrcmodulesmessagesindexts"></a>

### Message routes (`apps/server/src/modules/messages/index.ts`)

| Method | Path                      | Body / Query                         | Response                                                                  | Notes                             |
| ------ | ------------------------- | ------------------------------------ | ------------------------------------------------------------------------- | --------------------------------- |
| GET    | `/api/messages/inbox`     | `?agent=<id>&limit=<n>`              | `{ messages: [{id, fromId, body, status, createdAt, inReplyTo}], count }` | One agent's inbox queue.          |
| GET    | `/api/messages`           | `?limit=<n>`                         | `{ messages: [...], count }`                                              | Global message feed (all agents). |
| POST   | `/api/messages`           | `{ fromId, toId, body, inReplyTo? }` | `{ msgId, toId, status: 'queued' }` (201)                                 | Enqueue a message.                |
| POST   | `/api/messages/:id/reply` | `{ fromId, body }`                   | `{ msgId, toId, status: 'queued' }` (201)                                 | Reply to a message.               |

**Convention:** response envelopes use `{ data…, count }` for lists and `{ ok, ... }` for mutations,
matching the existing board routes. Error shape: `{ error: string }` with the appropriate HTTP status.
All team routes are Bun-gated (require `ServerContext`); they return 503 on the Cloudflare Workers path.
