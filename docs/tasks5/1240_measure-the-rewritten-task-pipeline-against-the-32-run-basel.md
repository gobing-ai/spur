---
schema_version: 1
name: Measure the rewritten task-pipeline against the 32-run baseline
status: testing
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-17T22:36:37.664Z"
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

- [ ] AC1 — R12 — The rewritten task pipeline is measured against the baseline (req: R1, R2, R3)

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
- [ ] Runs 2 and 3 to completion — blocked by two recorded defects (`spurBin` spawn at agent-run.ts:1926; hop-scoped empty-implement guard at agent-run.ts:1346)

### Solution

Measurement only; no pipeline, baseline or config change. `docs/reports/task-pipeline-baseline-comparison.md` is the artifact: it records the per-stage baseline recomputed from the 33 qualifying `.spur/run/*-summary.json` files (2551 min total, 692 min driver-overhead rows, implement 404, remediation 457), the three recorded baseline deltas that cannot be reconciled (implement 356, overhead 815, run count 32), the `spur history analyze` cross-agent table (no stage dimension), and one rewritten-pipeline run with a real `claude` executor (`492a9ea5…`): precheck 59 ms, implement 129.5 s, gate visit 1 252.5 s FAIL, remediate ~88 s, gate visit 2 226.5 s PASS, review 189.6 s — still in `remediate` visit 2 at the final observation, so the three-completed-run requirement (R1) is not met and is reported as a named gap with the exact commands for runs 2 and 3.

R3 findings recorded there, each with the code path: the baseline's aggregates are not reproducible from its inputs (§2.1); `spur history` has no stage dimension (§1.2); driver overhead is structural-only for host-executor runs (`run-summary.ts:583`); `--trace-file` trips the implement diff-scope guard (`agent-run.ts` 0487 guard); the empty-implement guard is hop-scoped (`agent-run.ts:1054`, `:1334`) so a pre-existing edit reads as a no-op; the verification-only admission spawns `vars.spurBin` as a single command and gets `exit null` for a two-word `bun <script>` invocation (`agent-run.ts:1909`); `workflow progress` per-visit windows are keyed by first-visit start, so revisited stages mis-split.

### Testing

**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | UNMET | Zero of the required three runs reached `done`. The baseline half is complete and reproducible (33 qualifying close-written summaries, 2551 min vs the recorded 2550, driver-overhead rows 692 min / 27.1%), and one run of the rewritten pipeline was measured through `review` in a scratch clone at `60faec03e` (precheck 59 ms, implement 129.5 s, gate FAIL 252.5 s, remediate ~88 s, gate PASS 226.5 s, review 189.6 s) — it was still in `remediate` visit 2 at the cutoff and never completed. Runs 2 and 3 have exact reproduce commands in the report's §5 but were not started. The blockers are recorded defects, not time: a two-word `vars.spurBin` cannot be spawned as one command (`packages/app/src/workflow/actions/agent-run.ts:1926` passes it straight into `command`, so a passing admission returns `exit null`), and the empty-implement guard is hop-scoped (`agent-run.ts:1346`) so a surviving non-corpus edit from the previous hop reads as a no-op |
| R2 | MET | `docs/reports/task-pipeline-baseline-comparison.md` exists with the method, per-stage baseline table, the rewritten pipeline's measured stages, gate time from the check receipts, a cross-agent table (`spur history analyze`), four attempt records, 11 findings and a reproduce section. Driver overhead is `n/a` for the measured runs with the reason stated (a subprocess-executor run has no host transcript) |
| R3 | MET | The baseline is untuned and the report names every regression as a finding, including its own inference limits: the codex capability attestation (0706 R5), the `--trace-file` diff-scope collision (0487), the hop-scoped empty-implement guard, the `spurBin` spawn defect, and that `workflow progress` per-visit windows share the first visit's start so only receipts and summed action ms are reliable |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R12 — The rewritten task pipeline is measured against the baseline (req: R1, R2, R3) | PARTIAL | command | `docs/reports/task-pipeline-baseline-comparison.md` — baseline reproduced (`bun /tmp/d65-baseline.ts .spur/run`: 33 runs, 2551 min, 692 min overhead) and one real `claude`-executor run of the rewritten pipeline measured through `review` (gate receipts: v1 FAIL `gateRuntimeMs` 252289, v2 PASS `gateRuntimeMs` 208471, both `queueWaitMs` 0). One of three runs completed through `review`, none reached `done` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: FAIL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict FAIL) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T22:06:23.202Z todo → wip (system)
- 2026-10-17T22:06:42.722Z wip → todo (system)
- 2026-10-17T22:36:36.790Z todo → wip (system)
- 2026-10-17T22:36:37.384Z wip → testing (system)

