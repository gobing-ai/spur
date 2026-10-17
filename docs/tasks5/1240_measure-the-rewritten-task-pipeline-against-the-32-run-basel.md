---
schema_version: 1
name: Measure the rewritten task-pipeline against the 32-run baseline
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-17T16:13:30.194Z"
feature_id: D65
priority: P2
tags:
  - measurement
  - task-pipeline
estimate_hours: 3

dependencies: ["1239"]
---

## 1240. Measure the rewritten task-pipeline against the 32-run baseline

### Background

Feature D65 P2 exit. Baseline (2026-10-16/17): 32 runs, 2550 min, driver overhead 815 min (32%), remediation ~450 min vs implement 356 min.

**Refine corrections (2026-10-17)**
- No corrections: `spur history analyze` supports --since/--until/--source/--session/--run/--task/--top/--out, enough for cross-agent per-stage figures.

### Requirements

- [ ] R1. Run at least three real tasks through the rewritten pipeline and collect run summaries.
- [ ] R2. Write a comparison report under docs/reports/ with per-stage time, driver overhead and gate time against the baseline, using `spur history` for cross-agent figures.
- [ ] R3. Report regressions as findings; do not tune the baseline.

### Acceptance Criteria

- [ ] AC1 — The rewritten task pipeline is measured against the baseline (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Measurement only; reuses run summaries (now with gate time) and `spur history analyze`. The report is the repeatable artifact.

### Plan

- [ ] Pick three todo tasks of differing size
- [ ] Run, collect summaries, write report

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History
