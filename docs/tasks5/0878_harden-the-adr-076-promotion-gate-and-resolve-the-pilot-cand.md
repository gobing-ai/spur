---
schema_version: 1
name: Harden the ADR-076 promotion gate and resolve the pilot candidate through it
status: backlog
template: feature-impl
created_at: 2026-09-17T17:38:39.161Z
updated_at: "2026-09-17T17:41:55.978Z"
feature_id: D62

---

## 0878. Harden the ADR-076 promotion gate and resolve the pilot candidate through it

### Background

Captured from the creation title: "Harden the ADR-076 promotion gate and resolve the pilot candidate through it".

### Requirements

- Gate `evaluateCandidate`'s `promote` decision on measured real runs: a candidate with zero recorded runs cannot promote (`scripts/commands/workflow-promotion.ts:284`).
- `resolve` refuses a decision that contradicts the candidate's evaluated `verdict` (`:514-538` never reads it).
- The `resolve --decision promote` refusal branch gets a test.
- The duration statistic's `.runs` count matches its duration fold (`:263` folds `rows.length` over a null-filtered durations array).
- Wire or drop `--now` in the resolve branch (`:427` parses it, never uses it).
- Final acceptance: resolve candidate `wrapup-contract-violation-pilot-routing` (`config/workflow-candidates.json:6`; verdict `delete`, deadline 2026-10-17, measured absence recorded by task 0876) **through the hardened gate**, decision `delete`.

### Acceptance Criteria

- Tests cover: zero-run promote refusal; contradicting-decision refusal; `--decision promote` refusal branch; duration fold count consistency.
- The pilot candidate is resolved via the hardened resolve path with the recorded `delete` decision and reason.
- `bun run spur-check` green.

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
