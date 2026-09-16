---
schema_version: 1
name: Gate a candidate workflow graph change on measured real-run data with a promotion deadline
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.227Z
updated_at: "2026-09-16T11:13:40.960Z"
feature_id: D62
priority: P2
tags:
  - workflow
  - adr-076
  - promotion

dependencies: ["0868", "0869"]
---

## 0873. Gate a candidate workflow graph change on measured real-run data with a promotion deadline

### Background

The user-proposed strategy of adding config/workflows/<name>2.yaml beside the canonical file was already built (tasks 0596, i6), run 9 times, and deleted by ADR-076 — four attempts over two days of live model quota, never reaching a verdict, blocking a feature chain. ADR-076's own reopening condition (measured real-run data, not a fixture bar) is met by this feature's evidence, and its 2026-09-16 amendment makes the gate operable.

### Requirements

- [ ] R1. A candidate graph change is shadow-run against recorded real-run inputs rather than kept as a standing parallel definition.
- [ ] R2. The promotion verdict cites agent.run count and duration measured from real run history.
- [ ] R3. The candidate is promoted into the canonical definition or deleted by a date named when it is created.
- [ ] R4. No unreferenced parallel definition remains in config/workflows/ past its named date.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R9 — A candidate graph change is promoted or deleted on measured real-run data
    Given a candidate workflow graph change proposed against a retained definition
    When the promotion gate is evaluated
    Then the verdict cites agent.run count and duration measured from real run history
    And the candidate is either promoted into the canonical definition or deleted
    And no unreferenced parallel definition remains in config/workflows/
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The failure mode ADR-076 recorded was an open-ended comparison with no deadline and no verdict, so the deadline is the load-bearing part, not the measurement harness. Shadow-running against recorded inputs — rather than paying live model quota twice per comparison — is what makes the verdict reachable within a deadline at all. Depends on the trace emission task: there is no real-run history to measure against until the default surface emits rows.

### Plan

1. Define the candidate record: canonical target, named deadline, measurement inputs.
2. Build the shadow-run comparison over recorded run history.
3. Emit a verdict citing agent.run count and duration.
4. Enforce the deadline: promote or delete, and fail the catalogue check on an expired candidate.
5. Document the gate in docs/design/workflow-execution-economy.md §5.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
