---
schema_version: 1
name: "Await the first R1 rejection assertion in proof-input-fingerprint.test.ts"
status: cancelled
template: feature-impl
created_at: 2026-09-03T23:07:44.570Z
updated_at: "2026-09-04T00:00:48.700Z"
feature_id: D9
---

## 0761. Await the first R1 rejection assertion in proof-input-fingerprint.test.ts

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements

- R1. `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244`: the first R1 regression assertion `expect(createGitAlternateTree(...)).rejects.toBeInstanceOf(...)` is never awaited — add `await` (sibling tests use the awaited `.catch(e => e)` pattern). Without it, bun:test may settle before the matcher runs, so a regression back to the `''` sentinel could pass vacuously.
- R2. The test still fails against pre-0751 code after the fix (failure path stays exercised).

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

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

- 2026-09-04T00:00:48.700Z todo → cancelled (system)
