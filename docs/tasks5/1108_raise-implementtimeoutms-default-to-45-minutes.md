---
schema_version: 1
name: Raise implementTimeoutMs default to 45 minutes
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:49.093Z
updated_at: "2026-10-07T07:34:13.557Z"
feature_id: R

---

## 1108. Raise implementTimeoutMs default to 45 minutes

### Background

`implementTimeoutMs` defaults to `"1800000"` (30m) at `config/workflows/task-pipeline.yaml:123`. Session evidence: 1096 and 1099 implement dispatches were killed at 30m mid-gate and needed re-dispatch; 1099's full implement consumed the raised 45m budget. The adjacent comment block (yaml :112-124) already documents that budget exhaustion is a real failure mode — the default predates multi-task batch usage.

### Requirements

- [ ] R1. `config/workflows/task-pipeline.yaml` sets `implementTimeoutMs: "2700000"` (45m) as the shipped default; the explanatory comment block is updated to state the 45m default and cite the session evidence (two 30m kills in runall-P1-20261006-02).
- [ ] R2. The run-var override path still works: a project can lower/raise the budget per run via `--vars '{"implementTimeoutMs":...}'` without YAML edits.
- [ ] R3. Budget exhaustion remains visible: the agent.run timeout failure still routes the run to a failed terminal with the timeout named in run output (verify with a dry-run or a `workflow run` trace inspection — do not add new plumbing).

### Acceptance Criteria

- [ ] AC1 — Implement agent runs default to a 45-minute budget and budget exhaustion is visible in run output

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

- 2026-10-07T07:34:13.557Z backlog → todo (system)

### Notes

The comment at yaml :119-121 currently reasons about the 30m choice — supersede it with the evidence, don't leave two justifications. `stepTimeoutMs` (review/verify/test-fix hops, :113) is a separate budget: leave it alone. Static-vs-run-var discipline per ADR-115: this var is already a run var, so no new knob is being added — only the default moves.

