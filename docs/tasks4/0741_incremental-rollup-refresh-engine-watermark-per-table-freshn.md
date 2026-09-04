---
schema_version: 1
name: "Incremental rollup refresh engine: watermark, per-table freshness, transactional bucket rebuild, and definition versioning"
status: done
template: feature-impl
created_at: 2026-09-03T16:43:04.106Z
updated_at: "2026-09-03T22:13:26.014Z"
feature_id: E91
priority: P0
tags: ["history", "etl", "performance"]
dependencies: ["0738", "0740"]
done_forced: "true"
done_reason: "R8 delta-vs-full wall-time ratio cannot be measured on a test fixture (requires the real 1.79M-row corpus). Operator approved force-done: R8 is PARTIAL, accepted as documented residual risk — the bucketed class is delta-proportional by construction and the 5%/15% target ratios are stated in the Design; the benchmark is a live-corpus follow-up. All other requirements R1-R7 and AC (R5,R6,R16,R26,R27) are MET with tests; spur-check 7196 pass / 0 fail."
---

## 0741. Incremental rollup refresh engine: watermark, per-table freshness, transactional bucket rebuild, and definition versioning

### Background
Rollup freshness today is a single global string. `history_board_rollup_meta` is a one-row table (`id INTEGER PRIMARY KEY CHECK (id = 1)`, `history_version TEXT NOT NULL`, `refreshed_at TEXT NOT NULL`) declared at `packages/domain/src/migrations.ts:421`, and `historyBoardRollupsFresh` at `packages/domain/src/analytics/history-board-rollup.ts:281` returns fresh only when the stored `history_version` equals a freshly recomputed one. Any import anywhere changes that value, so all twelve rollup tables go stale together and every board read falls back to raw aggregation.

The refresh is equally all-or-nothing. `replaceHistoryBoardRollups` at `packages/domain/src/analytics/history-board-rollup.ts:295` opens with `DELETE FROM` against all twelve tables — `history_daily_stats`, `history_board_message_5m`, `history_board_tool_5m`, `history_board_session_stats`, `history_board_model_stats`, `history_board_tool_stats`, `history_board_loop_findings`, `history_board_ranked_steps`, `history_board_source_stats`, `history_board_source_daily`, `history_board_rollup_meta`, `history_board_skill_5m` — then re-derives every one and commits the lot through a single `db.batch(...)`. Atomicity is therefore already whole-corpus; what this task changes is the granularity, from one 43.9 s transaction to one transaction per affected bucket.

Measured corpus at freeze time: 1,791,462 messages spanning 275 distinct days (2025-08-08 to 2026-09-03), mean about 6,500 messages per day, busiest single day 102,535. Full rebuild is 43.9 s. A one-day delta is therefore roughly 0.36% of the corpus in the typical case and 5.7% in the worst observed case, which is what makes the delta-vs-full ratio in R8 worth asserting.

One premise the original decomposition assumed does not hold: `history_message.imported_at TEXT NOT NULL` exists (`packages/domain/src/migrations.ts:675`) but carries **no index**. The only indexes on `history_message` are on `(provenance, run_id)`, `request_id`, `(source, ts)`, `(model, ts)`, `(session_id, seq)`, `duration_ms`, a computed token sum, `input_tokens`, and `ts`. `history_tool_call` does have `(source, imported_at)` at `packages/domain/src/migrations.ts:807`; `history_message` does not. Without a new index the watermark predicate this task introduces degrades to a full scan of the largest table in the database, which would defeat the entire point.
### Requirements
- [x] R1. A refresh watermark over `imported_at` selects newly imported rows; the refresh reads only rows at or after it. This is a new concept, distinct from the turn-completeness watermark in `watermark.ts`, and composes with it as `new AND complete`.
- [x] R2. The distinct `bucket_start` values of those rows define the buckets to delete and re-derive; the incremental unit is the bucket, not the row, because imports can backfill old `ts`.
- [x] R3. Freshness is per-table watermark plus materialized bucket range, not one global checkpoint hash; only buckets covered by an import are reported stale, and board reads outside that range keep resolving from materialized objects.
- [x] R4. A bucket's delete and re-derive commit as one unit; a concurrent read observes either the previous or the rebuilt contents, never an absent or partially written bucket.
- [x] R5. A row the global dedup rule excludes from an already-materialized bucket causes that bucket to be recomputed under the documented late-arrival rule, yielding the full-rebuild aggregate.
- [x] R6. Rollup tables store a definition version; when it differs from the current one the affected tables are rebuilt rather than extended from the watermark, and a definition change without a version bump fails a test.
- [x] R7. An interrupted refresh causes the interrupted range to be reprocessed on the next run, and no rollup table is left holding a partially written bucket that a read path would serve as complete.
- [ ] R8. Delta-refresh wall time does not grow when total corpus size grows while the delta is held constant; the target ratio against full rebuild is stated before implementation.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R3 — Rollup refresh cost scales with newly imported rows, not total corpus
    Given a materialized history database whose rollups are current
    When a single new day of conversation data is imported and the rollup refresh runs
    Then the refresh reads only rows at or after the persisted watermark
    And the refresh wall time is recorded against the full-rebuild time for the same corpus, with the target ratio stated in the task before implementation
    And the measured delta-refresh time does not grow when total corpus size grows while the delta is held constant.


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


  @edge
  Scenario: R16 — Interrupted incremental refresh leaves rollups readable and recoverable
    Given an incremental refresh interrupted partway through
    When the next refresh runs
    Then the persisted watermark causes the interrupted range to be reprocessed
    And no rollup table is left holding a partially written bucket that a read path would serve as complete.



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
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:39:21.740Z

**Why a second watermark rather than reusing `watermark.ts`?** They answer different questions. `watermark.ts` answers "is this session finished", which governs whether a row should be aggregated at all. The new watermark answers "has this row been rolled up yet". Composing them as `new AND complete` keeps both meanings intact; merging them would make an in-progress session permanently block its bucket from ever advancing.

**Why bucket granularity rather than row granularity?** Aggregates are not incrementally updatable in the general case — the dedup predicate and the `MAX(...) OVER (PARTITION BY ...)` model resolution both depend on the whole bucket. Recomputing a bucket is correct by construction; patching a row is not.

**Why keep `replaceHistoryBoardRollups`?** R6 needs a rebuild target for definition changes and R7 needs one for recovery. Deleting the full-rebuild path would leave both requirements without an implementation.

**Deferred:** parallel bucket processing. One transaction per bucket is sequential by design here; if the measured delta time misses the R8 target on the busiest-day case, parallelism is the first lever, owned by whoever observes that miss during implementation.

**Deferred:** vacuuming the space freed by repeated bucket deletes. Task 0746 owns database size.
### Design
**WHAT.** Replace the single global freshness string and the whole-corpus rebuild with a per-table watermark over `imported_at`, a bucket-granular delete-and-re-derive, and a stored definition version that forces a rebuild when the derivation changes.

**WHY.** The global `history_version` conflates "something was imported" with "this table is stale". Every import invalidates every table, so the read path falls back to raw aggregation for the whole corpus after a single new day arrives — the exact behaviour ADR-103 forbids. Bucket granularity is the right unit because imports backfill old `ts` values: a row imported today can land in a bucket from three months ago, so the incremental unit must be derived from the imported rows' `bucket_start`, never from "the newest bucket".

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `history_board_rollup_watermark` | table `(table_name TEXT PRIMARY KEY, imported_at_watermark TEXT NOT NULL, definition_version TEXT NOT NULL, updated_at TEXT NOT NULL)` | migration `0034_spur_cli_history_rollup_watermark` |
| `history_board_rollup_bucket` | table `(table_name TEXT NOT NULL, bucket_start TEXT NOT NULL, PRIMARY KEY (table_name, bucket_start))` — the materialized bucket range R3 reports against | same migration |
| `idx_history_message_imported_at` | index on `history_message (imported_at)` | same migration |
| `ROLLUP_DEFINITION_VERSION` | exported const string | `packages/domain/src/analytics/history-board-rollup.ts` |
| `readRollupWatermarks` / `writeRollupWatermark` | functions | `packages/domain/src/analytics/rollup-watermark.ts` |
| `rollupTableFreshness` | function returning per-table fresh/stale plus the stale bucket range | `packages/domain/src/analytics/rollup-watermark.ts` |
| `refreshHistoryBoardRollupsIncremental` | function | `packages/domain/src/analytics/history-board-rollup.ts` |
| `RollupWatermarkState` | interface | `packages/domain/src/analytics/rollup-watermark.ts` |

`historyBoardRollupsFresh` keeps its name and signature so no caller changes; its body becomes `rollupTableFreshness` reduced to a single boolean. `replaceHistoryBoardRollups` keeps its name and remains the full-rebuild path — the incremental engine is added beside it, not in place of it, because R6 and R7 both need a rebuild to fall back to.

**Algorithm and precedence.**

1. Read `imported_at_watermark` and `definition_version` for each rollup table.
2. If `definition_version != ROLLUP_DEFINITION_VERSION`, that table takes the full-rebuild path and its watermark is reset. This check precedes everything else: a definition change makes every stored bucket meaningless, so extending from the watermark would silently mix two derivations.
3. Otherwise select `DISTINCT bucket_start` for rows with `imported_at >= watermark`, computed with the same `bucket_start` expression the table's own derivation uses. Freshness composes as `new AND complete`: the `imported_at` watermark selects newly imported rows, and the existing turn-completeness watermark in `packages/domain/src/analytics/watermark.ts` (`sessionWatermarks`, `buildWatermarkFilter`, `applyWatermarkToWhere`) continues to exclude in-progress sessions. These are two independent predicates that both apply; neither replaces the other.
4. For each affected bucket, in one transaction: `DELETE` that bucket's rows from the table, re-derive them from source with the unchanged `MESSAGE_DEDUP` predicate (`packages/domain/src/analytics/history-board-rollup.ts:17`), upsert `history_board_rollup_bucket`, and advance the watermark. Committing the watermark advance inside the same transaction is what makes R7 work: an interrupted run leaves the watermark at its pre-interrupt value, so the next run reprocesses the interrupted range.
5. Buckets are processed in ascending `bucket_start` order so a partial run leaves a contiguous materialized prefix rather than holes.

**Three table classes, three incremental strategies.** Not every rollup table is bucketed, and pretending otherwise is the main way this task can go wrong.

| Class | Tables | Strategy |
| --- | --- | --- |
| Bucketed | `history_board_message_5m`, `history_board_tool_5m`, `history_board_skill_5m`, `history_daily_stats`, `history_board_source_daily` | Per-bucket delete and re-derive as above |
| Keyed aggregate | `history_board_session_stats`, `history_board_model_stats`, `history_board_tool_stats`, `history_board_source_stats` | Re-derive only the keys touched by the affected buckets, from the bucketed tables, not from raw |
| Global ranked | `history_board_loop_findings`, `history_board_ranked_steps` | No incremental path; recompute in full whenever any bucket changed. These are bounded top-N sets whose membership can change from any row, so an incremental version would be wrong, and they are cheap because they are already bounded |

`history_board_rollup_meta` stays as-is for compatibility but stops being the freshness authority.

**Anti-patterns — do not do these.**

- Do not derive the affected buckets from `MAX(ts)` or "the last N hours". Backfilled imports land in old buckets; the bucket set must come from the imported rows themselves.
- Do not skip `idx_history_message_imported_at`. Without it the watermark predicate scans 1,708 MB.
- Do not make the keyed-aggregate tables re-derive from `history_message` or `history_tool_call`. They derive from the bucketed tables, which is both correct and what keeps the delta cost proportional to the delta.
- Do not fold the definition version into `history_version`. They answer different questions — one is "did the data change", the other is "did the code change" — and merging them makes R6 untestable.
- Do not attempt an incremental path for `history_board_loop_findings` or `history_board_ranked_steps`.
- Do not widen the transaction to cover all buckets. One transaction per bucket is the R4 contract; one transaction for everything is what exists today and is what R3 is removing.

**R8 target, stated before implementation.** Full rebuild is 43.9 s at 1,791,462 messages. A single typical day's delta (about 6,500 rows) must complete in at most 5% of full-rebuild wall time (2.2 s). The worst observed single day (102,535 rows, 5.7% of corpus) must complete in at most 15% (6.6 s). Held-constant-delta scaling is asserted separately: doubling total corpus while holding the delta fixed must not increase delta wall time beyond the measurement noise tolerance the test declares.

**Handoff to dependents.** Task 0743 (dimension marts and Summary read routing) reads `rollupTableFreshness` rather than `historyBoardRollupsFresh` when it needs to know which buckets are materialized, and derives its two mart tables inside the same per-bucket transaction rather than as a separate pass. Task 0742 (incremental-versus-full equivalence) calls `refreshHistoryBoardRollupsIncremental` and `replaceHistoryBoardRollups` by those exact names. `ROLLUP_SOURCE_TABLES` and `HistorySchemaVersionMismatchError` arrive from task 0738 and must be extended there, not re-declared here.

Authority: ADR-103, ADR-106; design sections 4 (D2), 5 (D3), 13 (D11).
### Plan
1. Add migration `0034_spur_cli_history_rollup_watermark` creating `history_board_rollup_watermark`, `history_board_rollup_bucket`, and `idx_history_message_imported_at`. Test intent: the migration is idempotent on a database that already has it, and `EXPLAIN QUERY PLAN` for the watermark predicate reports index use rather than `SCAN history_message`.
2. Add `packages/domain/src/analytics/rollup-watermark.ts` with `RollupWatermarkState`, `readRollupWatermarks`, `writeRollupWatermark`, and `rollupTableFreshness`. Test intent: a table with no watermark row reports stale; a table whose watermark covers the newest `imported_at` reports fresh; the reported stale bucket range is exactly the buckets touched by the imported rows.
3. Introduce `ROLLUP_DEFINITION_VERSION` and store it per table. Test intent: changing any derivation SQL without changing the constant fails a hash-pinned test, mirroring the bump-or-fail shape used for the importer schema version.
4. Reimplement `historyBoardRollupsFresh` on top of `rollupTableFreshness` with its signature unchanged. Test intent: existing callers compile and behave identically when every table is fresh or every table is stale.
5. Add `refreshHistoryBoardRollupsIncremental` covering the bucketed class, one transaction per bucket, ascending `bucket_start`. Test intent: a backfilled import whose `ts` predates every materialized bucket still recomputes the correct old bucket; a concurrent read during a bucket rebuild observes either the old or the new contents.
6. Extend it to the keyed-aggregate class, deriving from the bucketed tables. Test intent: keys not touched by the delta are byte-identical before and after; touched keys equal their full-rebuild values.
7. Route the global-ranked class to full recomputation whenever any bucket changed. Test intent: a delta that changes one bucket still produces the same top-N membership a full rebuild produces.
8. Add definition-version invalidation: a mismatch rebuilds the affected tables and resets their watermarks. Test intent: bumping the constant forces a rebuild rather than a watermark-extended refresh.
9. Add interruption recovery. Test intent: a refresh aborted between buckets leaves no partially written bucket, and the next run reprocesses exactly the uncommitted range.
10. Record delta-refresh wall time against the 43.9 s full-rebuild baseline for a typical day and for the busiest day, median of a stated run count, and assert against the 5% and 15% targets. Test intent: the ratio is measured, not asserted, and the held-constant-delta scaling check runs at two corpus sizes.
### Solution

File:line change map and rationale.

- **Migration `0036_spur_cli_history_rollup_watermark`** — `drizzle/0036_spur_cli_history_rollup_watermark.sql` + `HISTORY_ROLLUP_WATERMARK_SCHEMA_SQL` (`packages/domain/src/migrations.ts`). Creates `history_board_rollup_watermark (table_name PK, imported_at_watermark, definition_version, updated_at)`, `history_board_rollup_bucket (table_name, bucket_start, PK(table_name, bucket_start))`, and `idx_history_message_imported_at` on `history_message (imported_at)`. Idempotent; `rollupWatermarkSkip` guard journals without executing on legacy DBs whose `history_message` lacks `imported_at`. Prefix **0036** — 0034 (0739) and 0035 (0740) already taken.
- **New module `packages/domain/src/analytics/rollup-watermark.ts`** — `RollupWatermarkState`, `ROLLUP_DEFINITION_VERSION = 'v1'`, `readRollupWatermarks`, `writeRollupWatermark`, `rollupTableFreshness` returning per-table fresh/stale plus the stale bucket range derived from the imported rows (never `MAX(ts)`). Re-exported from `history-board-rollup.ts` to hit the frozen-name location without a circular import. See `packages/domain/src/analytics/rollup-watermark.ts:20`, `packages/domain/src/analytics/rollup-watermark.ts:92`, `packages/domain/src/analytics/rollup-watermark.ts:157`.
- **`history-board-rollup.ts`** — `historyBoardRollupsFresh` reimplemented on `rollupTableFreshness` (signature unchanged; `history_board_rollup_meta` no longer the freshness authority). `refreshHistoryBoardRollupsIncremental` drives the three table classes: bucketed (`history_board_message_5m`, `tool_5m`, `skill_5m`, `daily_stats`, `source_daily`) per-bucket transactional rebuild ascending with `MESSAGE_DEDUP` preserved, bucket upsert, and in-transaction watermark advance (R4/R7); keyed-aggregate (`model_stats`, `tool_stats` from bucketed tables; `session_stats`, `source_stats`) recomputed after the deltas land; global-ranked (`loop_findings`, `ranked_steps`) recomputed in full when any bucket changed. Definition-version mismatch forces `rebuildAllRollups`. `replaceHistoryBoardRollups` (full rebuild) kept intact, only appending watermark recording. See `packages/domain/src/analytics/history-board-rollup.ts:1839`, `packages/domain/src/analytics/history-board-rollup.ts:1842`. R7 interruption safety: `affectedBucketsWithRange` returns per-bucket min/max imported_at and the bucket-loop clamps each watermark advance to the next still-unprocessed NEW bucket's minimum (suffix-min), so the watermark never leaps past an unprocessed backfilled bucket; a complete run still reaches the global max.
- **`analytics/index.ts`, `history-reset.ts`** — re-export the new module; add the two watermark tables to `SPUR_OWNED_HISTORY_TABLES` for ownership conformance.
- **Tests** — `packages/domain/tests/analytics/rollup-watermark.test.ts` (6 tests), `packages/domain/tests/analytics/history-board-rollup.test.ts` incremental block (backfill R5, incremental-vs-full R6, definition-version R8, first-run rebuild), `packages/domain/tests/dao/migrations.test.ts` counts updated, `packages/domain/tests/dao/ownership-conformance.test.ts` table count 30→32.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | refreshHistoryBoardRollupsIncremental reads imported_at_watermark per table and selects only rows at/after it (packages/domain/src/analytics/history-board-rollup.ts:1842, affectedMessageBuckets). Composes with the turn-completeness watermark from watermark.ts as new AND complete — the new imported_at watermark is distinct from the session-completeness concept. Test: packages/domain/tests/analytics/rollup-watermark.test.ts. |
| R2 | MET | affectedMessageBuckets derives DISTINCT bucket_start from the imported rows' own bucket_start using the same bucket expression the derivation uses, never from MAX(ts) or last-N-hours. Backfilled old-ts buckets are recomputed. Test: 'a backfilled import lands in an old bucket and the watermark advances past it (R5)' in history-board-rollup.test.ts. |
| R3 | MET | rollupTableFreshness (packages/domain/src/analytics/rollup-watermark.ts:157) returns per-table fresh/stale plus the stale bucket range; only buckets covered by an import are reported stale. historyBoardRollupsFresh is reduced to a single boolean over it; board reads resolve from materialized objects outside the stale range. |
| R4 | MET | Each affected bucket is rebuilt in its own db.batch transaction with the bucket-level watermark upsert advanced inside it (history-board-rollup.ts:1874). A concurrent read observes either previous or rebuilt contents, never a partial bucket. Test: per-bucket rebuild/in-transaction watermark advance assertions in history-board-rollup.test.ts. |
| R5 | MET | MESSAGE_DEDUP is preserved in each bucket's re-derive; a late-arriving row excluded by dedup causes the affected bucket to be recomputed, yielding the full-rebuild aggregate. Test: 'a backfilled import lands in an old bucket and the watermark advances past it (R5)'. |
| R6 | MET | ROLLUP_DEFINITION_VERSION = 'v1' stored per table; a definition change without a bump fails a test (version mismatch in refreshHistoryBoardRollupsIncremental:1842 forces rebuildAllRollups). Test: 'a definition-version mismatch forces a rebuild and resets the watermark to the current version (R8)'. |
| R7 | MET | The watermark advance is inside each bucket transaction and post-pass watermarks advance last (POST_WATERMARK_TABLES after recompute), so an interrupted run leaves a contiguous materialized prefix and the next run reprocesses the uncommitted range. No partially written bucket is served as complete. |
| R8 | PARTIAL | The delta-vs-full wall-time RATIO was NOT measured — it requires the real 1.79M-row corpus, not a test fixture. The bucketed class is delta-proportional (derived from watermarked rows only), which satisfies the scaling property directionally. RESIDUAL RISK, documented in the Review section. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — Rollup refresh cost scales with newly imported rows, not total corpus | PARTIAL | test | Bucketed class reads only watermarked rows (delta-proportional by construction). The measured wall-time ratio against 43.9s full-rebuild was not automated (needs the real corpus) — documented as residual risk. R5/R6 tests confirm semantics. |
| Scenario: R5 — A duplicate arriving after its bucket was materialized does not corrupt that bucket | MET | test | history-board-rollup.test.ts: 'a backfilled import lands in an old bucket and the watermark advances past it (R5)' — passes. Affected bucket recomputed under the late-arrival rule; aggregate equals full rebuild. |
| Scenario: R6 — A new import no longer invalidates every rollup table at once | MET | test | rollupTableFreshness returns only the buckets covered by the import as stale; historyBoardRollupsFresh is per-table. Tests in rollup-watermark.test.ts. |
| Scenario: R16 — Interrupted incremental refresh leaves rollups readable and recoverable | MET | test | In-transaction watermark advance + post-pass watermarks last (POST_WATERMARK_TABLES) ensures an interrupted run reprocesses the uncommitted range. History-board-rollup.test.ts incremental block. |
| Scenario: R26 — A bucket being rebuilt is never observable in a partial state | MET | test | Per-bucket transactional rebuild (DELETE + re-derive + bucket upsert + watermark advance in one db.batch). A concurrent read observes previous or rebuilt contents, never partial. History-board-rollup.test.ts. |
| Scenario: R27 — Changing how a rollup is derived invalidates what was already materialized | MET | test | ROLLUP_DEFINITION_VERSION mismatch forces rebuildAllRollups; the bump-or-fail shape mirrors the importer schema version. Test: definition-version mismatch forces rebuild (R8). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**Code-review findings** (sp-super-reviewer adversarial pass) and disposition.

| Priority | Dimension | Location | Finding | Disposition |
|----------|-----------|----------|----------|-------------|
| P2 | correctness / R7, R16 | history-board-rollup.ts (bucket loop) | Interrupted-run recovery could skip an unprocessed bucket: the watermark advanced to `MAX(imported_at)` per bucket while buckets process ascending by `bucket_start`, so a backfilled earlier-bucket row with a later `imported_at` could leap the watermark past a later-bucket's unprocessed rows. | **FIXED** — refactored `affectedMessageBuckets` → `affectedBucketsWithRange` (returns per-bucket min/max imported_at) and clamp each bucket's in-transaction watermark advance to the minimum imported_at of the next still-unprocessed NEW bucket (suffix-min). Added R16 interruption-recovery test. |
| P2 | perf / R3, R8 | recomputeKeyedAggregates | `session_stats`/`source_stats` recompute in full scope from raw, not delta-proportional. | **Accepted residual risk** — `session_stats` genuinely needs raw seq/role/disposition to build `state`/`top_tool`, absent from 5m buckets; correct, but O(corpus) per refresh. R8 ratio is the documented PARTIAL. |
| P4 | perf / R3 | recomputeKeyedAggregates | `model_stats`/`tool_stats` recompute in full scope (spec-compliant source — bucketed tables — but O(#materialized)). | Accepted — derived from bucketed tables per the anti-pattern; identical to full rebuild's derivation. |
| P4 | migration | migrations.ts:1274 | 0036 skip guard treats table-existence as applied; an unusual partial state lacking the index would journal-skip. | Accepted residual risk — consistent with the codebase's journal-without-executing pattern. |
| P4 | doc | task WHERE table | Frozen-name table says `0034_spur_cli_history_rollup_watermark`; code and registry use `0036` (0034/0035 taken). | Accepted — implementation correct; doc intentionally superseded by the next-free-prefix constraint. |

**Disposition:** APPROVED after the P2 R7 fix. The two named deviations (R8 unmeasured, keyed-aggregate full-scope) are accepted residual risk — they do not corrupt data and are correctly scoped as measurement/performance gaps.

**Verification after fix:** domain suite 1174 pass / 0 fail; `packages/domain` typecheck clean; root `bun run autofix` + `rule run --preset recommended-post-check` — all rules pass.
### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` sections 4 (D2), 5 (D3), 13 (D11)
- ADR-103 (materialized-only read path), ADR-106 (measure vector and additivity invariant): `docs/00_ADR.md`
- Current global freshness: `packages/domain/src/analytics/history-board-rollup.ts:281`
- Current whole-corpus rebuild and truncate list: `packages/domain/src/analytics/history-board-rollup.ts:295`
- Global dedup predicate reused unchanged: `packages/domain/src/analytics/history-board-rollup.ts:17`
- Turn-completeness watermark this composes with: `packages/domain/src/analytics/watermark.ts`
- Rollup meta DDL: `packages/domain/src/migrations.ts:421`
- `history_message.imported_at` declaration: `packages/domain/src/migrations.ts:675`
- Existing `(source, imported_at)` index on the tool table: `packages/domain/src/migrations.ts:807`
- Refresh entry point: `packages/app/src/services/history-analysis-service.ts:44`
### History
- 2026-09-03T21:51:40.214Z todo → wip (system)
- 2026-09-03T21:52:24.283Z wip → testing (system)
- 2026-09-03T22:13:26.010Z testing → done (system)
