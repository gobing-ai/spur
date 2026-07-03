---
template: standard
schema_version: 1
name: "0176 Wave C: verification depth and functional evidence"
description: ""
status: todo
type: task
profile: standard
feature_id: null
parent_wbs: "0176"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-02T06:29:12.249Z"
updated_at: "2026-07-02T06:33:34.565Z"
---

## 0179. 0176 Wave C: verification depth and functional evidence

### Background

Child task for 0176 Wave C. Fix verification depth findings F3 and F4: verification currently lacks a design-conformance lens and allows static references to clear behavior-bearing AC without fresh executable evidence.

### Requirements
- R1. Add a design-conformance pass to `sp:code-verification` verify mode between AC validation and SECUA.
- R2. Classify design claims as DONE, PARTIAL, NOT DONE, or CHANGED against the diff, with silent deviation lowering the verdict and documented goal-equivalent deviation accepted as CHANGED.
- R3. Add scope-creep detection for diff hunks that match no requirement, AC, Design, or Plan item.
- R4. Require at least one `test` or `command` evidence row for each behavior-bearing CORE requirement or AC; static-only evidence may not produce PASS.
- R5. Require CLI-surface tasks to capture one golden-path command invocation as command evidence.
- R6. Update verdict schema/prose and review workflow guidance to preserve the new evidence semantics.
- R7. After landing, run a small probe task through the full pipeline to prove the tightened verifier does not false-fail.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
