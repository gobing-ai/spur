---
template: feature-impl
schema_version: 1
name: "Encode chain-to-completion semantics in the sp:next-router skill"
description: ""
status: cancelled
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P1
tags: ["sp-plugin", "skills", "next-router"]
dependencies: ["0399"]
created_at: "2026-08-01T05:05:18.239Z"
updated_at: "2026-08-01T05:18:38.186Z"
---

## 0400. Encode chain-to-completion semantics in the sp:next-router skill

### Background

The chain belongs in the router, not spread across 28 command files. `sp:next-router`'s own charter says it must 'never be a second pipeline FSM', and it already owns TABLE A/B/C plus the `chain on success?` column — so it is the only place that knows what follows what.

Putting per-command 'what comes after me' logic in the command files would duplicate the routing table seven or more times and guarantee exactly the drift H8 exists to fix.

### Requirements
R1. Make the router the single owner of chain progression: given a task and `--next`, it resolves the next dispatch, invokes it with `--next` propagated, and repeats.
R2. Implement the stop contract from task 1 — halt on a failing gate, non-PASS verdict, HITL pause, unmet dependencies, or terminal status, reporting the halting step and reason.
R3. Halting is a normal outcome, not an error: a chain that stops at a gate reports where it stopped and exits cleanly, distinct from a chain that stops because the task is complete.
R4. Reconcile `routing-table.md` with the contract. Its rows already assume propagation; verify each `chain on success?` annotation matches the new definition and correct any that do not.
R5. Guard against runaway chains: a bound on hops, so a routing cycle or a task that keeps returning the same dispatch cannot loop forever. State the bound and what happens when it is hit.
R6. Do not change `task-pipeline.yaml` or any skill outside `next-router` — H8 changes the command surface and its router, not pipeline behavior.
### Acceptance Criteria
Covers feature scenarios R1, R2 and R3.

```gherkin
Feature: router-owned chain progression

  Scenario: A propagating --next drives a task to completion
    Given a task partway through its lifecycle
    When a dev command is run with --next
    Then the command completes its own step
    And the router resolves and invokes the next step with --next still set

  Scenario: The chain stops at a gate rather than forcing past it
    Given a chain running under --next
    When a step ends in a failing gate, a non-PASS verdict, or a HITL pause
    Then the chain halts at that step
    And the operator is told which step halted it and why
    And no later step is attempted

  Scenario: The chain stops when the work is done
    Given a chain running under --next
    When the task reaches a terminal status
    Then the chain stops without error
    And the operator is told the task is complete

  Scenario: A runaway chain is bounded
    Given a routing configuration that would dispatch indefinitely
    When a chain runs under --next
    Then the chain stops at the stated hop bound
    And it reports that the bound was reached rather than claiming completion
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
- [ ] Read the task 1 contract; treat it as the spec.
- [ ] Extend the router's documented modes with chain progression and propagation.
- [ ] Encode the stop contract, distinguishing halted-at-gate from completed.
- [ ] Audit every `chain on success?` cell in `routing-table.md` against the new definition; correct mismatches.
- [ ] Add the hop bound and its exhaustion message.
- [ ] Confirm `task-pipeline.yaml` is untouched.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T05:18:38.186Z todo → cancelled (system)
