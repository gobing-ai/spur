---
schema_version: 1
name: Emit the structured action trace from the inline pipeline driver
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.224Z
updated_at: "2026-09-16T11:03:29.113Z"
feature_id: D62
priority: P0
tags:
  - workflow
  - observability
  - adr-117
  - adr-047

---

## 0868. Emit the structured action trace from the inline pipeline driver

### Background

ADR-047 made the inline host-session driver the default surface for /sp:dev-run, /sp:dev-idea and /sp:dev-plan but left trace emission with the engine. 1,011 of ~1,400 run rows carry zero action_runs. Every downstream analytic — progress projection, tripwires, steering, escalation packets, cost attribution — therefore observes the minority of real work. A first-pass reading of this same data produced a wrong workflow retirement list, which is the concrete cost of the gap.

### Requirements

- [ ] R1. Every action executed by the inline driver writes an action_runs row carrying node, kind, status, ok and duration_ms.
- [ ] R2. The run's rows are queryable by run id without reading .spur/run/<run-id>.log.
- [ ] R3. Emission is best-effort at the action boundary only: a persistence failure is recorded and the run still reaches its declared terminal state.
- [ ] R4. The text run log remains, demoted to a human convenience; it is no longer the sole record.
- [ ] R5. The emission path is shared with the engine surface rather than reimplemented, so the two surfaces cannot drift.
- [ ] R6. The inline driver marks its run row terminal when the run reaches a declared terminal state; a successful inline run is never left non-terminal for `spur workflow clean` to reap as stale.
- [ ] R7. The run-row closure path is shared with the engine surface, like the action emission path, so the two cannot report terminal state differently.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R4 — Inline driver runs land in the structured action trace
    Given a pipeline driven by the inline driver with "--agent" omitted
    When the run reaches a terminal state
    Then every executed action has an action_runs row carrying node, kind, status, ok and duration_ms
    And the run's rows are queryable by its run id without reading .spur/run/<run-id>.log

  @edge
  Scenario: R12 — Trace emission failure never wedges or fails the run
    Given the inline driver cannot persist an action event
    When the run continues
    Then the workflow reaches its declared terminal state
    And the emission failure is recorded without changing the run's outcome
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The obligation belongs to the execution surface (ADR-117). Extract the engine's existing action-boundary emission into a surface-agnostic writer in packages/app/src/workflow/ and have both the engine runner and the inline driver call it, rather than giving the inline driver a parallel implementation — a second writer would drift and reintroduce the gap under a new name. Wrap each emission in a failure boundary that records and continues: observation must never wedge the thing observed, and the inline driver runs in the operator's own session where a throw is maximally disruptive.

### Plan

1. Read the engine's current emission call sites and the action_runs row shape.
2. Extract the shared writer; move the engine onto it with no behaviour change; run existing tests.
3. Add emission calls to the inline driver's action boundaries.
4. Add the failure boundary and its record path.
5. Update plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md with the emission obligation.
6. Test: an inline run produces rows for every action; an injected writer failure still reaches terminal.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
