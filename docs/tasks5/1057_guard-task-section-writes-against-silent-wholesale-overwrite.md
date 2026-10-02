---
schema_version: 1
name: Guard task section writes against silent wholesale overwrite of populated sections
status: todo
template: issue
created_at: 2026-10-02T21:08:29.909Z
updated_at: "2026-10-02T21:09:31.781Z"
feature_id: D63

---

## 1057. Guard task section writes against silent wholesale overwrite of populated sections

### Background

Session defect observed 2026-10-02 while driving task 1052 through task-pipeline: the review-state write `spur task update 1052 --section Review --from-file …` replaced the Review section WHOLESALE, silently destroying the task's pre-existing "Consolidation disposition — 2026-10-02" P1–P4 findings table (consolidation provenance for 1051–1056). The loss surfaced indirectly: the testing→done L3 gate then failed ("Review must contain a populated P1–P4 priority findings table"), costing a diagnose cycle plus a manual git-restore-and-merge repair before the done transition passed. The replace-on-write contract is documented behavior; the defect is that no bounded mechanism exists to extend a populated section without destroying it, and no warning fires when the target section is non-empty.

Recurrence surface is broad: every pipeline review/record write targets `--section Review`, and consolidation-heavy tasks (1051–1056, D63) carry disposition tables exactly there. Feature derivation: daily-workflow adoption friction (D63).

### Requirements

- R1: Provide a bounded way to extend a populated section without destroying it. Smallest sufficient design — a `--append` flag on `spur task update --section` (appends the body after the existing section content), or a non-empty-overwrite guard that refuses a wholesale replace of a non-empty section unless `--force` is passed; pick one and state why in Design. Recommendation: `--append` — it is additive, back-compat, and matches how pipeline states actually want to add review/verify narratives.
- R2: Default behavior is unchanged: `--section` without the new flag keeps today's byte-exact wholesale-replace semantics (the pipeline depends on it); existing task-update tests pass unmodified.
- R3: All writes stay CLI-gated (`spur task update`); no new direct file-write path is introduced, and section-name case sensitivity (canonical heading names) is preserved.

### Acceptance Criteria

- [ ] AC1: The chosen mechanism (R1) is implemented and tested: appending to (or force-replacing) a populated Review section preserves the pre-existing P1–P4 table content per the chosen semantics — test in the task-update/planning-write-service suite.
- [ ] AC2: Default wholesale-replace semantics are unchanged — existing task-update tests pass without modification.
- [ ] AC3: `spur task update --help` documents the new flag/guard, including the case-sensitive section-name contract.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
