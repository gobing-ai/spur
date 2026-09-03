---
schema_version: 1
name: "Assert incremental rollups equal a full rebuild"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.134Z
updated_at: "2026-09-03T17:45:46.893Z"
feature_id: E91
priority: P0
tags: ["history", "test", "correctness"]
dependencies: ["0741"]
---

## 0742. Assert incremental rollups equal a full rebuild

### Background
Task 0741 replaces one 43.9 s whole-corpus transaction with per-bucket delete-and-re-derive driven by an `imported_at` watermark. That is the highest-risk change in E91: an incremental aggregate that is subtly wrong produces plausible numbers that nobody notices, and the History board has no independent source of truth to check them against. The only cheap oracle available is the full rebuild that already exists — `replaceHistoryBoardRollups` at `packages/domain/src/analytics/history-board-rollup.ts:295` — so this task makes that oracle an automated assertion instead of a thing someone could run by hand.

Two structural facts shape what the assertion can claim. First, the twelve rollup tables truncated at `packages/domain/src/analytics/history-board-rollup.ts:297` do not all hold the same kind of number: `history_board_tool_5m`'s token columns are `REAL` because they are allocations of a message's tokens across the tool calls in that message, while `history_board_session_stats` and `history_board_model_stats` hold integer counts and sums. Task 0740 makes that distinction explicit by renaming allocated columns with an `_alloc` suffix and giving them `REAL` type. Exact equality is therefore the right assertion for integers and the wrong one for allocations, where floating-point summation order differs legitimately between a per-bucket build and a whole-corpus build.

Second, `history_board_rollup_meta` records `refreshed_at` as `new Date().toISOString()` at write time (`packages/domain/src/analytics/history-board-rollup.ts:602`), and 0741 adds `history_board_rollup_watermark` and `history_board_rollup_bucket` whose contents describe how the build ran rather than what it computed. These are bookkeeping, not measurements, and comparing them would fail every run for reasons that have nothing to do with correctness.
### Requirements
- [ ] R1. A corpus is imported in two increments; rollups are built incrementally across both and separately rebuilt in full from scratch.
- [ ] R2. Every integer measure in every `history_board_*` table is exactly equal between the two builds for a fixed filter matrix.
- [ ] R3. Every allocated real-valued measure agrees within a tolerance the test states explicitly.
- [ ] R4. Every dimension key present in one build is present in the other.
- [ ] R5. The equivalence assertion runs as an automated test, not a manual comparison.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R4 — Incremental rollups are byte-identical to a full rebuild
    Given a corpus imported in two increments
    When rollups are built incrementally across both increments and separately rebuilt in full from scratch
    Then every integer measure in every history_board_* table is exactly equal between the two builds for a fixed filter matrix
    And every allocated real-valued measure agrees within a declared tolerance that the test states explicitly
    And every dimension key present in one build is present in the other
    And the equivalence assertion runs as an automated test, not a manual comparison.


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:45:46.892Z

**Why fixtures rather than the real 4.2 GB corpus?** A test that takes 44 s per build and needs the operator's live database is a test nobody runs. Fixtures make the hard cases explicit and reproducible; the real-corpus measurement belongs to task 0745.

**Why is `history_board_ranked_steps` compared at all, given ranking ties?** Because task 0741 recomputes the global-ranked class in full on every refresh rather than incrementally, so both builds produce it by the identical code path and it is identical by construction. If that decision is ever reversed, tie-breaking becomes this test's problem and the reversal must add a deterministic total order to the ranking first.

**Why a relative rather than absolute tolerance for `_alloc`?** Absolute tolerance is meaningless across columns whose magnitudes differ by orders of magnitude — a 0.5-token slack is negligible on a 43-billion-token cache-read sum and enormous on a per-tool allocation.

**Deferred:** property-based generation of increment splits. Three named hard cases are enough to catch the failure modes the design predicts; randomized splitting is worth adding only if a real bug slips past them.
### Design
**WHAT.** An automated test that imports a fixture corpus in two increments, builds rollups incrementally across both, rebuilds them in full from scratch, and asserts the two results agree — exactly for integer measures, within a declared tolerance for allocated real measures, and on key sets in both directions.

**WHY.** R4's claim is that the incremental engine is a pure optimization. A claim of behavioural equivalence is only worth stating if something fails when it stops being true, and the only thing that can detect a wrong aggregate is a differently derived correct one.

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `packages/domain/tests/analytics/rollup-equivalence.test.ts` | test file | as named |
| `EQUIVALENCE_EXCLUDED_TABLES` | exported const, the bookkeeping tables not compared | same file |
| `ALLOC_TOLERANCE_RATIO` | exported const, relative tolerance for `_alloc` columns | same file |
| `snapshotRollupTables` | helper returning every compared table's rows keyed by primary key | same file |
| `diffRollupSnapshots` | helper returning per-table, per-column, per-key differences | same file |

**Which tables are compared, and how the set stays correct.** The compared set is derived from the same constant the refresh engine iterates, minus `EQUIVALENCE_EXCLUDED_TABLES`. It is never a second hand-written list: a hand-written list is exactly how a rollup table added later escapes the assertion without anyone noticing. `EQUIVALENCE_EXCLUDED_TABLES` contains `history_board_rollup_meta`, `history_board_rollup_watermark`, and `history_board_rollup_bucket`, and nothing else — each is excluded because it records how the build ran, not what it measured, and each exclusion carries that reason as a comment.

**Comparison precedence.**

1. Key sets first, in both directions. A key present in one build and absent from the other is reported as a missing or extra key, not as a value difference, because reporting it as a value difference makes the failure unreadable.
2. For keys present in both, integer columns are compared with exact equality. Any difference at all is a failure.
3. Columns whose name ends in `_alloc` are compared with the relative tolerance `ALLOC_TOLERANCE_RATIO`. The test states the tolerance as a named constant with a comment giving the reason — differing floating-point summation order between a per-bucket build and a whole-corpus build — so the number is a stated engineering decision rather than a value tuned until the test went green.
4. `NULL` and `0` are distinct values at every step. Task 0743 encodes not-applicable as `NULL`, so treating them as equal would hide the exact class of bug that encoding exists to prevent.

**Fixture shape.** The two increments must exercise the cases that make incremental refresh hard, not just the happy path: the second increment contains at least one row whose `ts` falls inside a bucket the first increment already materialized (backfill), at least one row the `MESSAGE_DEDUP` predicate at `packages/domain/src/analytics/history-board-rollup.ts:17` excludes, and at least one session that spans the boundary between the two increments. A fixture where increment two is strictly newer than increment one proves nothing, because it is the one case a naive `MAX(ts)` implementation also gets right.

**Anti-patterns — do not do these.**

- Do not compare only `history_board_session_stats`. The bug this test exists to catch is most likely in the keyed-aggregate class, which derives from bucketed tables rather than from raw.
- Do not hand-maintain the compared table list.
- Do not use exact equality on `_alloc` columns, and do not use tolerance on integer columns — a tolerance on an integer count hides an off-by-one.
- Do not tune `ALLOC_TOLERANCE_RATIO` upward until the test passes. If the observed drift exceeds a defensible tolerance, the allocation logic is wrong and the test is doing its job.
- Do not run this against the live 4.2 GB database. It is a fixture test with in-memory SQLite, matching the DAO test convention.

**Handoff to dependents.** Nothing in E91 consumes this task's output; it is a gate rather than a producer. It calls `refreshHistoryBoardRollupsIncremental` and `replaceHistoryBoardRollups` by those exact names, and it compares the `_alloc` column naming that task 0740 introduces, so both of those names must already exist when this test is written.

Authority: ADR-103, ADR-106; design sections 5 (D3) and 13 (D11).
### Plan
1. Build the two-increment fixture corpus in memory, covering backfill, a dedup-excluded row, and a session spanning the increment boundary. Test intent: each of the three hard cases is a named fixture case, so a later reader can see which one broke.
2. Add `snapshotRollupTables`, deriving the compared set from the refresh engine's own table constant minus `EQUIVALENCE_EXCLUDED_TABLES`. Test intent: adding a rollup table without adding an exclusion causes it to be compared automatically.
3. Add `diffRollupSnapshots` reporting missing keys, extra keys, and per-column differences separately. Test intent: a seeded difference of each of the three kinds produces a distinct, readable failure message.
4. Assert key-set equality in both directions before any value comparison. Test intent: a build missing an entire dimension key fails on the key set, not on a value.
5. Assert exact equality for integer columns and `ALLOC_TOLERANCE_RATIO` for `_alloc` columns, treating `NULL` and `0` as distinct. Test intent: a seeded off-by-one in a count fails; a seeded `NULL`-for-`0` substitution fails.
6. Wire the test into the standard `bun test` run from inside `packages/domain`. Test intent: the assertion runs in the normal gate, not as a manual step.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` sections 5 (D3), 13 (D11)
- ADR-103, ADR-106: `docs/00_ADR.md`
- Full-rebuild oracle and rollup table list: `packages/domain/src/analytics/history-board-rollup.ts:295`
- Dedup predicate the fixture must exercise: `packages/domain/src/analytics/history-board-rollup.ts:17`
- Non-deterministic bookkeeping timestamp: `packages/domain/src/analytics/history-board-rollup.ts:602`
- DAO test conventions and in-memory SQLite: `CLAUDE.md` build-and-verification section
### History
