---
schema_version: 1
name: "Bound the whole-corpus rollup derivations: candidate-set design for loop findings and ranked steps, and a covering index for source summary"
status: done
template: standard
created_at: 2026-09-04T08:14:01.724Z
updated_at: "2026-09-05T02:40:08.794Z"
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
- [x] R1. `history_board_loop_findings` is re-derived only for the sessions a delta touched — the derivation reads `history_tool_call` rows for those sessions and the `history_message` rows they hash to, and never scans messages outside that session set.
- [x] R2. `history_board_ranked_steps` is derived by an index-ordered top-N read of `history_message` rather than a full-corpus scan-and-sort: `EXPLAIN QUERY PLAN` for each of the three rankings under an unfiltered selector shows the matching rank index and no `USE TEMP B-TREE FOR ORDER BY`.
- [x] R3. Both bounded derivations produce the rows a full rebuild would produce. The three preconditions under which they cannot — a delta wider than `deltaSessionScope`'s limits, out-of-band row deletion, and an out-of-band edit to `history_tool_alias_map` — each fall back to the full path or are documented as an explicit staleness rule, and each has a test asserting the stated outcome.
- [x] R4. `history_board_source_stats` is derived from already-materialized per-day rows plus an index-bounded distinct-file walk, not from a full-corpus `GROUP BY` over `history_message`; the distinct-file walk resolves through an index, proven by `EXPLAIN QUERY PLAN`.
- [x] R5. `applyToolAliases` updates only rows in the delta's scope on an incremental refresh, and still re-aliases the whole table on the full-rebuild path so a changed alias map is never left half-applied.
- [x] R6. The delta-refresh cost of these four derivations, measured at a constant delta across at least three corpus scales, grows sublinearly in total corpus row count — the property 0741 R8 asserts for the per-bucket derivations and 0741 R9 explicitly exempts these from.
- [x] R7. The forensic read path is unchanged for filtered selectors: a query carrying any of `since`, `until`, `sources`, `models`, `sessionId`, `runId`, or `taskWbs` keeps the plan it has today, so narrow-window reads do not regress into a whole-rank-index walk.
- [x] R8. `ROLLUP_DEFINITION_VERSION` is bumped and its digest re-pinned, because every change here is a derivation change; existing databases rebuild rather than extend.

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
**WHAT.** Bound the four expensive rollup derivations with existing scopes and indexes: loop findings
reuse the delta session set, ranked steps use the existing rank indexes for unfiltered reads, source
coverage comes from materialized raw day rows plus a loose index walk, and alias backfill is scoped by
source and import watermark. No candidate table or merge engine is introduced.

**Frozen surfaces.**

| Name | Contract |
| --- | --- |
| `0039_spur_cli_bounded_rollup_derivations` | Adds `idx_history_message_source_file` plus `history_board_source_daily.raw_messages` and `.last_imported_at`. |
| `LoopQueryOptions.sessionScope` | Optional `readonly string[] \| null`; `[]` is a no-op and `null`/absent is full corpus. |
| `selectorIsUnfiltered` / `rankOrderExpr` | Drop unary `+` only for selectors that do not constrain `history_message`; filtered reads retain the prior plan. |
| `distinctSourceFileCounts` | Walks the true lexicographic next `(source, source_file)` key through the covering index. |
| `ToolAliasScope` | Carries `sources` and inclusive `since`; unscoped `applyToolAliases` remains the full-rebuild path. |
| `ROLLUP_DEFINITION_VERSION` | `v4`; the digest pin retains `v2` and `v3`. |

**Algorithm and precedence.**

1. The three global top-N queries use their rank indexes only for `ALL_HISTORY`; any source, model,
   time, session, run, or task filter preserves the unary-plus plan.
2. Loop findings delete and re-derive only the touched sessions. An explicit empty scope returns no
   rows and performs no delete; a wide delta resolves to `null` and uses the full fallback.
3. Source-day derivation is driven by raw `(source, day)` rows and left-joins analyzed measures, so a
   day removed by request-id dedup still contributes raw message/import coverage. Source totals sum
   those materialized rows; file counts use a true lex-first anchor and two index seeks per recursive
   step (next file in the same source, otherwise first file in the next source).
4. Incremental alias scope is the union of already-materialized sources and sources first seen in the
   current message delta. Each source gets an indexed `(source, imported_at)` range update; a full
   rebuild keeps the unscoped guarded update.
5. The emitted SQL changes invalidate prior materializations through `v4` and its pinned digest.

**Preconditions and fallbacks.**

| Condition | Required behavior |
| --- | --- |
| Delta exceeds `DELTA_ROW_SCAN_LIMIT` / `SESSION_SCOPE_LIMIT` | Resolve the session scope to `null` and recompute loops/keyed aggregates in full. |
| Delta touches no sessions | Preserve all existing loop rows; do not expand an empty scope to a corpus scan. |
| Rows are deleted through history reset | Reset truncates source and rollup tables together; the next refresh rebuilds cleanly. |
| Alias map changes outside import | Requires the unscoped/full-rebuild path; scoped refresh intentionally leaves pre-delta rows untouched. |

No public CLI, DTO, or UI surface changes. Candidate-contribution tables, per-bucket top-N merging,
unconditional removal of unary `+`, and incremental `previous + delta` accumulation remain explicitly
out of scope: the existing scope/index/materialized-day seams are sufficient and preserve restart
correctness.

**Cross-task.** Reuses 0741's watermark, per-bucket transaction, touched-session scope, and interrupted
refresh replay rule. Task 0746 continues to own database size and vacuuming.
### Plan
1. Add migration 0039 with the `(source, source_file)` index and raw source-day coverage columns; mirror
   it in the bundled schema and test fresh/existing migration paths.
2. Route unfiltered ranked queries through the existing rank indexes while preserving every filtered
   query plan; assert the production queries with `EXPLAIN QUERY PLAN`.
3. Reuse the touched-session scope for loop findings, including explicit empty-scope no-op and
   wide-delta full fallback; compare incremental rows with a fresh rebuild.
4. Drive source-day rows from raw coverage, sum their materialized totals, and count distinct files with
   a lexicographic loose index walk; cover raw-only days and adversarial source/file ordering.
5. Scope incremental alias application to materialized plus first-seen delta sources; retain unscoped
   re-aliasing for full rebuilds.
6. Advance the rollup definition to `v4`, pin its derivation digest, and retain the `v2`/`v3` pins.
7. Measure one constant 400-row delta at 100k, 400k, and 1.81M-message scales and record provenance,
   method, statement timings, growth, and the 0741 comparison in the tracked E91 report.
8. Run targeted regressions and the repository lint/type/test/build/corpus gates; sync the affected
   history design/report surfaces and record a fresh task verdict and review.
### Solution
The bounded design remains deliberately small: reuse the touched-session scope for loops, let SQLite's
existing rank indexes serve unfiltered top-N reads, derive source coverage from materialized day rows
plus the existing loose index walk, and scope alias updates by source and watermark. No candidate table
or merge engine was added.

| Anchor | Change |
| --- | --- |
| `drizzle/0039_spur_cli_bounded_rollup_derivations.sql:10` | Adds `idx_history_message_source_file` and raw source-day coverage columns. |
| `packages/domain/src/migrations.ts:1028` | Mirrors migration 0039 in the bundled schema and preserves the legacy-stub skip guard. |
| `packages/domain/src/analytics/forensic-query.ts:847` | `LoopQueryOptions.sessionScope` carries the bounded session set; empty and wide scopes have explicit no-op/full behavior. |
| `packages/domain/src/analytics/forensic-query.ts:880` | Unfiltered ranks use their indexes; filtered plans keep the unary `+`. |
| `packages/domain/src/analytics/forensic-query.ts:1055` | The distinct-file walk starts at the true lex-first pair and seeks one distinct key at a time. |
| `packages/domain/src/analytics/history-board-rollup.ts:452` | Full source-day derivation is raw-driven, preserving coverage removed by request-id dedup. |
| `packages/domain/src/analytics/history-board-rollup.ts:1519` | Incremental source-day derivation uses the same raw-driven relation for affected days. |
| `packages/domain/src/analytics/history-board-rollup.ts:1778` | Loop findings replace only touched sessions, with explicit empty/full fallback semantics. |
| `packages/domain/src/analytics/history-board-rollup.ts:1967` | Incremental aliases include sources first seen in the delta. |
| `packages/domain/src/analytics/rollup-watermark.ts:23` | Definition version advances to `v4`, forcing existing materializations through a full rebuild. |
| `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:148` | Real-query plan and regression coverage includes rank plans, loop fallbacks, reset, raw-only days, first-seen sources, equality, and adversarial loose-index anchoring. |
| `packages/domain/tests/analytics/rollup-definition-version.test.ts:27` | Pins `v4` while retaining `v2`/`v3`. |
| `plugins/sp/scripts/verify-answer-lint.ts:272` | Accepts exact task-local Gherkin scenario titles so all seven AC rows are linted and recorded; `plugins/sp/tests/verify-answer-lint.test.ts:124` is the regression. |
| `docs/report/2026-09-04-E91-bounded-rollup-derivations.md:1` | Records the three-scale, constant-delta benchmark and its 0741 comparison. |

Re-verification repaired three correctness gaps: empty session scopes no longer expand to a corpus
scan, raw source/day coverage survives message dedup, and a new source participates in alias backfill
on its first delta. Those SQL changes supersede the originally planned `v3` closeout with `v4`.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/forensic-query.ts:884` scopes the query by session and treats `[]` as a no-op; `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:250` proves incremental/full equality and untouched-session preservation. |
| R2 | MET | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:148` captures the three real ranking queries; EXPLAIN names the token, duration, and input rank indexes with no temporary ORDER BY tree. |
| R3 | MET | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:250`, `:310`, `:343`, `:386`, `:431`, and `:556` cover equality plus empty, wide-delta, reset/deletion, and alias-map staleness/full-rebuild outcomes. |
| R4 | MET | `packages/domain/src/analytics/history-board-rollup.ts:1519` derives source/day coverage from raw-driven materialized rows and `packages/domain/src/analytics/forensic-query.ts:1055` performs the loose index walk; plan, equality, raw-only-day, and adversarial-key tests pass. |
| R5 | MET | `packages/domain/src/analytics/history-board-rollup.ts:1967` scopes materialized and first-seen delta sources; `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:556` proves scoped, unscoped, and new-source alias behavior. |
| R6 | MET | The three-scale benchmark execution is recorded with corpus provenance and method at `docs/report/2026-09-04-E91-bounded-rollup-derivations.md:6`; `:21` records 18.1x corpus growth versus 3.7x derivation growth and the 0741 baseline. |
| R7 | MET | `packages/domain/src/analytics/forensic-query.ts:880` routes every listed selector dimension to the preserved filtered expression; the real-query filtered-plan regression at `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:181` retains the temporary sort. |
| R8 | MET | `packages/domain/src/analytics/rollup-watermark.ts:23` advances the definition to v4; `packages/domain/tests/analytics/rollup-definition-version.test.ts:27` pins the new digest and passes with prior pins retained. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Loop findings are re-derived only for the sessions a delta touched | MET | test | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:250` compares incremental and fresh rows and proves the untouched session remains at three repeats. |
| R2 — Ranked steps resolve from the rank indexes without a sort | MET | test | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:149` executes the production queries and asserts the exact three indexes with no temporary ORDER BY tree. |
| R3 — The bounded derivations agree with the full rebuild | MET | test | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:250`, `:343`, `:386`, `:431`, and `:556` cover equality and every documented fallback/staleness precondition. |
| R4 — Source summary is derived from materialized rows and an index walk | MET | test | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:402` proves the production loose-walk plan uses `idx_history_message_source_file`; `:431` proves incremental/full source rows are identical. |
| R5 — Alias backfill is scoped to the delta on an incremental refresh | MET | test | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:556` proves pre-delta rows stay untouched by scoped apply while the delta aliases, then proves unscoped apply rewrites both. |
| R6 — Delta cost stays sublinear as the corpus grows | MET | command | The executed constant-delta benchmark's provenance, method, three-scale timings, and baseline comparison are retained at `docs/report/2026-09-04-E91-bounded-rollup-derivations.md:6` and `:21`. |
| R7 — Filtered forensic reads keep their current plan | MET | test | `packages/domain/tests/analytics/bounded-rollup-0763.test.ts:181` calls the real filtered ranking query and asserts the preserved unary-plus plan still sorts rather than walking the rank index. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Reviewer:** `sp:super-reviewer` (`review_0763_final`)
**Scope:** final task 0763 implementation, requirements/AC, verification evidence, and architecture
**Method:** source inspection plus fresh domain and answer-lint regression runs

## Findings

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings. Functional, SECUA, and architecture review pass. |

## Requirement traceability

| Requirement | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `forensic-query.ts:884` implements session-scoped loop queries; `bounded-rollup-0763.test.ts:250` proves incremental/full equality and untouched-session preservation. |
| R2 | MET | Production-query plan tests at `bounded-rollup-0763.test.ts:148` prove all three unfiltered ranks use their indexes without a temporary ORDER BY tree. |
| R3 | MET | Tests at `:250`, `:310`, `:343`, `:386`, `:431`, and `:556` cover equality, empty/wide scope, reset/deletion, and alias-map staleness/full-rebuild behavior. |
| R4 | MET | `history-board-rollup.ts:1519` materializes raw-driven source days and `forensic-query.ts:1055` performs the corrected loose walk; plan, equality, raw-only-day, and adversarial-key tests pass. |
| R5 | MET | `history-board-rollup.ts:1967` scopes existing and first-seen sources; `bounded-rollup-0763.test.ts:556` proves scoped, unscoped, and new-source alias behavior. |
| R6 | MET | `docs/report/2026-09-04-E91-bounded-rollup-derivations.md:6` records benchmark provenance/method and `:21` records 18.1x corpus growth versus 3.7x derivation growth. |
| R7 | MET | `forensic-query.ts:880` preserves the filtered expression and the production-query regression at `bounded-rollup-0763.test.ts:181` retains the sort plan. |
| R8 | MET | `rollup-watermark.ts:23` advances to `v4`; `rollup-definition-version.test.ts:27` pins the digest with prior versions retained. |

## SECUA

| Dimension | Result |
| --- | --- |
| Security | PASS — no new trust boundary, credential, dynamic execution, or authorization surface. |
| Errors | PASS — empty and wide scopes have explicit, tested semantics; failures are not suppressed. |
| Consistency | PASS — full and incremental derivations are compared directly across fallbacks. |
| Usage | PASS — changes stay behind existing domain APIs and migration conventions. |
| Alignment | PASS — implementation and tracked history design/report surfaces agree on v4 behavior. |
| Scope | PASS — unrelated `config/**` coverage exclusion was removed before closeout. |

## Architecture

The implementation reuses existing session scopes, materialized day rows, and covering indexes. The
distinct-file walk remains proportional to distinct file keys rather than message rows; the tracked
three-scale benchmark verifies sublinear behavior. No new public surface or stateful abstraction was
introduced.

**Review Verdict: PASS.**
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
- 2026-09-04T16:44:43.779Z backlog → todo (system)
- 2026-09-05T00:13:09.741Z todo → wip (system)
- 2026-09-05T00:13:19.390Z wip → testing (system)
- 2026-09-05T00:13:37.449Z testing → done (system)
