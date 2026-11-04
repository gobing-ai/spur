---
schema_version: 1
id: "D65"
name: "One workflow interpreter and executor-agnostic agent.run dispatch"
status: done
priority: P2
tags: []
created_at: "2026-10-17T07:27:13.932Z"
updated_at: "2026-10-21T18:35:05.337Z"
---

# D65: One workflow interpreter and executor-agnostic agent.run dispatch

## Goal

Every Spur workflow runs on one interpreter — the engine — and every `agent.run` stage dispatches a self-contained work item to a resolved executor (host session, subprocess or agent fleet) and completes on a durable receipt, so fleet support is structural, `--auto` gates are `spur decision` points, and the host session stops re-executing engine mechanics (ADR-140).

## Scope

**In scope**

- Engine host executor: `agent.run` pauses the run and returns a work item; `spur workflow continue` accepts its receipt idempotently.
- One dispatch contract for host, subprocess and fleet executors with ADR-126 A4 receipt semantics.
- `spur workflow validate` lint for self-contained stages.
- Typed engine builtins: gate, decision, commit-guard, corpus transition; project commands via `spur self exec` (A92).
- HITL gates as `spur decision` points — operator responder interactively, maker under `--auto`.
- Engine-owned leases: one host-wide full-gate lock (task 1127 scope), per-task worktree, fleet occupancy.
- Engine-emitted traces; run-summary receipt-lookup fix and reported gate time.
- Pilot on `feature-verification.yaml`; E2E executor matrix (host × subprocess × fleet) on a tracked fixture workflow with one `agent.run` and one decision gate.
- `task-pipeline.yaml` rewrite to ~7 states without the proof chain, verify merged into review, tree-hash gate receipt; stage-time comparison with the 32-run baseline.
- Migration of idea-pipeline, wrapup-pipeline and pr-review; deletion of `spur workflow inline *`, the inline parity scripts and the ADR-071 proof machinery.
- Design satellite `docs/design/workflow-execution-foundation.md` and sp:spur-dev driver reference rewrite.

**Out of scope**

- `task-lifecycle.yaml` and `feature-lifecycle.yaml` (post-commit reactions; no redesign).
- Migrating the grandfathered nested CLI groups (ADR-051 2026-10-17 amendment; deferred P4).
- The ADR-051 amendment and ADR-140 text (landed directly before this feature).
- A92's action map and `spur self exec` (consumed, not built here).
- Fleet-only workflow catalogues and fleet as the default executor (ADR-126).

## Acceptance Criteria

```gherkin
Feature: One workflow interpreter and executor-agnostic agent.run dispatch

  @core
  Scenario: R1 — The host executor pauses the run with a work item at an agent.run stage
    # covers: I1, I2
    Given a workflow with one agent.run stage resolved to the host executor
    When spur workflow run --json reaches that stage
    Then the run is paused and the output carries the run id, state, skill, prompt and expected files, spur workflow continue with the work-item receipt advances the run, and repeating that continue with the same receipt changes nothing

  @core
  Scenario: R2 — Subprocess and fleet executors complete the same work item on a durable receipt
    # covers: I2
    Given the same agent.run stage resolved once to the subprocess executor and once to the fleet executor
    When the stage dispatches
    Then each completes on a durable receipt carrying the run id, and a fleet wait timeout records outcome-unknown and re-dispatches only on a failed or not-started receipt

  @core
  Scenario: R3 — Workflow validate reports a stage that is not self-contained
    # covers: I7
    Given an agent.run stage that declares no expected files and whose prompt reads a run artifact no earlier state or declared input produces
    When spur workflow validate runs on the definition
    Then it reports a finding naming the stage and the undeclared artifact, and a stage declaring its inputs and expected files passes

  @core
  Scenario: R4 — Deterministic steps run as typed engine builtins
    # covers: I8
    Given the migrated feature-verification and task-pipeline definitions
    When their actions are inspected
    Then gate, decision, commit-guard and corpus-transition steps are builtin actions, project commands run through spur self exec, and no shell action re-implements a builtin

  @core
  Scenario: R5 — Operator gates resolve as decision points under every profile
    # covers: I9
    Given a workflow whose operator gate is declared as a spur decision point
    When the run reaches the gate interactively and again under --auto
    Then the interactive run is answered by the operator responder, the --auto run is answered by the configured maker with the catalog fallback when the maker degrades, and the trace records each answer with its source

  @core
  Scenario: R6 — Engine leases serialize full gates across sessions on one host
    # covers: I10
    Given two runs on one host, in the same or different worktrees, that reach a full gate
    When both start the gate
    Then only one holds the host gate lease, the other waits or stops with the holder named, and the lease is released when the holding run finishes, fails or is cancelled; per-task worktrees and fleet occupancy are acquired and released by the engine the same way

  @core
  Scenario: R7 — Run summaries report gate time and engine-emitted traces
    # covers: I6, I11
    Given a completed task run whose gate wrote its check receipt
    When the run summary renders
    Then the gate time is non-null and matches the receipt, and every executed action has an engine-emitted action trace carrying the run id under each executor

  @core
  Scenario: R8 — Feature verification runs on the foundation
    # covers: I3
    Given the migrated feature-verification definition
    When spur workflow run feature-verification.yaml runs for a feature
    Then verification runs through the gate builtin with the check-feature action under the gate lease, and the done and failed routing and the evidence receipt match the pre-migration behavior

  @core
  Scenario: R9 — The executor matrix shows identical traces across executors
    # covers: I2, I14, I20
    Given a tracked fixture workflow with one agent.run stage and one decision point
    When the E2E executor matrix runs it under the host, subprocess and fleet executors
    Then every run reaches done with the same action sequence, receipt shape and terminal reason, the matrix writes a repeatable report artifact, and an unavailable fleet is reported as blocked with its missing precondition instead of passing

  @core
  Scenario: R10 — The task pipeline runs as a seven-state graph without the proof chain
    # covers: I4, I12
    Given the rewritten task-pipeline definition
    When its states and actions are inspected
    Then its working states are precheck, implement, escalate, gate, remediate and review, routing uses decision calls on transitions, review output carries per-requirement and AC traceability, and no proofDigest, fingerprint, verifiedOutcome or record step remains

  @core
  Scenario: R11 — A passing gate receipt is reused while the tree hash is unchanged
    # covers: I12
    Given a task whose gate passed and wrote a receipt keyed by the git tree hash
    When the gate is reached again with the same tree hash and then after a file change
    Then the first visit reuses the receipt without running the check, and the second runs the check and writes a new receipt

  @core
  Scenario: R12 — The rewritten task pipeline is measured against the baseline
    # covers: I15
    Given the 32-run stage-time baseline and a real task run on the rewritten pipeline under the executor matrix
    When the comparison report is produced
    Then it lists per-stage and total wall time beside the baseline with driver overhead shown separately

  @core
  Scenario: R13 — Remaining workflows migrate and the inline bookkeeping surface is removed
    # covers: I1, I16
    Given idea-pipeline, wrapup-pipeline and pr-review migrated to the foundation
    When the CLI and repository are inspected
    Then spur workflow inline and its sub-verbs no longer exist, the inline parity check script and its contract test are deleted, and the driver references describe the run, work, continue loop

  @core
  Scenario: R14 — The design satellite documents the foundation
    # covers: I13
    Given the design index in docs/04_DESIGN.md
    When the workflow execution foundation satellite is read
    Then it specifies the work-item shape, executor resolution, receipt semantics, builtins, decision points, leases and the coexistence window, and cites ADR-140

  @edge
  Scenario: R15 — New commands keep the noun verb shape
    # covers: I18
    Given the CLI command tree after the feature
    When nested command groups are enumerated
    Then none exists beyond the grandfathered list in the ADR-051 2026-10-17 amendment

  @edge
  Scenario: R16 — Foundation tasks depend on the A92 action map
    # covers: I19
    Given the D65 task set
    When task dependencies are listed
    Then every task that consumes spur self exec or edits task-pipeline gate variables depends on the A92 task that delivers it
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1231 | Author the workflow execution foundation design satellite | done |
| 1232 | Executor-agnostic agent.run dispatch with host pause and durable receipt | done |
| 1233 | Lint self-contained stages in workflow validate | done |
| 1234 | Typed engine builtins for gate, commit-guard and corpus transition | done |
| 1235 | Engine-owned leases for the gate, worktree and fleet occupancy | done |
| 1236 | Resolve operator gates as decision points under every profile | done |
| 1237 | Report gate time and engine traces in run summaries | done |
| 1238 | Pilot feature-verification on the foundation and run the executor matrix | done |
| 1239 | Rewrite task-pipeline as a seven-state graph without the proof chain | done |
| 1240 | Measure the rewritten task-pipeline against the 32-run baseline | done |
| 1241 | Migrate idea, wrapup and pr-review pipelines onto the foundation | done |
| 1242 | Delete the inline bookkeeping verbs and parity scripts | done |
<!-- END AUTO-GENERATED -->

## Notes

### Current reading — 2026-10-21

D66 subsequently consolidated workflow lifecycle ownership and retired this feature’s pilot feature-verification workflow. The single-interpreter and executor-agnostic primitives remain current.

## History

- 2026-10-17T17:17:52.534Z backlog → active (system)
- 2026-10-18T02:07:40.922Z active → verifying (system)
- 2026-10-18T02:07:56.470Z verifying → done (system)

