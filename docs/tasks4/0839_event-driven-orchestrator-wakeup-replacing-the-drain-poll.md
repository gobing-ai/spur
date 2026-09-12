---
schema_version: 1
name: Event-driven orchestrator wakeup replacing the drain poll
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.725Z
updated_at: "2026-09-12T04:58:47.764Z"
feature_id: G62
priority: P2
tags:
  - g6-program

dependencies: ["0838", "0833"]
---

## 0839. Event-driven orchestrator wakeup replacing the drain poll

### Background

`runAgentLoop` drains on every iteration and sleeps `--poll` (default 2000 ms) when the queue is
empty (`apps/cli/src/commands/agent.ts:706-745`). That is a hot loop for an orchestrator that holds a
model: the approved design requires waking on specific events and costing nothing while idle
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Strategy and capacity" — "No runnable
work should produce a durable reason and a bounded/event-driven wakeup, not a hot LLM polling loop").

The missing producer is the completion receipt from task 0833: without it there is no "result arrived"
event to wake on, which is why `docs/reports/g6-strategy-prototype.md` §4.8 records the wakeup surface
as simulated.

The prototype asserts the target directly: five idle ticks produce a model-call delta of zero and a
dispatch delta of zero, with an `idle` hold recorded.

### Requirements

- **R1** — Wake sources are explicit: human request, strategy change, task or capacity change, and
  completion receipt.
- **R2** — Idle wakeups cost no model call and no dispatch.
- **R3** — When nothing is runnable, a durable and operator-readable hold reason is recorded rather
  than a silent sleep.
- **R4** — The 2000 ms drain poll is replaced or deduplicated, not merely wrapped in a wakeup.
- **R5** — The cutover is safe for already-promoted long-lived loops; the replace-versus-dedup choice is
  Robin's open decision recorded on G62.
- **R6** — Tests assert zero model calls across repeated idle wakeups and a wake on each declared source.

### Acceptance Criteria

```gherkin
Feature: Event-driven orchestrator wakeup replacing the drain poll

  @core
  Scenario: R7 — Idle costs nothing
    Given no eligible work and no new input
    When the orchestrator idles across several wakeup intervals
    Then no model call and no dispatch occur
    And the current hold reason is readable by the operator

  @core
  Scenario: Each declared source wakes the orchestrator
    Given an idle orchestrator
    When a human request, a strategy change, a capacity change, or a completion receipt occurs
    Then the orchestrator wakes for that event

  @core
  Scenario: Existing loops keep working
    Given a long-lived loop promoted before this change
    When the wakeup path ships
    Then the loop continues to consume its queue without a manual migration step
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

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §4.8 simulated wakeup surface
- Code: `apps/cli/src/commands/agent.ts:706-745` (drain loop and `--poll` default)
- Producer dependency: task 0833 completion receipt supplies the result-arrived event

### History
