---
schema_version: 1
id: "D63"
name: "Reliable and measured daily-workflow adoption"
status: backlog
priority: P2
tags: []
created_at: "2026-09-22T02:55:20.144Z"
updated_at: "2026-09-22T03:00:27.112Z"
---

# D63: Reliable and measured daily-workflow adoption

## Goal

Make Spur's daily-development workflows portable, faster where measured, and reliable at completion and recovery boundaries by adopting the recently shipped execution contracts across the canonical catalogue.

## Scope

**In scope**

- Authoritative installed inline execution using the existing application boundary.
- Current-input verification receipts and correct wrapup/feature-completion ordering.
- Safe interruption/replay adoption, including human decisions, research limits and external request identity.
- The measured task-pipeline pilot selected by 0912; bounded idea-authoring and history-normalization candidates.
- Frozen-plan batch continuation and catalogue-wide source/installed/override compatibility.
- Required supporting CLI transports, existing skills, generated plugin artifacts and init defaults within those outcomes.

**Out of scope**

- Reimplementing B6/B7/B8/G66, D3 recovery, D-owned DecisionMaker tasks 0910/0911, or D62 tracing/promotion mechanisms.
- Taking over tasks 0912 or 0913, owned by another agent.
- A new engine, batch FSM, universal workflow, standing v2 graphs, or new skill/subagent by default.
- Automatic external publication, removal of independent verification, overwriting project overrides, or token pricing.
- New public CLI surfaces without a concrete separately consented design.

Owner boundary: D62 owns the existing economy mechanisms and 0912 baseline; D63 owns their portable, measured adoption and remaining completion/recovery integration across daily workflows.

## Acceptance Criteria

```gherkin
Feature: Reliable and measured daily-workflow adoption

  @core
  Scenario: R1 — Installed and source execution preserve authoritative identity
    Given a supported source or bundle-only installed workflow invocation and its selected definition
    When inline or subprocess execution records its identity and evidence
    Then the definition layer and digest match the authoritative resolver
    And unsupported capabilities fail explicitly without silently downgrading

  @core
  Scenario: R2 — Completion uses current evidence
    Given feature verification evidence bound to its checked inputs and run
    When feature completion evaluates the evidence
    Then changed tree, spec, check contract, wrong identity, missing evidence or FAIL cannot satisfy completion
    And unchanged valid evidence can be reused after relevant wrapup edits have been checked

  @core
  Scenario: R3 — Recovery preserves ownership and side effects
    Given an interrupted or paused workflow with recorded ownership and action outcomes
    When the operator resumes it through its supported execution surface
    Then the existing ownership and entry semantics are preserved
    And replay cannot duplicate an external request, bypass a human decision or produce false completion

  @core
  Scenario: R4 — Task optimization earns promotion
    Given a bounded task-pipeline candidate selected from 0912 with predeclared success criteria and a deadline
    When the existing promotion process evaluates its comparable real execution evidence
    Then promotion requires the safety floor, activation eligibility and declared benefit and reliability criteria
    And an unproven candidate is retired by its deadline with no fabricated speed improvement

  @core
  Scenario: R5 — Planning preserves intent through handoff
    Given an idea with requested scope, acceptance criteria and required design decisions
    When the optimized idea path prepares its task handoff
    Then all requested scope and valid design and acceptance criteria survive the dependency-bound preparation
    And ambiguity and unresolved human decisions prevent a false ready handoff

  @core
  Scenario: R6 — Batch continuation uses the original authorized set
    Given an interrupted batch with a frozen plan and child-run evidence
    When the batch resumes with potentially newer checkpoints or changed task listings
    Then the original membership and worktree identity remain authoritative
    And unrelated checkpoints and stale results cannot silently add or skip work

  @core
  Scenario: R7 — Diagnostics retain validity with fewer unnecessary model calls
    Given explicit daily or ad-hoc history arguments and the current analysis inputs
    When the history workflow normalizes scope and generates its report
    Then declared argument normalization uses deterministic validation without a scope model call
    And fresh analysis, digest-keyed caching, independent validation and atomic publication retain their guarantees

  @core
  Scenario: R8 — Migration preserves users and demonstrates outcomes
    Given the accepted catalogue dispositions and per-workflow candidates
    When the migration is checked across source, installed and project-override callers
    Then resolution precedence, active-run identity handling and rollback remain explicit and supported
    And each candidate is promoted or retired with evidence and user-owned overrides and history are preserved
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0914 | Make installed inline workflow execution use the authoritative application boundary | todo |
| 0915 | Bind feature completion and wrapup to current verification evidence | todo |
| 0916 | Make canonical workflow interruption and replay behavior explicit | blocked |
| 0917 | Deliver the measured task-pipeline optimization selected by 0912 | blocked |
| 0918 | Simplify idea authoring without weakening the planning handoff | blocked |
| 0919 | Reconcile batch continuation against the original frozen plan | blocked |
| 0920 | Make history workflow scope normalization deterministic | blocked |
| 0921 | Complete measured workflow migration and catalogue reconciliation | blocked |
<!-- END AUTO-GENERATED -->

## Notes

Architecture and eight-task breakdown accepted by Robin in this conversation (2026-09-21). Planning authority: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registration does not execute the refactoring.

Tasks 0912 and 0913 remain independently owned prerequisites. Tasks 0914/0915 are todo for refinement; 0916–0921 are blocked on recorded prerequisites. Batch creation assigns todo and the current lifecycle refuses todo → backlog, so dependent tasks use the supported blocked state. Evidence premises and workflow-change decisions must be satisfied before execution. ADR-107 eligibility and ADR-076 promotion/retirement remain binding. Approximate new engineering effort is 56 hours, excluding observation and 0912/0913.

Feature scenarios R1-R8 map in order to proposal labels W01-W08; the task roster records allocated WBS values. Task-local regression criteria supplement those scenario titles.

## History
