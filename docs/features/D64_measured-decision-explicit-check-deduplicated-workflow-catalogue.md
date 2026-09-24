---
schema_version: 1
id: "D64"
name: "Measured, decision-explicit, check-deduplicated workflow catalogue"
status: active
priority: P2
tags: []
created_at: "2026-09-24T00:07:59.728Z"
updated_at: "2026-09-24T17:32:09.158Z"
---

# D64: Measured, decision-explicit, check-deduplicated workflow catalogue

## Goal

Refactor Spur's workflow catalogue, once D63, E7, H53 and H1 land, so daily development runs are cheaper, more reliable and observable by evidence rather than by state count. Every workflow change is justified by measured cost (agent.run count, wall time, failure/terminal-reason mix) and promoted through the ADR-076 gate. Checking is centralised in a two-tier `spur-check` primitive whose receipts are reused across stages. Fuzzy branching uses DecisionMaker through an explicit non-pausing `decide` action. The ready agent fleet becomes an optional executor surface beside the traditional path.

## Scope

**In scope**

- Sequencing: implementation starts only after features D63, E7, H53 and H1 are done; tasks carry those dependencies.
- Phase 0 — instrument: terminal-reason taxonomy on runs, lifecycle bookkeeping separated from metric rollups, per-workflow cost baseline report (agent.run count, wall time, retries, terminal reason).
- Phase 1a — `spur-check` primitive: skill `sp:spur-check` with an accumulative lightweight tier (changed-scope, receipt-reusing) and a comprehensive tier (quality gate); receipts keyed by the proof fingerprint and reused across implement/test/review/verify/record; `bun run spur-check` becomes the comprehensive entry point; duplicate gate invocations removed from workflows.
- Phase 1b — fleet executor: optional third executor surface that dispatches `agent.run` to `agent.fleet` members via `spur message` / `spur agent`, selected by `--agent fleet` or a workflow var when `agent.fleet.enabled`; traditional inline and subprocess surfaces remain default and unchanged.
- Phase 1c — `decide` action: first-class, non-pausing workflow action wrapping DecisionMaker for fuzzy classification only, with inline-driver parity, recorded decision provenance and a deterministic degraded default when no backend is configured.
- Phase 2 — measured refactors via candidate promotion: task-pipeline triage lanes and failure triage (replace blind retry caps), wrapup doc-sync, history-anatomy correct-and-enrich, idea-pipeline guard legibility.
- Phase 3 — catalogue reconciliation: keep / fix / retire decisions for low-use workflows (e.g. pr-review, wayfinder) with evidence.

**Out of scope**

- A new workflow engine, nested workflows, or parallel `<name>2.yaml` copies.
- Using DecisionMaker for facts a deterministic command can establish.
- Removing operator taste pauses (idea-eval, design-approval, approve).
- A new public `spur` noun/verb without separate operator consent (the `spur-check` CLI surface is consent-gated).
- Making the fleet the default executor.

## Acceptance Criteria

```gherkin
Feature: Measured, decision-explicit, check-deduplicated workflow catalogue

  @core
  Scenario: R1 — Refactor work starts only after its prerequisite features finish
    # covers: I1, I8
    Given features D63, E7, H53 and H1 and the evaluated refactor plan recorded for this feature
    When a task of this feature is selected for execution
    Then the task declares its dependency on the prerequisite work
    And it cannot enter implementation while any prerequisite feature is not done

  @core
  Scenario: R2 — Every workflow run ends with a classified terminal reason
    # covers: I2, I4, I7
    Given a canonical workflow run on any execution surface
    When the run reaches a terminal or paused state
    Then the run records one terminal reason from a closed taxonomy
    And lifecycle bookkeeping rows are separated from the metric rollups used for cost comparison

  @core
  Scenario: R3 — A per-workflow cost baseline is reproducible from recorded runs
    # covers: I2, I5, I7
    Given attributable runs for each canonical workflow
    When the baseline report is generated
    Then it lists agent.run count, wall time, retry count and terminal-reason mix per workflow and state
    And the same inputs produce the same report

  @core
  Scenario: R4 — Workflow shape changes are accepted only on measured benefit
    # covers: I2, I3, I4, I5
    Given a candidate workflow that adds, splits, combines or retires states
    When it is evaluated against the pinned baseline before its deadline
    Then it is promoted only when it projects strictly fewer agent.run actions or meets its declared measured target without lowering the safety floor
    And a candidate that adds states without measured benefit is retired and leaves the current graph unchanged

  @core
  Scenario: R5 — Fuzzy branching uses an explicit non-pausing decide action
    # covers: I6, I4
    Given a workflow state whose branch depends on a fuzzy classification
    When the decide action runs on the inline or subprocess surface
    Then the decision, method, backend and rationale are recorded as a trace row
    And a missing or failing decision backend yields the declared deterministic default instead of a pause or crash
    And deterministic facts are established by commands, never by the decide action

  @core
  Scenario: R6 — Lightweight checks accumulate during development
    # covers: I9
    Given a task in implementation with a recorded proof fingerprint
    When the lightweight spur-check tier runs after an edit
    Then it checks only the changed scope and reuses receipts whose fingerprint is unchanged
    And it records a receipt keyed by the current fingerprint

  @core
  Scenario: R7 — The comprehensive check runs once at the quality boundary
    # covers: I9
    Given a task reaching its quality boundary with lightweight receipts
    When the comprehensive spur-check tier runs
    Then lint, typecheck, tests and pre/post rules execute once for the current fingerprint
    And later review, verify and record stages reuse that receipt instead of re-running the same checks
    And a changed fingerprint invalidates the receipt and forces a fresh comprehensive run

  @core
  Scenario: R8 — The agent fleet is an optional executor surface
    # covers: I10
    Given agent.fleet is enabled with members and the operator selects the fleet executor
    When a workflow reaches an agent.run action
    Then the action is dispatched to a fleet member through spur message and spur agent coordination
    And the run records the same identity, evidence and terminal reason as the traditional surfaces
    And with the fleet disabled or not selected the traditional inline and subprocess surfaces run unchanged

  @core
  Scenario: R9 — Task pipeline routes work by triage lane and failure class
    # covers: I2, I3, I5
    Given a task with a classified change risk and a failing stage
    When the task pipeline chooses its next state
    Then a low-risk lane skips the review agent.run while keeping the comprehensive check
    And a failure is classified before retry so that non-retryable failures stop instead of looping to the retry cap

  @core
  Scenario: R10 — Catalogue workflows are kept, fixed or retired on evidence
    # covers: I3, I7
    Given the canonical workflow catalogue and its measured usage and cost
    When the catalogue reconciliation runs
    Then each workflow has a recorded keep, fix or retire decision with its evidence
    And retired workflows are removed from the catalogue with their callers rerouted
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0937 | Record a closed terminal reason on every workflow run and separate bookkeeping rows | todo |
| 0938 | Emit a reproducible per-workflow cost baseline report | todo |
| 0939 | Add the two-tier spur-check primitive with fingerprint-bound receipts | todo |
| 0940 | Reuse check receipts across task-pipeline stages as a measured candidate | todo |
| 0941 | Add a non-pausing decide workflow action backed by DecisionMaker | todo |
| 0942 | Add the opt-in fleet executor surface for agent.run | todo |
| 0943 | Route task-pipeline work by triage lane and failure class | todo |
| 0944 | Skip clean model passes in wrapup doc-sync and history-anatomy | todo |
| 0945 | Make idea-pipeline guards legible with terminal reasons on failure edges | todo |
| 0946 | Reconcile the workflow catalogue with keep, fix or retire decisions | todo |
| 0947 | Make idea-pipeline ready-prepare audit premise correctness and re-stamp evidence after re-parenting | wip |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-24T00:15:32.526Z moved O → D64 (system)
- 2026-09-24T17:32:09.158Z backlog → active (system)

