---
schema_version: 1
name: Residuals from 1324
status: done
template: standard
created_at: 2026-11-10T22:53:01.911Z
updated_at: "2026-11-11T17:46:38.282Z"

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1328-verdict.json
---

## 1328. Residuals from 1324

### Background

Source task: 1324 (feature E6) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:4f4834b9 — packages/domain/src/analytics/forensic-query.ts:182: Class sweep: the R3 `poll-duplicate` exclusion misses the per-model/day rollup chain — `messageRollup` totals still sum assistant durations/samples over collapsed poll rows, and `history-board-rollup` feeds that into `history_board_model_stats`, which `readExecutorLatency` divides (`meanMs = assistant_duration_ms / samples`); poll rows receive derived durations from the duration backfill, so executor-latency means/samples for poll-heavy sources remain polluted. Primary R3 surfaces (bySession + both loops queries) are excluded and tested; this is the one remaining latency aggregator.

### Requirements

- [x] R1. `messageRollup`'s per-model/day latency aggregates (`assistantDurationMs`/`assistantDurationUnmeasured`/`assistantDurationSamples`) exclude `poll-duplicate` rows, so `history_board_model_stats` → `readExecutorLatency` means are not polluted by derived poll durations; token/cost sums (Q8 spend scope) unchanged.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Guard the three duration SUM cases with `disposition <> 'poll-duplicate'` in `messageRollup` (packages/domain/src/analytics/forensic-query.ts).
2. Regression test in packages/domain/tests/analytics/forensic-query.test.ts: duration aggregates exclude the poll row while token/message sums keep it.
3. `bun test tests/analytics/forensic-query.test.ts` green in packages/domain; fail-proof the test by stashing the src fix.

### Solution

- packages/domain/src/analytics/forensic-query.ts:186-189 (`messageRollup`): the `filtered` and `selected` CTEs now project `m.disposition`; the three assistant-duration SUM cases are guarded with `disposition <> 'poll-duplicate'` (column is NOT NULL, same predicate form as the 1324 R3 rollup queries). Token/cost/message sums untouched — the Q8 spend scope intentionally keeps collapsed poll rows.
- packages/domain/tests/analytics/forensic-query.test.ts:362: regression test co-located with the 0624 request-folding test.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/domain/tests/analytics/forensic-query.test.ts:362 — a poll row with derived duration 7000ms no longer inflates `assistantDurationMs`/`assistantDurationSamples` while token sums keep both rows; bun test in packages/domain: 32 pass / 0 fail, and the test fails with the src fix stashed |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 | No new findings introduced; 1324 R3's primary surfaces (bySession, both loops queries, tool joins) already excluded collapsed polls — this closes the last latency aggregator (`messageRollup` → `history_board_model_stats` → `readExecutorLatency`) with a predicate identical to the 1324 R3 forms. | Accepted — closed with the fix; no residual risk identified. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-11T17:43:41.672Z backlog → todo (system)
- 2026-11-11T17:43:42.013Z todo → wip (system)
- 2026-11-11T17:44:19.705Z wip → testing (system)
- 2026-11-11T17:46:38.238Z testing → done (system)

