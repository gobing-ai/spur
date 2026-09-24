---
schema_version: 1
id: "D63"
name: "Reliable and measured daily-workflow adoption"
status: active
priority: P2
tags: []
created_at: "2026-09-22T02:55:20.144Z"
updated_at: "2026-09-24T19:59:44.152Z"
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
    Given the 0912-selected observability pilot and a possible later task-pipeline speed candidate
    When attributable real runs are evaluated under their separately declared targets and deadlines
    Then the observability pilot is validated without being labeled a speed improvement
    And any speed candidate requires the safety floor, activation eligibility, declared benefit and reliability criteria
    And an unproven candidate is retired, or insufficient evidence leaves the current graph unchanged

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
| 0914 | Make installed inline workflow execution use the authoritative application boundary | done |
| 0915 | Bind feature completion and wrapup to current verification evidence | done |
| 0916 | Make canonical workflow interruption and replay behavior explicit | done |
| 0917 | Deliver the measured task-pipeline optimization selected by 0912 | done |
| 0918 | Simplify idea authoring without weakening the planning handoff | done |
| 0919 | Reconcile batch continuation against the original frozen plan | done |
| 0920 | Make history workflow scope normalization deterministic | done |
| 0921 | Complete measured workflow migration and catalogue reconciliation | done |
| 0935 | Settle D63 0917 inline-run evidence debt and close the feature | done |
| 0936 | Preserve feature scenario-key rows when re-verifying and re-recording a task | done |
<!-- END AUTO-GENERATED -->

## Notes

Architecture and eight-task breakdown accepted by Robin on 2026-09-21. Planning authority: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registration itself did not execute the refactoring.

0912 and 0913 are done under their own owners. 0912 selected an inline observability pilot, not a speed route; D63 R4 and task 0917 distinguish those decisions. Task 0914 is done. Tasks 0915, 0918 and 0920 are todo with ready delegated designs; 0916, 0917, 0919 and 0921 remain blocked on recorded prerequisites. 0918's graph edit is not yet eligible: its selected definition has only one current-digest terminal done run, so its agent begins with the frozen evidence gate and may return a no-change result. The independent idea/history baselines need not wait for 0917's observation window. Each candidate retains ADR-107 eligibility and ADR-076 promotion/retirement. The 56-hour estimate excludes observation and the separately owned 0912/0913 work.

Feature scenarios R1–R8 map in order to proposal labels W01–W08; task-local regression criteria supplement the stable scenario titles. A task's insufficient-evidence verdict does not assert a feature-level speed improvement.

## History

- 2026-09-22T21:46:38.980Z backlog → active (system)
- 2026-09-23T18:22:08.867Z active → blocked (system)
- 2026-09-24T00:35:33.685Z blocked → active (system)
- 2026-09-24T19:57:52.583Z active → verifying (system)
- 2026-09-24T19:59:44.152Z verifying → active (system)

