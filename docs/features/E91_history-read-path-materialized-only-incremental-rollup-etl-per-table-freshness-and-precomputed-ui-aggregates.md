---
schema_version: 1
id: "E91"
name: "History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates"
status: active
priority: P2
tags: []
created_at: "2026-09-03T07:00:35.499Z"
updated_at: "2026-09-04T08:13:40.853Z"
---

# E91: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

## Goal

Make the History module's read path serve every aggregate from materialized rollup objects rather
than re-aggregating raw tables per request, and make the rollup ETL cost proportional to newly
imported data instead of to total corpus size.

Today the rollup layer is inert: `refreshHistoryRollups` aborts on a table that no migration
creates, so every tab silently falls back to full-corpus scans measured at 2.3–4.2 s per analyzer
against a 4.2 GB / 1.79 M-message database. Even when the rebuild succeeds, the freshness key is
derived from the global import checkpoint, so any single newly imported line invalidates all twelve
rollup tables at once and forces a 44 s all-corpus rebuild before fast reads resume.

The feature restores that layer, converts it from full-rebuild to watermark-bounded incremental
refresh, re-keys freshness so an import invalidates only the buckets it touched, and materializes
the aggregates the History UI actually requests so they become lookups instead of computations.
The observable outcome is interactive History latency that stays flat as the corpus grows, with
the existing UI and its transport contracts byte-identical throughout.

## Scope

### In scope

- Restore the broken rollup refresh path: resolve the `history_skill_call` reference in
  `packages/domain/src/analytics/history-board-rollup.ts` so `refreshHistoryRollups` completes, and
  add a gate that prevents a rollup source table from being referenced without DDL.
- Convert `replaceHistoryBoardRollups` from delete-all-and-rebuild to watermark-bounded incremental
  upsert for the time-bucketed rollup tables, wiring the already-present `watermark.ts` /
  `WatermarkQueryOptions` seam into `refreshHistoryRollups`.
- Define and implement the late-arrival rule for `MESSAGE_DEDUP` so incremental aggregates remain
  identical to a full rebuild when a duplicate lands after its bucket was materialized.
- Re-key rollup freshness from the global import-checkpoint hash to per-table (or bounded-staleness)
  watermarks so an import degrades only the affected buckets, not the whole board.
- Materialize the aggregates the Summary tab always requests — the four dimension time series
  (model/source/tool/skill), the KPI trend, and previous-window KPIs — at their natural grains, with
  an explicit cut line between materialized combinations and 5-minute-table fallback.
- Persist an `effective_tool_name` column on `history_tool_call` at import time, index it, and route
  both the Summary top-tools path and the tool-sequence path at it so tool identity is consistent
  and indexable.
- Push the raw-path `getSessions` sort and pagination from JavaScript into SQL.
- Drizzle migrations for all new columns, tables, and indexes, plus the corresponding
  `packages/domain/src/migrations.ts` entries.
- A rollup-versus-raw equivalence test proving materialized answers equal full-rebuild answers over a
  fixed filter matrix, and latency evidence for the affected tabs.
- Retention or compaction for `history_import_ledger`, which is roughly 20 percent of database size
  and is read by no board query.

### Out of scope

- Any change under `apps/web/src/modules/history/`. The UI is verified and must show a zero diff.
- Any change to endpoint or DTO shapes in `packages/contracts/src/history.ts`.
- Migrating History analytics to a columnar or separate analytics store. Recorded as the escape
  hatch for a future corpus scale, not built here.
- Eliminating raw-table access for non-aggregate point lookups. Drill-down detail reads by
  `record_hash` stay on raw tables and are correct as-is; the constraint is no aggregation over raw
  tables on the read path.
- New public `spur` nouns or verbs. Existing history verbs keep their current surface.
- Import parsing and source-adapter behavior, except for the single derived `effective_tool_name`
  column written at import time.
- Retroactive backfill policy for historical corpora beyond what the equivalence test requires.

## Acceptance Criteria

```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R1 — Rollup refresh completes against the locked importer schema
    Given a workspace resolved to the importer version pinned in the lockfile
    And a history import has applied the importer schema to the database
    When refreshHistoryRollups runs to completion through the source-local CLI
    Then it exits without a "no such table" error
    And history_board_rollup_meta records a new history version
    And history_board_skill_5m contains a non-zero row count for a corpus that has skill calls.

  @core
  Scenario: R2 — Every rollup source table is asserted against the importer-applied schema
    Given the set of table names read by the rollup refresh path
    When the schema guard runs as part of the test suite
    Then every referenced source table exists in the schema produced by applying both the Spur migrations and the importer schema
    And the guard fails naming the offending table when a referenced table is absent from that combined schema.

  @core
  Scenario: R3 — Rollup refresh cost scales with newly imported rows, not total corpus
    Given a materialized history database whose rollups are current
    When a single new day of conversation data is imported and the rollup refresh runs
    Then the refresh reads only rows at or after the persisted watermark
    And the refresh wall time is recorded against the full-rebuild time for the same corpus, with the target ratio stated in the task before implementation
    And the measured delta-refresh time for the per-bucket derivations does not grow with total corpus row count while the delta is held constant
    And the derivations that recompute beyond the changed buckets stay inside their stated budget for the whole delta refresh against full rebuild.

  @core
  Scenario: R4 — Incremental rollups are byte-identical to a full rebuild
    Given a corpus imported in two increments
    When rollups are built incrementally across both increments and separately rebuilt in full from scratch
    Then every integer measure in every history_board_* table is exactly equal between the two builds for a fixed filter matrix
    And every allocated real-valued measure agrees within a declared tolerance that the test states explicitly
    And every dimension key present in one build is present in the other
    And the equivalence assertion runs as an automated test, not a manual comparison.

  @core
  Scenario: R5 — A duplicate arriving after its bucket was materialized does not corrupt that bucket
    Given a message bucket already materialized incrementally
    When a later import introduces a row that the global MESSAGE_DEDUP rule excludes from that bucket
    Then the affected bucket is recomputed under the documented late-arrival rule
    And the resulting aggregate equals the full-rebuild aggregate for that bucket.

  @core
  Scenario: R6 — A new import no longer invalidates every rollup table at once
    Given a fresh set of rollup tables and a new import touching a bounded time range
    When rollup freshness is evaluated after that import
    Then only the buckets covered by the imported range are reported stale
    And board reads outside that range continue to resolve from materialized objects
    And no read path falls back to a full-corpus aggregation because of the import.

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

  @core
  Scenario: R9 — Tool identity is persisted once at import and used consistently
    Given tool calls whose effective name is currently derived by a CASE expression at query time
    When the corpus is imported
    Then history_tool_call carries a persisted effective_tool_name column with a supporting index
    And the summary top-tools path and the tool-sequence path both filter on that column
    And a tool selected from the Summary list returns matching rows in the tool-sequence view.

  @core
  Scenario: R10 — Session listing is sorted and paginated in SQL on both read paths
    Given a session listing request with a sort order and a page offset
    When the request is served from either the materialized path or the fallback path
    Then ordering and pagination are performed by the database
    And no path materializes the full session set in application memory before slicing.

  @core
  Scenario: R11 — The History UI and its transport contracts are unchanged
    Given the feature branch at completion
    When the diff against the base branch is inspected
    Then apps/web/src/modules/history/ has no changed lines
    And packages/contracts/src/history.ts has no changed lines
    And every History endpoint returns the same response shape it returned before the change.

  @core
  Scenario: R12 — Affected tabs show recorded latency improvement against a measured baseline
    Given a recorded pre-change latency baseline for Summary, Sessions, Insights, Sources, and Tool Using at current corpus scale
    When the same measurements are repeated after the change with fresh rollups
    Then each tab's measured latency is recorded alongside its baseline
    And each measurement is the median of a stated number of runs rather than a single sample
    And no tab regresses against its baseline beyond a declared noise tolerance.

  @core
  Scenario: R13 — Schema changes ship as ordered migrations
    Given new columns, tables, and indexes introduced by this feature
    When the migration set is applied to a database at the previous schema version
    Then each change is delivered by a drizzle migration using the next four-digit prefix
    And a corresponding entry exists in the domain migration registry
    And applying the set to an existing populated database succeeds without data loss.

  @edge
  Scenario: R14 — Rollup staleness degrades predictably rather than silently
    Given rollups that cannot be brought current
    When a board read is served
    Then the response reports its freshness state through the existing response fields
    And the fallback is bounded rather than an unannounced full-corpus scan.

  @edge
  Scenario: R15 — Import ledger retention reduces database size without affecting board reads
    Given an import ledger occupying a substantial share of database size
    When the retention or compaction policy is applied
    Then database size is measurably reduced
    And every History board query returns results identical to those before the reduction.

  @edge
  Scenario: R16 — Interrupted incremental refresh leaves rollups readable and recoverable
    Given an incremental refresh interrupted partway through
    When the next refresh runs
    Then the persisted watermark causes the interrupted range to be reprocessed
    And no rollup table is left holding a partially written bucket that a read path would serve as complete.


  @core
  Scenario: R17 — Installed workspace dependencies match the lockfile at check time
    Given a lockfile pinning the @gobing-ai/ts-* package versions
    When the dependency drift guard runs as part of the project check
    Then every installed @gobing-ai/ts-* version equals its locked version
    And the guard fails naming each package whose installed version differs.

  @core
  Scenario: R18 — Rollup refresh refuses to run against a schema it cannot vouch for
    Given the schema version guard delivered by the DDL ownership feature
    When a rollup refresh is requested against a database whose recorded importer schema version does not match the installed package
    Then the refresh aborts before writing any rollup row
    And the abort message names the recorded version, the installed version, and the remediation
    And previously materialized rollups are left readable and unmodified.

  @core
  Scenario: R19 — Tool names carry a cross-agent alias that defaults to identity
    Given the same logical tool recorded under different names by different coding agents
    When the corpus is imported
    Then history_tool_call carries a tool_name_alias column whose value defaults to that row's effective_tool_name
    And alias resolution goes through a single mapping seam that falls through to identity when no mapping entry exists
    And a backfill migration populates tool_name_alias for every pre-existing row
    And with an empty mapping table every tool breakdown is identical to the breakdown produced before the column existed.

  @edge
  Scenario: R20 — Adding a tool alias mapping regroups breakdowns without changing facts
    Given a mapping entry that maps several agent-specific tool names onto one alias
    When the mapping is applied and rollups are refreshed
    Then breakdowns grouped by alias report those names as a single row
    And effective_tool_name is unchanged for every affected row
    And breakdowns grouped by effective_tool_name are unchanged.

  @core
  Scenario: R21 — Aggregate tables carry one uniform additive measure vector
    Given the dimension-grain aggregate tables named in the design's placement table
    When their schema is inspected
    Then each carries messages, tool_calls, skill_calls, fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, duration_ms, and duration_samples
    And every member of the vector is a count or a sum
    And the same measure name means the same thing on every table that carries it
    And a measure that is not well defined at a given dimension is recorded as not applicable rather than as zero.

  @core
  Scenario: R22 — No rate, ratio, or mean is materialized
    Given derived variables such as cache hit rate, gain rate, and mean duration
    When the aggregate schemas are inspected
    Then no column stores a rate, ratio, percentage, or mean
    And every sum that supports a mean is accompanied by its sample count
    And each derived variable is computed from the measure vector at read time.

  @core
  Scenario: R23 — Cache write tokens are measured separately from cache reads
    Given messages carrying both cache_read_tokens and cache_write_tokens
    When aggregates are materialized
    Then cache_write_tokens is stored as its own measure, never summed into cache_read_tokens
    And cache hit rate is computed as cache_read over the sum of fresh, cache_read, and cache_write
    And no History response shape changes as a result.

  @core
  Scenario: R24 — Allocated token measures are named distinctly from measured ones
    Given tool-grain and skill-grain tables that attribute message tokens across calls
    When their token columns are inspected
    Then every attributed measure carries a name distinct from its measured counterpart
    And no query sums an attributed measure together with a measured one.

  @edge
  Scenario: R25 — Aggregates that are not KPI surfaces do not carry the vector
    Given per-row ranking tables, findings tables, and rollup metadata
    When the measure vector is applied across the schema
    Then those tables are unchanged
    And top-N breakdown tables carry only the measures well defined at their grain.

  @core
  Scenario: R26 — A bucket being rebuilt is never observable in a partial state
    Given a materialized bucket that an incremental refresh must delete and re-derive
    When a board read executes concurrently with that refresh
    Then the read observes either the previous bucket contents or the rebuilt contents, never an absent or partially written bucket
    And a bucket's delete and re-derive are committed as one unit
    And a concurrent read is never served an aggregate that omits a bucket the watermark reports as materialized.

  @core
  Scenario: R27 — Changing how a rollup is derived invalidates what was already materialized
    Given materialized rollups produced by a prior definition of the derivation logic, bucket boundaries, or measure vector
    When the derivation is changed and the refresh runs
    Then the stored definition version no longer matches the current one
    And every affected rollup table is rebuilt rather than extended from the existing watermark
    And a definition change that is not accompanied by a version change fails a test.
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0738 | History schema trust gate: dependency drift, source-table assertion, and version-mismatch abort | done |
| 0739 | Persist tool identity at import: effective_tool_name, tool_name_alias, and the alias resolution seam | done |
| 0740 | Complete the measure vector on existing rollup tables and enforce the additivity invariant | done |
| 0741 | Incremental rollup refresh engine: watermark, per-table freshness, transactional bucket rebuild, and definition versioning | done |
| 0742 | Assert incremental rollups equal a full rebuild | done |
| 0743 | Dimension marts and Summary read routing with bounded staleness fallback | done |
| 0744 | Sort and paginate session listing in SQL on both read paths | done |
| 0745 | Verify the History surface is unchanged and record the latency result | done |
| 0746 | Import ledger retention to reduce database size without affecting board reads | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-04T00:12:39.410Z backlog → active (system)
- 2026-09-04T00:12:39.658Z active → verifying (system)
- 2026-09-04T03:34:17.331Z done → active (system)
