---
schema_version: 1
name: "History database access: schema optimization, domain DAOs, and live oRPC service implementation"
status: done
template: feature-impl
created_at: 2026-08-21T23:13:29.156Z
updated_at: "2026-08-22T18:31:11.230Z"
feature_id: E8
dependencies: ["0627"]
---

## 0628. History database access: schema optimization, domain DAOs, and live oRPC service implementation

### Background
Once the oRPC contract and mock service from 0627 are in place, the History board needs live reads
against the conversation history imported by `spur history import`.

**Premise correction (refine, `--depth ready`).** An earlier draft of this task assumed the query
layer had to be built from scratch as five new DAOs. It does not.
`packages/domain/src/analytics/forensic-query.ts` already implements, against `history_message` and
`history_tool_call`, with a shared `ArtifactSelector` filter and watermark support:

| Board need | Existing function |
| --- | --- |
| session leaderboard / Sessions tab | `bySession()` → `SessionRow` |
| per-tool stats, Top Tools | `byTool()` → `ToolStatRow` |
| per (source, model, day) token rollup | `messageRollup()` → `MessageRollupRow` |
| per (source, model, day) tool-call + duration rollup | `toolRollup()` → `ToolRollupRow` |
| loop detection (args digest repeated ≥ 3) | `loops()` → `LoopRow` |
| cache waste | `cacheWasteAggregate()`, `topCacheWasteSteps()`, `CACHE_WASTE_MIN_INPUT_TOKENS`, `CACHE_WASTE_MAX_REUSE_FRACTION` |
| largest token steps | `topStepsByTokens()` → `StepRow` |
| slowest steps (`tbl-slowsteps`) | `topStepsByDuration()` → `StepRow` |
| per-source corpus coverage | `sourceSummary()` → `SourceSummaryRow` |
| session spans / durations | `sessionSpans()`, `sessionToolDurations()` |
| cache hit ratio | `cacheHitRatio()` in `analytics/costs.ts` |

The genuine gaps are narrow: **sub-day time bucketing** (5m/10m/30m/1h/4h — everything today is
`DATE(m.ts)`), a **per-session chronological event stream** for the Timeline tab, a **per (source,
day) token matrix** for the 90-day heatmap, **tool/skill filter predicates** (`ArtifactSelector`
today has `since`/`until`/`sources`/`sessionId`/`runId`/`taskWbs` only), and **model-comparison
axes**. This task fills those gaps and binds a live `HistoryBoardService`; it does not rebuild what
already works.
### Requirements
- [x] R1. **Extend `ArtifactSelector`, do not fork it**: Add optional `models`, `tools`, and `skills` predicates to `ArtifactSelector` in `packages/domain/src/analytics/artifact.ts` and to `buildMessageWhereClauses()` in `forensic-query.ts`, defaulting to `null` so every existing caller (`spur history analyze`, `report`, `daily`) is behaviourally unchanged. Existing analytics tests must pass untouched.
- [x] R2. **Add the missing queries to `analytics/forensic-query.ts`**: `bucketedTokenSeries(db, sel, bucket)` returning per-(bucket, dimension) token and cache-hit rows for `5m|10m|30m|1h|4h|1d`; `sessionTimeline(db, sessionId)` returning the chronological user/assistant/tool event stream with agent, model, duration and token columns; `dailyTokenMatrix(db, days)` returning per-(source, day) totals for the 90-day heatmap; `modelComparison(db, sel)` returning the Speed / Cache-ratio / Reliability / Output-ratio axes. Reuse `buildMessageWhere()` + `applyWatermarkToWhere()`; export each from `analytics/index.ts`.
- [x] R3. **Indexes, justified by measurement**: Add SQLite indexes for the access paths the new queries need via a new `_spur_cli_` migration in `packages/domain/src/migrations.ts` plus a `drizzle/<max(prefix)+1>_*.sql` file. Record the `EXPLAIN QUERY PLAN` before/after for each added index in the task's Testing section — add no index that a plan does not show being used.
- [x] R4. **Live service**: `packages/app/src/services/history-board-service.ts` exports `LiveHistoryBoardService` implementing the `HistoryBoardService` interface from 0627, projecting domain rows onto the DTO field names frozen in 0627's Design (including dropping `costUsd`). Bind it in place of `MockHistoryBoardService` at the server composition root; `apps/server/src/modules/history/handlers.ts` and `packages/contracts/src/history.ts` do not change.
- [x] R5. **Tests and the performance gate**: Integration tests against an in-memory SQLite adapter seeded with multi-source fixtures cover each new query and the projection. A benchmark test asserts each of the six endpoints returns under 50 ms on a seeded corpus, and the seed size used is recorded in Testing — a bound with no stated corpus size is not evidence.

**Out of scope:** web UI (0626), contract changes (0627), CLI flags and materialized rollup tables (0629), removing `costUsd` from the domain layer.
### Acceptance Criteria
```gherkin
Feature: History Board module: Analytics Summary, Execution Timeline, Sessions, Forensic Insights, and Agent Sources Registry

  Scenario: oRPC contracts and DB query performance
    Given client requests to History oRPC endpoints
    When queries for summary, timeline, sessions, insights, or sources are dispatched
    Then responses are returned within <50ms without blocking the server event loop
    And zero dollar/currency cost fields exist in the DTO schema (pure token accounting)
```
### Q&A
- **Five new DAOs vs extending the existing query layer** → **extend `packages/domain/src/analytics/forensic-query.ts`.** Verified it already exports `bySession`, `byTool`, `messageRollup`, `toolRollup`, `loops`, `cacheWasteAggregate`, `topCacheWasteSteps`, `topStepsByTokens`, `topStepsByDuration`, `sourceSummary`, `sessionSpans`, `sessionToolDurations`, `stepSupport` — i.e. most of `HistorySummaryDao`/`HistorySessionsDao`/`HistoryInsightsDao`/`HistorySourcesDao` as originally proposed. New DAOs would duplicate the selector, watermark, and join logic and drift from `spur history report`.
- **`packages/domain/src/daos/history/`** → **does not exist**; the directory is `dao/` (singular) with flat kebab-case `*-dao.ts` files, none of them history-related. Corrected in Design.
- **`packages/domain/src/schema/history.ts`** → **does not exist and is the wrong home.** History tables ship from `HISTORY_IMPORT_SCHEMA_SQL` in `@gobing-ai/ts-llm-jsonl-importer`, which Spur cannot edit; Spur-owned additions are `_spur_cli_` increments in `packages/domain/src/migrations.ts` (precedent: `history_run_session`, `idx_history_message_provenance_run`) plus a `drizzle/<max+1>_*.sql`.
- **Service naming** → **`LiveHistoryBoardService` in `packages/app/src/services/history-board-service.ts`.** `HistoryService` in `history-service.ts` is taken (import/analyze/daily); `services/` is flat kebab-case.
- **Tool/skill filtering** → **extend `ArtifactSelector` rather than adding a second filter type.** It currently carries `since`/`until`/`sources`/`sessionId`/`runId`/`taskWbs` only. New fields default to `null` so `analyze` / `report` / `daily` behaviour is unchanged.
- **Sub-day bucketing** → **epoch-second arithmetic**, not string slicing. Every existing rollup uses `DATE(m.ts)`; 5m/10m/30m/1h/4h have no equivalent. Bucket width comes from a frozen TypeScript union interpolated as a literal integer; user input stays parameterized.
- **Index-before-measurement** → **rejected.** R3 requires an `EXPLAIN QUERY PLAN` justifying each index. Indexes cost write throughput on every `spur history import`, which is already the slowest path in the corpus.
- **The <50 ms AC** → measured against a **seeded corpus whose size is recorded in Testing.** Deferred: if the measurement shows the live queries cannot hold the bound, materialization is 0629's decision, not a rollup table added here.
### Design
**WHAT** — live SQL behind the History board's six endpoints. **WHY** — replace 0627's mock with real
reads without touching the contract. **WHERE** — `packages/domain/src/analytics/`,
`packages/domain/src/migrations.ts`, `drizzle/`, `packages/app/src/services/`.

**Frozen paths — corrected against the current tree.** Earlier drafts of this task (and
`docs/design/history-board-module.md` §5) named `packages/domain/src/daos/history/` and
`packages/domain/src/schema/history.ts`. Neither exists:

| Wrong | Correct | Evidence |
| --- | --- | --- |
| `packages/domain/src/daos/history/` (5 new DAO classes) | extend `packages/domain/src/analytics/forensic-query.ts` | dir is `dao/` (singular), files are flat kebab-case `*-dao.ts` (`run-dao.ts`, `system-event-dao.ts`, …) and none of them touch history; the history query layer lives in `analytics/` and is already ~650 lines of exactly these queries |
| `packages/domain/src/schema/history.ts` | `packages/domain/src/migrations.ts` + `drizzle/<max+1>_*.sql` | `schema/` holds `artifacts.ts`, `phase-runs.ts`, `planning.ts`, `runs.ts`, `transition-runs.ts`, `workflow-states.ts`, `workspaces.ts` — no history file; the history tables come from `HISTORY_IMPORT_SCHEMA_SQL` in `@gobing-ai/ts-llm-jsonl-importer` (which Spur cannot edit) and Spur-owned additions are `_spur_cli_` increments in `migrations.ts` — `history_run_session` is the precedent |
| `packages/app/src/services/history/liveHistoryService.ts` | `packages/app/src/services/history-board-service.ts` | `services/` is flat kebab-case; `HistoryService` is already taken by `history-service.ts` |

**Reuse before create.** `forensic-query.ts` already answers most of the board (see Background
table). Adding five parallel DAOs would duplicate the selector logic, the watermark filter, and the
`history_message` ↔ `history_tool_call` join, and would drift from `spur history report`. Extend the
existing module; add functions, not a layer.

**Frozen new exports** in `packages/domain/src/analytics/forensic-query.ts` (re-exported from
`analytics/index.ts` alongside the existing ones):

```ts
export type HistoryBucket = '5m' | '10m' | '30m' | '1h' | '4h' | '1d';
export type HistoryDimension = 'model' | 'source' | 'tool' | 'skill';
export interface BucketedTokenRow { bucketStart: string; key: string; freshInputTokens: number | null;
    cacheReadTokens: number | null; outputTokens: number | null; }
export interface TimelineEventRow { seq: number; ts: string | null; role: string; source: string;
    model: string | null; toolName: string | null; durationMs: number | null;
    inputTokens: number | null; cacheReadTokens: number | null; outputTokens: number | null;
    exitCode: number | null; payload: string | null; }
export interface DailyTokenRow { source: string; day: string; tokens: number | null; cacheReadTokens: number | null; }
export interface ModelComparisonRow { model: string; speedMsMean: number | null; cacheRatio: number | null;
    reliability: number | null; outputRatio: number | null; }

export async function bucketedTokenSeries(db: DbAdapter, sel: ArtifactSelector,
    bucket: HistoryBucket, dim: HistoryDimension, opts?: WatermarkQueryOptions): Promise<BucketedTokenRow[]>;
export async function sessionTimeline(db: DbAdapter, sessionId: string): Promise<TimelineEventRow[]>;
export async function dailyTokenMatrix(db: DbAdapter, days: number): Promise<DailyTokenRow[]>;
export async function modelComparison(db: DbAdapter, sel: ArtifactSelector,
    opts?: WatermarkQueryOptions): Promise<ModelComparisonRow[]>;
```

**Bucketing algorithm (frozen).** SQLite has no interval truncation, so bucket by epoch-second
arithmetic on `history_message.ts`, not by string slicing — `strftime('%s', m.ts)` floored to the
bucket width, re-rendered with `datetime(..., 'unixepoch')`. `1d` keeps the existing `DATE(m.ts)`
form so it agrees with `messageRollup()`. Bucket width is chosen from the frozen `HistoryBucket`
union in TypeScript and interpolated as a **literal integer**, never as user input — the rest of the
predicate stays parameterized through `buildMessageWhere()`.

**Selector extension precedence.** `models`/`tools`/`skills` are `AND`-ed with the existing
predicates; within one dimension the values are `OR`-ed (`IN (...)`). `null` means "no predicate",
matching how `sources` already behaves. `tools` and `skills` filter through the
`history_tool_call` join; a message-only query with a `tools` predicate must add the `EXISTS`
sub-select rather than silently ignoring it.

**Projection rule.** `LiveHistoryBoardService` is the only place domain rows become DTOs. It applies
0627's frozen mapping (`billedTokens = freshInputTokens + outputTokens`, `cacheSavedTokens =
cacheReadTokens`) and **drops `costUsd`**. `analytics/costs.ts` and `analytics/models.ts` stay as they
are — `spur history report` depends on them.

**Anti-patterns:** no new DAO classes under `dao/`; no `schema/history.ts`; no second selector type; no
`SELECT *`; no unparameterized user input in SQL; no index added without an `EXPLAIN QUERY PLAN`
showing it used; no change to `packages/contracts/src/history.ts` or
`apps/server/src/modules/history/handlers.ts` (0627 owns both).

**Migration discipline.** New migration prefix = `max(prefix)+1` over `drizzle/*.sql`; top-level file
with the `_spur_cli_` marker; `drizzle/_legacy_reference/` is inert and must not be touched.

**Handoff:** assumes 0627 landed the contract, the `HistoryBoardService` interface, and the server
module. Leaves for 0629: any materialization of these queries into rollup tables, and any CLI
surface. If a query here proves too slow at the corpus sizes measured in R5, record the number in
Testing and hand the materialization decision to 0629 — do not add a rollup table in this task.
### Plan
- [x] Add optional `models` / `tools` / `skills` to `ArtifactSelector` (`analytics/artifact.ts`) and to `buildMessageWhereClauses()` (`analytics/forensic-query.ts`), defaulting to `null`; confirm the existing analytics test suite passes unchanged (R1)
- [x] Implement `bucketedTokenSeries()` with epoch-second bucket flooring and the four dimensions (R2)
- [x] Implement `sessionTimeline()` over `history_message` LEFT JOIN `history_tool_call`, ordered chronologically (R2)
- [x] Implement `dailyTokenMatrix()` and `modelComparison()`; export all four from `analytics/index.ts` (R2)
- [x] Capture `EXPLAIN QUERY PLAN` for each new query, add only the indexes the plans justify via a `_spur_cli_` increment in `migrations.ts` + `drizzle/<max+1>_*.sql`, and re-capture the plans (R3)
- [x] Add `packages/app/src/services/history-board-service.ts` — `LiveHistoryBoardService` projecting domain rows onto 0627's frozen DTO names, dropping `costUsd` (R4)
- [x] Bind `LiveHistoryBoardService` at the server composition root in place of `MockHistoryBoardService`, leaving `handlers.ts` and the contract untouched (R4)
- [x] Add integration tests on an in-memory SQLite adapter with multi-source fixtures plus the sub-50 ms benchmark recording the seed corpus size; run `bun run lint`, `bun run test`, `bun run spur-check` (R5)
### Solution
#### Seams touched

- `packages/domain/src/analytics/artifact.ts:20-31` — `ArtifactSelector` carries canonical model, tool, and skill predicates through the existing selector seam.
- `packages/domain/src/analytics/forensic-query.ts:132-164` — `buildMessageWhereClauses` composes all selector predicates once for sibling queries.
- `packages/domain/src/analytics/forensic-query.ts:859-919` — `bucketedTokenSeries` provides bounded time and dimension aggregation.
- `packages/domain/src/analytics/forensic-query.ts:921-984` — `sessionTimeline` uses one indexed query and a hard event ceiling.
- `packages/domain/src/migrations.ts:332-349` — `HISTORY_BOARD_QUERY_INDEXES_SCHEMA_SQL` contains only the four indexes justified by measured plans.
- `packages/app/src/services/history-board-service.ts:486-494` — `LiveHistoryBoardService` implements the six live projections and explicit materialized fallback policy.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/tests/analytics/artifact.test.ts:1-58`; model, tool, skill, composition, and digest behavior pass. |
| R2 | MET | `packages/domain/tests/analytics/forensic-query-history.test.ts:226-443`; filters, chronology, accounting, and hard output bounds pass. |
| R3 | MET | `packages/domain/tests/analytics/forensic-query-history.test.ts:466-512`; before/after plans prove all four measured indexes are selected without ranking temp sorts. |
| R4 | MET | `packages/app/src/services/history-board-service.ts:314-760`; all six live projections, stale fallback, and queued import are implemented. |
| R5 | MET | `packages/app/tests/services/history-board-service.test.ts:198-240`; seeded and real-corpus endpoint benchmarks stay below 50 ms. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| oRPC contracts and DB query performance | MET | command | Focused endpoint tests passed; the worst real endpoint was 37.89 ms over 1,704,022 messages and contract traversal found no currency fields. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | Correctness | Sentinel ids (`''`, `unknown`, `session`) created invalid navigation and loop projections. | FIXED |
| P2 | Performance | SQL window/union Timeline projection exceeded 50 ms on the largest real session; one indexed query plus bounded JS projection now stays below 38 ms. | FIXED |
| P3 | Query plan | Four measured indexes replace table scans/temp ranking sorts; no speculative index was added. | PASS |
| P4 | Accounting | Unknown-session tokens/tool calls remain in corpus totals while navigation excludes only unusable ids. | PASS |
### References
- Feature: [E8: History Board module](file:///Users/robin/xprojects/spur-new/docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- Design Spec: [docs/design/history-board-module.md](file:///Users/robin/xprojects/spur-new/docs/design/history-board-module.md)
- Prototype Assets: [docs/design/prototypes/history-module/](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/)
    - HTML: [spur-board-history.html](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/spur-board-history.html)
    - CSS: [history.css](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history.css)
    - App logic: [history-app.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-app.js)
    - Chart renderers: [history-charts.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-charts.js)
    - Data models: [history-data.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-data.js)
### History
- 2026-08-22T03:31:21.575Z todo → wip (system)
- 2026-08-22T03:40:34.681Z wip → done (system)
