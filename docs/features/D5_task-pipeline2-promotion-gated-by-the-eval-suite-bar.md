---
schema_version: 1
id: "D5"
name: "Workflow pipeline contract, progress projection, and staged consolidation"
status: active
priority: P2
tags: []
created_at: "2026-08-19T05:34:31.735Z"
updated_at: "2026-08-20T00:07:13.995Z"
---

# D5: task-pipeline2 promotion gated by the eval-suite bar

## Goal

Establish a deterministic-first workflow composition contract and shared progress infrastructure, then consolidate Spur's pipeline workflows into observable, proof-preserving canonical paths.

## Scope

- In scope:
  - Record the workflow YAML, shell, deterministic-action, agent-input, observability, and post-verification mutation rules in `docs/00_ADR.md`, including resolution of ADR-029's planning-pipeline deferral.
  - Review all six shipped pipeline workflows, freeze their graph/artifact/failure/model-query baselines, map prerequisites, and migrate them in a deliberate order with per-pipeline tests.
  - Add one persisted workflow progress projection, with read-side event wakeups and polling fallback, for detailed inline and trace todo/progress views.
  - Place reusable deterministic behavior in existing CLI/application services, least-privilege built-ins, or external extensions according to ownership; refine existing skills and slash commands only for demonstrated gaps.
  - Retire the duplicate planning path, end with exactly one canonical task pipeline by deleting the unreferenced `task-pipeline2.yaml` and closing the promotion question with a dated decision record, and integrate advisory per-HEAD PR review at the feature/branch boundary.
- Out of scope:
  - EventBus or `system_events` as a workflow mutation/control authority, and generic event-driven waits without a concrete external dependency.
  - Raw role addressing or broadcast for `spur agent wait` or `spur message`; identity-pinned occupant semantics remain authoritative.
  - A new public CLI noun or verb, or any unapproved change to existing public flags, JSON, or human output.
  - Implementing E7 run-record history/retention work, J9 event-presentation remediation, or unrelated non-pipeline workflows as primary refactor targets.

## Acceptance Criteria

```gherkin
Feature: Workflow pipeline contract, progress projection, and staged consolidation

  @core
  Scenario: R1 — Workflow composition rules are authoritative and enforceable
    Given workflow behavior is split across YAML, CLI commands, built-ins, extensions, and agent capabilities
    When the workflow design decisions are recorded
    Then `docs/00_ADR.md` defines ownership for YAML, shell, deterministic logic, and model judgment
    And it defines the observability/query-balance rule and the post-PASS mutation invariant
    And it separates state effects from evidence writes, uses structured gate execution, and preserves merged run metadata
    And ADR-029 records the deliberate retirement or retention decision for `planning-pipeline.yaml`

  @core
  Scenario: R2 — Every shipped pipeline has a reviewed disposition and frozen baseline
    Given docs, idea, planning, task, task-pipeline2, and wrap-up pipeline definitions
    When migration planning is frozen before the first refactor
    Then each pipeline has a deliberate keep, absorb, merge, or retire disposition
    And each has prerequisite, graph, artifact, failure-policy, caller, and model-query baselines
    And the migration order names a pipeline-specific exit gate before the next pipeline changes

  @core
  Scenario: R3 — Long runs expose one detailed persisted todo projection
    Given running, looping, failed, skipped, and completed workflow fixtures
    When an inline driver or workflow trace requests detailed progress
    Then both consume one projection derived from the workflow definition and persisted run rows
    And every state and action is shown as pending, active, completed, failed, or terminally skipped
    And attempts, visits, elapsed time, timeout, current action, diagnostics, artifacts, and next eligible transition are exposed when known

  @core
  Scenario: R4 — Event wakeups cannot become workflow mutation authority
    Given a progress follower reconnects or observes a missing or duplicate event notification
    When it refreshes a workflow run
    Then it re-reads persisted workflow state and reconstructs the same progress projection
    And no EventBus or `system_events` notification directly authorizes a workflow transition or mutation

  @core
  Scenario: R5 — Deterministic workflow programs have explicit least-privilege owners
    Given compound shell logic or a model query whose result is derivable locally
    When the owning pipeline is refactored
    Then reusable product behavior uses an existing CLI operation, application service, or capability-specific built-in
    And project-only policy uses a workflow-relative external extension
    And command gates use literal executable/args for a named project script rather than a shell-shaped runtime string
    And YAML shell actions remain short invocations or trivial glue with focused unit and failure-path tests

  @core
  Scenario: R6 — Role-aware workflow coordination preserves occupant identity
    Given reviewed pipelines declare roles for model work but have no cardinality-one role-addressed wait or message requirement
    When agent and message support is evaluated
    Then `agent.run` keeps role-based executor selection
    And wait and message operations remain pinned to a concrete spec, run, and generation
    And any future role binding requires a concrete caller, exact-one resolution, a persisted occupant pin, and public-surface consent

  # RESOLVED 2026-08-20 (task 0609 R2): the R6 deferral above was recorded only here until it
  # became an explicit decision. ADR-075 (Accepted) closes the question — no concrete caller
  # exists on the pipeline or team/coordination surface, so wait and message stay
  # identity-pinned and no role addressing ships. Reopening evidence is listed in ADR-075.

  @core
  Scenario: R7 — Lower-risk pipelines migrate without behavior or query-count regression
    Given the shared deterministic and progress prerequisites are available
    When `wrapup-pipeline.yaml` and then `docs-pipeline.yaml` are migrated
    Then each preserves its transition, artifact, and failure contracts
    And deterministic metrics and verdict construction no longer require model judgment
    And the measured model-query count does not increase

  @core
  Scenario: R8 — Planning has one canonical entry path
    Given `planning-pipeline.yaml`, the idea pipeline, and `/sp:dev-plan` overlap
    When planning semantics and approval gates are reconciled
    Then required phasing and design-approval behavior is absorbed into the canonical idea/dev-plan path
    And all callers, scaffolds, bundles, skills, commands, and docs stop referencing `planning-pipeline.yaml`
    And the duplicate workflow is removed only after parity tests pass

  @core
  Scenario: R9 — Task execution preserves verification proof and ends with one canonical pipeline
    Given `task-pipeline2.yaml` was a parallel graph that once permitted agent mutation after a PASS verdict
    When the canonical task pipeline and residual-completeness behavior are redesigned
    Then residual checking is read-only or mutation re-enters bounded remediation, quality, review, and `--fix none` verification
    And the final quality, review, and verification evidence names one unchanged proof-input digest before record or done
    And exactly one canonical task pipeline remains, the duplicate graph having been deleted rather than promoted
    And the promotion question is closed by a dated decision record instead of being left open behind an unrun bar

  @core
  Scenario: R10 — The idea pipeline migrates last with deterministic handoff and concise agent inputs
    Given the idea pipeline has the widest artifact and retry surface
    When it is migrated after the other pipeline contracts stabilize
    Then batch validation, dependency wiring, readiness calculation, and handoff assembly run through tested deterministic capabilities
    And model inputs are concise skill or slash-command invocations
    And existing capabilities are refined before any new skill or command is introduced

  @core
  Scenario: R11 — PR review spends quota once per stable integration HEAD without blocking by default
    Given local task gates have passed for a stable feature or branch HEAD
    When the existing PR-review workflow is invoked at the integration boundary
    Then current-HEAD deduplication prevents duplicate review requests
    And findings route back through affected local gates before merge
    And pending, timeout, quota unavailability, or unavailable review is recorded but remains advisory unless the operator explicitly requires clean review

  @core
  Scenario: R12 — Every migration is independently verified and shipped surfaces stay synchronized
    Given a pipeline migration is proposed
    When its schema, graph, artifact, failure-injection, model-query, scaffold, bundle, and targeted unit gates run
    Then the next migration does not start until the current pipeline's exit evidence passes
    And public surface changes remain separately consented under ADR-051
    And the final repository, corpus, workflow-validation, documentation-sync, and build gates pass
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0603 | Establish workflow composition contract and shared execution infrastructure | todo |
| 0604 | Migrate, consolidate, and integration-review pipeline workflows | todo |
<!-- END AUTO-GENERATED -->

## Notes

### Chosen architecture

- Reject `task-pipeline2.yaml` promotion at the static semantic gate: its post-PASS `agent.run` may mutate the tree and then reaches `record` without re-running quality, review, or verification.
- Use a hybrid infrastructure-first sequence: freeze current behavior, add only shared primitives demanded by reviewed pipelines, then migrate one pipeline at a time. Do not spend more evaluation quota on the current unsafe candidate.
- Build one `WorkflowProgressProjection` from the workflow definition plus persisted run, phase, transition, and action rows. `system_events`/`followSystemEventsAfter` wake readers; readers always re-read persisted truth and retain bounded polling fallback.
- Keep role selection on `agent.run`. Do not add raw role addressing to identity-pinned wait/message operations; add a future exact-one bind step only for a concrete workflow caller and only after ADR-051 consent.
- Keep `pr-review.yaml` separate and invoke it once per stable integration HEAD after local gates and before merge/cleanup. Pending or unavailable review is advisory by default.

### Final topology

- Keep `docs-pipeline.yaml`, `wrapup-pipeline.yaml`, and `idea-pipeline.yaml` as separate lifecycle workflows.
- Absorb `planning-pipeline.yaml` into the canonical idea/dev-plan path, then retire it.
- Refactor `task-pipeline.yaml` as the canonical execution graph; redesign pipeline2 as a temporary safe delta, merge it after the promotion bar passes, then delete pipeline2.
- Keep `pr-review.yaml` as a separate feature/branch integration workflow.

### Migration order

1. Record ADR decisions, consent boundaries, and all-pipeline graph/artifact/failure/query baselines; statically freeze pipeline2 promotion.
2. Add the persisted progress projection, read-side event wakeup, classified command-gate/retry, least-privilege run-artifact, and deterministic domain primitives.
3. Migrate wrap-up, then docs, each behind its own parity and failure-injection gate.
4. Absorb planning semantics and retire the duplicate planning workflow after caller/scaffold/bundle parity.
5. Refactor the canonical task pipeline; redesign residual completeness as read-only or bounded fix → gate → review/verify.
6. Run the agreed promotion suite, merge the safe candidate delta, and remove pipeline2 only after operator approval.
7. Migrate the idea pipeline last, integrate advisory per-HEAD PR review, and finish documentation/scaffold/bundle/repository gates.

### Decomposition decision

- Parent rubric: E2 D2 L2 C2 R2 = 10 → decompose because infrastructure and migration have distinct high-risk review/rollback boundaries.
- Operator-approved override: create exactly two dependency-ordered WBS tasks. D5-A–D5-P are internal Plan handles, not task corpus entries.
- Task 1 owns the contract and shared prerequisites and performs no pipeline migration. Task 2 depends on Task 1 and owns the staged migrations and consolidation.

## History

- 2026-08-19T21:21:02.867Z backlog → active (system)
- 2026-08-19T21:21:03.135Z active → verifying (system)
- 2026-08-19T21:21:13.190Z verifying → done (system)
- 2026-08-20T00:07:13.995Z done → active (system)
