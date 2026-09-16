---
schema_version: 1
name: Expose spur workflow progress over the existing projectWorkflowProgress projection
status: todo
template: feature-impl
created_at: 2026-09-16T10:45:25.223Z
updated_at: "2026-09-16T11:04:06.203Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - cli
  - observability

---

## 0867. Expose spur workflow progress over the existing projectWorkflowProgress projection

### Background

packages/app/src/workflow/progress-projection.ts (506 lines) exports projectWorkflowProgress and is tested, but has zero CLI consumers — the projection that would answer "where is this run" is unreachable from the terminal. This is the cheapest half of ADR-117: wiring, not building.

### Requirements

- [ ] R1. `spur workflow progress <run-id> --json` returns the projectWorkflowProgress projection for that run.
- [ ] R2. The output names the current state, each action's attempts, and the next candidate transitions.
- [ ] R3. The command adds no projection logic beyond rendering — all derivation stays in packages/app.
- [ ] R4. A running or incomplete run exits without error and marks missing data as unknown.
- [ ] R5. An unknown run id produces a named error rather than an empty success.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R3 — A progress read surface exposes the existing projection
    Given a workflow run id with recorded states, actions and transitions
    When the operator runs "spur workflow progress <run-id> --json"
    Then the output is the projectWorkflowProgress projection for that run
    And it names the current state, each action's attempts, and the next candidate transitions
    And the command adds no new projection logic beyond rendering

  @edge
  Scenario: R11 — The progress surface degrades gracefully on an unknown or incomplete run
    Given a run id that is unknown, still running, or missing action rows
    When the operator runs "spur workflow progress <run-id> --json"
    Then the command exits without error for a running or incomplete run and marks the missing data as unknown
    And an unknown run id produces a named error rather than an empty success
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

apps/cli is a thin transport (ADR-021): the command resolves the run id, calls projectWorkflowProgress, and renders. No new projection, no new query shape. Human output is a rendering of the same projection object, never a second derivation path. Adding a verb under the existing `workflow` noun needs operator consent per the public-surface governance rule — that consent is recorded in feature D62's scope, so no further gate blocks this task.

### Plan

1. Read progress-projection.ts's exported shape and its existing tests.
2. Add the `progress` verb to apps/cli/src/commands/workflow.ts, --json and human rendering.
3. Handle unknown-run and incomplete-run paths per R4/R5.
4. Add CLI tests in apps/cli/tests covering a complete run, an incomplete run, and an unknown id.
5. Update docs/design/cli-contracts.md and docs/help/cmd_workflow.md.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
