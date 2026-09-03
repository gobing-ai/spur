---
schema_version: 1
name: "Complete the measure vector on existing rollup tables and enforce the additivity invariant"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.077Z
updated_at: "2026-09-03T17:27:03.843Z"
feature_id: E91
priority: P1
tags: ["history", "rollup", "kpi"]
---

## 0740. Complete the measure vector on existing rollup tables and enforce the additivity invariant

### Background
The twelve rollup tables (`packages/domain/src/migrations.ts:419-630`) each chose an ad-hoc measure subset, so what is answerable depends on which table happens to hold the dimension. Column inventory verified against the tree on 2026-09-03.

`history_message` carries both `cache_read_tokens` and `cache_write_tokens`, but **no rollup table carries the latter** and it is absent from `packages/contracts/src/history.ts` — even though `run-cost.ts` and `role-tokens.ts` both consume it. `history_board_ranked_steps` already ships a `cache-waste` ranking kind (1000 rows live) while the measure backing it does not exist in any aggregate.

**Premise corrected: the sample-count column is named `assistant_duration_samples`, not `duration_samples`,** and it exists on exactly two tables — `history_board_message_5m` (`packages/domain/src/migrations.ts:452`) and `history_board_model_stats` (`packages/domain/src/migrations.ts:516`). Two further corrections to this task's original framing:

- `history_daily_stats` and `history_board_session_stats` each carry `assistant_duration_ms` with no sample count, so a correct mean duration is not computable from either. Both need one.
- `history_board_source_stats` carries **no duration column at all**, so it needs no sample count. The original Plan listed it; that was wrong.
- `history_board_tool_5m` and `history_board_tool_stats` carry `duration_ms` whose sample count is already `calls` — one duration per tool call. They need no new column, and the additivity test must recognise `calls` as a valid sample count rather than flagging them.

`history_board_tool_5m` stores its token columns as **REAL** (`packages/domain/src/migrations.ts:471-473`): message tokens allocated across the tool calls of a message. Their sum does not equal `history_board_message_5m`'s integer sums, so anything adding across the two silently double counts.

**New finding.** `history_board_tool_stats` is built by `SUM()`-ing those REAL allocations into **INTEGER** columns (`packages/domain/src/analytics/history-board-rollup.ts:473-480`). Its token columns are therefore allocations too — silently truncated — and must take the `_alloc` suffix alongside `tool_5m`'s.

`history_board_skill_5m` carries only `calls` and no token or duration measures, so R5's `_alloc` rename does not reach it.
### Requirements
- [ ] R1. `cache_write_tokens` is stored as its own measure on the rollup tables that carry token measures, never summed into `cache_read_tokens`.
- [ ] R2. Cache hit rate is computed as `cache_read / (fresh + cache_read + cache_write)`.
- [ ] R3. No History response shape changes; `packages/contracts/src/history.ts` stays byte-identical.
- [ ] R4. Every materialized duration sum has a co-located sample count: `assistant_duration_samples` is added to `history_daily_stats` and `history_board_session_stats`; the tool-grain tables already have `calls`.
- [ ] R5. Every attributed (allocated) token measure carries an `_alloc` name distinct from its measured counterpart, and no query sums the two together.
- [ ] R6. No aggregate column stores a rate, ratio, percentage, or mean; each derived variable is computed from the measure vector at read time.
- [ ] R7. Per-row ranking tables, findings tables, and rollup metadata are unchanged; top-N breakdown tables carry only measures well defined at their grain.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

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


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:26:55.757Z

**What is the sample-count column actually called? — `assistant_duration_samples`.** Verified on `history_board_message_5m` (`packages/domain/src/migrations.ts:452`) and `history_board_model_stats` (`packages/domain/src/migrations.ts:516`). This task's original Requirements and Plan said `duration_samples`; corrected here and in the frozen column table.

**Which tables actually need a duration sample count? — Two, not three.** `history_daily_stats` and `history_board_session_stats` carry `assistant_duration_ms` with no count. `history_board_source_stats` was listed in the original Plan but carries no duration column at all, so it needs nothing. Corrected.

**Do the tool-grain tables need a sample count? — No.** `history_board_tool_5m` and `history_board_tool_stats` carry `duration_ms` whose count is `calls` — one duration per tool call. The additivity test must accept an existing column as the count rather than demanding a `*_samples` name, or it will flag two correct tables.

**Are `history_board_tool_stats`' token columns allocations? — Yes, and this is new.** They are `SUM()`s of `history_board_tool_5m`'s REAL allocations, declared INTEGER (`packages/domain/src/analytics/history-board-rollup.ts:473-480`). They take the `_alloc` suffix and change to REAL in the same migration. Leaving them INTEGER would mean `tool_stats` totals never reconcile with `tool_5m`.

**Does `history_board_skill_5m` need the vector? — No.** It carries only `calls`. R25's "aggregates that are not KPI surfaces do not carry the vector" covers it alongside the ranking, findings, and metadata tables.

**Is the 0.3% cache-hit correction the justification? — No.** The correction is real but small at aggregate scale; the justification is that cache write is unmeasurable at *any* grain today, and cache waste is a per-session and per-model pathology that averages to nothing globally. Accepting the 0.3% figure as the bar would set the wrong acceptance test.

**Does anything reach the UI? — No.** `cache_write_tokens` is storage-layer only; `packages/contracts/src/history.ts` stays byte-identical and R3 asserts it. Surfacing it is deferred; owner: the operator, as a separate UI decision after the measure exists.
### Design
**WHAT.** Add `cache_write_tokens` to the rollup tables carrying token measures, add the missing duration sample counts, rename allocated token columns to `_alloc`, and add a schema test enforcing the additivity invariant.

**WHY.** ADR-106: aggregates store additive measures and the counts beside them; every derived variable — rate, ratio, mean — is computed at read time from that vector. A stored rate invites `AVG()` across buckets, which is wrong and looks plausible. This is what makes the vector composable: a new question becomes a `GROUP BY` over an existing table rather than a new rollup table.

**WHERE.** `packages/domain/src/migrations.ts` (DDL + migration), `packages/domain/src/analytics/history-board-rollup.ts` (derivation, readers at lines 379, 473-480, 484-500, 713+), `packages/app/src/services/history-board-service.ts` (readers), `packages/domain/tests/analytics/history-board-rollup.test.ts`.

**Cache write is not a hit.** It is the premium-billed cost of populating the cache. Folding it into a single cached figure makes a session that wrote a large cache and never reused it score as high cache-hit — precisely the pathology the metric should expose. Measured corpus mix: fresh=8.56B, cache_read=43.73B, cache_write=0.16B, output=0.16B; the aggregate correction is 0.8367 → 0.8336, 0.3%. **That is not the argument.** The argument is that cache write is unmeasurable at any grain today, and cache waste is a per-session and per-model pathology that averages to nothing globally.

**Frozen names and the exact column plan**

| Table | Add `cache_write_tokens` | Add duration sample count | `_alloc` rename |
| --- | --- | --- | --- |
| `history_daily_stats` | yes, `INTEGER NOT NULL DEFAULT 0` | yes — `assistant_duration_samples` | no |
| `history_board_message_5m` | yes, `INTEGER NOT NULL DEFAULT 0` | already has it | no |
| `history_board_session_stats` | yes, `INTEGER NOT NULL DEFAULT 0` | yes — `assistant_duration_samples` | no |
| `history_board_model_stats` | yes, `INTEGER NOT NULL DEFAULT 0` | already has it | no |
| `history_board_source_stats` | yes, `INTEGER NOT NULL DEFAULT 0` | no duration column — nothing to add | no |
| `history_board_source_daily` | yes, `INTEGER NOT NULL DEFAULT 0` | no duration column | no |
| `history_board_tool_5m` | yes, `cache_write_tokens_alloc REAL NOT NULL DEFAULT 0` | `calls` already serves `duration_ms` | yes — `fresh_input_tokens_alloc`, `cache_read_tokens_alloc`, `output_tokens_alloc` |
| `history_board_tool_stats` | yes, `cache_write_tokens_alloc` | `calls` already serves `duration_ms` | yes — same three names |
| `history_board_ranked_steps` | no — per-row ranking (R7) | no | no |
| `history_board_loop_findings` | no — findings table (R7) | no | no |
| `history_board_rollup_meta` | no — metadata (R7) | no | no |
| `history_board_skill_5m` | no — carries only `calls` | no | no |

`0031` is the current maximum migration prefix and `0032` is reserved by task 0748; this task takes the next free prefix in the feature's sequence, coordinated with tasks 0739, 0741, and 0743.

**Precedence and algorithm**

1. **Allocated measures take an `_alloc` suffix.** Tokens are a property of a message; on tool grain they are an attribution. Distinct names make it impossible to sum a measurement and an attribution under one column name by accident. `history_board_tool_stats` is included because its columns are `SUM()`s of `tool_5m`'s REAL allocations (`packages/domain/src/analytics/history-board-rollup.ts:473-480`) — the fact that it declares them INTEGER makes it *more* misleading, not less.
2. **Keep the `_alloc` columns REAL, including on `tool_stats`.** Truncating an allocation to INTEGER at every grain compounds; if `tool_stats` keeps INTEGER, its totals will not reconcile with `tool_5m`'s. Change the declared type in the same migration as the rename.
3. **Cache hit rate is `cache_read / (fresh + cache_read + cache_write)`**, computed at read time. Nothing stores it.
4. **A sample count may be an existing column.** `calls` is the sample count for `duration_ms` on both tool-grain tables. The additivity test asserts *a* count exists alongside every sum, not that it is always named `*_samples`.
5. **Storage layer only.** `cache_write_tokens` gains no response field, so `packages/contracts/src/history.ts` stays byte-identical and R3 / feature R11 hold. Surfacing it in the UI is a separate, later decision.

**Anti-patterns**

- **Do not sum `cache_write_tokens` into `cache_read_tokens`.** That is the exact pathology the split exists to expose.
- **Do not materialize a rate, ratio, percentage, or mean.** Not `cache_hit_rate`, not `mean_duration_ms`, not `error_rate`. R6 is checked by a column-name pattern test.
- **Do not add a field to `packages/contracts/src/history.ts`.** R3 is asserted byte-for-byte; a contract change here breaks feature R11 and the unchanged-UI constraint the whole feature was scoped under.
- **Do not touch `history_board_ranked_steps`, `history_board_loop_findings`, or `history_board_rollup_meta`.** R7 names them explicitly; the measure vector does not apply at per-row or metadata grain.
- **Do not leave `tool_stats` token columns INTEGER after the rename.** A rename that preserves the truncation renames the bug instead of fixing it.
- **Do not justify this task on latency.** It adds columns; it does not remove work from the read path.

**Handoff to dependents**

Task 0741 (incremental refresh engine) rebuilds these tables bucket-by-bucket and must populate every column in the table above — a bucket rebuild that leaves a new column at its DEFAULT is an additivity break the equivalence test in task 0742 will catch. Task 0743's `dimension_daily` and `kpi_window` marts carry the same vector with the same names, including the `_alloc` distinction. All names above are frozen; dependents must not introduce variants.

Authority: ADR-106; `docs/design/history-incremental-materialization.md` section 12 (D10).
### Plan
1. **R1 (cache write).** Add `cache_write_tokens` to the six measured-token tables and `cache_write_tokens_alloc` to the two tool-grain tables, per the column table in Design, via a migration with the next free four-digit prefix plus its `drizzle/` file. Test intent: assert the column exists at every listed grain and is never referenced in the same `SUM()` as `cache_read_tokens`.
2. **R4 (sample counts).** Add `assistant_duration_samples` to `history_daily_stats` and `history_board_session_stats`. Test intent: assert every materialized duration sum has a co-located count — including recognising `calls` as the count for the tool-grain `duration_ms` — so a mean is computable from the table alone.
3. **R5 (allocation naming).** Rename `history_board_tool_5m`'s three REAL token columns to `_alloc` names, rename and re-type `history_board_tool_stats`' three INTEGER token columns to REAL `_alloc` names, and update every reader. Test intent: assert no query sums an `_alloc` column together with a non-`_alloc` one — the silent double-count this requirement exists to prevent.
4. **Populate.** Extend the rollup derivation so every new column is written on a full rebuild, including the `cache_write_tokens` allocation on tool grain using the same allocation rule as the existing REAL columns.
5. **R2 (read-time rate).** Compute cache hit rate as `cache_read / (fresh + cache_read + cache_write)` wherever it is derived, from the stored vector.
6. **R6 + R7 (invariant test).** Add a schema test asserting no aggregate column name matches a rate/ratio/percentage/mean pattern, that every duration sum has a sample count, and that `history_board_ranked_steps`, `history_board_loop_findings`, `history_board_rollup_meta`, and `history_board_skill_5m` are byte-unchanged. Test intent: encode ADR-106 as a build failure so the next rollup table cannot reintroduce a stored rate.
7. **R3 (contract).** Assert `packages/contracts/src/history.ts` is byte-identical to its pre-change content.
8. Run the domain and app test suites plus `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- `docs/00_ADR.md` — ADR-106 (measure vector and additivity invariant)
- `docs/design/history-incremental-materialization.md` — section 12 (D10, six subsections)
- Board rollup DDL: `packages/domain/src/migrations.ts:419-630`; `assistant_duration_samples` at `packages/domain/src/migrations.ts:452` and `packages/domain/src/migrations.ts:516`; `history_board_tool_5m` REAL token columns at `packages/domain/src/migrations.ts:471-473`
- `history_board_tool_stats` derivation from REAL allocations into INTEGER: `packages/domain/src/analytics/history-board-rollup.ts:473-480`
- Contract that must not change: `packages/contracts/src/history.ts`
- Current max migration `0031_spur_cli_history_board_tool_stats_columns`; `0032` reserved by task 0748
- Dependents: task 0741 (must populate every new column per bucket), task 0742 (equivalence test catches unpopulated columns), task 0743 (marts carry the same vector)
### History
