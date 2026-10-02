---
schema_version: 1
name: Enforce per-heading uniqueness in the job-handoff contract test
status: backlog
template: feature-impl
created_at: 2026-10-02T17:28:57.081Z
updated_at: "2026-10-02T17:29:59.459Z"
feature_id: D62

---

## 1056. Enforce per-heading uniqueness in the job-handoff contract test

### Background

Task 1050 review (verdict PASS, run 4cd815f9) flagged P4: `plugins/sp/tests/job-handoff-contract.test.ts` docstring claims per-heading uniqueness, but no assertion enforces it — the indexOf slice boundaries silently depend on each of the eight section headings occurring exactly once; heading drift currently fails confusingly instead of loud.

Note (accepted, out of scope): sample specimens 1024-1027 are bare numbers and could false-positive against future numeric tokens — inherited parity from the hash-pinned 1041 source, documented in the review answer; keep byte-parity unless the specimens are changed deliberately.

### Requirements

- R1: Before slicing, assert each of the eight boundary headings occurs exactly once in both wrapper fixtures (dump + resume), so heading drift fails loud at the uniqueness check instead of producing a wrong slice.

### Acceptance Criteria

- [ ] AC1: R1 — uniqueness assertion runs for both fixtures and a duplicated-heading mutation test fails the suite; evidence `test`

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
