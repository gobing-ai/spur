---
schema_version: 1
name: "Bound the whole-corpus rollup derivations: candidate-set design for loop findings and ranked steps, and a covering index for source summary"
status: backlog
template: standard
created_at: 2026-09-04T08:14:01.724Z
updated_at: "2026-09-04T16:29:24.942Z"
feature_id: E91
ac_altitude: task-local
---

## 0763. Bound the whole-corpus rollup derivations: candidate-set design for loop findings and ranked steps, and a covering index for source summary

### Background
Task 0741 made the rollup refresh incremental per bucket and measured the result. The per-bucket
derivations behave: at a constant 400-row delta across an 18x corpus (100,000 -> 1,810,110 messages)
they cost 144 ms -> 179 ms -> 324 ms, bounded by materialized bucket/day count rather than row count.

Four derivations do not, because none has a bounded-candidate path today:

| Derivation | 100k | 400k | 1.81M |
| --- | ---: | ---: | ---: |
| `loops()` `filtered_messages` CTE -> `history_board_loop_findings` | 155 ms | 669 ms | 3,547 ms |
| three `topStepsBy*` -> `history_board_ranked_steps` | 72 ms | 211 ms | 1,376 ms |
| `sourceSummary` `COUNT(DISTINCT m.source_file)` -> `history_board_source_stats` | 46 ms | 227 ms | 604 ms |
| `applyToolAliases` full-table `UPDATE history_tool_call` | 19 ms | 57 ms | 96 ms |

(Instrumented per-statement times; they sum above wall clock because batched statements are attributed
individually. Harness: full rebuild after clearing every board table, then one 400-row delta import and
an incremental refresh, timed through a proxy `DbAdapter`.)

At 1.81M messages the whole delta refresh is 4,794 ms against a 45,565 ms full rebuild - 10.5%, inside
0741 R8's stated worst-day bound of 15% but outside its typical-day bound of 5%. That headroom is
consumed by these four, and it shrinks as the corpus grows: they are the only part of the refresh that
scales with total corpus rather than with the delta.

The 0741 Design mandates the current shape for the global-ranked class - "No incremental path; recompute
in full whenever any bucket changed" - on the premise that these tables are "cheap because they are
already bounded". Measurement shows the *output* is bounded (a top-N list) but the *computation* is
O(corpus): each refresh rescans every message to find the candidates it will then rank down to N.

#### Premise verification (refine, 2026-09-04)

Five premises were checked against the current tree before freezing the design. Three of them
change what this task should build.

**1. `history_board_loop_findings` is not a top-N table, and is not global.** `loops()`
(`packages/domain/src/analytics/forensic-query.ts:835`) emits every
`(source, session_id, tool_name, args_digest)` group with `COUNT(*) >= 3`; its `ORDER BY repeats DESC`
carries no `LIMIT`, and the bound is applied by the read path instead
(`packages/domain/src/analytics/history-board-rollup.ts:937`). The 0741 Design's "bounded top-N sets"
premise holds for `ranked_steps` only. Because the grouping key contains `session_id`, loop findings
are a **keyed aggregate over sessions** - the same class as `history_board_session_stats`, not a global
ranking. No candidate-set table is needed: `deltaSessionScope`
(`packages/domain/src/analytics/history-board-rollup.ts:1808`) already resolves the touched-session set
from `idx_history_message_imported_at`, and already scopes `sessionStatsOps` the same way.

**2. The ranked-step queries have exactly matching indexes and deliberately defeat them.**
`drizzle/0020_spur_cli_history_board_query_indexes.sql` creates `idx_history_message_duration_rank`,
`idx_history_message_token_rank`, and `idx_history_message_input_rank` - all partial on
`role = 'assistant'`, all keyed on the exact ranking expression. `topStepsByTokens`,
`topStepsByDuration`, and `topCacheWasteSteps` prefix every ranking column with SQLite's unary `+`,
which strips the column reference and forbids index use. Measured plans on the same DDL
(SQLite 3.51.0):

| Ranking | Plan today (`+`) | Plan without `+` |
| --- | --- | --- |
| duration | `SCAN m USING INDEX idx_history_message_input_rank` + `USE TEMP B-TREE FOR ORDER BY` | `SEARCH m USING COVERING INDEX idx_history_message_duration_rank (duration_ms>?)` |
| tokens | `SCAN m USING INDEX idx_history_message_input_rank` + `USE TEMP B-TREE FOR ORDER BY` | `SCAN m USING INDEX idx_history_message_token_rank` (no sort) |
| cache-waste | `SCAN m USING INDEX idx_history_message_input_rank` + `USE TEMP B-TREE FOR ORDER BY` | `SEARCH m USING INDEX idx_history_message_input_rank (input_tokens>?)` |

A full corpus scan plus a full sort is exactly the 72 -> 211 -> 1,376 ms curve. Without the `+` the scan
is index-ordered, so `LIMIT 1000` stops after roughly 1,000 index entries. The `+` arrived in the commit
that introduced these functions (`9eedc29a4`), not later as a workaround, and it is defensible for a
*narrow* selector - with `since`/`until`/`sources` set, `(source, ts)` beats walking a whole rank index.
It is wrong for the rollup's unfiltered `ALL_HISTORY` call.

**3. `sourceSummary` cannot become an index search.** `GROUP BY m.source` with `COUNT(*)` must visit
every row in each group. A `(source, source_file, imported_at)` covering index turns today's
`SCAN m USING INDEX idx_history_message_source_ts` (index scan plus a table lookup per row) into
`SCAN m USING COVERING INDEX` - faster, still linear in corpus rows, still failing R5. The original R3
asked for something SQLite does not offer; the bounded path has to come from already-materialized
per-day rows plus an index-bounded distinct-file walk.

**4. `applyToolAliases` runs twice per full path and cannot use the delta index directly.** It is called
at the top of `replaceHistoryBoardRollups` (`history-board-rollup.ts:285`) and again at the top of
`refreshHistoryBoardRollupsIncremental` (`:1849`). `history_tool_call` carries
`idx_history_tool_call_source_imported ON (source, imported_at)` - leading column `source`, so a bare
`imported_at >= ?` predicate cannot use it and the scoped update must be driven per source. Nothing in
the product writes `history_tool_alias_map` at runtime: migration 0034 creates it empty and
`packages/domain/src/analytics/history-reset.ts` only truncates it.

**5. The refresh never deletes rows.** The single deletion path is `history-reset.ts`, which truncates
every rollup table alongside the raw tables. R2's "a combine-with-materialized derivation cannot see a
row that left the corpus" is therefore a stated precondition, not an implementation branch.

`sourceSummary` keeps three non-rollup callers on arbitrary selectors
(`packages/app/src/services/history-service.ts:646`, `history-board-service.ts:1750`,
`history-analysis-service.ts:78`), so it stays; only the rollup's use of it is replaced.
### Requirements
- [ ] R1. `history_board_loop_findings` is re-derived only for the sessions a delta touched — the derivation reads `history_tool_call` rows for those sessions and the `history_message` rows they hash to, and never scans messages outside that session set.
- [ ] R2. `history_board_ranked_steps` is derived by an index-ordered top-N read of `history_message` rather than a full-corpus scan-and-sort: `EXPLAIN QUERY PLAN` for each of the three rankings under an unfiltered selector shows the matching rank index and no `USE TEMP B-TREE FOR ORDER BY`.
- [ ] R3. Both bounded derivations produce the rows a full rebuild would produce. The three preconditions under which they cannot — a delta wider than `deltaSessionScope`'s limits, out-of-band row deletion, and an out-of-band edit to `history_tool_alias_map` — each fall back to the full path or are documented as an explicit staleness rule, and each has a test asserting the stated outcome.
- [ ] R4. `history_board_source_stats` is derived from already-materialized per-day rows plus an index-bounded distinct-file walk, not from a full-corpus `GROUP BY` over `history_message`; the distinct-file walk resolves through an index, proven by `EXPLAIN QUERY PLAN`.
- [ ] R5. `applyToolAliases` updates only rows in the delta's scope on an incremental refresh, and still re-aliases the whole table on the full-rebuild path so a changed alias map is never left half-applied.
- [ ] R6. The delta-refresh cost of these four derivations, measured at a constant delta across at least three corpus scales, grows sublinearly in total corpus row count — the property 0741 R8 asserts for the per-bucket derivations and 0741 R9 explicitly exempts these from.
- [ ] R7. The forensic read path is unchanged for filtered selectors: a query carrying any of `since`, `until`, `sources`, `models`, `sessionId`, `runId`, or `taskWbs` keeps the plan it has today, so narrow-window reads do not regress into a whole-rank-index walk.
- [ ] R8. `ROLLUP_DEFINITION_VERSION` is bumped and its digest re-pinned, because every change here is a derivation change; existing databases rebuild rather than extend.

**Out of scope.** Parallel bucket processing (0741 deferral, still deferred). Vacuuming space freed by
bucket deletes (task 0746). Changing what `history_board_source_stats.messages` counts — it stays the
raw, undeduped, unwatermarked import-coverage number it is today. Adding a runtime writer or a stored
digest for `history_tool_alias_map`. Changing `historyBoardRankedStepsFromRollup`'s existing behaviour
of slicing a filtered read out of a globally ranked top-N.
### Acceptance Criteria
```gherkin
Feature: Bounded whole-corpus rollup derivations

  @core
  Scenario: R1 — Loop findings are re-derived only for the sessions a delta touched
    Given a materialized history database whose rollups are current
    When a delta import touching a bounded set of sessions triggers an incremental refresh
    Then the loop-findings derivation reads only tool calls for those sessions and the messages they hash to
    And loop-finding rows for untouched sessions are left in place rather than deleted and recomputed.

  @core
  Scenario: R2 — Ranked steps resolve from the rank indexes without a sort
    Given an unfiltered selector over a corpus of assistant steps
    When `EXPLAIN QUERY PLAN` is run against each of the three ranked-step derivations
    Then each plan names its matching rank index
    And no plan contains `USE TEMP B-TREE FOR ORDER BY`.

  @core
  Scenario: R3 — The bounded derivations agree with the full rebuild
    Given a database refreshed incrementally through the bounded derivations
    When its loop-findings, ranked-steps and source-stats rows are diffed against a full rebuild of the same corpus
    Then the rows are identical, except for cases covered by a documented precondition
    And each precondition has a test that asserts the fallback or staleness outcome it states.

  @core
  Scenario: R4 — Source summary is derived from materialized rows and an index walk
    Given a corpus whose messages span many source files per source
    When the incremental refresh derives `history_board_source_stats`
    Then message counts and last-import times come from `history_board_source_daily`
    And the distinct-file count resolves through an index, shown by `EXPLAIN QUERY PLAN`
    And no statement in that derivation groups over the whole `history_message` table.

  @core
  Scenario: R5 — Alias backfill is scoped to the delta on an incremental refresh
    Given a materialized history database whose rollups are current
    When a delta import triggers an incremental refresh
    Then the alias update touches only tool-call rows in the delta's per-source imported-at range
    And a full rebuild still re-aliases every row.

  @core
  Scenario: R6 — Delta cost stays sublinear as the corpus grows
    Given three corpora at increasing scale built from the same real database
    When an identical delta is imported into each and the incremental refresh is timed
    Then the combined cost of the four derivations grows sublinearly in total corpus row count
    And the measurement is recorded against the 0741 R9 baseline it supersedes.

  @edge
  Scenario: R7 — Filtered forensic reads keep their current plan
    Given a selector carrying a time window or a source allowlist
    When the ranked-step queries run under that selector
    Then their query plans are unchanged from before this task
    And the rank indexes are not walked in place of the selective index.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-04T16:29:24.942Z

**Refine `--depth ready`, 2026-09-04.**

**Why no per-bucket candidate-contribution table?** The pre-refine design proposed materializing each
bucket's top-N and merging. Exactness requires per-partition K = `RANK_DEPTH` (1000), because the global
top-N can all fall in one partition. At 5-minute grain that is ~79,000 buckets x 1,000 rows — larger
than the corpus it was meant to bound. Day grain is 275 x 1,000 and still ~46% of the message count for
three rankings. Both are worse than the alternative, which is that the three rank indexes needed for an
exact index-ordered top-N already exist and are simply not being used (Background item 2). Dropping the
unary `+` is the whole fix, and it is exact by construction — no candidate set, no new table, no
staleness rule.

**Why is loop-findings not a merge problem at all?** Its grouping key contains `session_id`
(Background item 1), so it is a keyed aggregate, not a global ranking. It gets the same treatment
`history_board_session_stats` already gets: `deltaSessionScope` resolves the touched sessions, the
derivation deletes and re-derives only those, and `null` (delta too wide) falls back to a full recompute.
This reuses an existing helper and an existing fallback rather than inventing a second scoping mechanism.

**Why keep the `+` for filtered selectors?** With `since`/`until`/`sources` set, `(source, ts)` is the
selective index and walking a rank index end-to-end while filtering by `ts` would be a regression — which
is presumably why the `+` was written in the first place. The rollup always calls with `ALL_HISTORY`, so
the decision is made from the selector, not from a caller-passed flag: unfiltered drops the `+`, anything
filtered keeps it. R7 pins that no-regression property.

**Why not just add the `(source, source_file, imported_at)` covering index for source summary?** It
converts a scan-plus-lookup into a covering scan — a real constant-factor win but still O(corpus), which
fails R6's sublinearity assertion (Background item 3). The bounded path is: message counts and last-import
times summed from `history_board_source_daily` (already materialized, already delta-scoped, bounded by
sources x days), and the distinct-file count from a recursive-CTE loose index scan over a new
`(source, source_file)` index — O(distinct files x log n) seeks, and distinct files grows with imported
files, not with messages.

**Why add `raw_messages` / `last_imported_at` to `history_board_source_daily` rather than accumulate
counters on `history_board_source_stats`?** R7 of task 0741 deliberately reprocesses an interrupted
range on the next run, so any `counter += delta` scheme double-counts. A per-day column inside the
existing delete-and-re-derive-by-day pass is idempotent by construction. The two new columns are raw —
no dedup, no turn watermark — and are documented as such in the DDL, because they back the import-coverage
number, which is deliberately different from the deduped measures in the same row.

**Why not change what `history_board_source_stats.messages` counts?** It is the odd column out — every
other board number is deduped and watermarked — but it is the honest answer to "did my import land",
which is the panel it feeds. Aligning it would be a user-visible number change with no requirement behind
it. Left alone; noted as out of scope.

**Deferred — a stored digest for `history_tool_alias_map`.** Scoping the alias update to the delta means
an out-of-band edit to the map does not re-alias older rows. Today no runtime writer exists: migration
0034 creates the table empty and `history-reset.ts` only truncates it, and a map change shipped through a
migration trips the pinned-derivation-digest test and forces a `ROLLUP_DEFINITION_VERSION` bump, which
rebuilds. The documented rule is therefore "editing the alias map out of band requires a full rebuild".
Condition to revisit: the first runtime writer of `history_tool_alias_map`.

**Deferred — deriving `files` from `history_import_checkpoint`.** It is keyed `(source, source_file)` and
would make the distinct-file count a `COUNT(*)` over a tiny table. Rejected for now because checkpoint
rows and files-that-produced-messages are not the same set (a file can check point with zero surviving
message rows), and no evidence was gathered on the divergence. Condition to revisit: a measurement
showing the two counts agree on the real corpus.

**Deferred (from 0741, still deferred):** parallel bucket processing; vacuuming freed space (task 0746).
### Design
**WHAT.** Give each of the four unbounded derivations a scope that is bounded by the delta or by an
index, without adding a candidate-set table: loop findings become session-scoped, ranked steps become
index-ordered, source stats are summed from already-materialized per-day rows plus an index walk, and the
alias backfill is scoped per source to the delta's imported-at range.

**WHY.** 0741 classified `loop_findings` and `ranked_steps` together as "global ranked ... cheap because
they are already bounded". Measurement disproved the cheapness, and premise verification (Background)
disproved the classification: they are two different problems. `loop_findings` is a keyed aggregate over
sessions and needs the scoping mechanism that already exists; `ranked_steps` is a genuine global top-N
whose exact bounded path is the three rank indexes that already exist and are being defeated by a unary
`+`. Neither needs new machinery, which is why this task adds one index and two columns rather than a
candidate-contribution table.

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `0039_spur_cli_bounded_rollup_derivations` | migration | `drizzle/0039_spur_cli_bounded_rollup_derivations.sql` + `BOUNDED_ROLLUP_DERIVATIONS_SCHEMA_SQL` in `packages/domain/src/migrations.ts` |
| `idx_history_message_source_file` | index on `history_message (source, source_file)` | same migration |
| `history_board_source_daily.raw_messages` | column `INTEGER NOT NULL DEFAULT 0` | same migration |
| `history_board_source_daily.last_imported_at` | column `TEXT` | same migration |
| `LoopQueryOptions` | `interface LoopQueryOptions extends WatermarkQueryOptions { sessionScope?: readonly string[] }` | `packages/domain/src/analytics/forensic-query.ts` |
| `loops(db, sel, opts?: LoopQueryOptions)` | existing function, third parameter widened | `packages/domain/src/analytics/forensic-query.ts:835` |
| `selectorIsUnfiltered(sel)` | module-private predicate | `packages/domain/src/analytics/forensic-query.ts` |
| `rankOrderExpr(sel, expr)` | module-private helper returning `expr` when unfiltered, `` `+${expr}` `` otherwise | `packages/domain/src/analytics/forensic-query.ts` |
| `distinctSourceFileCounts(db)` | exported function returning `Map<string, number>` | `packages/domain/src/analytics/forensic-query.ts` |
| `applyToolAliases(db, scope?: ToolAliasScope)` | existing function, optional second parameter | `packages/domain/src/analytics/tool-alias.ts:39` |
| `ToolAliasScope` | `interface ToolAliasScope { sources: readonly string[]; since: string }` | `packages/domain/src/analytics/tool-alias.ts` |
| `ROLLUP_DEFINITION_VERSION` | bumped `'v2'` -> `'v3'` | `packages/domain/src/analytics/rollup-watermark.ts:22` |

No other public API changes. `sourceSummary`, `historyBoardLoopsFromRollup`,
`historyBoardRankedStepsFromRollup`, `replaceHistoryBoardRollups`, and
`refreshHistoryBoardRollupsIncremental` all keep their names and signatures.

**Algorithm and precedence.**

1. **Ranked steps (R2, R7).** In `topStepsByTokens`, `topStepsByDuration`, and `topCacheWasteSteps`,
   route every `+`-prefixed ranking expression — both the `ORDER BY` key and the `IS NOT NULL` /
   comparison predicates that reference the ranked column — through `rankOrderExpr(sel, …)`.
   `selectorIsUnfiltered` returns true only when `since`, `until`, `sources`, `models`, `sessionId`,
   `runId`, and `taskWbs` are all null/undefined; `tools` and `skills` do not constrain
   `history_message` and are ignored. Unfiltered drops the `+` and the existing partial indexes serve the
   `ORDER BY … DESC LIMIT` in index order; filtered keeps today's plan verbatim. This is the entire
   ranked-steps change — `recomputeGlobalRanked` keeps calling the same three functions with
   `ALL_HISTORY`.
2. **Loop findings (R1, R3).** Add `sessionScope` to `loops`. When present, the query is driven from
   `history_tool_call` (`idx_history_tool_call_session_id_seq`, `session_id IN (…)`) and joins
   `history_message` by `record_hash`, which is that table's `PRIMARY KEY` — a seek per tool call. When
   absent, the query keeps its current message-first `CROSS JOIN` shape. Split `recomputeGlobalRanked`
   into `recomputeRankedSteps(db)` (unchanged full-table replace of `history_board_ranked_steps`; the
   three reads are now index-ordered) and `recomputeLoopFindings(db, sessionScope)`, which with a scope
   deletes only `WHERE session_id IN (…)` and re-inserts those sessions, and with `null` keeps the
   existing whole-table delete-and-reinsert. `refreshHistoryBoardRollupsIncremental` already computes
   `deltaSessionScope(db, messageWm.importedAtWatermark)` for `recomputeKeyedAggregates`; hoist that call
   and pass the same value to `recomputeLoopFindings`, so one scope resolution serves both and the two can
   never disagree.
3. **Source stats (R4).** In `recomputeDailyAndSourceDaily`, extend the `history_board_source_daily`
   insert with a third CTE reading `history_message` directly, filtered to the affected days as an `OR`
   of half-open `ts` ranges (`ts >= ? AND ts < ?`) plus `ts IS NULL` for the sentinel day `''` — every
   term index-served by `idx_history_message_ts`. It supplies `raw_messages` (`COUNT(*)`) and
   `last_imported_at` (`MAX(imported_at)`) per `(source, day)`. Then in `recomputeKeyedAggregates`,
   replace `sourceSummary(db, ALL_HISTORY)` with: `SUM(raw_messages)` and `MAX(last_imported_at)` grouped
   by source over `history_board_source_daily`, plus `distinctSourceFileCounts(db)` for `files`. That
   helper is a recursive CTE emulating a loose index scan over `idx_history_message_source_file` —
   seed with `SELECT MIN(source), MIN(source_file)`, step with
   `SELECT MIN(source_file) … WHERE source = ? AND source_file > ?` — so its cost is one seek per distinct
   `(source, source_file)` pair. The subsequent enrich `UPDATE` over `history_board_source_stats` is
   unchanged.
4. **Alias backfill (R5).** `applyToolAliases(db)` with no scope keeps today's guarded full-table
   `UPDATE` and stays the call at the top of `replaceHistoryBoardRollups`. `refreshHistoryBoardRollupsIncremental`
   passes `{ sources, since }`, where `since` is the message-table watermark it already reads and
   `sources` is `SELECT source FROM history_board_source_stats` (a handful of rows). The scoped form
   issues one `UPDATE … WHERE source = ? AND imported_at >= ?` per source, which
   `idx_history_tool_call_source_imported` serves as a range seek — a bare `imported_at >= ?` cannot use
   that index, so the per-source loop is the point, not an accident. The existing guard
   (`WHERE tool_name_alias IS NOT COALESCE(…)`) stays in both forms.
5. **Version bump (R8).** Every step above changes emitted SQL. Bump `ROLLUP_DEFINITION_VERSION` to
   `'v3'` and add the reported digest under a new `v3` key in `PINNED_DERIVATION_DIGEST`
   (`packages/domain/tests/analytics/rollup-definition-version.test.ts:28`), keeping the `v2` entry.
   Because the version differs, existing databases take `rebuildAllRollups`, which is what makes the two
   new `history_board_source_daily` columns populate for already-materialized days.

**Documented preconditions (R3).** Each falls back to the full path or is a stated rule:

| Precondition | Behaviour | Test |
| --- | --- | --- |
| Delta wider than `DELTA_ROW_SCAN_LIMIT` / `SESSION_SCOPE_LIMIT` | `deltaSessionScope` returns `null`; loop findings recompute in full, exactly as session stats already do | assert a wide delta produces full-rebuild-identical loop rows |
| Rows deleted out of band | Not produced by any refresh path; `history-reset.ts` is the only deleter and it truncates the rollups too | assert reset leaves no orphan rollup rows |
| `history_tool_alias_map` edited out of band | Stated rule: a full rebuild is required; a map change shipped by migration trips the pinned digest and forces the bump | assert scoped alias update leaves pre-delta rows untouched, and that the unscoped call re-aliases them |

**Anti-patterns — do not do these.**

- Do not add a candidate-contribution table, a per-bucket top-N, or a merge-with-materialized step. The
  rank indexes make the top-N exact without one (Q&A), and loop findings are not a ranking.
- Do not delete the `+` unconditionally. Filtered forensic selectors depend on it; R7 is the guard.
- Do not scope the alias `UPDATE` with a bare `imported_at >= ?`. The index is `(source, imported_at)`.
- Do not accumulate `raw_messages` as `previous + delta`. An interrupted refresh reprocesses its range
  (0741 R7) and would double-count; the per-day column must be delete-and-re-derive.
- Do not change what `history_board_source_stats.messages` counts, and do not source it from the deduped
  `history_board_source_daily` token/session columns. `raw_messages` is a separate, deliberately raw column.
- Do not re-point `sourceSummary` itself. Three forensic callers pass arbitrary selectors and need it as
  it is; only the rollup's call site is replaced.
- Do not derive `files` from `history_import_checkpoint` without first measuring the divergence (Q&A).

**Primary file targets.**

- `packages/domain/src/analytics/forensic-query.ts` — `rankOrderExpr`, `selectorIsUnfiltered`,
  `LoopQueryOptions`, `distinctSourceFileCounts`, the three ranking queries, `loops`.
- `packages/domain/src/analytics/history-board-rollup.ts` — `recomputeGlobalRanked` split,
  `recomputeDailyAndSourceDaily`, `recomputeKeyedAggregates`, `refreshHistoryBoardRollupsIncremental`.
- `packages/domain/src/analytics/tool-alias.ts` — `ToolAliasScope`, scoped `applyToolAliases`.
- `packages/domain/src/analytics/rollup-watermark.ts` — version bump.
- `packages/domain/src/migrations.ts` + `drizzle/0039_spur_cli_bounded_rollup_derivations.sql`.
- `packages/domain/tests/analytics/rollup-definition-version.test.ts` — new `v3` digest key.

**Cross-task.** Assumes from 0741: the watermark, the per-bucket transaction, `deltaSessionScope`,
`postPassLags`, and the R7 reprocess-on-interrupt rule — none of which this task re-owns or changes.
Leaves for 0746: database size and vacuuming. Supersedes 0741 R9's budget with the R6 measurement;
0741's Design table entry for the "global ranked" class is corrected by this task and should be read
alongside it rather than as current.
### Plan
<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

1. **Migration 0039** (R4, R8 prerequisite). Add `drizzle/0039_spur_cli_bounded_rollup_derivations.sql`
   and `BOUNDED_ROLLUP_DERIVATIONS_SCHEMA_SQL` in `packages/domain/src/migrations.ts`:
   `idx_history_message_source_file ON history_message (source, source_file)`, plus
   `history_board_source_daily.raw_messages INTEGER NOT NULL DEFAULT 0` and
   `.last_imported_at TEXT`, each with a comment stating the columns are raw (no dedup, no turn
   watermark) because they back import coverage. Verify the migration applies to an existing database
   and to a fresh one.
2. **Ranked steps** (R2, R7). Add `selectorIsUnfiltered` and `rankOrderExpr` to `forensic-query.ts` and
   route the `+` prefixes in `topStepsByTokens`, `topStepsByDuration`, `topCacheWasteSteps` through it.
   Test: `EXPLAIN QUERY PLAN` for each ranking under `ALL_HISTORY` names the matching rank index and
   contains no `USE TEMP B-TREE FOR ORDER BY`; under a `since`+`sources` selector the plan is unchanged
   from the pre-change baseline.
3. **Loop findings** (R1, R3). Add `LoopQueryOptions.sessionScope` and the tool-call-first query shape to
   `loops`. Split `recomputeGlobalRanked` into `recomputeRankedSteps` and
   `recomputeLoopFindings(db, sessionScope)`; hoist the existing `deltaSessionScope` call in
   `refreshHistoryBoardRollupsIncremental` so one value feeds both it and `recomputeKeyedAggregates`.
   Tests: scoped refresh leaves untouched sessions' rows byte-identical and matches a full rebuild;
   a delta exceeding the scope limits falls back to the full recompute and still matches.
4. **Source stats** (R4). Extend the `history_board_source_daily` insert in
   `recomputeDailyAndSourceDaily` with the raw per-day CTE (day `ts` ranges `OR ts IS NULL`). Add
   `distinctSourceFileCounts`. Replace the `sourceSummary(db, ALL_HISTORY)` call in
   `recomputeKeyedAggregates` with the summed per-day rows plus that helper; leave the enrich `UPDATE`
   alone. Tests: source-stats rows match a full rebuild including the NULL-`ts` sentinel day;
   `EXPLAIN QUERY PLAN` for the distinct-file walk shows the new index; no statement in the derivation
   groups over the whole `history_message` table.
5. **Alias backfill** (R5). Add `ToolAliasScope` and the optional second parameter to
   `applyToolAliases`; pass `{ sources, since }` from `refreshHistoryBoardRollupsIncremental` only.
   Tests: with a scope, a pre-delta row keeps its stale alias; without one (full rebuild), it is
   re-aliased.
6. **Version bump** (R8). Set `ROLLUP_DEFINITION_VERSION = 'v3'`, run
   `packages/domain/tests/analytics/rollup-definition-version.test.ts`, add the reported digest under a
   new `v3` key, keep `v2`. Confirm an existing v2 database takes `rebuildAllRollups` and populates the
   two new columns.
7. **Measurement** (R6). Re-run the 0741 harness — full rebuild after clearing every board table, then
   one 400-row delta import and an incremental refresh, timed through a proxy `DbAdapter` — at 100k,
   400k, and 1.81M messages. Record the four derivations' per-statement times and the whole-delta vs
   full-rebuild ratio in `## Testing`, alongside the 0741 R9 baseline they supersede. Publish the
   comparison in a report under `docs/report/` following the existing E91 latency report.
8. **Gates.** `bun run spur-check`, `bun run test`, `bun run build`. Update `docs/04_DESIGN.md` history
   surfaces if the rollup derivation contract is described there, and note in `docs/00_ADR.md` only if
   the class taxonomy from 0741 is recorded as a decision.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature `E91` — History read path materialized-only.
- Task `0741` — incremental rollup refresh engine; R8/R9 record the measurement this task acts on, and its Design's "global ranked" class entry is corrected here.
- Task `0746` — database size and vacuuming (out of scope here).
- `packages/domain/src/analytics/history-board-rollup.ts` — `recomputeGlobalRanked`, `recomputeKeyedAggregates`, `recomputeDailyAndSourceDaily`, `deltaSessionScope`, `refreshHistoryBoardRollupsIncremental`.
- `packages/domain/src/analytics/forensic-query.ts` — `loops` (:835), `sourceSummary` (:946), `topStepsByTokens` (:1049), `topStepsByDuration` (:1072), `topCacheWasteSteps` (:1123).
- `packages/domain/src/analytics/tool-alias.ts` — `applyToolAliases` (:39) and the alias-resolution seam.
- `packages/domain/src/analytics/rollup-watermark.ts` — `ROLLUP_DEFINITION_VERSION` and the three table classes.
- `packages/domain/src/analytics/history-reset.ts` — the only path that deletes history rows.
- `drizzle/0020_spur_cli_history_board_query_indexes.sql` — the three rank indexes this task starts using.
- `drizzle/0030_spur_cli_history_board_covering_indexes.sql` — `idx_history_tool_call_source_imported (source, imported_at)`.
- `packages/domain/tests/analytics/rollup-definition-version.test.ts` — the digest pin that a derivation change trips.
- `docs/report/2026-09-03-E91-history-tab-latency-baseline.md` — corpus and refresh-cost context.
### History
