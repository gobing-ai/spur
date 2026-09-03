---
schema_version: 1
name: "History module Summary tab skill-load breakdown with materialized rollup"
status: done
template: standard
created_at: 2026-09-02T17:50:14.145Z
updated_at: "2026-09-03T04:52:12.433Z"
dependencies: ["0735", "0736"]
feature_id: E9
---

## 0737. History module Summary tab skill-load breakdown with materialized rollup

### Background

The History module's Summary tab currently surfaces message/token/tool-call KPIs from the rollup tables. With `history_skill_call` populated (0735 + 0736), skill-load behavior becomes analyzable: which skills fire, on which agents, user-vs-model invoked, and how the fire-rate trends. The Summary tab needs a skill-load breakdown section, backed by a materialized rollup so scans over a multi-thousand-file corpus stay fast (the same performance rationale as the existing board rollups).

### Requirements

- [x] R1. The History Summary tab adds a skill-load breakdown section: counts by `skill_name`, by `source` (agent), by `invocation_kind` (`user`/`model`), plus a trend series over the selected window (mirroring the existing KPI-trend/previous-window pattern).
- [x] R2. A materialized rollup table `history_board_skill_5m` (named into the existing `history_board_*` family — renamed from the draft `history_skill_rollup`, see Q&A) keyed on `(bucket_start, source, skill_name, invocation_kind)` with a `calls` count backs the section. DDL lands in `packages/domain/src/migrations.ts` with the next four-digit migration prefix; the table is rebuilt by `replaceHistoryBoardRollups` (`packages/domain/src/analytics/history-board-rollup.ts:257`) from an extended `HistoryBoardRollupSeed` (:98) during `spur history analyze`, so Summary queries never scan `history_skill_call` directly.
- [x] R3. Rollup freshness/staleness is surfaced through the existing mechanism — `history_board_rollup_meta` + `historyBoardRollupsFresh` (`history-board-rollup.ts:243`); a stale rollup is flagged, never silently empty.
- [x] R4. Rebuild is full-replace within the freshness-gated analyze run (`history-analysis-service.ts:44,61`), idempotent under re-analyze, and the table joins the reset set in `packages/domain/src/analytics/history-reset.ts`. (The draft's "incremental rebuild" was corrected — the board pipeline is freshness-gated full replace; see Q&A.)
- [x] R5. Empty-state handling: no skill data → section hidden or "no skill activity" message; no crash.
- [x] R6. Web UI: the Summary tab component (`apps/web/src/modules/history/SummaryTab.tsx`) renders the new section from the board/Summary service (`computeSummaryExtras`, `packages/app/src/services/history-board-service.ts:510`).
- [x] R7. Tests cover rollup aggregation correctness (per-key counting, bucket alignment) and UI rendering with sample data.

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
Implemented spur-side: the History Summary tab skill-load breakdown backed by a materialized rollup `history_board_skill_5m`, rebuilt during `spur history analyze` from `history_skill_call` (the 0736 extraction). No upstream importer change — the rollup is a Spur-domain/board concern over the new table.

**Rollup + migrations (domain/analytics):**

- packages/domain/src/analytics/history-board-rollup.ts:266 — `skillCallRollup(db)` aggregates `history_skill_call` by `(bucket_start, source, skill_name, invocation_kind)` into `HistoryBoardSkill5mRow` with a `calls` count; `:295` `replaceHistoryBoardRollups` full-replaces `history_board_skill_5m` within the freshness-gated analyze run (R2/R4); `:281` `historyBoardRollupsFresh` reuses the existing rollup-meta freshness mechanism (R3).
- packages/domain/src/analytics/history-board-rollup.ts:1121 — `historyBoardSkillBreakdownFromRollup` returns bySkill / bySource / byInvocationKind / trend; the bySkill and trend queries exclude empty + `'unknown'` skill names so bogus/unknown keys are never surfaced (R7).
- packages/domain/src/migrations.ts:608 — `CREATE TABLE IF NOT EXISTS history_board_skill_5m` with `(bucket_start, source, skill_name, invocation_kind)` key + `:616` `idx_history_board_skill_5m_skill_bucket` index; migration `0032_spur_cli_history_board_skill_5m` (:941) rebuilt via `applyCliMigrations` (R2).
- packages/domain/src/analytics/history-reset.ts:18 — added `history_board_skill_5m` to `HISTORY_RESET_TABLES` (derived data a re-analyze rebuilds) (R4).
- packages/domain/src/analytics/index.ts:136 — re-export `skillCallRollup` from the analytics barrel (R2).

**Service + contract (app/contracts):**

- packages/app/src/services/history-board-service.ts:514 — `computeSummaryExtras` reads the skill rollup and assembles the breakdown (`:564` `skillBreakdown`: bySkill / bySource / byInvocationKind / trend) plus `skillsUsed`; `skill` added to the board dimension/filter enum. **AC5 freshness:** the assembled `skillBreakdown` carries `fresh: !exact`, so the not-fresh (stale/never-analyzed) path surfaces an explicit non-fresh signal instead of a silent-empty "no skill activity" (R3/R5).
- packages/app/src/services/history-analysis-service.ts:44 — the analyze run rebuilds the skill rollup table alongside the existing board rollups (R4).
- packages/app/src/services/history-board-mock-service.ts:640 — mock data carries the new skill-breakdown payload (`fresh: true`) for UI dev/test.
- packages/contracts/src/history.ts:199 — additive Summary payload field `skillBreakdown` (`historySkillBreakdownSchema`, with `fresh: z.boolean().default(true)`), and `historyDimensionEnum` extended with `'skill'`; no breaking oRPC contract change (R6).

**Web UI (apps/web):**

- apps/web/src/modules/history/SummaryTab.tsx:315 — added the skill-load breakdown section: chart/table mode toggle, count-by-skill/source/invocation-kind, trend series over the selected window; `fresh: false` renders a "run history analyze to populate" state rather than silent-empty (R5/R6).
- apps/web/tests/modules/history/components.test.tsx — UI rendering test with sample skill-breakdown data (R7).

**Tests (domain/app/contracts):**

- packages/domain/tests/analytics/history-board-rollup.test.ts — rollup aggregation correctness: per-key counting, bucket alignment, skill-name normalization, breakdown selector honoring, and the empty/`'unknown'` bySkill + trend exclusion (R7).
- packages/app/tests/services/history-board-service.test.ts — service assembles the breakdown from the rollup, empty/no-crash handling, and an AC5 stale-path regression asserting `skillBreakdown.fresh === false` on a never-analyzed rollup (R6/R7).
- packages/contracts/tests/history-contract.test.ts — additive Summary contract shape (`fresh` default applies) (R6).

Design note: the rollup is rebuilt full-replace within the freshness-gated analyze run (corrected from the draft's "incremental" — the board pipeline is freshness-gated full replace per Q&A). Empty-state: `fresh: false` shows an explicit "pending analyze" state; `fresh: true` with zero rows hides/no-skill-activity (R5).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Summary tab skill-load breakdown: `apps/web/src/modules/history/SummaryTab.tsx:315` section (chart/table toggle across model/source/tool/skill); `packages/app/src/services/history-board-service.ts:564` `skillBreakdown` (bySkill/bySource/byInvocationKind/trend) assembled in `computeSummaryExtras` `packages/app/src/services/history-board-service.ts:514`. |
| R2 | MET | `history_board_skill_5m` DDL `packages/domain/src/migrations.ts:608` (static rollups schema) + migration `0032_spur_cli_history_board_skill_5m` `packages/domain/src/migrations.ts:941` via `HISTORY_BOARD_SKILL_5M_SCHEMA_SQL` `packages/domain/src/migrations.ts:638`; `skillCallRollup` `packages/domain/src/analytics/history-board-rollup.ts:266` groups `history_skill_call` by minute floor; `replaceHistoryBoardRollups` `packages/domain/src/analytics/history-board-rollup.ts:295` deletes+inserts the table. |
| R3 | MET | `historyBoardRollupsFresh` `packages/domain/src/analytics/history-board-rollup.ts:281` reused from the shared `history_board_rollup_meta`; freshness surfaced in `packages/app/src/services/history-board-service.ts:564` as `fresh: !exact` (flagged, never silent-empty). |
| R4 | MET | Full-replace within the freshness-gated analyze run (`replaceHistoryBoardRollups` `packages/domain/src/analytics/history-board-rollup.ts:295`; `packages/app/src/services/history-analysis-service.ts:44`); idempotent under re-analyze. `packages/domain/src/analytics/history-reset.ts:40` adds `history_board_skill_5m` to the reset set. |
| R5 | MET | Two empty states, no crash: `apps/web/src/modules/history/SummaryTab.tsx:1012` `fresh === false` → "run history analyze to populate"; the zero-rows fresh state renders "No skill activity recorded for this window." |
| R6 | MET | Service wires `skillBreakdown` (`packages/app/src/services/history-board-service.ts:564`) + `skill` dimension (`packages/contracts/src/history.ts:18`); oRPC payload additive `historySkillBreakdownSchema` (`packages/contracts/src/history.ts:126`) with `fresh` (`packages/contracts/src/history.ts:134`). No existing field reshaped. |
| R7 | MET | Rollup aggregation + UI tests pass: domain `packages/domain/tests/analytics/history-board-rollup.test.ts` (per-key count, bucket alignment, idempotency, empty/unknown exclusion), app `packages/app/tests/services/history-board-service.test.ts` (rollup-read assertion, empty, stale), contracts `packages/contracts/tests/history-contract.test.ts` (additive shape + fresh default), web `apps/web/tests/modules/history/components.test.tsx` (sample-data render). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/history-board-service.test.ts` (seeded `history_skill_call` → `skillBreakdown.bySkill`/`bySource`/`byInvocationKind` correct per counts); `SummaryTab` renders from sample data. |
| AC2 | MET | test | `packages/domain/tests/analytics/history-board-rollup.test.ts` — `replaceHistoryBoardRollups` materializes `history_board_skill_5m`; re-analyze produces identical rows (idempotent). |
| AC3 | MET | test | `packages/app/tests/services/history-board-service.test.ts` — "getSummary skillBreakdown reads history_board_skill_5m, not history_skill_call" + latency budget; `historyBoardSkillBreakdownFromRollup` `packages/domain/src/analytics/history-board-rollup.ts:1121` reads only `history_board_skill_5m`. |
| AC4 | MET | test | `packages/app/tests/services/history-board-service.test.ts` — zero skill rows → empty `skillBreakdown` (no crash); UI `apps/web/src/modules/history/SummaryTab.tsx` renders the empty state. |
| AC5 | MET | test | `packages/app/tests/services/history-board-service.test.ts` — stale/never-analyzed rollup → `skillBreakdown.fresh === false`; `packages/app/src/services/history-board-service.ts:564` `fresh: !exact` (not-fresh path surfaces explicit signal, not silent-empty). |
| AC6 | MET | command | `spur task check 0737` → PASS (exit 0, this run). |

Coverage: N/A (verdict-based; verify pipeline does not measure code coverage).
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | correctness | packages/app/src/services/history-board-service.ts:555 | Stale-rollup path served a silent-empty `skillBreakdown` (AC5). **Addressed:** the assembled `skillBreakdown` now carries `fresh: !exact`; the not-fresh (stale/never-analyzed) path rewrites to an explicit non-fresh signal so the Summary renders "run history analyze" instead of "no skill activity". |
| P3 | correctness | packages/domain/src/analytics/history-board-rollup.ts:1146 | `bySkill` rollup query surfaced empty/`unknown` skill names. **Addressed:** the query now excludes `r.skill_name <> '' AND r.skill_name <> 'unknown'`. |
| P3 | usability | packages/contracts/src/history.ts:198 | `skillBreakdown` is a required contract field (shape-change claim slightly overstated). All in-repo producers supply it; `fresh` was added additively with a default. No in-repo break. |

**Scope:** working-tree diff of the 0737 surfaces (domain/app/contracts/web + tests). **Dimensions:** functional, security, efficiency, correctness, usability, architecture. **Verdict:** PASS (all findings addressed in the remediation pass; re-gate/re-review/re-verify below).

**Functional Traceability.** R1-R7 all MET for the skill-breakdown section + materialized rollup: section render (SummaryTab.tsx), `skillCallRollup`/`replaceHistoryBoardRollups` (history-board-rollup.ts), migration `0032_spur_cli_history_board_skill_5m` (migrations.ts), freshness via shared `historyBoardRollupsFresh` (R3), reset-set inclusion (R4), empty/fresh-state handling (R5), service + contract wiring (R6), rollup/UI tests (R7).

**Acceptance Criteria.** AC1-AC4, AC6 MET; AC5 now MET via the explicit `fresh` signal (no silent-empty on a stale/never-analyzed rollup).

**Verification evidence (fresh):** `bun test packages/domain/tests/analytics/history-board-rollup.test.ts` → 39/0; `bun test packages/app/tests/services/history-board-service.test.ts` → 19/0; `bun test packages/contracts/tests/history-contract.test.ts` → 17/0; `bun test apps/web/tests/modules/history/components.test.tsx` → 24/0; typechecks clean; `spur task check 0737` → PASS.

**Architecture.** Follows the existing `history_board_*` rollup pattern end to end — materialized table, shared `rollup_meta` freshness, reset-set inclusion, minute-floor materialization re-bucketed at read. No new abstraction introduced; the additive `skillBreakdown` field and domain reader mirror existing readers.
### References

- Depends on: 0735 (schema), 0736 (populated rows)
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10
- Existing pattern: `history_board_*` rollups + `replaceHistoryBoardRollups` in `packages/domain/src/analytics/history-board-rollup.ts`; `computeSummaryExtras` in `packages/app/src/services/history-board-service.ts:510`; `apps/web/src/modules/history/SummaryTab.tsx`

### History

- 2026-09-03T04:21:41.403Z backlog → wip (system)
- 2026-09-03T04:51:45.932Z wip → testing (system)
- 2026-09-03T04:51:53.322Z testing → done (system)
