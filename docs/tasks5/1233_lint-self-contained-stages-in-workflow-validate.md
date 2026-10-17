---
schema_version: 1
name: Lint self-contained stages in workflow validate
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.817Z
updated_at: "2026-10-17T16:13:23.671Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - lint
estimate_hours: 4

dependencies: ["1231"]
---

## 1233. Lint self-contained stages in workflow validate

### Background

Feature D65 F3. An agent.run prompt that relies on host conversation memory cannot run under a subprocess or fleet executor. `spur workflow validate` must reject such stages before any run.

**Refine corrections (2026-10-17)**
- collectHitlDecisionViolations at composition-lint.ts:338 → actual :345 → Design cites :345.

### Requirements

- [ ] R1. Every agent.run declares expectFile(s) or owned task sections; otherwise validate reports the state id and the missing declaration.
- [ ] R2. Every `.spur/run/` path named in an agent.run prompt is produced by an earlier state's action or declared as a workflow input; otherwise validate reports the path and state.
- [ ] R3. Shipped workflows pass or carry an explicit, reviewed allowance; violations exit nonzero.

### Acceptance Criteria

- [ ] AC1 — Workflow validate reports a stage that is not self-contained (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend packages/app/src/workflow/composition-lint.ts beside collectHitlDecisionViolations (:345) — same collector shape, same report format; no new lint framework. Path production is a static scan of shell/command.gate args and expectFile options of predecessor states. Rejected: runtime detection (too late; the point is pre-flight).

### Plan

- [ ] List failure modes: undeclared output, prompt path from a later state, path only produced in a sibling branch, templated path
- [ ] Add collector + wire into validate
- [ ] Run validate across config/workflows

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
