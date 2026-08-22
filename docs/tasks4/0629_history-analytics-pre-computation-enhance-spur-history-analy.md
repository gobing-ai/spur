---
schema_version: 1
name: "History analytics pre-computation: enhance spur history analyze and import pipeline"
status: done
template: feature-impl
created_at: 2026-08-21T23:13:31.955Z
updated_at: "2026-08-22T06:13:22.650Z"
feature_id: E8
dependencies: ["0628"]
---

## 0629. History analytics pre-computation: enhance spur history analyze and import pipeline

### Background
Complex forensic analytics (loop detection, cache-waste scoring, latency ranking, 90-day daily token
matrices) over thousands of raw execution steps can be CPU-intensive at query time. This task exists
to make the History board load instantly if — and only if — measurement shows the live queries
cannot.

**Premise corrections (refine, `--depth ready`).** Three assumptions in the earlier draft do not hold
against the current tree:

1. **The forensic analyzers already exist.** `packages/domain/src/analytics/forensic-query.ts`
   implements loop detection (`loops()`, args-digest repeated ≥ 3), cache-waste scoring
   (`cacheWasteAggregate()`, `topCacheWasteSteps()`, `CACHE_WASTE_MIN_INPUT_TOKENS`,
   `CACHE_WASTE_MAX_REUSE_FRACTION`), and step-latency profiling (`topStepsByDuration()`,
   `topStepsByTokens()`). `analytics/artifact.ts` already types the results as `LoopFinding`,
   `CacheWasteStat`, `StepStat`, `SessionStat`, `ToolStat`, `ForensicTotals`. This task must not
   re-implement any of them.
2. **Most of the proposed CLI flags already exist.** `spur history analyze` today accepts `--since`,
   `--until`, `--source`, `--session`, `--run`, `--task`, `--top`, `--out`, `--json`
   (`apps/cli/src/commands/history.ts:130`). `--agent <id>` is the existing `--source`. Only
   `--mode <quick|full>` is genuinely new — and a new public CLI flag is an **ADR-051 consent gate**
   requiring explicit operator sign-off before it can land.
3. **Import already chains into analysis.** `HistoryService.daily()`
   (`packages/app/src/services/history-service.ts:517`) runs `importAll()` → `analyze()` → artifact
   write → optional render, and `spur history daily` exposes it. A separate "wire incremental
   background analysis into `spur history import`" would duplicate it.

What remains genuinely open is **materialization**: whether the board's queries need pre-aggregated
rollup tables, or whether 0628's indexed live queries already hold the <50 ms bound. That is an
evidence question, and 0628 R5 produces the evidence.
### Requirements
- [x] R1. **Measurement gate first**: Read 0628's recorded benchmark (per-endpoint latency + seeded corpus size) and re-run it against the largest real corpus available via a **source-local binary** (`bun run apps/cli/src/index.ts …` or the built `apps/cli/spur.js` — never a global `spur`; record the provenance header). Write the numbers into this task's Testing section. If every endpoint holds under 50 ms at realistic corpus size, close R2–R4 as **not needed** with the evidence and stop — that is a valid completion of this task, not a failure.
- [x] R2. **Materialized rollups, only for the endpoints R1 shows are too slow**: Add a `_spur_cli_` migration in `packages/domain/src/migrations.ts` plus `drizzle/<max(prefix)+1>_*.sql` creating only the rollup tables R1 justifies — candidate `history_daily_stats(source, day, fresh_input_tokens, cache_read_tokens, output_tokens, tool_calls, sessions)` for the 90-day heatmap. Each table added must name the endpoint and the measured latency that justified it.
- [x] R3. **Rollup builder reusing the existing analyzers**: Implement the rollup refresh in `packages/app/src/services/history-analysis-service.ts` by calling the existing `messageRollup()` / `toolRollup()` / `loops()` / `topStepsByDuration()` / `cacheWasteAggregate()` from `@gobing-ai/spur-domain`. Refresh is **incremental and idempotent** — keyed on the import checkpoint so re-running over an unchanged corpus is a no-op — and `LiveHistoryBoardService` reads the rollup when present and falls back to the live query when it is stale or absent.
- [x] R4. **Wire into the existing analyze path, add no new CLI flag**: Invoke the rollup refresh from `HistoryService.analyze()` so `spur history analyze`, `spur history daily`, and the board's `history.triggerImport` all refresh with no surface change. `--mode <quick|full>` and `--agent <id>` are **not** added — see Q&A; `--agent` duplicates the existing `--source`, and `--mode` needs operator consent under ADR-051.
- [x] R5. **Tests**: unit tests for the rollup builder (incrementality, idempotence, staleness fallback) and integration tests proving rollup-backed and live-query results are numerically identical on the same fixture corpus. Any endpoint left on the live path keeps its 0628 benchmark as its evidence.

**Out of scope:** web UI (0626), contract changes (0627), the base query layer and its indexes (0628), any new or renamed public CLI flag.
### Acceptance Criteria
```gherkin
Feature: History Board module: Analytics Summary, Execution Timeline, Sessions, Forensic Insights, and Agent Sources Registry

  Scenario: oRPC contracts and DB query performance
    Given client requests to History oRPC endpoints
    When queries for summary, timeline, sessions, insights, or sources are dispatched
    Then responses are returned within <50ms without blocking the server event loop
    And zero dollar/currency cost fields exist in the DTO schema (pure token accounting)
```
### Q&A
- **`--mode <quick|full>` on `spur history analyze`** → **not added in this task; blocked on operator consent.** It is a new public CLI surface, and AGENTS.md § "Adding a script/command" (ADR-051, amended 2026-08-20) requires explicit operator consent with design context before any noun/verb/flag change lands. Open question for the operator: *is a `--mode quick|full` split on `history analyze` wanted, or should the rollup refresh always run?* Default taken here: always refresh, no flag — the refresh is incremental and a no-op on an unchanged corpus, so a "quick" mode saves little.
- **`--agent <id>`** → **not added; it duplicates the existing `--source`.** `spur history analyze` already accepts `--source` (`apps/cli/src/commands/history.ts:136`), which is the same axis under the name every other history verb uses.
- **`--since` / `--json`** → **already exist** (`apps/cli/src/commands/history.ts:134,142`). The original R1 listed them as new.
- **Re-implementing loop / cache-waste / latency analyzers** → **rejected; call the existing exports.** `packages/domain/src/analytics/forensic-query.ts` already ships `loops()` (args digest ≥ 3), `cacheWasteAggregate()` / `topCacheWasteSteps()` with tuned thresholds, and `topStepsByDuration()` / `topStepsByTokens()`, all typed in `analytics/artifact.ts`. A second implementation would silently diverge from `spur history report --mode forensics`.
- **"Wire incremental background analysis into `spur history import`"** → **redundant.** `HistoryService.daily()` (`history-service.ts:517`) already chains `importAll()` → `analyze()`. Hooking the refresh into `analyze()` covers `analyze`, `daily`, and the board's `triggerImport` with one call site.
- **`history_daily_stats` / `history_loop_findings` / `history_slow_steps` as a given** → **conditional on measurement.** Only tables that a recorded >50 ms endpoint latency justifies get created. Rollups cost write throughput on the already-slow import path and add a staleness class; "evidence before optimization" applies. R1 completing with zero new tables is a valid outcome.
- **Where new tables live** → `packages/domain/src/migrations.ts` `_spur_cli_` increment + `drizzle/<max(prefix)+1>_*.sql`, not `packages/domain/src/schema/history.ts` (which does not exist — history DDL ships from the importer package).
### Design
**WHAT** — conditional pre-computation for the History board. **WHY** — only if measurement shows the
live queries miss the <50 ms bound; an unmeasured rollup table is write-path cost with no proven
read-path benefit. **WHERE** — `packages/app/src/services/`, `packages/domain/src/migrations.ts`,
`drizzle/`.

**Frozen paths — corrected against the current tree.**

| Wrong | Correct | Evidence |
| --- | --- | --- |
| `packages/app/src/services/history/historyAnalysisService.ts` | `packages/app/src/services/history-analysis-service.ts` | `services/` is flat kebab-case — `history-service.ts`, `history-refresh-service.ts`, `feature-service.ts`, `task-check.ts` |
| `packages/domain/src/schema/history.ts` (new tables) | `packages/domain/src/migrations.ts` `_spur_cli_` increment + `drizzle/<max+1>_*.sql` | `schema/` has no history file; history tables come from `HISTORY_IMPORT_SCHEMA_SQL` in `@gobing-ai/ts-llm-jsonl-importer` and Spur-owned additions follow the `history_run_session` precedent |
| implement loop / cache-waste / slow-step analyzers | **call** `loops()`, `cacheWasteAggregate()`, `topCacheWasteSteps()`, `topStepsByDuration()`, `topStepsByTokens()` from `@gobing-ai/spur-domain` | all already exported from `packages/domain/src/analytics/index.ts` |
| add `--mode <quick\|full>` and `--agent <id>` to `spur history analyze` | add **no** flag | `--since`, `--until`, `--source`, `--session`, `--run`, `--task`, `--top`, `--out`, `--json` already exist at `apps/cli/src/commands/history.ts:130`; `--agent` duplicates `--source`; `--mode` is a new public surface behind the ADR-051 consent gate |
| new "incremental background analysis" hook on `spur history import` | refresh from `HistoryService.analyze()` | `HistoryService.daily()` (`history-service.ts:517`) already chains `importAll()` → `analyze()` → artifact write, so hooking `analyze()` covers `analyze`, `daily`, and `history.triggerImport` at once |

**Evidence-before-optimization is the shape of this task.** R1 is a gate, not a preliminary: if the
0628 indexed queries hold under 50 ms at realistic corpus size, this task completes with a recorded
measurement and no schema change. Adding rollup tables costs write throughput on `spur history
import`, already the slowest path in the corpus, and introduces a staleness class that does not exist
today.

**Candidate rollup shape** (only if R1 justifies it) — the 90-day heatmap is the strongest candidate
because it scans the whole corpus by definition while every other endpoint is range-bounded:

```sql
CREATE TABLE IF NOT EXISTS history_daily_stats (
    source TEXT NOT NULL, day TEXT NOT NULL,
    fresh_input_tokens INTEGER, cache_read_tokens INTEGER, output_tokens INTEGER,
    tool_calls INTEGER, sessions INTEGER,
    refreshed_at TEXT NOT NULL,
    PRIMARY KEY (source, day)
);
```

**Refresh contract (frozen).** `refreshHistoryRollups(db, { since })` in
`history-analysis-service.ts`: derives rows by calling the existing analytics functions, upserts by
primary key, and is a no-op when the import checkpoint has not advanced. Idempotent — running it
twice over an unchanged corpus produces byte-identical rows. `LiveHistoryBoardService` reads the
rollup when `refreshed_at` is at or after the latest `history_message.ts` it would cover, and falls
back to the live query otherwise. **Deterministic over implicit:** the fallback is a visible,
tested branch, never a silent recompute.

**Anti-patterns:** no new CLI flag or renamed flag; no re-implementation of an analyzer that
`analytics/` already exports; no rollup table without a recorded latency justifying it; no rollup
read path without a staleness fallback; no `schema/history.ts`; no touching
`drizzle/_legacy_reference/`.

**Real-data validation contract (AGENTS.md).** Any `spur history import` / `analyze` run producing
evidence for R1 uses a source-local binary — `bun run apps/cli/src/index.ts …` or the built
`apps/cli/spur.js` — never a bare global `spur`, and the provenance header (`binary:` + resolved
`@gobing-ai/ts-llm-jsonl-importer@<version>`) is recorded in the transcript before each run.

**Handoff:** depends on 0628 having landed the live queries, their indexes, and the recorded
benchmark. Leaves nothing for a dependent task; E8's board is complete when this closes.
### Plan
- [x] Read 0628's recorded per-endpoint benchmark and corpus size; re-measure against the largest real corpus using a source-local binary, recording the provenance header and the numbers in Testing (R1)
- [x] Decide per endpoint: holds under 50 ms → close as not-needed with evidence; misses → carry into R2. Record the decision and its number for every endpoint (R1)
- [x] For each endpoint that missed, add its rollup table via a `_spur_cli_` increment in `packages/domain/src/migrations.ts` + `drizzle/<max+1>_*.sql`, naming the endpoint and latency in the migration comment (R2)
- [x] Implement `refreshHistoryRollups()` in `packages/app/src/services/history-analysis-service.ts` by calling the existing `messageRollup` / `toolRollup` / `loops` / `topStepsByDuration` / `cacheWasteAggregate` exports — incremental, checkpoint-keyed, idempotent (R3)
- [x] Add the staleness-aware read path to `LiveHistoryBoardService`: rollup when fresh, live query otherwise, as an explicit tested branch (R3)
- [x] Invoke `refreshHistoryRollups()` from `HistoryService.analyze()` so `analyze`, `daily`, and `history.triggerImport` all refresh with no CLI surface change (R4)
- [x] Add unit tests (incrementality, idempotence, staleness fallback) and integration tests proving rollup-backed and live results are numerically identical on one fixture corpus (R5)
- [x] Re-run the benchmark post-materialization and record before/after in Testing; run `bun run lint`, `bun run test`, `bun run spur-check` (R1, R5)
### Solution
#### Seams touched

- `packages/domain/src/migrations.ts:351-365` — `HISTORY_BOARD_ROLLUPS_SCHEMA_SQL` adds only the four read models justified by real latency.
- `packages/domain/src/analytics/history-board-rollup.ts:30-41` — `HISTORY_BOARD_ROLLUP_VERSION` makes freshness sensitive to projection semantics.
- `packages/domain/src/analytics/history-board-rollup.ts:172-190` — `replaceHistoryBoardRollups` atomically replaces checkpoint-keyed projections.
- `packages/app/src/services/history-analysis-service.ts:39-58` — `refreshHistoryRollups` reuses the existing forensic analyzers and no-ops on an unchanged corpus.
- `packages/app/src/services/history-service.ts:518-524` — `refreshHistoryRollups` runs from the existing analyze path without a public CLI change.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Source-local provenance was apps/cli/src/index.ts with importer 0.4.41; the 1,704,022-message pre-rollup benchmark measured Summary 27,019.49 ms, Timeline 61.42 ms, Sessions 2,648.62 ms, Insights 12,477.92 ms, Sources 5,453.31 ms, and trigger 0.05 ms. |
| R2 | MET | `packages/domain/src/migrations.ts:351-365`; only measured Summary, Sessions, Insights, and Sources read models were added; Timeline stays live. |
| R3 | MET | `packages/app/tests/services/history-analysis-service.test.ts:207-306`; refresh, unchanged no-op, stale fallback, and live/materialized equality pass. |
| R4 | MET | `packages/app/src/services/history-service.ts:518-540`; the existing analyze path refreshes projections with no public surface change. |
| R5 | MET | `packages/app/tests/services/history-analysis-service.test.ts:207-306`; builder and integration coverage pass in the 134-test matrix. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| oRPC contracts and DB query performance | MET | command | Five real runs put every endpoint below 50 ms, with a 37.89 ms worst case over 1,704,022 messages, and pure-token checks passed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | Performance | Real live Summary, Sessions, Insights, and Sources missed 50 ms by large margins; measured rollups reduce the worst endpoint to 37.89 ms. | FIXED |
| P2 | Freshness | Checkpoint-only freshness could accept projections built under older semantics; a versioned checkpoint invalidates them deterministically. | FIXED |
| P3 | Scope | Timeline remains on its measured indexed live path; no unneeded rollup or public CLI flag was added. | PASS |
| P4 | Equality | Fixture tests prove fresh rollups equal live projections and stale/unsupported filters fall back safely. | PASS |
### References
- Feature: [E8: History Board module](file:///Users/robin/xprojects/spur-new/docs/features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- Design Spec: [docs/design/history-board-module.md](file:///Users/robin/xprojects/spur-new/docs/design/history-board-module.md)
- Prototype Assets: [docs/design/prototypes/history-module/](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/)
    - HTML: [spur-board-history.html](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/spur-board-history.html)
    - CSS: [history.css](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history.css)
    - App logic: [history-app.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-app.js)
    - Chart renderers: [history-charts.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-charts.js)
    - Data models: [history-data.js](file:///Users/robin/xprojects/spur-new/docs/design/prototypes/history-module/history-data.js)
### History
- 2026-08-22T03:40:49.296Z todo → wip (system)
- 2026-08-22T03:42:10.512Z wip → done (system)
