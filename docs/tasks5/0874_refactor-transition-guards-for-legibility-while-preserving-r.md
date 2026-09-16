---
schema_version: 1
name: Refactor transition guards for legibility while preserving routing semantics
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.227Z
updated_at: "2026-09-16T11:13:41.199Z"
feature_id: D62
priority: P2
tags:
  - workflow
  - guards
  - legibility

dependencies: ["0868", "0866"]
---

## 0874. Refactor transition guards for legibility while preserving routing semantics

### Background

idea-pipeline carries 27 chained-test shell guards totalling 3,023 characters; task-pipeline carries a single 455-character guard. This is a correctness and reviewability concern, not a performance one — shell is 3.3% of machine time at 6.0 s average — and framing it as a performance win would make the work read as a failure.

### Requirements

- [ ] R1. Guards in the retained definitions are rewritten for legibility.
- [ ] R2. Evaluated against the same recorded variable and artifact state, every rewritten guard returns the same routing decision as the pre-refactor definition.
- [ ] R3. The parity check is executed, not asserted by inspection.
- [ ] R4. No guard rewrite changes a definition's reachable state set.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R10 — Guard refactoring preserves routing semantics
    Given a retained definition whose transition guards are rewritten for legibility
    When each guard is evaluated against the same recorded variable and artifact state as before
    Then every guard returns the same routing decision as the pre-refactor definition
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Routing parity is the whole risk: task-lifecycle's header records that a well-intentioned guard change in task 0758 denied every wip→testing and testing→done write until reverted, because requestTransition selects a single transition per (from,to) pair and denies on that guard without falling through. The refactor therefore needs a mechanical parity check over recorded states, not a reviewer's reading. Sequenced last: the trace from the emission task supplies the recorded state to check against.

### Plan

1. Capture recorded variable and artifact state per transition from run history.
2. Build the parity harness: evaluate old and new guard against the same state, compare decisions.
3. Rewrite guards definition by definition, running parity after each.
4. Confirm the reachable state set is unchanged per definition.
5. Record the 0758 hazard in the refactor's evidence so the next editor sees it.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
