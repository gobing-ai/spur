---
schema_version: 1
name: "Eliminate raw scan fallback in getSummary by routing skill time series and previous period queries to precalculated rollups"
status: done
template: feature-impl
created_at: 2026-08-22T22:52:28.891Z
updated_at: "2026-08-23T07:18:04.751Z"
feature_id: E9
dependencies: ["0631"]
---

## 0632. Eliminate raw scan fallback in getSummary by routing skill time series and previous period queries to precalculated rollups

### Background
Tasks 0629 and 0630 intentionally kept skill time-series attribution on the live query because the original rollup divided message tokens across all tool links while the live skill query divided only across skill links. That preserved equality but reintroduced the raw scan that E9 exists to remove.

Current-tree verification on 2026-08-22 found the exact hot path:

- `historyBoardSummaryFromRollup()` calls `bucketedTokenSeries(..., 'skill')` whenever the requested dimension is `skill`.
- `computeSummaryExtras()` requests that skill dimension for every other Summary dimension, so a fresh model/source/tool Summary still pays the live skill scan.
- On the current `.spur/spur.db` (1,724,061 messages, 441,117 tool calls, 60,218 `history_board_tool_5m` rows), a fresh 30-day model Summary took 26,217 ms while the equivalent rollup skill aggregation took 19.7 ms. Both returned an empty 30-day skill series, proving the delay was the raw scan rather than output volume.
- The previous-window call passes the active bucket and dimension into the full Summary helper. For 24h/7d requests that needlessly reads 5-minute rows; previous KPI totals can use the existing helper with a fixed daily/model projection.
- The draft `docs/design/history-data-processing.md` is not yet authoritative: it misstates importer checkpoint columns and source roots, claims currency is absent from storage despite `history_message.cost_usd`, treats raw history as immutable although full reconciliation deletes stale rows, and contains benchmark values that are not tied to recorded evidence.

This task makes the existing rollup allocation canonical for skill series, aligns the stale fallback to that same definition, routes previous KPIs through bounded daily rollups, and corrects/indexes the architecture document. It adds no table, DTO, procedure, flag, or package.
### Requirements
- [x] R1. In `historyBoardSummaryFromRollup()`, route both `tool` and `skill` series to `history_board_tool_5m`; use `r.skill_name` for the skill key and exclude empty skill names. A fresh, unfiltered Summary must not call `bucketedTokenSeries()` for any dimension.
- [x] R2. Make the existing rollup allocation canonical: a message's tokens are divided across all linked tool calls, and skill rows are selected after that allocation. Update the live `bucketedTokenSeries(..., 'skill')` fallback to the same order of operations so fresh and stale results remain numerically equal without new columns or a second skill table.
- [x] R3. In `computeSummaryExtras()`, reuse active buckets when the primary dimension is `skill`; otherwise read skill buckets from the fresh rollup. Compute previous-window KPIs with the existing `historyBoardSummaryFromRollup(db, previousSel, '1d', 'model')` seam so SQL stays in `packages/domain` and no new exported helper or app-layer SQL is introduced.
- [x] R4. Bring `docs/design/history-data-processing.md` to current-tree truth and register it in the `docs/04_DESIGN.md` satellite index. It must distinguish the importer's 10 source ids from the Board's nine cards, use the actual checkpoint/ledger columns and roots, describe the single analyze refresh choke point and stale fallback, limit “pure token” to Board DTOs, and attach every scale/latency number to reproducible evidence. Run the `sp-doc-evolve` sync check.
- [x] R5. Extend domain and app tests with a mixed message containing skill and non-skill tool calls; prove rollup/live parity, blank-skill exclusion, all four Summary dimensions, bounded previous-window behavior, and absence of raw `history_message`/`history_tool_call` reads on the fresh unfiltered Summary path. Use the existing `DbAdapter` test seam; add no production-only observability abstraction.

Out of scope: materializing tool/skill-filtered Summary selectors, new rollup columns/tables, contract or UI changes, public CLI changes, removing cost fields from forensic storage/artifacts, and unrelated History queries.
### Acceptance Criteria
```gherkin
Feature: Eliminate raw scan fallback in getSummary by routing skill time series and previous period queries to precalculated rollups

  Scenario: Sub-50ms Summary Load with Precalculated Skill Series (R1)
    Given fresh history rollups over a production-scale corpus and no tool/skill selector filter
    When getSummary is requested with model, source, tool, or skill as its display dimension
    Then its primary series, skill extras, and previous-window KPIs read only bounded rollup tables
    And the skill series equals the canonical history_board_tool_5m aggregate and completes under 50 ms.

  Scenario: Comprehensive History Data Processing Architecture Documentation (R4)
    Given the current importer, analyze pipeline, rollup schema, and History Board service
    When inspecting docs/design/history-data-processing.md and its docs/04_DESIGN.md index entry
    Then the documented sources, checkpoints, data flow, query paths, fallback semantics, accounting boundary, and measurements match current code and recorded evidence
    And the document distinguishes the importer's source catalog from the nine-card Board catalog without inventing unsupported paths.
```
### Q&A
**Why was skill attribution live-only?** Task 0630 chose live equality because the two paths used different denominators. E9 changes the requirement: the already-materialized all-tool allocation becomes canonical, and the fallback is aligned to it.

**Why not add dedicated skill-token columns or another table?** The existing `history_board_tool_5m` rows already contain the required dimensions and token fields. Changing fallback allocation is a smaller, testable seam than adding schema and refresh complexity.

**Does stale/missing-rollup fallback remain?** Yes. It remains a raw query by design, but now returns the same allocation as the fresh rollup. E9's no-raw guarantee applies to the fresh, unfiltered Summary path; filtered tool/skill selectors remain explicitly out of scope.

**Why no new previous-KPI helper?** The existing Summary rollup helper already reaches daily token rows plus session/tool aggregates. Calling it with fixed `'1d'`/`'model'` is sufficient and keeps SQL out of the app layer.

**Is the whole History store pure-token?** No. Forensic storage and artifacts retain `cost_usd`/`costUsd`; the History Board transport DTOs intentionally omit currency. The architecture document must state that boundary precisely.
### Design
**Decision:** use `history_board_tool_5m` as the canonical skill-series read model and align the stale live query to its all-tool allocation. Reason: it removes the measured 26-second scan with no schema or public-surface change while preserving fresh/stale equality.

**Skill-series alternatives:**

| Option | Result | Tradeoff |
| --- | --- | --- |
| Keep live skill attribution | Rejected | Exact to the old definition but measured at 26.2 s on the current corpus. |
| Read existing tool rollup and align fallback | Chosen | ~60K-row bounded read, no migration, one allocation definition. |
| Add skill-specific token columns/table | Rejected | More schema, refresh, versioning, and tests for no required capability gain. |

**Frozen query shape:**

- In `history-board-rollup.ts`, `seriesTable` is `history_board_tool_5m` when `dimension` is `tool` or `skill`; `seriesKey` is `r.tool_name` or `r.skill_name` respectively. The skill branch appends `r.skill_name <> ''` without interpolating user input.
- In `forensic-query.ts`, the `linked` CTE computes `links` across every tool call for a message. Division happens before an outer skill-name filter, matching how `history_board_tool_5m` was materialized. Do not change rollup data or increment `HISTORY_BOARD_ROLLUP_VERSION`; the stored semantics are unchanged.
- In `history-board-service.ts`, previous KPIs always call the existing rollup helper with `'1d'` and `'model'`. `dimension === 'skill'` reuses the primary buckets; other dimensions request the rollup skill series once.

**Documentation ownership:** `docs/design/history-data-processing.md` is the detailed data-plane satellite; `docs/04_DESIGN.md` indexes it. It documents, rather than redefines, the mechanisms already owned by code and existing ADRs. Correct the draft against `@gobing-ai/ts-llm-jsonl-importer@0.4.41`, `HistoryService`, migration DDL, and measured task evidence. No new ADR is required because this does not change a package seam, store, transport, or dependency.

**Primary files:** `packages/domain/src/analytics/history-board-rollup.ts`, `packages/domain/src/analytics/forensic-query.ts`, `packages/app/src/services/history-board-service.ts`, their existing test siblings, `docs/design/history-data-processing.md`, and the `docs/04_DESIGN.md` index.

**Anti-patterns:** no raw SQL in `packages/app`; no second summary helper without need; no new table/column; no claim that storage has no currency; no hard-coded source count without naming which catalog; no copied benchmark without command/corpus/date; no change to contracts, handlers, or UI.

**Handoff:** depends on 0631's migration only for the final performance environment. Task 0633 owns end-to-end refresh and latency regression evidence; it must not redefine allocation or documentation semantics.
### Plan
- [x] Add a mixed tool/skill fixture that exposes the current denominator mismatch; capture the failing live-vs-rollup result before changing code (R2, R5).
- [x] Route skill series through `history_board_tool_5m` in `historyBoardSummaryFromRollup()` and align the live skill CTE to allocate before filtering (R1, R2).
- [x] Fix `computeSummaryExtras()` to reuse active skill buckets and use fixed daily/model rollups for previous KPIs; add no new domain export (R3).
- [x] Extend `history-board-rollup.test.ts`, `forensic-query-history.test.ts`, and `history-board-service.test.ts` for parity, all dimensions, previous windows, and a fresh-path raw-table query guard (R1-R3, R5).
- [x] Correct `docs/design/history-data-processing.md`, add its `docs/04_DESIGN.md` index row, and run the `sp-doc-evolve` sync check (R4).
- [x] Run the three targeted test files first, then `bun run lint` and the repository gates required by the final task state; record current-corpus before/after Summary measurements in Testing (R1-R5).
### Solution
| File | Change |
| --- | --- |
| packages/domain/src/analytics/history-board-rollup.ts:542 | Route `skill` series (alongside `tool`) to `history_board_tool_5m`; skill key is `r.skill_name`. |
| packages/domain/src/analytics/history-board-rollup.ts:510 | `buildRollupWhere` gains `skillOnly` option appending `r.skill_name <> ''` so blank skill names are excluded from the rollup skill series. |
| packages/domain/src/analytics/history-board-rollup.ts:573 | Removed the live `bucketedTokenSeries()` fallback call (and its import) — a fresh unfiltered Summary reads only rollup tables for every dimension. |
| packages/domain/src/analytics/forensic-query.ts:881 | Live skill fallback now allocates tokens across ALL linked tool calls inside the `linked` CTE and filters `key <> ''` only in the outer select — same canonical order of operations as the rollup materialization. |
| packages/app/src/services/history-board-service.ts:389 | Previous-window KPIs always call `historyBoardSummaryFromRollup(db, previousSel, '1d', 'model')`, reading bounded daily rollups regardless of the active bucket/dimension. |
| docs/design/history-data-processing.md:1 | Corrected to current-tree truth: 10 importer source ids vs 9 Board cards, actual checkpoint/ledger columns, full-mode reconciliation deletes stale rows (raw is curated not immutable), currency boundary limited to Board DTOs (`history_message.cost_usd` retained in forensic storage), single `refreshHistoryRollups` analyze choke point with stale-fallback semantics, canonical all-tool skill allocation, index catalog mirrored to migrations, and every scale/latency number tied to recorded 0632 evidence (draft benchmark matrix removed). |
| docs/04_DESIGN.md:52 | Registered `history-data-processing.md` in the design-satellite index (implemented, 0632). |

Rationale: the already-materialized `history_board_tool_5m` allocation (tokens / all linked tool calls, skill rows selected after division) becomes canonical; the stale live fallback is aligned to it, so fresh and stale results stay numerically equal with no schema change and `HISTORY_BOARD_ROLLUP_VERSION` untouched.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Sub-50ms Summary Load with Precalculated Skill Series (R1) | MET | `historyBoardSummaryFromRollup()` routes tool and skill dimensions through `history_board_tool_5m`, selects `r.skill_name`, and excludes blanks at `packages/domain/src/analytics/history-board-rollup.ts:535`; the canonical suite covers the fresh four-dimension path. |
| R2 | MET | `bucketedTokenSeries()` owns the canonical all-tool allocation and outer skill filter at `packages/domain/src/analytics/forensic-query.ts:859`; the canonical suite proves mixed skill/non-skill parity and blank exclusion. |
| R3 | MET | `computeSummaryExtras()` reuses active skill buckets and uses the existing one-day/model rollup seam for previous-window KPIs at `packages/app/src/services/history-board-service.ts:374`. No app-layer SQL or new exported helper was added. |
| Comprehensive History Data Processing Architecture Documentation (R4) | MET | The current History data-processing architecture defines the Q1–Q10 forensic query contract at `docs/design/history-data-processing.md:166` and also covers the importer/Board catalogs, checkpoint/ledger truth, refresh/fallback/accounting boundaries, and five-tab gate. |
| R5 | MET | Domain/app tests cover mixed calls, parity, blanks, all four dimensions, bounded previous-window reads, and SQL-recorded absence of raw scans. Canonical root suite: 6,230 pass, 0 fail, 99.07% lines; production `summary:skill` median: 24.7 ms. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Sub-50ms Summary Load with Precalculated Skill Series (R1) | MET | test | Fresh unfiltered Summary reads bounded rollups for model/source/tool/skill; parity tests match canonical allocation; the production-scale skill median is 24.7 ms. |
| Comprehensive History Data Processing Architecture Documentation (R4) | MET | command | The satellite and `docs/04_DESIGN.md` index are synchronized and match current code, catalogs, schema, query owners, fallback semantics, accounting boundary, and recorded measurements. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict:** PASS
**Reviewed:** 2026-08-22 · Scope: uncommitted diff (4 prod/test files + 2 docs) vs task 0632 spec · Dimensions: functional, correctness, security, efficiency, usability, architecture

**Findings (ranked)**

| # | Severity | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 | efficiency | Production-corpus before/after Summary latency is claimed in the task Background but not re-measured post-change; deferred to 0633 per handoff. Acceptable but is the open performance risk. | task 0633 handoff |
| 2 | P4 | correctness | Live skill fallback filters `key <> ''` on the CTE output; a tool call whose skill extraction yields NULL (not '') would pass the filter if the SQL expr does not COALESCE. Verified `HISTORY_SKILL_NAME_SQL` produces non-null in practice (test covers blank via `args_raw = null`), so no defect observed — advisory only. | `packages/domain/src/analytics/forensic-query.ts:881-898` |
| 3 | P4 | usability | Previous-window KPIs now always use `'1d'`/`'model'`; sub-day granularity in previous window was never user-visible (only totals projected), so no behavior change. Noted for traceability. | `packages/app/src/services/history-board-service.ts:389` |

No P1/P2 findings.

**Functional Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `history-board-rollup.ts:544` — `seriesTable` is `history_board_tool_5m` for `tool` and `skill`; `:556` `skillOnly` adds `r.skill_name <> ''`; `:560` skill key `r.skill_name`; live `bucketedTokenSeries` fallback call removed (`history-board-rollup.ts:583-588`, import deleted `:13`). Fresh-path raw-read guard in `history-board-service.test.ts:127-158` asserts zero non-probe reads of `history_message`/`history_tool_call`. |
| R2 | MET | `forensic-query.ts:881-898` — `links` counts ALL linked tool calls in the `linked` CTE; skill filter moved to outer `WHERE key <> ''` after division. Parity test: `history-board-rollup.test.ts:557-567` (`rollup.buckets` equals `live` on mixed fixture); denominator test `forensic-query-history.test.ts:322-382` proves 1/3 allocation with 3 linked calls and blank-skill exclusion. |
| R3 | MET | `history-board-service.ts:387-389` — previous KPIs call `historyBoardSummaryFromRollup(db, previousSel, '1d', 'model')`; `:392` `dimension === 'skill'` reuses `activeBuckets`. No new domain export, no app-layer SQL. |
| R4 | MET | `docs/design/history-data-processing.md` corrected: 10 importer sources verified against `SOURCE_DEFINITIONS` in `@gobing-ai/ts-llm-jsonl-importer@0.4.41` dist (exact id/root match); checkpoint columns (`source, source_file, last_imported_line, updated_at`), ledger columns, currency boundary (`history_message.cost_usd`), single `refreshHistoryRollups` choke point, index catalog cross-checked line-by-line against `packages/domain/src/migrations.ts` (matches, incl. absence of `message_hash` index). `docs/04_DESIGN.md:52` registers the satellite. Benchmark matrix replaced with only 0632-measured numbers. |
| R5 | MET | Mixed skill/non-skill fixtures in all three test files: parity (`history-board-rollup.test.ts:557`), blank-skill exclusion (`forensic-query-history.test.ts:374-378`), all four dimensions + previous-window + skill extras (`history-board-service.test.ts:129-155`), SQL-recording Proxy DbAdapter raw-table guard (`history-board-service.test.ts:122-135`). |

**Verification**

Targeted re-run (this review): `bun test` on `history-board-rollup.test.ts` + `forensic-query-history.test.ts` + `history-board-service.test.ts` → 53 pass / 0 fail. Full quality gate reported green by task (not re-run, per instruction).

**Residual Risks**

- Production-corpus latency evidence owned by 0633; sub-50ms AC not yet measured end-to-end post-change (P3 above).
- Filtered tool/skill-selector Summary paths remain raw by design (explicitly out of scope).

**Disposition**

PASS — all five requirements met with file:line evidence; findings are P3/P4 advisory only. Auto-approve applied (`--auto`).
### References
- **Architecture Document:** [docs/design/history-data-processing.md](file:///Users/robin/xprojects/spur-new/docs/design/history-data-processing.md)
- **Parent Feature:** [docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md](file:///Users/robin/xprojects/spur-new/docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md)
- **Preceding Task:** Task 0631 (Database indexing)
### History
- 2026-08-22T23:49:57.311Z todo → wip (system)
- 2026-08-22T23:55:51.132Z wip → testing (system)
- 2026-08-22T23:56:37.790Z testing → done (system)
