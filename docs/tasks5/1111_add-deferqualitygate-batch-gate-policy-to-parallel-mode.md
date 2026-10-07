---
schema_version: 1
name: Add deferQualityGate batch gate policy to parallel mode
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:50.343Z
updated_at: "2026-10-07T07:34:14.542Z"
feature_id: R

---

## 1111. Add deferQualityGate batch gate policy to parallel mode

### Background

Under `--mode parallel` every task pipeline runs its own full quality gate inside its worktree (`task-pipeline.yaml` quality-gate stage), so an N-task batch pays N full gates plus the operator's integrated verification. Session evidence: the P1 batch paid 4 full-gate runs (~28 min) where 1 integrated run (388s) sufficed — slices integrated clean and only the integrated tree was checked once. The batch lifecycle already has the defer-once precedent: `deferFeatureSync` (0931 R5, `execution-batch.md` § Parallel isolation "Generated regions — defer the sync, regenerate once").

### Requirements

- [ ] R1. `task-pipeline.yaml` gains run var `deferQualityGate` (default `"false"`, mirroring `deferFeatureSync` placement/comment style, ADR-115 constraints): when `"true"`, the quality-gate stage is skipped for that task run and the task report notes the deferral.
- [ ] R2. Parallel launches set `deferQualityGate: "true"` in the WT-3 dispatch vars (`execution-batch.md` § Parallel isolation driver loop); after the last integration the orchestrator runs the project `qualityGateCmd` once on the integrated base ref before feature-sync regeneration, recording PASS/fail in the batch report.
- [ ] R3. Red-gate bisect recipe: if the integrated gate fails, the report names per-branch re-gate commands (newest-first) so the failing slice is localized manually — no automatic bisect, mirroring the R4 no-auto-resolution stance.
- [ ] R4. The batch report outcome vocabulary gains a deferred-check marker per row so post-batch inspection knows which slices were not individually checked.

### Acceptance Criteria

- [ ] AC1 — Parallel batches run one integrated quality gate instead of per-task gates

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T07:34:14.542Z backlog → todo (system)

