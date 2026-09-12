---
schema_version: 1
name: Work view reusing task and feature surfaces with reference chips
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.545Z
updated_at: "2026-09-12T04:56:45.972Z"
feature_id: G63
priority: P3
tags:
  - g6-program

dependencies: ["0840"]
---

## 0843. Work view reusing task and feature surfaces with reference chips

### Background

Task and feature views already exist as Board modules (`apps/web/src/modules/task-kanban`,
`apps/web/src/modules/features`). The Projects module must reuse them rather than fork a third task
surface — the design's Work view is "existing task and feature views, project-scoped"
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Projects Board information
architecture").

The new capability is the bridge to Conversation: referencing a task or feature into a request as
structured data, which is what makes the request unambiguous to the orchestrator.

### Requirements

- **R1** — Work embeds the existing task and feature views scoped to the selected project; no new
  task-rendering code path.
- **R2** — A task or feature can be referenced into the conversation as a structured reference chip.
- **R3** — Project scoping is by canonical project path, consistent with the module shell.
- **R4** — Existing task/feature routes keep working unchanged outside the module.

### Acceptance Criteria

```gherkin
Feature: Work view reusing task and feature surfaces

  @core
  Scenario: Work reuses the existing views
    Given a project with tasks and features
    When the Work view opens
    Then it renders the existing task and feature surfaces scoped to that project

  @core
  Scenario: A task can be referenced into a request
    Given a task shown in Work
    When the operator references it into the conversation
    Then the composer carries it as a structured reference
```

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

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Projects Board information architecture"
- Code: `apps/web/src/modules/task-kanban`, `apps/web/src/modules/features`

### History
