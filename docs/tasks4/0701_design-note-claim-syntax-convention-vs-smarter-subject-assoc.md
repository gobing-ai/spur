---
schema_version: 1
name: "Design note: claim-syntax convention vs smarter subject association for claim-matcher residue"
status: todo
template: feature-impl
created_at: 2026-08-27T19:45:35.829Z
updated_at: "2026-08-27T19:48:07.892Z"
feature_id: F96
priority: P3
---

## 0701. Design note: claim-syntax convention vs smarter subject association for claim-matcher residue

### Background

F96's decision task. After code-span stripping (f60e5ae), the claim-matcher residue in
`config/corpus-baseline.json` is three dated entries (tasks 0607/0677/0670): a "Pending" inside a
quoted ADR title, and "todo"/"not implemented" phrases describing *other* subjects near an R-id.
Explicitly deferred-depth: diminishing returns, so the deliverable is a decision, not a fix.

### Requirements

- [ ] R1. **Author the design note** (`docs/04_DESIGN.md` section or ADR entry) comparing a
      claim-syntax convention (authors mark what a claim refers to) against smarter subject
      association (the matcher narrows what a claim can refer to), with a recommendation.
- [ ] R2. **Sequencing: do not start before F94** (the close-out friction batch) is done.

### Acceptance Criteria

- [ ] AC1. The note exists, compares both options against the 0607/0677/0670 residue, and records
      a decision the implementation task gates on.

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
