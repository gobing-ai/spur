---
schema_version: 1
name: Lint self-contained stages in workflow validate
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.817Z
updated_at: "2026-10-18T02:02:00.051Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - lint
estimate_hours: 4

dependencies: ["1231"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1233-verdict.json
---

## 1233. Lint self-contained stages in workflow validate

### Background

Feature D65 F3. An agent.run prompt that relies on host conversation memory cannot run under a subprocess or fleet executor. `spur workflow validate` must reject such stages before any run.

**Refine corrections (2026-10-17)**
- collectHitlDecisionViolations at composition-lint.ts:338 → actual :345 → Design cites :345.

### Requirements

- [x] R1. Every agent.run declares expectFile(s) or owned task sections; otherwise validate reports the state id and the missing declaration.
- [x] R2. Every `.spur/run/` path named in an agent.run prompt is produced by an earlier state's action or declared as a workflow input; otherwise validate reports the path and state.
- [x] R3. Shipped workflows pass or carry an explicit, reviewed allowance; violations exit nonzero.

### Acceptance Criteria

- [x] AC1 — R3 — Workflow validate reports a stage that is not self-contained (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend packages/app/src/workflow/composition-lint.ts beside collectHitlDecisionViolations (:345) — same collector shape, same report format; no new lint framework. Path production is a static scan of shell/command.gate args and expectFile options of predecessor states. Rejected: runtime detection (too late; the point is pre-flight).

### Plan

- [x] List failure modes: undeclared output, prompt path from a later state, path only produced in a sibling branch, templated path
- [x] Add collector + wire into validate
- [x] Run validate across config/workflows

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/workflow-execution-foundation.md:228` |
| `docs/design/workflow-execution-foundation.md:232` |
| `docs/design/workflow-execution-foundation.md:245` |
| `packages/app/src/services/workflow-inspect-ops.ts:141` |
| `packages/app/src/services/workflow-inspect-ops.ts:20` |
| `packages/app/src/workflow/composition-lint.ts:412` |
| `packages/app/tests/services/workflow-service.test.ts:629` |
| `packages/app/tests/workflow/composition-advisory.test.ts:287` |
| `packages/app/tests/workflow/composition-advisory.test.ts:290` |
| `packages/app/tests/workflow/composition-advisory.test.ts:72` |
| `packages/app/tests/workflow/composition-advisory.test.ts:86` |
| `packages/app/tests/workflow/self-contained-stage.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 47 — (pass) collectSelfContainedStageViolations R1 — declared completion > flags an agent.run that declares neither expectFiles nor ownedSections [0.23ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 50 — (pass) collectSelfContainedStageViolations R2 — prompt paths > flags a run path produced only by a later state [0.06ms]; fresh targeted run exited 0 |
| R3 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 57 — (pass) shipped workflows are self-contained (1241) > every shipped workflow passes with no allowance [37.74ms]; fresh targeted run exited 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R3 — Workflow validate reports a stage that is not self-contained | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 47 — (pass) collectSelfContainedStageViolations R1 — declared completion > flags an agent.run that declares neither expectFiles nor ownedSections [0.23ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 50 — (pass) collectSelfContainedStageViolations R2 — prompt paths > flags a run path produced only by a later state [0.06ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 57 — (pass) shipped workflows are self-contained (1241) > every shipped workflow passes with no allowance [37.74ms]; fresh targeted run exited 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 47 — (pass) collectSelfContainedStageViolations R1 — declared completion > flags an agent.run that declares neither expectFiles nor ownedSections [0.23ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 50 — (pass) collectSelfContainedStageViolations R2 — prompt paths > flags a run path produced only by a later state [0.06ms]; fresh targeted run exited 0 |
| R3 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 57 — (pass) shipped workflows are self-contained (1241) > every shipped workflow passes with no allowance [37.74ms]; fresh targeted run exited 0 |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R3 — Workflow validate reports a stage that is not self-contained | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 47 — (pass) collectSelfContainedStageViolations R1 — declared completion > flags an agent.run that declares neither expectFiles nor ownedSections [0.23ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 50 — (pass) collectSelfContainedStageViolations R2 — prompt paths > flags a run path produced only by a later state [0.06ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 57 — (pass) shipped workflows are self-contained (1241) > every shipped workflow passes with no allowance [37.74ms]; fresh targeted run exited 0 |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/design/workflow-execution-foundation.md:19 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T17:43:41.489Z todo → wip (system)
- 2026-10-17T17:43:47.445Z wip → testing (system)
- 2026-10-17T17:43:54.746Z testing → done (system)

