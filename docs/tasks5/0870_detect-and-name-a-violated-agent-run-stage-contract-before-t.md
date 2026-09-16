---
schema_version: 1
name: Detect and name a violated agent.run stage contract before the result is accepted
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.225Z
updated_at: "2026-09-16T11:13:40.277Z"
feature_id: D62
priority: P0
tags:
  - workflow
  - agent-run
  - adr-118

dependencies: ["0868"]
---

## 0870. Detect and name a violated agent.run stage contract before the result is accepted

### Background

agent.run is 96% of workflow machine time (4,173 min over 723 actions) against shell's 3.3%. Within it, implement fails 83 of 180 runs (46%) after paying 9.9 min each. Sampled payloads split those failures into two populations the current single ok:false collapses: exitCode 3 executor errors, and exitCode 0 with ok:false — a clean agent exit that missed its own declared post-condition. Only the second is cheaply repairable, and it cannot be routed until it is named.

### Requirements

- [ ] R1. An agent.run stage declaring answerFile, expectFile or requireDiff has that declaration treated as a contract.
- [ ] R2. A violation is detected and named before the stage reports success.
- [ ] R3. The run log and the action trace record which contract was violated and the observed value.
- [ ] R4. A contract violation is distinguishable in the trace from an executor failure; the two are not both bare ok:false.
- [ ] R5. Executor failure retains its existing semantics unchanged.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R7 — An expensive stage validates its contract before the result is accepted
    Given an agent.run stage declaring answerFile, expectFile or requireDiff
    When the stage produces an output that violates a declared contract
    Then the violation is detected and named before the stage reports success
    And the run log records which contract was violated and the observed value
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

This task establishes the third outcome and its evidence; routing is the next task's job, so the split keeps each diff reviewable. The check runs at the point the stage's result is accepted, using the post-conditions the YAML already declares — no new declaration syntax, because every expensive stage already states what it must produce. Naming the observed value matters as much as naming the contract: `expectFile empty` and `expectFile missing` need different repairs.

### Plan

1. Inventory the declared post-conditions across config/workflows/ and their current evaluation site.
2. Introduce the contract-violation outcome alongside success and executor failure.
3. Record contract name and observed value into the run log and the action_runs row.
4. Confirm executor-failure behaviour is byte-identical to before.
5. Test each declared post-condition's violation shape.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
