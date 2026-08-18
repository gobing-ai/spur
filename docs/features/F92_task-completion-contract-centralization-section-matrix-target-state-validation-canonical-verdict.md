---
schema_version: 1
id: "F92"
name: "Task completion contract centralization: section matrix, target-state validation, canonical verdict"
status: backlog
priority: P1
tags: []
created_at: "2026-08-18T20:03:09.425Z"
updated_at: "2026-08-18T20:06:04.273Z"
---

# F92: Task completion contract centralization: section matrix, target-state validation, canonical verdict

## Goal
Make task creation, lifecycle validation, and verification completion obey one executable contract each, so task state cannot depend on duplicated section lists, current-state checks, loose verdict casts, or contradictory agent instructions.

The outcome is a trustworthy `spur task` path: the section matrix determines task structure, transition gates evaluate the state being entered, one validated verdict policy decides completion, and plugin/stage metadata are checked projections of those runtime contracts.
## Scope
**In scope**

- Restore `config/tasks/section-matrix.yaml` as the sole semantic authority for variant/status section layout during both creation and validation.
- Add the operator-approved `spur task check --as <status>` surface, matching the existing feature-check target-state pattern, and use it for lifecycle guards and inline fallback enforcement.
- Eliminate hand-maintained creation/matrix fallback policies; package or embed the canonical matrix without restating it.
- Define one runtime-validated verdict artifact schema and one aggregation policy for requirements, Acceptance Criteria, checks, and independent task-check outcome.
- Make the existing done-transition choke point enforce target-state structure, canonical PASS verdict, provenance, and Review requirements through shared services.
- Reconcile workflow, stage-registry, and `plugins/sp` skill guidance with explicit single-writer ownership for Solution, Testing, and Review.
- Add focused unit/integration/parity tests plus same-commit `docs/04_DESIGN.md` and CLI/skill reference updates.

**Out of scope**

- New CLI nouns or verbs. `--as` is an additive option on the existing `task check` verb and was explicitly approved by the operator on 2026-08-18.
- Changes to the legal task lifecycle graph, task statuses, feature lifecycle, UI/Board behavior, corpus migrations, or baseline reconciliation.
- Replacing the workflow engine or introducing a second validation framework.
- Rewriting the answer-file table parser already repaired by task 0590; this feature consumes its normalized output.
- Broad refactors outside the files and consumers named by the three implementation tasks.
## Acceptance Criteria
```gherkin
Feature: Task completion contract centralization

  @core
  Scenario: R1 — Matrix alone determines created sections
    Given a task template variant and creation status
    When spur task create or batch-create renders the task
    Then the section headings come from the canonical section matrix entry
    And templates contribute section bodies and guidance without owning document layout

  @core
  Scenario: R2 — Transition gates evaluate target status
    Given a task transitioning from one lifecycle status to another
    When the lifecycle structural guard runs
    Then task validation evaluates the matrix and status-dependent rules as the target status
    And the task file is not mutated before the guard allows the transition

  @core
  Scenario: R3 — Missing target-required sections deny transition
    Given a task whose current-status check passes but whose target status requires an absent section
    When the task attempts that transition
    Then the transition is denied with the stable missing-section finding
    And the task remains byte-identical

  @core
  Scenario: R4 — Canonical verdict schema rejects malformed artifacts
    Given a missing, malformed, or structurally invalid verdict artifact
    When any task, feature, record, or done-gate consumer reads it
    Then the same canonical parser reports an invalid artifact
    And no consumer can cast it into a PASS verdict

  @core
  Scenario: R5 — One aggregation policy governs every verdict consumer
    Given requirement, Acceptance Criteria, check, and task-check outcomes
    When a verdict is derived, persisted, checked, or used by the done guard
    Then every consumer computes the same aggregate using one shared function
    And blocking or major review findings affect the result according to the documented policy

  @core
  Scenario: R6 — Done transition uses one completion policy
    Given any lifecycle-enabled, no-lifecycle, record-driven, or direct CLI path to done
    When the transition is requested
    Then the existing CLI choke point requires target-done structural validation, canonical PASS, provenance, and valid Review evidence
    And workflow routing cannot weaken that completion decision

  @core
  Scenario: R7 — Each pipeline stage has one task-section writer
    Given implementation, review, verification, and record stages
    When they produce task evidence
    Then implementation owns Solution, the review coordinator owns Review, and record owns Testing
    And component reviewers and verification do not overwrite another stage's section

  @core
  Scenario: R8 — Skills and registry are checked projections
    Given the runtime task and verdict contracts
    When plugin parity and documentation gates run
    Then stage artifacts, gates, and skill instructions match those contracts
    And stale static status-to-section tables are replaced by CLI queries or generated projections
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0591 | Centralize task section creation and target-state lifecycle validation | todo |
| 0592 | Canonicalize verdict artifacts, aggregation, and done-completion enforcement | todo |
| 0593 | Reconcile stage section ownership and agent-skill projections with runtime contracts | todo |
<!-- END AUTO-GENERATED -->

## Notes
**Authority split.** `config/tasks/section-matrix.yaml` owns variant/status section obligations. Runtime checker code owns finding behavior. A canonical verdict schema/aggregator owns verification artifacts. Stage registry and skills describe those contracts but must not reimplement them.

**Public surface consent.** The operator reviewed the design and agreed on 2026-08-18 to add `spur task check --as <status>` and deprecate the misleading `--strict-core` profile. Preserve `--strict-core` temporarily as a compatibility alias during the same-change plugin/workflow migration; removal requires its own compatibility decision if external consumers remain.

**Sequencing.** Task 1 establishes target-aware validation. Task 2 consumes it in the completion gate. Task 3 updates portable harness projections only after both runtime contracts are stable.
## History
