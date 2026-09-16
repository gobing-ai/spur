---
schema_version: 1
name: Route a contract violation to a repair edge, piloted on wrapup-pipeline
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.226Z
updated_at: "2026-09-16T11:13:40.530Z"
feature_id: D62
priority: P0
tags:
  - workflow
  - agent-run
  - adr-118
  - pilot

dependencies: ["0870"]
---

## 0871. Route a contract violation to a repair edge, piloted on wrapup-pipeline

### Background

Once a contract violation is named, the run can take a cheap path instead of re-dispatching a stage averaging 357 s. wrapup-pipeline is the pilot: 99 real runs and the best real completion rate on record, 9 states, 1 agent.run — small enough to iterate, real enough that the lesson transfers. This replaces the original proposal's plan to pilot on the untraced graphs.

### Requirements

- [ ] R1. A definition may route the contract-violation outcome to a distinct outgoing edge.
- [ ] R2. The repair path does not re-dispatch the full stage on its first attempt.
- [ ] R3. The run log distinguishes a contract violation from an executor failure at the routing decision.
- [ ] R4. A definition that declares no contract-violation edge behaves exactly as it does today.
- [ ] R5. wrapup-pipeline carries the pilot edge and its behaviour is recorded from real runs, not fixtures.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R8 — A contract violation routes to a repair outcome, not a full-stage retry
    Given a stage whose output failed a declared contract check
    When the pipeline evaluates its outgoing transitions
    Then the run takes a distinct contract-violation edge
    And the repair path does not re-dispatch the full stage on its first attempt
    And the run log distinguishes a contract violation from an executor failure
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Routing is opt-in per definition: an absent contract-violation edge must leave today's behaviour untouched, or this change silently alters every pipeline at once. The first repair attempt is deliberately not a re-dispatch — re-running the same 357 s stage on the same inputs is what the measured 46% failure rate already buys. Pilot scope is one definition so the promotion evidence comes from real traffic before the pattern spreads.

### Plan

1. Add the contract-violation edge kind to the transition evaluation path, opt-in.
2. Verify a definition without the edge is unchanged (regression over existing definitions).
3. Add the pilot edge and repair action to wrapup-pipeline.
4. Record routing decisions in the run log with the violation name.
5. Collect real-run evidence for the pilot before proposing wider adoption.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
