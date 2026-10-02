---
schema_version: 1
name: Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)
status: backlog
template: feature-impl
created_at: 2026-10-02T23:30:56.374Z
updated_at: "2026-10-02T23:31:07.706Z"
feature_id: F96

---

## 1061. Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)

### Background

Session evidence (task 1056, 2026-10-02): the first done attempt was blocked by `L4.uncovered-task-scenario` because the issue-template ships checkbox AC rows, which the done-gate treats as scenario-keyed, while the owning feature's AC (gherkin R1-R15) has no matching persist-out scenario. Tasks 1053-1055 passed only because they already used freeform ACs. 1056 had to convert to freeform `- ACn:` style mid-flight (noted as P3 template mismatch in its Review). Corpus precedent now diverges from the shipped template.

### Requirements

1. Decide the owning fix and apply the smaller one: either the default task template ships freeform `- ACn:` AC rows, or the done-gate treats template-default checkbox AC rows consistently with freeform rows.
2. Whichever side changes, 1053-1056's freeform corpus stays valid and existing checkbox-AC tasks do not silently lose scenario coverage.
3. Document the resolved convention in the owning surface (task template docs or task-check design) so the next runall batch does not rediscover it.

### Acceptance Criteria

- AC1: a throwaway task created from the default template reaches `done` without AC-style rewrites; check PASS evidence recorded, then the throwaway is cleaned up.
- AC2: a task whose feature AC genuinely lacks a persisted scenario still fails the done-gate (fail-closed retained).

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
