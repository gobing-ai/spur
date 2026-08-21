---
schema_version: 1
id: "D6"
name: "Workflow cost, deterministic ownership surface, and role-addressed coordination"
status: done
priority: P2
tags: []
created_at: "2026-08-20T00:08:14.252Z"
updated_at: "2026-08-20T21:55:08.156Z"
---

# D6: Workflow cost, deterministic ownership surface, and role-addressed coordination

## Goal
Close the three requests from the original workflow-refactor brief that feature D5 could not carry: actively **reduce** model-query cost and pipeline wall-clock (D5 only ever promised non-regression), decide the **public CLI surface** that lets compound shell move into owned capabilities (D5 put new verbs out of scope), and resolve **role-addressed coordination** for `spur agent wait` / `spur message` (D5 R6 deferred it with no follow-up tracked).
## Scope
**Provenance.** These three items come from the operator's original `/sp:dev-idea` brief that produced D5. A 2026-08-19 coverage audit of that brief against D5 (R1–R12) and the whole task corpus found them to be the only requests with no covering task. Everything else in the brief is covered by D5, or was scoped out there for a stated reason that still holds.

In scope:

- **Query cost and wall-clock as budgets, not floors.** Measure per-pipeline model-query count and wall-clock, identify adjacent `agent.run` hops whose prompts can merge into one query without losing the gate they enforce, and set an enforced budget. The brief asked to "merge some LLM queries into one to reduce the LLM query cost" and flagged that "the whole execution process is still slow"; D5 R7 only committed to "the measured model-query count does not increase".
- **The public CLI/capability surface for compound shell.** Decide, under ADR-051, which deterministic behavior currently living in pipeline shell earns a public `spur` verb, an application service, a built-in, or a workflow-relative external extension — and land the chosen surface. The brief asked to "centralize these shell logic to be the part of spur CLI itself or some built-in extention or some external extension"; D5 restricted itself to *existing* CLI operations, which is what left `qualityGateCmd` and the `task-pipeline` precheck doctor probe unmigrated in task 0604.
- **Role-addressed coordination beyond `agent.run`.** Resolve whether `spur agent wait` and `spur message` gain role addressing, including the concrete caller, exact-one resolution, persisted occupant pin, and ADR-051 consent that D5 R6 named as preconditions. A reasoned "no" that retires the question is an acceptable outcome; leaving it untracked is not.

Out of scope:

- Re-running D5's migration waves, or D5's own closure work (task 0606 owns the eval-pipeline bar, the pipeline2 retirement, the composition-checker `invocation` gap, and the ADR-072 decision).
- EventBus or `system_events` as a workflow mutation/control authority — ADR-070 and D5 R4 already settled that events are read-side wakeups only, and the original brief's "leverage event pub/sub to make the workflow more reliable and dynamic" is answered by that decision, not reopened here.
- Broadcast or fan-out message addressing; only exact-one role resolution is in question.
- Changing the proof-state invariant (ADR-071) or any post-verification mutation rule.
## Acceptance Criteria
```gherkin
Feature: Workflow cost, deterministic ownership surface, and role-addressed coordination

  @core
  Scenario: R1 — Model-query cost and wall-clock are measured per pipeline
    Given the shipped pipelines carry agent.run hops whose cost has only ever been bounded as "not increasing"
    When the cost baseline is captured
    Then each pipeline records its model-query count and wall-clock against a named fixture set
    And the measurement is reproducible from a source-local command, not a hand-timed run
    And the numbers are committed as a checked budget rather than a prose claim

  @core
  Scenario: R2 — Mergeable model queries are consolidated without losing a gate
    Given adjacent agent.run hops that ask one model for judgments a single prompt could return
    When consolidation candidates are evaluated
    Then each merge preserves every gate, artifact, and failure edge the separate hops enforced
    And a merge that would fold a HITL pause or a verdict boundary into another hop is rejected
    And the post-merge model-query count is strictly lower than the recorded baseline

  @core
  Scenario: R3 — A pipeline exceeding its cost budget fails visibly
    Given a committed per-pipeline query and wall-clock budget
    When a change pushes a pipeline past its budget
    Then the gate fails naming the pipeline, the budget, and the measured value
    And the budget can only be raised by an explicit recorded decision, never silently

  @core
  Scenario: R4 — Compound pipeline shell has a decided owner under ADR-051
    Given deterministic behavior that lives in pipeline shell because no owned capability can host it
    When each case is classified
    Then it resolves to a public spur verb, an application service, a built-in, or a workflow-relative external extension
    And every new or changed public surface carries explicit operator consent with design context
    And a case deliberately left in shell records why, so the exception is visible rather than assumed

  @core
  Scenario: R5 — The chosen surface lands and the shell it replaces is deleted
    Given a consented ownership decision for a shell program
    When the owning capability ships with unit and failure-path tests
    Then the pipeline invokes the capability and the replaced shell is removed, not left beside it
    And the composition baseline records the new action facts in the same commit
    And behavior parity is proven by the affected pipeline's own tests

  @core
  Scenario: R6 — Role-addressed wait and message are resolved, not left open
    Given agent.run supports role-based executor selection but wait and message are identity-pinned
    When role addressing is evaluated against a concrete caller
    Then the outcome is either shipped role addressing with exact-one resolution, a persisted occupant pin, and ADR-051 consent, or a dated decision record closing the question
    And a decision to keep identity pinning authoritative states the reason rather than lapsing silently
    And no broadcast or fan-out addressing is introduced under either outcome
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0607 | Measure and reduce pipeline model-query cost and wall-clock | done |
| 0608 | Decide and land the ownership surface for compound pipeline shell | done |
| 0609 | Resolve role-addressed coordination for agent wait and message | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-08-20T02:09:16.114Z backlog → active (system)
- 2026-08-20T21:53:35.698Z active → verifying (system)
- 2026-08-20T21:55:08.156Z verifying → done (system)
