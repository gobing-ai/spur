---
schema_version: 1
name: "Implement the chosen claim-matcher subject association approach"
status: cancelled
template: feature-impl
created_at: 2026-08-27T19:45:36.028Z
updated_at: "2026-08-27T20:11:58.913Z"
feature_id: F96
priority: P3
dependencies: ["0701"]
---

## 0702. Implement the chosen claim-matcher subject association approach

### Background

F96's implementation task. **Gated twice:** on the design decision from 0701, and on F94
completing (the operator's explicit intent — claim-matcher depth is deferred until the close-out
friction batch lands).

### Requirements

- [ ] R1. **Implement the chosen option** from the 0701 design decision for the residue class.
- [ ] R2. **GATE — start only after the design decision is recorded AND F94 is done.**

### Acceptance Criteria

- [ ] AC1. Given the implemented option, when the corpus check runs, then the 0607/0677/0670
      residue entries stop reproducing or are reclassified per the decision.

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

- 2026-08-27T19:48:39.501Z todo → blocked (system)
- 2026-08-27T20:11:58.913Z blocked → cancelled (system)
