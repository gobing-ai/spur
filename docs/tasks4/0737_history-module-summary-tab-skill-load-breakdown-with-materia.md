---
schema_version: 1
name: "History module Summary tab skill-load breakdown with materialized rollup"
status: backlog
template: standard
created_at: 2026-09-02T17:50:14.145Z
updated_at: "2026-09-02T17:52:42.845Z"
dependencies: ["0735", "0736"]
feature_id: L
---

## 0737. History module Summary tab skill-load breakdown with materialized rollup

### Background
The History module's Summary tab currently surfaces message/token/tool-call KPIs from the rollup tables. With `history_skill_call` populated (0735 + 0736), skill-load behavior becomes analyzable: which skills fire, on which agents, user-vs-model invoked, and how the fire-rate trends. The Summary tab needs a skill-load breakdown section, backed by a materialized rollup so scans over a multi-thousand-file corpus stay fast (the same performance rationale as the existing board rollups).
### Requirements
- [ ] R1. The History Summary tab adds a skill-load breakdown section: counts by `skill_name`, by `source` (agent), by `invocation_kind` (`user`/`model`), plus a trend series over the selected window (mirroring the existing KPI-trend/previous-window pattern).
- [ ] R2. A materialized rollup (table or view) `history_skill_rollup` keyed on `(source, skill_name, invocation_kind, bucket)` backs the section, maintained incrementally by the history analyze pipeline so Summary queries never scan `history_skill_call` directly.
- [ ] R3. Rollup freshness/staleness is surfaced the same way as existing board rollups (freshness check; stale rollup does not silently show empty).
- [ ] R4. The rollup supports full vs incremental rebuild and is idempotent under re-analyze.
- [ ] R5. Empty-state handling: no skill data → section hidden or "no skill activity" message; no crash.
- [ ] R6. Web UI: the Summary tab component renders the new section from the board/Summary service (computeSummaryExtras path).
- [ ] R7. Tests cover rollup aggregation correctness (per-key counting, bucket alignment) and UI rendering with sample data.
### Acceptance Criteria
- AC1: Summary tab shows the skill-load breakdown with correct per-skill / per-agent / per-invocation-kind counts for a seeded `history_skill_call` fixture.
- AC2: `history_skill_rollup` is rebuilt by `spur history analyze`; a re-analyze produces identical rollup rows (idempotent).
- AC3: A Summary query for a window reads the rollup, not `history_skill_call` (query plan / coverage assertion), and a large fixture returns within the existing board latency budget.
- AC4: With zero skill rows, the section renders the empty state without error.
- AC5: Rollup freshness is reported; stale rollup is flagged (not silent-empty).
- AC6: `spur task check 0737` passes.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Approach: follow the existing board-rollup pattern. `spur history analyze` already aggregates `history_tool_call`-derived KPIs into rollup tables; add a parallel `history_skill_rollup` aggregation keyed on `(source, skill_name, invocation_kind, bucket)`. The Summary service (`computeSummaryExtras` in packages/app/src/services/history-board-service.ts) gains a skill-series computation read from the rollup; the Summary tab component renders it.

Key tradeoffs:
- Materialized table over a live view: consistent with existing rollups, gives explicit freshness control, and keeps windowed aggregation off the detail table.
- Bucket granularity matches the board's existing bucket set so trend overlays reuse the same axis.

Impacted surfaces:
- `packages/app/src/services/history-board-service.ts` (summary extras)
- history analyze aggregation (rollup writer, e.g. packages/domain analytics)
- `apps/web` History Summary tab component
- rollup tests + UI fixture tests
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Depends on: 0735, 0736
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10
- Existing pattern: board rollups + `computeSummaryExtras` in `packages/app/src/services/history-board-service.ts`
### History
