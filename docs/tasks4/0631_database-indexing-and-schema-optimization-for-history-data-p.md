---
schema_version: 1
name: "Database indexing and schema optimization for History data plane"
status: done
template: feature-impl
created_at: 2026-08-22T22:52:26.674Z
updated_at: "2026-09-03T16:59:11.683Z"
feature_id: E9
---

## 0631. Database indexing and schema optimization for History data plane

### Background

Feature E9 follows the measured History Board work in tasks 0628 and 0629. The current checkout already has indexed live reads plus 11 checkpoint-versioned rollup tables, but several selector/order paths still lack purpose-built composite indexes.

Current-tree verification on 2026-08-22 established the actual starting point:

- `CLI_MIGRATIONS` ends at `0021_spur_cli_history_board_rollups`; the draft's proposed `0017` identifier is already occupied and is invalid. The next migration is `0022_spur_cli_history_performance_indexes`.
- The resolved `@gobing-ai/ts-llm-jsonl-importer@0.4.41` schema already provides `history_message(source, session_id, seq)`, `history_message(ts)`, `history_tool_call(source, session_id, seq)`, `history_tool_call(message_hash)`, and `history_import_checkpoint` primary key `(source, source_file)`.
- The local production-scale database contains 1,724,061 messages and 441,117 tool calls. Existing rollup indexes are source/model/skill-leading; there is no `(source, ts)`, `(model, ts)`, session-id-leading tool-call index, or the feature's bucket-leading rollup indexes.
- Fresh databases receive incremental DDL by running the complete `CLI_MIGRATIONS` sequence. `CLI_SCHEMA_SQL` intentionally creates the foundation before rollup tables exist, so adding rollup indexes there would execute in the wrong order.

This task adds one idempotent incremental migration and proves each retained index against a representative query plan. It does not alter importer-owned tables, add a schema layer, or rewrite earlier journaled migrations.

### Requirements

- [x] R1. Add the feature-required raw-query indexes: `idx_history_message_source_ts` on `history_message(source, ts)`, `idx_history_message_model_ts` on `history_message(model, ts)`, and `idx_history_tool_call_session_id_seq` on `history_tool_call(session_id, seq)`.
- [x] R2. Add the feature-required rollup indexes: `idx_history_board_message_5m_bucket_model` on `history_board_message_5m(bucket_start, model)` and `idx_history_board_tool_5m_bucket_skill` on `history_board_tool_5m(bucket_start, skill_name)`. Add `idx_history_board_session_source_started` on `history_board_session_stats(source, started_at DESC)` for the actual `WHERE source ... ORDER BY started_at` access path; do not add the ineffective reverse order from the draft.
- [x] R3. Define `HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL`, append `0022_spur_cli_history_performance_indexes` to `CLI_MIGRATIONS`, and add the byte-equivalent top-level migration `drizzle/0022_spur_cli_history_performance_indexes.sql`. Every statement must use `CREATE INDEX IF NOT EXISTS`; do not modify `drizzle/_legacy_reference/` or append rollup DDL to `CLI_SCHEMA_SQL`.
- [x] R4. Extend `packages/domain/tests/dao/migrations.test.ts` to cover the 23-entry migration sequence, fresh and upgraded databases, a second idempotent apply, and exact column order/direction via `PRAGMA index_xinfo`. Record `EXPLAIN QUERY PLAN` evidence for each new index against the query shape it is meant to serve.
- [x] R5. Do not add `history_import_checkpoint(source, updated_at)` merely because the draft listed it: the current source-filtered lookup is already served by primary key `(source, source_file)`, while the freshness query aggregates the whole checkpoint table. Add a checkpoint index only if a current-tree query and `EXPLAIN QUERY PLAN` prove a distinct access path; otherwise record it as rejected.

Out of scope: new history tables, importer-package changes, query-semantic changes, public CLI changes, and unrelated schema/index cleanup.

### Acceptance Criteria

```gherkin
Feature: Database indexing and schema optimization for History data plane

  Scenario: Targeted SQLite Index Coverage for History Query Paths (R2)
    Given a database migrated through 0021 and the current 0022 migration
    When the migration is applied once or reapplied idempotently
    Then the source/timestamp, model/timestamp, session/sequence, bucket/model, bucket/skill, and source/started-at indexes exist with the frozen column order
    And representative EXPLAIN QUERY PLAN output selects each retained index for its intended access path
    And fresh-database and upgraded-database schema results are identical.
```

### Q&A

**Why a new 0022 migration instead of editing 0020/0021 only?** Existing databases have already journaled 0020 and 0021; changing only their SQL would never apply the new indexes there. A new idempotent increment upgrades existing databases and is harmless after a fresh 0021 create.

**Why not put the indexes in `CLI_SCHEMA_SQL`?** That foundation SQL runs before the 0021 rollup tables exist. The ordered migration sequence is the fresh-database contract.

**Why is the session index `(source, started_at DESC)` rather than `(started_at DESC, source)`?** The service filters by source before ordering by start time. The existing `started_at DESC` index already covers unfiltered ordering; source-leading order is the missing access path.

**What is the measured write penalty?** Unknown until implementation. Do not repeat the draft's unverified “less than 3%” claim; capture before/after import or index-build evidence if the gate requires it.

**Why reject the checkpoint candidate by default?** Its current source lookup is covered by the table primary key and its freshness query has no selective predicate. An unused index is permanent write and storage cost.

### Design

**Decision:** ship one new CLI-owned migration (`0022`) containing only the proven composite indexes. Reason: it upgrades already-journaled databases without changing importer ownership or replaying old migrations.

**Alternatives considered:**

| Option | Result | Reason |
| --- | --- | --- |
| Edit 0020/0021 only | Rejected | Existing databases have journaled those ids and would never receive changed SQL. |
| Add `0022` in Spur | Chosen | Smallest reversible change; matches the current migration seam and top-level Drizzle mirror. |
| Change `@gobing-ai/ts-llm-jsonl-importer` schema | Rejected | The tables are package-owned, but these workload-specific indexes are Spur read-plane policy. |

**Frozen names and locations:**

- SQL constant: `HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL` in `packages/domain/src/migrations.ts`.
- Embedded migration id: `0022_spur_cli_history_performance_indexes`.
- Folder migration: `drizzle/0022_spur_cli_history_performance_indexes.sql` with the `_spur_cli_` marker.
- Tests: extend `packages/domain/tests/dao/migrations.test.ts`; do not create a parallel migration harness.

`CLI_MIGRATIONS` remains the ordered authority: 0021 creates rollup tables, then 0022 creates their indexes. A fresh database and an upgraded database therefore converge. `CREATE INDEX IF NOT EXISTS` makes replay safe; the migration journal prevents normal duplicate work.

For each index, capture the representative SQL and assert the chosen plan. `PRAGMA index_xinfo` verifies column order plus the `DESC` bit. If a proposed index is not selected, stop and remove it from this task rather than shipping decorative DDL.

No ADR is required: this extends the existing SQLite migration/read-plane mechanism without changing a module boundary, dependency, transport, or public surface.

**Anti-patterns:** no `0017` reuse; no direct edit to importer DDL; no rollup index in `CLI_SCHEMA_SQL`; no duplicate prefix; no index justified only by table size; no legacy-reference edit.

**Handoff:** task 0632 may assume 0022 exists and must not add or rename schema objects owned here. Task 0633 verifies the resulting access paths at service level.

### Plan

- [x] Inspect the current query shapes and capture pre-index `EXPLAIN QUERY PLAN` output for every R1/R2 candidate; reject any index with no demonstrated path (R4, R5).
- [x] Add `HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL`, migration `0022_spur_cli_history_performance_indexes`, and `drizzle/0022_spur_cli_history_performance_indexes.sql` with identical idempotent DDL (R1-R3).
- [x] Update the migration sequence/count and add fresh, upgraded, idempotence, `PRAGMA index_xinfo`, and post-index plan assertions in `packages/domain/tests/dao/migrations.test.ts` (R3, R4).
- [x] Run `bun test packages/domain/tests/dao/migrations.test.ts`; then run `bun run lint` and the repository gates required by the final task state (R4).
- [x] Record the before/after plans, retained/rejected candidates, and any measured write/storage cost in Testing so 0632/0633 consume evidence rather than assumptions (R4, R5).

### Solution

**Change map:**

- `packages/domain/src/migrations.ts:348` — new `HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL` with six `CREATE INDEX IF NOT EXISTS` statements (R1/R2):
  - `idx_history_message_source_ts (source, ts)`, `idx_history_message_model_ts (model, ts)` on `history_message`
  - `idx_history_tool_call_session_id_seq (session_id, seq)` on `history_tool_call`
  - `idx_history_board_message_5m_bucket_model (bucket_start, model)`, `idx_history_board_tool_5m_bucket_skill (bucket_start, skill_name)` on the 0021 rollup tables
  - `idx_history_board_session_source_started (source, started_at DESC)` for the source-filtered newest-first session path
- `packages/domain/src/migrations.ts:701` — migration list extended to 23 entries with `0022_spur_cli_history_performance_indexes`; sequence doc comment updated. No DDL added to `CLI_SCHEMA_SQL`; `drizzle/_legacy_reference/` untouched.
- `packages/domain/src/migrations.ts:797` — `historyPerformanceIndexesSkip` guard (same pattern as 0020): journals 0022 without executing on stub/legacy shapes whose `history_message` lacks `ts`/`model` or whose `history_tool_call` is absent, so existing upgrade-path tests keep working.
- `drizzle/0022_spur_cli_history_performance_indexes.sql` — top-level mirror, statement-identical to the embedded constant (same leading-newline convention as 0020).
- `packages/domain/tests/dao/migrations.test.ts` — 23-entry sequence assertion, fresh-DB `PRAGMA index_xinfo` order/direction checks, upgraded(0021)→0022 fresh-vs-upgraded schema convergence, second-apply idempotence, per-index `EXPLAIN QUERY PLAN` assertions, and the R5 checkpoint rejection test. Upgrade-path applied-count expectations bumped (20→21, 21→22, 13→14).

**Rationale:** one idempotent increment upgrades databases already journaled through 0021; fresh databases get the same indexes by running the full ordered sequence after 0021 creates the rollup tables.

**R5 rejection:** `history_import_checkpoint(source, updated_at)` not added — the source lookup is served by the PK `(source, source_file)` and the freshness query (`MAX(updated_at) GROUP BY source`) has no selective predicate; recorded as a test, not DDL.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `packages/domain/src/migrations.ts:380` — `HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL` defines the three raw-plane indexes: `idx_history_message_source_ts (source, ts)`, `idx_history_message_model_ts (model, ts)`, `idx_history_tool_call_session_id_seq (session_id, seq)`; idempotent-DDL + frozen-order assertions `packages/domain/tests/dao/migrations.test.ts:494,519-521`. |
| R2 | MET | `packages/domain/src/migrations.ts:384-395` — rollup indexes `idx_history_board_message_5m_bucket_model (bucket_start, model)`, `idx_history_board_tool_5m_bucket_skill (bucket_start, skill_name)`, and `idx_history_board_session_source_started (source, started_at DESC)` (DESC bit via `index_xinfo`); EXPLAIN plan selections `packages/domain/tests/dao/migrations.test.ts:587-617`. |
| R3 | MET | `CLI_MIGRATIONS[22]` = `0022_spur_cli_history_performance_indexes` at `packages/domain/src/migrations.ts:882-883`; top-level mirror `drizzle/0022_spur_cli_history_performance_indexes.sql` byte-identical (672 bytes, verified this run); every statement is `CREATE INDEX IF NOT EXISTS` (`packages/domain/tests/dao/migrations.test.ts:494`); no `CLI_SCHEMA_SQL`/`drizzle/_legacy_reference/` change. |
| R4 | MET | `packages/domain/tests/dao/migrations.test.ts:501,542,561,619` — fresh-DB six-index order/direction, 0021→0022 upgraded-vs-fresh convergence, second-apply idempotence (journals 0), per-index `EXPLAIN QUERY PLAN` selection, R5 rejection. Fresh run: 49 pass / 0 fail / 205 expect() / 100% migration coverage. |
| R5 | MET | `packages/domain/tests/dao/migrations.test.ts:619` — `history_import_checkpoint(source, updated_at)` rejected: PK `(source, source_file)` covers the source lookup, freshness aggregate has no selective predicate, index absent. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Targeted SQLite Index Coverage for History Query Paths (R2) | MET | test | `packages/domain/tests/dao/migrations.test.ts:501` (fresh DB gains six indexes with frozen order/direction + second-apply idempotence), `:561` (EXPLAIN QUERY PLAN selects each retained index), `:542` (fresh vs 0021-upgraded schema convergence). Fresh run 49/49 pass. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Reviewed:** 2026-08-22 · Dimensions: functional, security, efficiency, correctness, usability, architecture · **Verdict: PASS**

Scope: uncommitted diff — `packages/domain/src/migrations.ts`, `packages/domain/tests/dao/migrations.test.ts`, `drizzle/0022_spur_cli_history_performance_indexes.sql` (docs/tasks4*, docs/features, config/corpus-baseline.json excluded as pre-existing/plan artifacts).

| # | Severity | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 | architecture | 0022 skip-guard duplicates the 0020 guard shape inline in `applyCliMigrations` rather than extracting a shared helper | `packages/domain/src/migrations.ts:780` |

No blockers, majors, or minors.

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | `HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL` defines `idx_history_message_source_ts`, `idx_history_message_model_ts`, `idx_history_tool_call_session_id_seq` (`packages/domain/src/migrations.ts:336-344`); `PRAGMA index_xinfo` + EXPLAIN assertions in `packages/domain/tests/dao/migrations.test.ts:467-501,535-584` |
| R2 | MET | Rollup + session-stats indexes at `packages/domain/src/migrations.ts:345-351`, incl. `started_at DESC` direction verified via xinfo `desc` bit (`migrations.test.ts:493-499`) |
| R3 | MET | `CLI_MIGRATIONS` 23-entry list (`migrations.ts:692-695`); byte-equivalent mirror `drizzle/0022_spur_cli_history_performance_indexes.sql`; idempotence regex test (`migrations.test.ts:448-453`); `CLI_SCHEMA_SQL` and `_legacy_reference/` untouched |
| R4 | MET | 23-entry sequence test, fresh/upgraded convergence (`sqlite_master` DDL equality), second-apply = 0 journaled, per-index `EXPLAIN QUERY PLAN` with `ANALYZE` seeding — `migrations.test.ts:119,503-532,495-496,535-584`; 47/47 tests pass (re-run 2026-08-22) |
| R5 | MET | Checkpoint index rejected with evidence: PK `(source, source_file)` asserted, no selective predicate for the freshness query — `migrations.test.ts:587-604` |

`bun test packages/domain/tests/dao/migrations.test.ts` → 47 pass / 0 fail / 180 expects (2026-08-22, fresh run in review).

Residual risk: write-penalty on the 1.7M-row production corpus is not measured here — deferred to 0633's latency gate as recorded in Testing; second `idx_history*`-only scope of the convergence comparison is adequate since 0021's own test owns table convergence.

**Disposition:** PASS. No remediation required; advisory #1 may be folded into any future migration-guard refactor.

### References

- **Architecture Document:** [docs/design/history-data-processing.md](file:///Users/robin/xprojects/spur-new/docs/design/history-data-processing.md)
- **Parent Feature:** [docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md](file:///Users/robin/xprojects/spur-new/docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md)
- **Prior Migration Precedents:** Task 0628 (`0016_spur_cli_history_board_indexes`), Task 0629 (`history_board_rollups`)

### History

- 2026-08-22T23:31:50.018Z todo → wip (system)
- 2026-08-22T23:37:19.595Z wip → testing (system)
- 2026-08-22T23:38:04.474Z testing → done (system)
