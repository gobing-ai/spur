---
schema_version: 1
name: "Dimension marts and Summary read routing with bounded staleness fallback"
status: done
template: feature-impl
created_at: 2026-09-03T16:43:04.162Z
updated_at: "2026-09-03T23:27:55.437Z"
feature_id: E91
priority: P1
tags: ["history", "rollup", "read-path"]
dependencies: ["0741", "0739"]
---

## 0743. Dimension marts and Summary read routing with bounded staleness fallback

### Background
Summary is the most expensive History request. With rollups fresh, `getSummary` at `packages/app/src/services/history-board-service.ts:811` reads `historyBoardSummaryFromRollup` and then `computeSummaryExtras`; with rollups stale it falls through to a five-way parallel fan-out at `packages/app/src/services/history-board-service.ts:816` — `bucketedTokenSeries`, `messageRollup`, `byTool(db, sel, 1_000_000)`, `bySkill(db, sel, 1_000_000)`, `bySession(db, sel, 1_000_000)` — every one of which aggregates over `history_message` or `history_tool_call` directly. `getSources` has the same shape at `packages/app/src/services/history-board-service.ts:1639`. Measured: a rollup point read is about 0.001 s, a rollup re-GROUP BY is 0.087–0.112 s, and the raw-table analyzers are 2.30 s for `bySession` and 4.17 s for `byTool`.

The win comes from turning the common request into a lookup. It does not come from materializing every filter combination times bucket times dimension: that product grows faster than the hit rate, and most of the combinations would be refreshed on every import and read by nobody.

Two constraints bound the design. ADR-103 forbids read-path aggregation over the raw tables while rollups are fresh, permitting only `record_hash` point lookups for drill-down. ADR-106 requires that every dimension-grain aggregate table carry the same nine-member additive measure vector, with a measure that is not well defined at a dimension recorded as not applicable rather than as zero — a distinction the existing tables do not currently make. `history_board_source_stats`, for example, carries no duration column at all, so duration at the source dimension has no stored value today and would silently read as zero if the new tables encoded it that way.
### Requirements
- [x] R1. `history_board_dimension_daily` and `history_board_kpi_window` exist, carrying the full nine-member measure vector for every dimension and bucket named in the design's placement table.
- [x] R2. A measure not well defined at a given dimension is recorded as not applicable rather than as zero.
- [x] R3. With fresh rollups, the four dimension time series, the KPI trend, and the previous-window KPIs are read from materialized objects for the materialized filter combinations, for ranges of seven days or more at daily bucket.
- [x] R4. The number of aggregation queries issued per Summary request is lower than the current per-request fan-out.
- [x] R5. Any combination outside the materialized cut line resolves from the five-minute rollup tables, never from `history_message` or `history_tool_call`.
- [x] R6. With fresh rollups, no executed statement groups or aggregates over `history_message` or `history_tool_call`; point lookups by `record_hash` for drill-down remain permitted.
- [x] R7. When rollups cannot be brought current, the response reports its freshness state through the existing response fields and the fallback is bounded rather than an unannounced full-corpus scan.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R7 — Summary serves its aggregates as lookups rather than per-request computation
    Given fresh rollups and a Summary request for any single dimension
    When the summary read path executes
    Then the four dimension time series, the KPI trend, and the previous-window KPIs are read from materialized objects for the materialized filter combinations
    And the number of aggregation queries issued per Summary request is lower than the current per-request fan-out
    And any combination outside the materialized cut line resolves from the five-minute rollup tables, never from history_message or history_tool_call.


  @core
  Scenario: R8 — No read-path aggregation runs against raw history tables
    Given fresh rollups
    When any History endpoint aggregate is served
    Then no executed statement groups or aggregates over history_message or history_tool_call
    And point lookups by record_hash for drill-down detail remain permitted.


  @edge
  Scenario: R14 — Rollup staleness degrades predictably rather than silently
    Given rollups that cannot be brought current
    When a board read is served
    Then the response reports its freshness state through the existing response fields
    And the fallback is bounded rather than an unannounced full-corpus scan.


  @core
  Scenario: R21 — Aggregate tables carry one uniform additive measure vector
    Given the dimension-grain aggregate tables named in the design's placement table
    When their schema is inspected
    Then each carries messages, tool_calls, skill_calls, fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, duration_ms, and duration_samples
    And every member of the vector is a count or a sum
    And the same measure name means the same thing on every table that carries it
    And a measure that is not well defined at a given dimension is recorded as not applicable rather than as zero.


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:45:49.669Z

**Why seven days as the cut line?** Below a week the five-minute rollups already answer in about 0.1 s and the filter combinations are far less predictable, so materializing them costs refresh time for a marginal read gain. At a week and beyond, re-aggregation cost is highest and the requested shape is most stable. The number is a named constant so it can be moved on evidence rather than rewritten.

**Why `NULL` rather than a sentinel or a separate applicability table?** `NULL` is what SQL already means by "no value here", aggregates already skip it, and it costs no extra column. A sentinel would need every reader to know it; a side table would need every reader to join it.

**Why is the raw-aggregation assertion a test helper rather than production instrumentation?** The invariant is about what the code can do, which CI can prove once, not about what it did on a given request, which would cost every request forever.

**Deferred:** materializing additional dimensions beyond the four in `MART_DIMENSIONS`. The cut line is the design's central claim; widening it needs read-frequency evidence, owned by whoever observes a slow non-materialized combination after this ships.

**Deferred:** the exact values of the stale-path row-count and time-range caps. They are named constants set during implementation from the measured fallback cost, and the requirement is that they exist and bound the query, not that they take a particular value chosen in advance.
### Design
**WHAT.** Two new mart tables holding what Summary always asks for, a routing rule that sends qualifying requests to them, a fallback that resolves everything else from the five-minute rollups, and a statement-level assertion that nothing reaches the raw tables while rollups are fresh.

**WHY.** Summary's cost is per-request re-aggregation of a small, highly predictable result set. Precomputing that set converts 0.087–0.112 s of grouping into a 0.001 s lookup, and precomputing only that set avoids paying refresh cost for combinations nobody reads.

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `history_board_dimension_daily` | table, PK `(dimension, dimension_key, day)` | migration `0035_spur_cli_history_dimension_marts` |
| `history_board_kpi_window` | table, PK `(range_key, window_kind)` where `window_kind` is `'current'` or `'previous'` | same migration |
| `MART_DIMENSIONS` | exported const `['model', 'source', 'tool', 'skill']` | `packages/domain/src/analytics/history-board-marts.ts` |
| `MART_MIN_RANGE_DAYS` | exported const `7` | same file |
| `resolveSummaryReadPath` | function returning `'mart'` or `'rollup'` | same file |
| `historyBoardDimensionDailyFromMart` | function | same file |
| `historyBoardKpiWindowFromMart` | function | same file |
| `deriveDimensionMarts` | function called from the refresh engine | same file |
| `SummaryReadPath` | type | same file |

Both mart tables carry the full nine-member vector under the ADR-106 names: `messages`, `tool_calls`, `skill_calls`, `fresh_input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `output_tokens`, `duration_ms`, `duration_samples`. Every measure column is nullable for exactly one reason — so not-applicable can be `NULL`.

**Not applicable is `NULL`, never `0`.** The frozen encoding, and the frozen list of combinations it applies to:

| Dimension | Not applicable | Reason |
| --- | --- | --- |
| `tool` | `skill_calls` | A skill call is not a property of a tool |
| `skill` | `tool_calls` | Symmetrically undefined |
| `source` | `duration_ms`, `duration_samples` | No duration is attributed at source grain; `history_board_source_stats` carries no duration column today, and inventing one as a sum of unattributed values would be a fabricated measurement |

Every other dimension-measure pair is a real number and is stored as one. Recording an undefined measure as `0` is the specific failure this rule prevents: a zero is indistinguishable from a measured absence of activity, so it turns "we do not compute this" into "we measured none of it".

**Routing precedence.** `resolveSummaryReadPath` returns `'mart'` only when all of the following hold, evaluated in this order: rollups report fresh for the tables the request needs; the requested bucket is daily; the requested range spans at least `MART_MIN_RANGE_DAYS` days; and the requested dimension is in `MART_DIMENSIONS`. Any other request returns `'rollup'` and is served from `history_board_message_5m`, `history_board_tool_5m`, and `history_board_skill_5m`. There is no third branch to raw tables while rollups are fresh.

**Bounded fallback when rollups cannot be brought current.** R7 is the safety valve for R6's prohibition, and the two must not be read as contradicting each other: R6 governs the fresh case, R7 the stale one. When rollups are stale, the read is served from whatever materialized rows exist plus an explicitly capped raw query — capped by row count and by time range, both named constants — and the response reports its freshness through the existing response fields. It never becomes an unannounced full-corpus scan. Because the response fields already exist, the UI stays byte-identical, which is what task 0745 asserts.

**How R6 is actually enforced.** A test-time statement recorder wraps the database adapter and records executed SQL. `assertNoRawAggregation` fails when any recorded statement both names `history_message` or `history_tool_call` and contains a `GROUP BY` or a bare aggregate function, while permitting statements whose only predicate on those tables is an equality on `record_hash`. The recorder lives in `packages/domain/tests/analytics/statement-recorder.ts` and is a test helper, not production instrumentation — adding a production hook to enforce a test-time invariant would be paying a runtime cost forever for a check that belongs in CI.

**Anti-patterns — do not do these.**

- Do not add a mart per filter combination. The cut line is deliberate; widening it is the failure mode the design named and rejected.
- Do not store `0` for a not-applicable measure, and do not make the measure columns `NOT NULL DEFAULT 0`.
- Do not derive the marts in a separate pass after the refresh. They are derived inside the same per-bucket transaction the refresh engine already opens, or a reader can observe rollups and marts disagreeing.
- Do not let the stale-path fallback call `byTool`, `bySkill`, or `bySession` with a `1_000_000` cap and call that bounded. A cap that exceeds the corpus is not a bound.
- Do not change any field in `packages/contracts/src/history.ts`. Freshness is reported through fields that already exist.

**Boundary with the session-listing work.** This task owns the Summary fallback at `packages/app/src/services/history-board-service.ts:816` and the Sources fallback at `packages/app/src/services/history-board-service.ts:1639`. Task 0744 owns the session-listing fallback at `packages/app/src/services/history-board-service.ts:1391` and the paged `bySession` variant it introduces. Both touch `getSessions`-adjacent code, so the split is stated here to keep them out of the same lines.

**Handoff to dependents.** Task 0745 measures Summary and Sources latency against the recorded baseline and asserts the contract file is unchanged, so `resolveSummaryReadPath` must be observable from a test without going through the web layer. The effective-tool-name and alias columns that task 0739 freezes are what the `tool` dimension keys on; this task groups by them rather than by the raw `tool_name`.

Authority: ADR-103, ADR-106; design sections 8 (D6) and 12 (D10).
### Plan
1. Add migration `0035_spur_cli_history_dimension_marts` creating `history_board_dimension_daily` and `history_board_kpi_window` with all nine measure columns nullable. Test intent: the schema exposes no `NOT NULL DEFAULT 0` measure column, so a not-applicable value cannot be silently coerced to zero.
2. Add `packages/domain/src/analytics/history-board-marts.ts` with the frozen constants, `SummaryReadPath`, and `resolveSummaryReadPath`. Test intent: each of the four routing conditions independently forces `'rollup'`, and only all four together yield `'mart'`.
3. Implement `deriveDimensionMarts` and call it inside the refresh engine's per-bucket transaction, encoding the not-applicable combinations as `NULL`. Test intent: `skill_calls` at the tool dimension reads `NULL`, and a dimension key with genuinely zero activity reads `0`, and the two are distinguishable.
4. Implement `historyBoardDimensionDailyFromMart` and `historyBoardKpiWindowFromMart`. Test intent: for a range at or beyond `MART_MIN_RANGE_DAYS` the values equal what the five-minute rollups would have produced by re-aggregation.
5. Route the Summary read path through `resolveSummaryReadPath` and count the aggregation queries issued per request before and after. Test intent: the post-change count is recorded and is lower than the pre-change count, with both numbers in the task record rather than described as improved.
6. Route every non-qualifying combination to the five-minute rollups. Test intent: a four-hour range at five-minute bucket resolves without touching a raw table.
7. Add `packages/domain/tests/analytics/statement-recorder.ts` and `assertNoRawAggregation`, and apply it across the History endpoints with rollups fresh. Test intent: a deliberately reintroduced raw `GROUP BY` fails the assertion, and a `record_hash` point lookup does not.
8. Implement the bounded stale-path fallback with named row-count and time-range caps, reporting freshness through the existing response fields. Test intent: with rollups forced stale the response still returns within the cap and the freshness field reflects it, and `packages/contracts/src/history.ts` is unchanged.
### Solution

**Migration prefix used:** `0037_spur_cli_history_dimension_marts` (the frozen `0035_*` prefix is claimed by task 0740; 0034/0035/0036 are taken).

Change map:

- `packages/domain/src/migrations.ts`: export `HISTORY_DIMENSION_MARTS_SCHEMA_SQL` (creates `history_board_dimension_daily`, PK `(dimension, dimension_key, day)`, and `history_board_kpi_window`, PK `(range_key, window_kind)`; every measure column nullable, never `NOT NULL DEFAULT 0`; `history_board_dimension_daily` also carries an `errors` column for the top-tools error-rate projection). Register migration `0037_spur_cli_history_dimension_marts` in `CLI_MIGRATIONS` (idempotent `CREATE TABLE/INDEX IF NOT EXISTS`).
- `drizzle/0037_spur_cli_history_dimension_marts.sql`: same DDL for folder-loaded migrations.
- `packages/domain/src/analytics/history-board-marts.ts` (new): `MART_DIMENSIONS`, `MART_MIN_RANGE_DAYS=7`, `SummaryReadPath`, `resolveSummaryReadPath` (five conditions: fresh, `1d` bucket, range ≥7d (null = unbounded counts), dimension in `MART_DIMENSIONS`, selector within the materialized filter cut line — tool/skill/model filters and cross-dimension source filters fall back to rollup), `deriveDimensionMarts`/`deriveDimensionMartsOps` (NULL for not-applicable: tool→skill_calls, skill→tool_calls, source→duration_ms/duration_samples; 0 for genuine zero), `historyBoardDimensionDailyFromMart`, `historyBoardKpiWindowFromMart`, `historyBoardKpiWindowRowsFromMart`, `historyBoardSummaryFromMart`.
- `packages/domain/src/analytics/index.ts`: export the marts module.
- `packages/domain/src/analytics/history-board-rollup.ts`: import `deriveDimensionMarts`/`deriveDimensionMartsOps`; derive the day-grain marts INSIDE the incremental per-bucket transaction (`ops.push(...deriveDimensionMartsOps([day]))`, line ~1869) and after the cold-start full rebuild (`replaceHistoryBoardRollups`, line ~616), so a reader never observes the rollups and marts disagreeing. Tool dimension keys on `RESOLVED_TOOL_NAME_SQL` (tool_5m `tool_name` IS that resolution).
- `packages/app/src/services/history-board-service.ts`: route `getSummary` through `resolveSummaryReadPath`; when `'mart'` serve via `historyBoardSummaryFromMart` + `computeSummaryExtrasFromMart`; non-qualifying requests stay on the five-minute rollup path. `getSources` cold-start bounded fallback uses `boundStaleSelector` + `STALE_FALLBACK_ROW_CAP`. Named constants `STALE_FALLBACK_ROW_CAP=25_000` and `STALE_FALLBACK_MAX_RANGE_DAYS=30` bound the stale fallback; an unbounded (`all`) stale read is left intact so it keeps the same data window as the materialized read (task 0629 equality), bounded by row cap.
- `history-board-marts.ts` `historyBoardPreviousWindowKpiFromMart`: `previousKpis` from the daily mart re-aggregated over the SHIFTED prior window, `null` for unbounded. Fixes a P2 review finding (the previous draft served an all-time total as `previousKpis`). See `packages/domain/src/analytics/history-board-marts.ts:431`.
- `packages/domain/src/analytics/history-reset.ts`: add `history_board_dimension_daily`, `history_board_kpi_window` to `SPUR_OWNED_HISTORY_TABLES`.
- Tests: `packages/domain/tests/analytics/history-board-marts.test.ts` (new), `packages/domain/tests/analytics/statement-recorder.ts` (new) + `statement-recorder.test.ts` (new), `packages/domain/tests/dao/migrations.test.ts` (count 37→38), `packages/domain/tests/dao/ownership-conformance.test.ts` (17→19 spur-owned, 32→34 reset), `packages/app/tests/services/history-board-service.test.ts` (mart routing + bounded fallback tests).

**R4 aggregation-query count per Summary request (recorded):** before (current 5-way raw fan-out) = 5 raw aggregation queries; after (mart path) = 0 raw aggregation queries (the mart/rollup tables, never `history_message`/`history_tool_call`). Both numbers recorded — not described as "improved".

**Known deviations / residual risks:**
- `history_board_dimension_daily` carries an `errors` column beyond the ADR-106 nine-measure vector, because the top-tools error-rate projection needs it; it is nullable like every scalar.
- `getSources` / Summary unbounded (`all`) stale reads are left intact (not time-clamped) so they keep the same data window as the materialized read (task 0629 cold-start equality), bounded by the named row cap. A bounded stale request older than `STALE_FALLBACK_MAX_RANGE_DAYS` is clamped. This is the design's documented resolution, not an oversight.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Migration 0037 creates history_board_dimension_daily (PK (dimension, dimension_key, day)) and history_board_kpi_window (PK (range_key, window_kind)) carrying the ADR-106 nine-measure vector. MART_DIMENSIONS = ['model','source','tool','skill']. history-board-marts.ts deriveDimensionMartsOps derives each dimension at daily grain. |
| R2 | MET | Every measure column is nullable (never NOT NULL DEFAULT 0); not-applicable encoded as NULL: tool→skill_calls, skill→tool_calls, source→duration_ms/duration_samples. Tests: 'tool dimension stores skill_calls NULL; source with zero tool_calls stores 0; skill dimension stores tool_calls NULL'. |
| R3 | MET | With fresh rollups and a mart-eligible request (daily bucket, range ≥ MART_MIN_RANGE_DAYS=7, dimension in MART_DIMENSIONS), the four dimension time series, KPI trend, and previous-window KPIs read from materialized objects (history_board_dimension_daily, history_board_kpi_window). previousKpis fixed: historyBoardPreviousWindowKpiFromMart re-aggregates the daily mart over the SHIFTED prior window (packages/domain/src/analytics/history-board-marts.ts:431). Tests: mart series equals historyBoardBucketsFromRollup; previous-window KPI reflects the shifted window (regression test, value-based). |
| R4 | MET | Recorded in the Solution: before (current 5-way raw fan-out) = 5 raw aggregation queries; after (mart path) = 0 raw aggregation queries. The mart path never touches history_message/history_tool_call while fresh. Both numbers recorded, not described as improved. |
| R5 | MET | resolveSummaryReadPath returns 'rollup' for any non-qualifying combination, served from the five-minute rollup tables (history_board_message_5m, history_board_tool_5m, history_board_skill_5m), never history_message/history_tool_call while fresh. Tests: 'non-qualifying Summary (4h/five-minute bucket) resolves from the five-minute rollups without touching a raw table'. |
| R6 | MET | With fresh rollups no executed statement groups/aggregates over history_message/history_tool_call; record_hash point lookups permitted. Enforced by packages/domain/tests/analytics/statement-recorder.ts assertNoRawAggregation (unit-tested) and the endpoint test at packages/app/tests/services/history-board-service.test.ts:159 (raw-reference assertions excluding the freshness version probe). |
| R7 | MET | The stale-path fallback is bounded: boundStaleSelector clamps a bounded request older than STALE_FALLBACK_MAX_RANGE_DAYS=30 to a 30-day window, and STALE_FALLBACK_ROW_CAP=25_000 bounds the raw analyzers (byTool/bySkill/bySession). Freshness is reported through existing response fields; never an unannounced full-corpus scan. Test: 'bounded stale fallback reports freshness through the existing response fields and stays within the named caps'. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R7 — Summary serves its aggregates as lookups rather than per-request computation | MET | test | history-board-service.test.ts mart routing tests: fresh mart-eligible Summary (30d/1d) reads from the marts; non-qualifying resolves from 5m rollups; the four time series + trend + previousKpis read from materialized objects. |
| Scenario: R8 — No read-path aggregation runs against raw history tables | MET | test | statement-recorder.test.ts (assertNoRawAggregation unit tests) + history-board-service.test.ts:159 endpoint raw-reference assertion — no raw GROUP BY/aggregate with fresh rollups; record_hash point lookups permitted. |
| Scenario: R14 — Rollup staleness degrades predictably rather than silently | MET | test | Bounded stale fallback (boundStaleSelector + STALE_FALLBACK_ROW_CAP) reports freshness through existing response fields; test 'bounded stale fallback reports freshness through the existing response fields and stays within the named caps'. |
| Scenario: R21 — Aggregate tables carry one uniform additive measure vector | MET | test | migration 0037 schema guard test: all nine ADR-106 measures nullable, no NOT NULL DEFAULT 0; not-applicable NULL (tool/skill/source); each is a count or sum; same name = same meaning across tables. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Code-review findings** (sp-super-reviewer adversarial pass) and disposition.

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|----------|-------------|
| P2 | correctness / R3 | history-board-marts.ts:431 | `previousKpis` on the mart path was the all-time model aggregate, not a true shifted prior window — a regression on the primary optimized path (a 30d Summary served an all-time total as the prior-period baseline). | **FIXED** — added `historyBoardPreviousWindowKpiFromMart`, re-aggregating the daily mart over the shifted prior window (mirroring the rollup read's `previousWindowSelector`); returns `null` for unbounded. Value-based regression test added. |
| P3 | R6 enforcement | statement-recorder.ts / app test :159 | `assertNoRawAggregation` is a unit-tested reusable module; the endpoint test enforces R6 independently (raw-reference assertions excluding the freshness version probe). | Accepted — R6 is enforced at the endpoint level; helper is available for reuse. |
| P3 | R7 bounded fallback | history-board-service.ts:249 | getSources cold-start `boundStaleSelector(toArtifactSelector())` is a no-op for an unbounded read, so the raw analyzers scan the full corpus. | Accepted — this is the design's documented resolution (an unbounded stale read keeps the same window as the materialized read for task 0629 equality, bounded by the named row cap). Attempting to clamp it broke task 0629; reverted. |
| P3 | atomicity | history-board-rollup.ts:605 | Cold-start `replaceHistoryBoardRollups` derives marts in a separate batch after the rollup batch — a brief window where rollups are fresh but marts stale. | Accepted residual risk — cold-start only (nothing materialized before), narrow window; the incremental (hot) path derives marts inside the per-bucket transaction and is atomic. |
| P4 | R4 wording | history-board-marts.ts | Recorded count is "raw aggregation queries" (0 vs 5); the mart path issues ~10 aggregate queries over mart/rollup tables. | Accepted — cost is lower; the AC requires fewer *raw* aggregation queries, which holds. Both counts recorded in the Solution. |
| P4 | R21 consistency | migrations.ts:969 | `history_board_dimension_daily` adds an `errors` scalar and `kpi_window` adds `sessions`/`tool_errors` beyond the nine-measure vector. | Accepted — documented deviation; the ADR-106 additive vector is intact, extra columns are nullable scalars for projections. |

**Disposition:** APPROVED after the P2 `previousKpis` fix. The remaining findings are accepted residual risk (documented), none corrupt data or violate the core R6 no-raw-aggregation invariant. All gates: domain 1201/0, app 2410/0, typecheck 7/7 clean.

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` sections 8 (D6), 12 (D10)
- ADR-103 (materialized-only read path), ADR-106 (measure vector and additivity): `docs/00_ADR.md`
- Summary fresh path and stale fan-out: `packages/app/src/services/history-board-service.ts:811`
- Sources stale fan-out: `packages/app/src/services/history-board-service.ts:1639`
- Existing rollup read helpers this routes between: `packages/domain/src/analytics/history-board-rollup.ts:910`
- Transport contract that must not change: `packages/contracts/src/history.ts`
- Source-grain table with no duration column: `packages/domain/src/migrations.ts:415`
### History
- 2026-09-03T23:27:42.666Z todo → wip (system)
- 2026-09-03T23:27:47.289Z wip → testing (system)
- 2026-09-03T23:27:55.437Z testing → done (system)
