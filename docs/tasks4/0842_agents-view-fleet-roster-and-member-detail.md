---
schema_version: 1
name: "Agents view: fleet roster and member detail"
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.544Z
updated_at: "2026-09-12T04:56:45.799Z"
feature_id: G63
priority: P2
tags:
  - g6-program

dependencies: ["0840"]
---

## 0842. Agents view: fleet roster and member detail

### Background

Agent visibility is split across Teams and Inbox today. The replacement is one roster scoped to the
selected project, with a member detail pane that reuses the existing process, terminal, message, and
activity transports under `/api/team/*` rather than introducing a new one
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Projects Board information architecture").

Declared desired state and observed liveness are different facts: a running process may be busy,
blocked, or unable to dispatch because its executor is disabled
(`docs/reports/g6-runtime-inventory.md` §5). The roster must show both without collapsing them into
one green dot.

Prototype coverage: R3-1…R3-8 state cards (`docs/reports/g6-projects-prototype.md`).

### Requirements

- **R1** — A roster of the project's fleet: role, executor, capabilities, current work, orchestrator
  marker.
- **R2** — Declared state and observed liveness are rendered as distinct facts.
- **R3** — Member detail exposes process, terminal, messages, and activity through existing
  `/api/team/*` transports.
- **R4** — Escape closes member detail and returns focus to its opener.
- **R5** — `executor-unavailable` is a named state with its next action, distinct from offline.
- **R6** — No agent lifecycle control is invented here beyond what the existing transports already
  expose.

### Acceptance Criteria

```gherkin
Feature: Agents view fleet roster and member detail

  @core
  Scenario: The roster shows the project fleet
    Given a project with declared fleet members
    When the Agents view opens
    Then each member shows role, executor, capabilities, and current work
    And the orchestrator is marked

  @core
  Scenario: Declared and observed are separate
    Given a member that is declared enabled but whose process is not running
    When its card renders
    Then declared state and observed liveness are shown as distinct facts

  @core
  Scenario: Detail opens and returns focus
    Given a member card with focus
    When detail is opened and then dismissed with Escape
    Then focus returns to the card that opened it
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
- Reference implementation: [projects prototype report](../reports/g6-projects-prototype.md) R3-1…R3-8 state cards
- Retained transports: `/api/team/*` process, terminal, stream
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5 declared-vs-observed state

### History
