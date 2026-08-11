---
template: feature-impl
schema_version: 1
name: "Idea-pipeline regression tests for dogfood findings with no-surface guard"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["idea", "workflow", "plugins/sp"]
dependencies: ["0518"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.899Z"
updated_at: "2026-08-11T22:26:23.148Z"
---

## 0519. Idea-pipeline regression tests for dogfood findings with no-surface guard

### Background

Split from task 0515 (feature I2, decomposition 2026-08-11): the verification slice. 0515 keeps the guidance contract; 0518 owns the finalization machinery. This task locks the four dogfood findings behind workflow-definition and plugin contract tests and enforces the no-runtime-surface constraint.

Implements feature I2 scenarios R14 (Idea handoff is safe to execute) and R10 (refinement changes no runtime surface). Ordering: last in the 0515 chain — after 0518 (the tests cover its machinery).

Rubric: E2 D1 L1 C0 R0 = 4 → split (size gate).

### Requirements
- [ ] R1. Add focused workflow-definition and plugin contract tests reproducing the four dogfood findings.
- [ ] R2. Add no public CLI command/flag, task-batch schema field, dependency, persistence schema, or transport.
### Acceptance Criteria
```gherkin
Feature: Idea-pipeline regression coverage
  Scenario: R1 — Idea handoff is safe to execute
    Given the four dogfood findings are encoded as tests
    When the focused suite runs against an unhardened idea-pipeline definition
    Then each test fails and passes only with the 0515/0518 changes in place

  Scenario: R2 — Refinement changes no runtime surface
    Given the change set is limited to harness guidance and tests
    When the diff is reviewed
    Then no public CLI surface, task-batch schema, dependency, persistence, or transport changes
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Tests target the idea-pipeline definition (config/workflows/idea-pipeline.yaml) and the plugin contract (plugins/sp/tests/skill-structure.test.ts pattern) for: Goal/Scope intent, design-review feedback, ordering sidecar + deps, roster refresh, readiness-gated handoff. R2 is a diff-scope guard — the change set must not touch public CLI surface, task-batch schema, dependencies, persistence, or transport.
### Plan
- [ ] Extend idea-pipeline definition and plugin contract tests for all four findings.
- [ ] Run workflow validation, focused tests, and feature/task checks.
- [ ] Confirm no public surface or schema diff.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

I2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
