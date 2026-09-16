---
schema_version: 1
name: "Repair the action-boundary event contract: collapse aliases and correlate agent invocations"
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.224Z
updated_at: "2026-09-16T11:13:39.930Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - observability
  - events

dependencies: ["0868"]
---

## 0869. Repair the action-boundary event contract: collapse aliases and correlate agent invocations

### Background

The event vocabulary double-names one boundary: workflow.action.start and .started were each emitted 342 times, .done and .finished each 338 — so any count of action boundaries is doubled unless the reader knows to pick one. Separately, 276 of 443 agent.invoke.start events carry a NULL run_id, so the single most expensive thing a run does cannot be attributed to the run that paid for it.

### Requirements

- [ ] R1. Exactly one start event and one finish event are recorded per action execution.
- [ ] R2. No two event names describe the same action boundary; the retired alias is deleted rather than kept as a silent duplicate.
- [ ] R3. agent.invoke.start and agent.invoke.exit events record the non-null run id of the dispatching run.
- [ ] R4. Existing consumers of the retired alias names are migrated in the same change; none is left reading a name that no longer fires.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R5 — Each workflow action emits exactly one start event and one finish event
    Given a workflow action executes once
    When its system_events rows are counted by event_name
    Then exactly one start event and one finish event are recorded for that action
    And no two event names describe the same action boundary

  @core
  Scenario: R6 — Agent invocation events carry the run they belong to
    Given an agent invocation dispatched from a workflow action
    When its "agent.invoke.start" and "agent.invoke.exit" events are persisted
    Then each event records the non-null run id of the dispatching run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Delete the duplicate rather than alias it (constitution: delete, don't layer) — a compatibility shim here would preserve exactly the double-count the task exists to remove. Pick the surviving name by which one existing consumers already read, and migrate the rest. For run correlation, thread the dispatching run id through the agent invocation path rather than inferring it at read time from timestamps; an inferred correlation is wrong precisely when runs overlap, which is when it matters.

### Plan

1. Enumerate emitters and consumers of both alias pairs.
2. Choose the surviving names; migrate consumers; delete the duplicate emissions.
3. Trace the agent invocation path to find where run id is dropped; thread it through.
4. Add a test asserting one start and one finish per action, and non-null run id on invoke events.
5. Note the vocabulary change in docs/design/event-tracking.md.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
