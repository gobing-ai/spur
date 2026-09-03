---
schema_version: 1
name: "Dimension marts and Summary read routing with bounded staleness fallback"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.162Z
updated_at: "2026-09-03T17:45:49.670Z"
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
- [ ] R1. `history_board_dimension_daily` and `history_board_kpi_window` exist, carrying the full nine-member measure vector for every dimension and bucket named in the design's placement table.
- [ ] R2. A measure not well defined at a given dimension is recorded as not applicable rather than as zero.
- [ ] R3. With fresh rollups, the four dimension time series, the KPI trend, and the previous-window KPIs are read from materialized objects for the materialized filter combinations, for ranges of seven days or more at daily bucket.
- [ ] R4. The number of aggregation queries issued per Summary request is lower than the current per-request fan-out.
- [ ] R5. Any combination outside the materialized cut line resolves from the five-minute rollup tables, never from `history_message` or `history_tool_call`.
- [ ] R6. With fresh rollups, no executed statement groups or aggregates over `history_message` or `history_tool_call`; point lookups by `record_hash` for drill-down remain permitted.
- [ ] R7. When rollups cannot be brought current, the response reports its freshness state through the existing response fields and the fallback is bounded rather than an unannounced full-corpus scan.
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
