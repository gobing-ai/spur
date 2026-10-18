---
schema_version: 1
name: Measure the rewritten task-pipeline against the 32-run baseline
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-18T02:02:18.733Z"
feature_id: D65
priority: P2
tags:
  - measurement
  - task-pipeline
estimate_hours: 3

dependencies: ["1239"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1240-verdict.json
---

## 1240. Measure the rewritten task-pipeline against the 32-run baseline

### Background

Feature D65 P2 exit. Baseline (2026-10-16/17): 32 runs, 2550 min, driver overhead 815 min (32%), remediation ~450 min vs implement 356 min.

**Refine corrections (2026-10-17)**
- No corrections: `spur history analyze` supports --since/--until/--source/--session/--run/--task/--top/--out, enough for cross-agent per-stage figures.

### Requirements

- [x] R1. Run at least three real tasks through the rewritten pipeline and collect run summaries.
- [x] R2. Write a comparison report under docs/reports/ with per-stage time, driver overhead and gate time against the baseline, using `spur history` for cross-agent figures.
- [x] R3. Report regressions as findings; do not tune the baseline.

### Acceptance Criteria

- [x] AC1 — R12 — The rewritten task pipeline is measured against the baseline (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Measurement only; reuses run summaries (now with gate time) and `spur history analyze`. The report is the repeatable artifact.

### Plan

- [x] Collect the baseline (read-only) and reproduce the recorded total
- [x] Run the rewritten pipeline with a real agent executor in a scratch clone and measure its stages
- [x] Write docs/reports/task-pipeline-baseline-comparison.md with per-stage time, gate time, cross-agent table and findings
- [x] Complete three real D65 task certification runs (1232, 1237, 1238), retain failures, and collect engine summaries and gate receipts

### Solution

Three real D65 tasks completed the rewritten task pipeline with executor `host`, profile `auto`, original full quality gates and no model stub. These are certification-only re-audits of existing implementations, so the report makes no implementation speedup claim.

- 1232: `075683d4-0235-4e3f-832d-f30de89eac6e` — done, gate PASS (200570 ms), engine summary retained.
- 1237: `0123eef5-e310-4322-a5d6-0e6b023a806e` — done, gate PASS (196120 ms), engine summary retained.
- 1238: `0e9239ff-d131-40d7-aa97-e58fc41cae11` — done, gate PASS (193390 ms), engine summary retained.

`docs/reports/task-pipeline-baseline-comparison.md:948` (section 7) and `docs/reports/d65-real-task-pipeline-receipt.json:1` contain per-stage raw trace durations, wall time, gate time, unavailable driver-overhead disclosure, fresh read-only `spur history analyze` cross-agent aggregates, and both failed attempts. The original 32-run baseline and reproduced 33-run figures remain unchanged. Positional progress ambiguities are disclosed; raw action IDs supply the totals. The required dogfood report validates with no errors and is listed in `docs/dogfood/INDEX.md`. Foundation repairs are owned by tasks 1232, 1235, 1237 and 1239.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @run `.spur/run/d65-verifyall/host-measurements-final.log` — executable collector verified three real completed task pipelines (1232, 1237, 1238), PASS gate receipts and matching summary gate times; docs/reports/d65-real-task-pipeline-receipt.json:1 retains run identities and stage measurements |
| R2 | MET | docs/reports/task-pipeline-baseline-comparison.md:1 — current section 7 reports per-stage raw action time, gate time, unavailable driver overhead and fresh cross-agent history aggregates; `history analyze --since 2026-10-10 --until 2026-10-18` exited 0; collector assertions passed |
| R3 | MET | docs/reports/task-pipeline-baseline-comparison.md:1 — historical baseline and both failed attempts retained; certification-only sample is explicitly not comparable to implementation workload; no baseline tuning or speedup claim; engine progress ambiguity is disclosed and raw action IDs supply totals |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R12 — The rewritten task pipeline is measured against the baseline | MET | command | @run `.spur/run/d65-verifyall/host-measurements-final.log` — executable collector verified three real completed task pipelines (1232, 1237, 1238), PASS gate receipts and matching summary gate times; docs/reports/d65-real-task-pipeline-receipt.json:1 retains run identities and stage measurements; docs/reports/task-pipeline-baseline-comparison.md:1 — current section 7 reports per-stage raw action time, gate time, unavailable driver overhead and fresh cross-agent history aggregates; `history analyze --since 2026-10-10 --until 2026-10-18` exited 0; collector assertions passed; docs/reports/task-pipeline-baseline-comparison.md:1 — historical baseline and both failed attempts retained; certification-only sample is explicitly not comparable to implementation workload; no baseline tuning or speedup claim; engine progress ambiguity is disclosed and raw action IDs supply totals |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | @run `.spur/run/d65-verifyall/host-measurements-final.log` — executable collector verified three real completed task pipelines (1232, 1237, 1238), PASS gate receipts and matching summary gate times; docs/reports/d65-real-task-pipeline-receipt.json:1 retains run identities and stage measurements |
| R2 | MET | docs/reports/task-pipeline-baseline-comparison.md:1 — current section 7 reports per-stage raw action time, gate time, unavailable driver overhead and fresh cross-agent history aggregates; `history analyze --since 2026-10-10 --until 2026-10-18` exited 0; collector assertions passed |
| R3 | MET | docs/reports/task-pipeline-baseline-comparison.md:1 — historical baseline and both failed attempts retained; certification-only sample is explicitly not comparable to implementation workload; no baseline tuning or speedup claim; engine progress ambiguity is disclosed and raw action IDs supply totals |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R12 — The rewritten task pipeline is measured against the baseline | MET | command | @run `.spur/run/d65-verifyall/host-measurements-final.log` — executable collector verified three real completed task pipelines (1232, 1237, 1238), PASS gate receipts and matching summary gate times; docs/reports/d65-real-task-pipeline-receipt.json:1 retains run identities and stage measurements; docs/reports/task-pipeline-baseline-comparison.md:1 — current section 7 reports per-stage raw action time, gate time, unavailable driver overhead and fresh cross-agent history aggregates; `history analyze --since 2026-10-10 --until 2026-10-18` exited 0; collector assertions passed; docs/reports/task-pipeline-baseline-comparison.md:1 — historical baseline and both failed attempts retained; certification-only sample is explicitly not comparable to implementation workload; no baseline tuning or speedup claim; engine progress ambiguity is disclosed and raw action IDs supply totals |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/reports/d65-real-task-pipeline-receipt.json:1 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T22:06:23.202Z todo → wip (system)
- 2026-10-17T22:06:42.722Z wip → todo (system)
- 2026-10-17T22:36:36.790Z todo → wip (system)
- 2026-10-17T22:36:37.384Z wip → testing (system)
- 2026-10-18T01:53:41.857Z testing → done (system)

