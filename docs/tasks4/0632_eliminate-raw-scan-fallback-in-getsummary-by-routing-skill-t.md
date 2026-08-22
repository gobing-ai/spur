---
schema_version: 1
name: "Eliminate raw scan fallback in getSummary by routing skill time series and previous period queries to precalculated rollups"
status: todo
template: feature-impl
created_at: 2026-08-22T22:52:28.891Z
updated_at: "2026-08-22T23:21:07.776Z"
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
- [ ] R1. In `historyBoardSummaryFromRollup()`, route both `tool` and `skill` series to `history_board_tool_5m`; use `r.skill_name` for the skill key and exclude empty skill names. A fresh, unfiltered Summary must not call `bucketedTokenSeries()` for any dimension.
- [ ] R2. Make the existing rollup allocation canonical: a message's tokens are divided across all linked tool calls, and skill rows are selected after that allocation. Update the live `bucketedTokenSeries(..., 'skill')` fallback to the same order of operations so fresh and stale results remain numerically equal without new columns or a second skill table.
- [ ] R3. In `computeSummaryExtras()`, reuse active buckets when the primary dimension is `skill`; otherwise read skill buckets from the fresh rollup. Compute previous-window KPIs with the existing `historyBoardSummaryFromRollup(db, previousSel, '1d', 'model')` seam so SQL stays in `packages/domain` and no new exported helper or app-layer SQL is introduced.
- [ ] R4. Bring `docs/design/history-data-processing.md` to current-tree truth and register it in the `docs/04_DESIGN.md` satellite index. It must distinguish the importer's 10 source ids from the Board's nine cards, use the actual checkpoint/ledger columns and roots, describe the single analyze refresh choke point and stale fallback, limit “pure token” to Board DTOs, and attach every scale/latency number to reproducible evidence. Run the `sp-doc-evolve` sync check.
- [ ] R5. Extend domain and app tests with a mixed message containing skill and non-skill tool calls; prove rollup/live parity, blank-skill exclusion, all four Summary dimensions, bounded previous-window behavior, and absence of raw `history_message`/`history_tool_call` reads on the fresh unfiltered Summary path. Use the existing `DbAdapter` test seam; add no production-only observability abstraction.

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
- [ ] Add a mixed tool/skill fixture that exposes the current denominator mismatch; capture the failing live-vs-rollup result before changing code (R2, R5).
- [ ] Route skill series through `history_board_tool_5m` in `historyBoardSummaryFromRollup()` and align the live skill CTE to allocate before filtering (R1, R2).
- [ ] Fix `computeSummaryExtras()` to reuse active skill buckets and use fixed daily/model rollups for previous KPIs; add no new domain export (R3).
- [ ] Extend `history-board-rollup.test.ts`, `forensic-query-history.test.ts`, and `history-board-service.test.ts` for parity, all dimensions, previous windows, and a fresh-path raw-table query guard (R1-R3, R5).
- [ ] Correct `docs/design/history-data-processing.md`, add its `docs/04_DESIGN.md` index row, and run the `sp-doc-evolve` sync check (R4).
- [ ] Run the three targeted test files first, then `bun run lint` and the repository gates required by the final task state; record current-corpus before/after Summary measurements in Testing (R1-R5).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Architecture Document:** [docs/design/history-data-processing.md](file:///Users/robin/xprojects/spur-new/docs/design/history-data-processing.md)
- **Parent Feature:** [docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md](file:///Users/robin/xprojects/spur-new/docs/features/E9_history-plane-performance-optimization-precalculated-rollup-tables-database-indexing-and-data-processing-architecture.md)
- **Preceding Task:** Task 0631 (Database indexing)
### History
