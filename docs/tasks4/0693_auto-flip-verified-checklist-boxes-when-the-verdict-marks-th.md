---
schema_version: 1
name: "Auto-flip verified checklist boxes when the verdict marks them MET/PASS"
status: todo
template: feature-impl
created_at: 2026-08-27T19:44:59.828Z
updated_at: "2026-08-27T19:48:06.526Z"
feature_id: F94
priority: P2
---

## 0693. Auto-flip verified checklist boxes when the verdict marks them MET/PASS

### Background

Pipeline completion left **21** Requirements/AC boxes unchecked in done task 0688; the
`L3.unchecked-checklist` finding then forced post-close manual flips — a history rewrite of a done
task. The verdict artifact already knows which requirements are MET/PASS; the flip just never
happens mechanically. This task files friction G-3 of F94.

### Requirements

- [ ] R1. **Flip boxes the verdict proves.** In the `task record`/verify write path, flip
      Requirements and AC checkboxes to checked when the verdict marks the corresponding
      requirement MET/PASS.
- [ ] R2. **Never flip on ambiguity.** PARTIAL/FAIL/UNKNOWN verdicts leave boxes unchecked; boxes
      the verdict does not mention stay untouched.
- [ ] R3. **Tested.** Cover all-MET, mixed-PARTIAL, and unmentioned-requirement cases.

### Acceptance Criteria

- [ ] AC1. Given a verdict marking all requirements MET, when `task record` writes the record,
      then the corresponding Requirements/AC boxes are checked and no post-close
      `L3.unchecked-checklist` flip pass is needed.
- [ ] AC2. Given a PARTIAL verdict, when record writes, then only the MET requirements' boxes
      flip.
- [ ] AC3. Given the test suite, when it runs, then the MET/PARTIAL/unmentioned cases are
      covered.

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
