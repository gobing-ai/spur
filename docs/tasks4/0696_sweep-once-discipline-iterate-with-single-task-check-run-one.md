---
schema_version: 1
name: "Sweep-once discipline: iterate with single-task check, run one --corpus sweep before commit"
status: todo
template: feature-impl
created_at: 2026-08-27T19:45:19.961Z
updated_at: "2026-08-27T19:48:07.545Z"
feature_id: F94
priority: P3
---

## 0696. Sweep-once discipline: iterate with single-task check, run one --corpus sweep before commit

### Background

Rider from the 0688 friction review (F94): the 0688 session burned **17 `task check --corpus`
sweeps × ~60s** iterating on one task. Single-task check is the iterate-loop tool; the corpus
sweep belongs once, at commit-prep (where F91's two-sided ratchet expects to see it). S-size doc
task; the discipline is real money in agent time.

### Requirements

- [ ] R1. **Codify sweep-once in the verification-gate docs:** iterate with single-task
      `spur task check <wbs>`; run `task check --corpus` exactly once, at commit-prep.

### Acceptance Criteria

- [ ] AC1. The verification-gate docs state the discipline: single-task check drives the iterate
      loop; the `--corpus` sweep runs once before commit.

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
