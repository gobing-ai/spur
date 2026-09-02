---
schema_version: 1
name: "History module Summary tab skill-load breakdown with materialized rollup"
status: backlog
template: standard
created_at: 2026-09-02T17:50:14.145Z
updated_at: "2026-09-02T20:41:53.204Z"
dependencies: ["0735", "0736"]
feature_id: E9
---

## 0737. History module Summary tab skill-load breakdown with materialized rollup

### Background

The History module's Summary tab currently surfaces message/token/tool-call KPIs from the rollup tables. With `history_skill_call` populated (0735 + 0736), skill-load behavior becomes analyzable: which skills fire, on which agents, user-vs-model invoked, and how the fire-rate trends. The Summary tab needs a skill-load breakdown section, backed by a materialized rollup so scans over a multi-thousand-file corpus stay fast (the same performance rationale as the existing board rollups).

### Requirements

- [ ] R1. The History Summary tab adds a skill-load breakdown section: counts by `skill_name`, by `source` (agent), by `invocation_kind` (`user`/`model`), plus a trend series over the selected window (mirroring the existing KPI-trend/previous-window pattern).
- [ ] R2. A materialized rollup table `history_board_skill_5m` (named into the existing `history_board_*` family — renamed from the draft `history_skill_rollup`, see Q&A) keyed on `(bucket_start, source, skill_name, invocation_kind)` with a `calls` count backs the section. DDL lands in `packages/domain/src/migrations.ts` with the next four-digit migration prefix; the table is rebuilt by `replaceHistoryBoardRollups` (`packages/domain/src/analytics/history-board-rollup.ts:257`) from an extended `HistoryBoardRollupSeed` (:98) during `spur history analyze`, so Summary queries never scan `history_skill_call` directly.
- [ ] R3. Rollup freshness/staleness is surfaced through the existing mechanism — `history_board_rollup_meta` + `historyBoardRollupsFresh` (`history-board-rollup.ts:243`); a stale rollup is flagged, never silently empty.
- [ ] R4. Rebuild is full-replace within the freshness-gated analyze run (`history-analysis-service.ts:44,61`), idempotent under re-analyze, and the table joins the reset set in `packages/domain/src/analytics/history-reset.ts`. (The draft's "incremental rebuild" was corrected — the board pipeline is freshness-gated full replace; see Q&A.)
- [ ] R5. Empty-state handling: no skill data → section hidden or "no skill activity" message; no crash.
- [ ] R6. Web UI: the Summary tab component (`apps/web/src/modules/history/SummaryTab.tsx`) renders the new section from the board/Summary service (`computeSummaryExtras`, `packages/app/src/services/history-board-service.ts:510`).
- [ ] R7. Tests cover rollup aggregation correctness (per-key counting, bucket alignment) and UI rendering with sample data.

Out of scope: schema/extraction for `history_skill_call` (0735/0736), changes to other board tabs, oRPC contract shape changes beyond the additive Summary payload field.

### Acceptance Criteria

- AC1: Summary tab shows the skill-load breakdown with correct per-skill / per-agent / per-invocation-kind counts for a seeded `history_skill_call` fixture.
- AC2: `history_board_skill_5m` is rebuilt by `spur history analyze`; a re-analyze produces identical rollup rows (idempotent).
- AC3: A Summary query for a window reads `history_board_skill_5m`, not `history_skill_call` (query plan / coverage assertion), and a large fixture returns within the existing board latency budget.
- AC4: With zero skill rows, the section renders the empty state without error.
- AC5: Rollup freshness is reported via `history_board_rollup_meta` / `historyBoardRollupsFresh`; a stale rollup is flagged (not silent-empty).
- AC6: `spur task check 0737` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-02T20:41:53.021Z

- **Q: Rollup table name — `history_skill_rollup` or the `history_board_*` family?** A: `history_board_skill_5m`. Premise corrected during ready-depth refine: every existing rollup lives in the `history_board_*` family covered by `history_board_rollup_meta` freshness and `history-reset.ts`; a one-off `history_skill_rollup` would need parallel freshness/reset plumbing. R2 and AC2/AC3 updated.
- **Q: Incremental or full-replace rebuild?** A: Full-replace. The draft R2/R4 said "maintained incrementally / full vs incremental rebuild" — the actual analyze pipeline is freshness-gated full replace (`historyBoardRollupsFresh` at `history-analysis-service.ts:44`, `replaceHistoryBoardRollups` at :61). Idempotency is structural; R4 corrected.
- **Q: Does the Summary payload change break the oRPC contract?** A: No — the `skillBreakdown` field is additive; no existing field changes shape (R6, feature scope: no contract signature redesign).

### Design

Approach: follow the existing board-rollup pattern end to end. `spur history analyze` already aggregates typed history tables into the `history_board_*` rollup family via a freshness-gated full replace; add a parallel `history_board_skill_5m` aggregation keyed on `(bucket_start, source, skill_name, invocation_kind)`. The Summary service (`computeSummaryExtras` in `packages/app/src/services/history-board-service.ts:510`) gains a skill-series computation read from the rollup; `apps/web/src/modules/history/SummaryTab.tsx` renders it.

Frozen names (the contract — implement verbatim):

- Table: `history_board_skill_5m` — columns `bucket_start TEXT NOT NULL`, `source TEXT NOT NULL`, `skill_name TEXT NOT NULL`, `invocation_kind TEXT NOT NULL`, `calls INTEGER NOT NULL`, plus `PRIMARY KEY (bucket_start, source, skill_name, invocation_kind)`; index on `(skill_name, bucket_start)`.
- Seed: `HistoryBoardRollupSeed` (`history-board-rollup.ts:98`) gains `skill5m` rows; `replaceHistoryBoardRollups` (:257) deletes+inserts the new table inside the same transaction and the existing `history_board_rollup_meta` upsert (:554) covers freshness.
- Service: additive `skillBreakdown` field on the Summary extras payload produced by `computeSummaryExtras` (`history-board-service.ts:510`); consumed by `SummaryTab.tsx`.

Key tradeoffs:

- Materialized table over a live view: consistent with existing rollups, explicit freshness control, keeps windowed aggregation off the detail table.
- Bucket granularity matches the board's existing 5m bucket set so trend overlays reuse the same axis.
- Full-replace (not incremental) matches the analyze pipeline's existing semantics — idempotency is structural, freshness comes free via `rollup_meta`.

Anti-patterns (do NOT implement):

- No live SQL view and no direct scans of `history_skill_call` in the request path (defeats the rollup).
- No separate freshness table or meta row — reuse `history_board_rollup_meta`.
- No new bucket granularity and no changes to the other four tabs.
- No oRPC contract breakage — the Summary payload change is additive only.

Impacted surfaces:

- `packages/domain/src/migrations.ts` — new four-digit migration adding `history_board_skill_5m` (DDL per frozen names).
- `packages/domain/src/analytics/history-board-rollup.ts` — `HistoryBoardRollupSeed` extension + `replaceHistoryBoardRollups` insert + a `historyBoardSkillBreakdownFromRollup` reader (mirrors `historyBoardSourcesFromRollup` :1038).
- `packages/domain/src/analytics/history-reset.ts` — add the table to the reset set.
- `packages/app/src/services/history-analysis-service.ts:61` — extend seed construction with the skill aggregation query over `history_skill_call`.
- `packages/app/src/services/history-board-service.ts:510` — `computeSummaryExtras` skill series.
- `apps/web/src/modules/history/SummaryTab.tsx` — render the section (with R5 empty state).
- Tests: `packages/domain/tests/analytics/history-board-rollup.test.ts` (aggregation/idempotency), `packages/app/tests/services/history-board-service.test.ts` (latency + rollup-read assertion), UI fixture render.

Assumes from 0735/0736: populated `history_skill_call` with `(source, skill_name, invocation_kind, started_at)` available for bucketing. Leaves for dependents: none (terminal task in the chain).

### Plan

1. Migration (next four-digit prefix) in `packages/domain/src/migrations.ts` creating `history_board_skill_5m` per the frozen DDL — R2.
2. Extend `HistoryBoardRollupSeed` + `replaceHistoryBoardRollups` in `history-board-rollup.ts`; add the table to `history-reset.ts` — R2, R4.
3. Extend the seed construction in `history-analysis-service.ts` with the skill aggregation query over `history_skill_call` (bucket by `started_at` 5m floor) — R2, R4.
4. Domain tests: per-key counting, bucket alignment, re-analyze idempotency in `history-board-rollup.test.ts` — AC2, R7.
5. Add `historyBoardSkillBreakdownFromRollup` reader + wire `skillBreakdown` into `computeSummaryExtras` — R1, R6.
6. Service tests: rollup-read (not detail-scan) assertion + latency budget in `history-board-service.test.ts`; freshness flag behavior — AC3, AC5, R3.
7. Render the section in `SummaryTab.tsx` with the R5 empty state; UI fixture test — AC1, AC4, R7.
8. `spur task check 0737` — AC6.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Depends on: 0735 (schema), 0736 (populated rows)
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10
- Existing pattern: `history_board_*` rollups + `replaceHistoryBoardRollups` in `packages/domain/src/analytics/history-board-rollup.ts`; `computeSummaryExtras` in `packages/app/src/services/history-board-service.ts:510`; `apps/web/src/modules/history/SummaryTab.tsx`

### History
