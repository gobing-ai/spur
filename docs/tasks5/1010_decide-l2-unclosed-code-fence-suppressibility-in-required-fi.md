---
schema_version: 1
name: Decide L2.unclosed-code-fence suppressibility in REQUIRED_FINDING_CODES (1008 P3-2)
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:17.374Z
updated_at: "2026-09-29T18:20:40.576Z"
feature_id: F91

ac_altitude: task-local
---

## 1010. Decide L2.unclosed-code-fence suppressibility in REQUIRED_FINDING_CODES (1008 P3-2)

### Background

Task 1008 review finding P3-2 (preserved review answer, `.spur/run/785c3ca9-fa8e-4ea8-b75e-81ccac2db600-review-answer.txt`): `L2.unclosed-code-fence` is not in `REQUIRED_FINDING_CODES`, so its `error` severity can be overridden (suppressed) via the `tasks.severity` config. Task 1008 R2 specified the error default, and the corpus-gate story assumes the fence error cannot be silenced — but whether suppression is an intentional operator escape hatch or a gap is an unmade product decision, not a mechanical fix.

Decision owner: operator (with `packages/app/src/services/planning-check-base.ts` and `packages/config/src/finding-codes.ts` as the implementation surface).

### Requirements

- **R1 (decision recorded)** — decide whether `L2.unclosed-code-fence` must be non-suppressible; record the decision in the owning contract doc (`docs/design/configuration-contracts.md`) either way.
- **R2 (implement per decision)** — if suppression is disallowed: add the code to `REQUIRED_FINDING_CODES` (`packages/app/src/services/planning-check-base.ts`) with a regression test proving `tasks.severity` cannot lower it. If suppression is intentional: document the escape hatch explicitly in `configuration-contracts.md` (which code remains suppressible, which does not, and why).

### Acceptance Criteria

- [ ] AC1 — Suppressibility of `L2.unclosed-code-fence` is decided and recorded in `configuration-contracts.md` (req: R1)
- [ ] AC2 — Implementation matches the decision: either `REQUIRED_FINDING_CODES` entry + regression test (suppression disallowed), or explicit contract documentation of the intended escape hatch (req: R2)

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
