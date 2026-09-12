---
schema_version: 1
name: Persisted rest and GTD strategy runtime with restart resume
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.725Z
updated_at: "2026-09-12T04:58:47.592Z"
feature_id: G62
priority: P1
tags:
  - g6-program

dependencies: ["0836", "0837"]
---

## 0838. Persisted rest and GTD strategy runtime with restart resume

### Background

Rest and GTD exist only as a prototype controller
(`apps/cli/tests/commands/g6-strategy-prototype.test.ts`, 23 tests / 109 assertions). Production has no
strategy primitive at all: nothing holds dispatch, nothing selects next work, and nothing survives a
restart.

Robin approved the semantics on 2026-09-11: `rest` accepts input, starts nothing — including
previously queued assignments that have not started — and lets running work finish; `gtd` selects
already-authorized eligible work. `gtd` is a project dispatch policy, not a replacement for
`/sp:dev-gtd` or `task-pipeline.yaml`: it selects within the existing readiness, dependency, and
verification gates and may explain a hold, never bypass a gate
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Strategy and capacity").

The design is also explicit that starting the Board must not silently reset the active strategy.

### Requirements

- **R1** — `rest` and `gtd` are persisted per project and restored on restart; starting the Board does
  not reset the active strategy.
- **R2** — `rest`: input is accepted and results ingested, no new dispatch starts (including queued but
  unstarted assignments), running work finishes and holds its slot until reconciliation.
- **R3** — `gtd`: dispatches only authorized, ready, dependency-satisfied tasks, ordered by priority
  then WBS, entirely within the existing gate owners.
- **R4** — Every skipped candidate records an actionable hold reason (unauthorized, not-ready,
  unmet-dependency, no-idle-instance, executor-unavailable, rest-after-drain).
- **R5** — Strategy selection is a small declared extension point — no dynamic plugin loader, no second
  workflow engine, no separate backlog model.
- **R6** — On restart, persisted strategy, fleet ownership, and in-flight assignments are reconciled
  before any new work is accepted.

### Acceptance Criteria

```gherkin
Feature: Persisted rest and GTD strategy runtime with restart resume

  @core
  Scenario: R2 — GTD dispatches only eligible authorized work
    Given strategy gtd and a mix of authorized, unauthorized, unready, and blocked tasks
    When the orchestrator selects next work
    Then only authorized, ready, dependency-satisfied tasks dispatch, ordered by priority then WBS
    And every skipped task records an actionable hold reason

  @core
  Scenario: R3 — Rest drains without starting new work
    Given running work and queued unstarted assignments
    When the strategy changes to rest
    Then no further dispatch starts, queued-unstarted assignments do not begin
    And running work finishes and reconciles, keeping its slot until reconciliation

  @core
  Scenario: R6 — Restart resumes persisted state before dispatching
    Given a persisted strategy, fleet, and in-flight assignments
    When the runtime restarts
    Then strategy and ownership are restored and reconciled before any new dispatch
    And starting the Board does not reset the active strategy
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
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity" (semantics approved 2026-09-11)
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §3 per-case traces, §4 missing production seams
- Prototype: `apps/cli/tests/fixtures/g6/strategy-prototype.ts`, `apps/cli/tests/commands/g6-strategy-prototype.test.ts`
- Preserved gates: `config/workflows/task-pipeline.yaml` readiness/verification remain authoritative

### History
