---
schema_version: 1
name: "Automated rollup materialization and latency regression tests for History data plane"
status: todo
template: feature-impl
created_at: 2026-08-22T22:52:32.112Z
updated_at: "2026-08-22T23:21:13.154Z"
feature_id: E9
dependencies: ["0632"]
---

## 0633. Automated rollup materialization and latency regression tests for History data plane

### Background
The rollup refresh already has one correct production choke point: `HistoryService.analyze()` calls `refreshHistoryRollups(db)` after assembling the forensic artifact. `HistoryService.daily()` calls `analyze()`, and the `history.refresh` queue handler calls `daily()`. Adding direct refresh calls to daily or the queue consumer would run the same materialization twice.

The 11 read models are `history_daily_stats` plus ten `history_board_*` tables: message/tool 5-minute buckets, session/model/tool aggregates, loop findings, ranked steps, source totals/daily activity, and rollup metadata. On the 2026-08-22 local corpus they hold 1,295; 48,429; 60,218; 3,980; 77; 243; 6,502; 3,000; 8; 520; and 1 rows respectively. Zero rows can still be correct for a fixture with no matching loops or sources; freshness is metadata/version equality, not blanket non-emptiness.

Existing coverage is close but not sufficient for E9:

- `history-analysis-service.test.ts` already proves checkpoint-keyed refresh, unchanged no-op, stale fallback, and broad live/rollup equality. Reuse it.
- `history-refresh-service.test.ts` already proves the queue handler calls `daily()` exactly once. Reuse it; do not duplicate the consumer in a new test harness.
- `history-board-service.test.ts` times six calls over 500 raw messages but never calls `refreshHistoryRollups()`, includes `triggerImport` as if it were a data tab, measures one cold sample, and contains no skill invocation. It therefore cannot catch the 26-second fresh-Summary regression found in 0632.

This task closes the missing integration and performance evidence primarily in existing test files. Production code changes are allowed only if a new test exposes a real root-cause defect.
### Requirements
- [ ] R1. Prove the single refresh choke point: after `HistoryService.analyze()` on a seeded corpus, `historyBoardRollupsFresh(db)` is true, `history_board_rollup_meta.history_version` equals `historyBoardHistoryVersion(db)`, and every rollup table contains the fixture's expected aggregate (including legitimate zero counts). Keep `daily()` and `handleHistoryRefreshJob()` as composition paths; add no duplicate refresh call.
- [ ] R2. Replace the current one-shot raw-corpus benchmark with a fresh-rollup regression in `packages/app/tests/services/history-board-service.test.ts`: seed mixed sources/models/tools/skills, call `refreshHistoryRollups()`, warm each read once, then assert the median of five serial samples is under 50 ms for Summary in all four dimensions plus Timeline, Sessions, Insights, and Sources. Record fixture size in the test name/output; exclude `triggerImport` from the five-tab latency matrix.
- [ ] R3. Add a deterministic access-path assertion beside timing: fresh Summary/Sessions/Insights/Sources calls must not issue SQL against `history_message` or `history_tool_call`; Timeline is the documented indexed raw-read exception. Recursively assert all five tab responses omit keys matching cost/currency/dollar naming even though the seeded raw row contains `cost_usd`.
- [ ] R4. Re-run the same service reads against the current `.spur/spur.db` with the source-local TypeScript tree, record message/tool/rollup row counts and five-run medians, and require every tab path to remain below 50 ms. This is read-only verification evidence, not a committed test dependency on operator data and not a new CLI/script surface.
- [ ] R5. Run targeted tests first, then the canonical completion gates: `bun run autofix`, `bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, and `bun run corpus-check`. No skipped test, threshold waiver, or timing-only claim counts as PASS.

Out of scope: another scheduler/queue hook, a new benchmark package or public CLI flag, production metrics plumbing solely for tests, UI/contract changes, and a large generated corpus committed to the repository.
### Acceptance Criteria
```gherkin
Feature: Automated rollup materialization and latency regression tests for History data plane

  Scenario: Rollup Materialization During spur history analyze (R3)
    Given imported history whose checkpoint version is newer than the current rollup metadata
    When HistoryService.analyze completes directly, through daily, or through the history.refresh consumer
    Then the single analyze-owned refresh makes history_board_rollup_meta match the current history version
    And all 11 rollup tables contain the deterministic aggregates expected for that corpus without a duplicate refresh.

  Scenario: Performance Regression Tests (R5)
    Given mixed-source, mixed-model, tool-and-skill fixtures with fresh rollups
    When the Summary, Timeline, Sessions, Insights, and Sources service paths are warmed and sampled five times
    Then every median is below 50 ms, fresh materialized paths issue no raw-table query, Timeline uses its indexed raw path, and no Board response leaks currency fields
    And a read-only production-scale run records the same sub-50 ms result with corpus counts.
```
### Q&A
**Where does refresh belong?** Only in `HistoryService.analyze()`. `daily()` and the queue consumer already compose through it; direct calls there would duplicate expensive work.

**Why median-of-five after warm-up?** One cold `performance.now()` sample is dominated by setup and scheduler noise. Five serial samples are the smallest stable regression check that still reports a meaningful central value.

**Does the in-memory benchmark prove 1.7M-row performance?** No. It prevents local regressions and is paired with a deterministic no-raw-query assertion. The separate read-only `.spur/spur.db` run is the scale evidence and is recorded in Testing, not made a CI dependency.

**Must every rollup table be non-empty?** No. Empty loop/ranking/source results can be correct for a fixture. Assert exact expected rows plus version freshness, not `COUNT(*) > 0` everywhere.

**Is `triggerImport` a sixth performance endpoint?** It is a queue-dispatch action, not one of the five History data tabs. Its queue behavior already has dedicated tests and stays out of the read-latency matrix.
### Design
**Decision:** extend the existing service tests and keep `HistoryService.analyze()` as the only refresh owner. Reason: the production seams already exist; the defect is missing evidence, not missing architecture.

**Alternatives considered:**

| Option | Result | Reason |
| --- | --- | --- |
| Extend current test siblings | Chosen | Exercises the real service/DB seams with the smallest diff. |
| Add a benchmark framework/module | Rejected | One test-local median helper is enough; a new module has no production caller. |
| Add a public `history benchmark` verb | Rejected | Unneeded surface and behind the ADR-051 consent gate. |
| Refresh independently in analyze, daily, and queue | Rejected | Three owners create duplicate materialization and drift. |

**Integration proof:** add the direct analyze assertion to `packages/app/tests/services/history-service.test.ts`. Continue using `history-analysis-service.test.ts` for table replacement/idempotence and `history-refresh-service.test.ts` for queue-to-daily composition; edit those files only if the new proof exposes a gap.

**Latency proof:** modify the existing benchmark in `packages/app/tests/services/history-board-service.test.ts`. Seed at least one retained skill invocation (`tool_name` in `skill|use_skill|invoke_skill` with valid `args_raw`) plus a non-skill tool on the same message, refresh, assert freshness, warm, then time serial calls. Keep the median helper local to the test file. Capture SQL through the existing adapter method seam and fail if a materialized path touches raw history tables; do not add production instrumentation.

**Scale proof:** use a read-only `DbAdapter` over `.spur/spur.db` and the source-local `LiveHistoryBoardService`. Record the command, date, row counts, five samples, median, and machine context in Testing. The repository test remains hermetic and never assumes the operator database exists.

**Accounting boundary:** the fixture deliberately stores nonzero `cost_usd`; recursive key inspection proves the Board response omits currency. Do not remove forensic cost fields or change DTOs.

No ADR is required: this adds verification to existing seams and introduces no dependency, boundary, transport, store, or convention.

**Anti-patterns:** no second refresh owner; no one-sample timing assertion; no 1.7M-row CI fixture; no skipped “real DB” test; no triggerImport in tab latency; no timing claim without access-path proof; no public surface.

**Handoff:** depends on 0632's canonical skill allocation and fast fresh Summary path. This task is the final E9 verification owner and changes production code only for failures demonstrated by these checks.
### Plan
- [ ] Add a direct `HistoryService.analyze()` integration assertion for metadata/version equality and exact expected rows across the 11 rollup tables; reuse the existing daily and queue-composition tests as evidence (R1).
- [ ] Update the existing History Board fixture with mixed sources/models, a skill plus non-skill tool on one message, and nonzero raw `cost_usd`; refresh and assert freshness before measuring (R2, R3).
- [ ] Replace the one-shot six-call benchmark with warm-up plus five-sample medians for the five tabs/all Summary dimensions, and add the deterministic raw-table access guard plus recursive currency-key check (R2, R3).
- [ ] Run the two modified test files and any failing owning test first; fix production code only at the shared root-cause seam if a check fails (R1-R3).
- [ ] Run the read-only current-corpus benchmark through the source-local TypeScript service, recording counts, samples, medians, date, and environment in Testing (R4).
- [ ] Run `bun run autofix`, `bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, and `bun run corpus-check`; record all results and the final E9 scenario evidence (R5).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Architecture Document:** [docs/design/history-data-processing.md](file:///Users/robin/xprojects/spur-new/docs/design/history-data-processing.md)
- **Parent Feature:** [docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md](file:///Users/robin/xprojects/spur-new/docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md)
- **Preceding Tasks:** Task 0631 (Database indexing), Task 0632 (Rollup query routing)
### History
