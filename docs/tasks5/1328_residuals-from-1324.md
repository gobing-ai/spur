---
schema_version: 1
name: Residuals from 1324
status: backlog
template: standard
created_at: 2026-11-10T22:53:01.911Z
updated_at: "2026-11-10T22:53:02.063Z"

---

## 1328. Residuals from 1324

### Background

Source task: 1324 (feature E6) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:4f4834b9 — packages/domain/src/analytics/forensic-query.ts:182: Class sweep: the R3 `poll-duplicate` exclusion misses the per-model/day rollup chain — `messageRollup` totals still sum assistant durations/samples over collapsed poll rows, and `history-board-rollup` feeds that into `history_board_model_stats`, which `readExecutorLatency` divides (`meanMs = assistant_duration_ms / samples`); poll rows receive derived durations from the duration backfill, so executor-latency means/samples for poll-heavy sources remain polluted. Primary R3 surfaces (bySession + both loops queries) are excluded and tested; this is the one remaining latency aggregator.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
