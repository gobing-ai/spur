---
schema_version: 1
id: "D66"
name: "Workflow consolidation: one owner per lifecycle, D65 primitives everywhere"
status: active
priority: P2
tags: []
created_at: "2026-10-18T05:06:26.563Z"
updated_at: "2026-10-18T06:45:10.247Z"
---

# D66: Workflow consolidation: one owner per lifecycle, D65 primitives everywhere

## Goal

Reduce the bundled workflow set to the definitions that own a distinct lifecycle, give feature state exactly one owner (feature-lifecycle), and run every surviving workflow on the D65 primitives — host/fleet executor for model stages, `command.gate` for deterministic CLI steps, `decide` for objective routing, and operator pauses only for taste or irreversible choices — so planning and wrap-up runs stop failing at deterministic entry steps and agents read a smaller, current surface.

## Scope

In scope:
- Delete feature-verification.yaml, pr-review.yaml and wayfinder-resolution.yaml with their scaffold entries, callers, CLI help text, sp skill/command/agent references and owning docs.
- feature-lifecycle: `verifying` entry runs `spur feature verify` as a command.gate; receipt verifier identity rebound to feature-lifecycle with a compatibility read for existing receipts; guarded active→verifying when all linked tasks are terminal.
- wrapup-pipeline: remove feature-transition/feature-verify, remove steps duplicated by task-pipeline's done close, typed task-resolve gate; keep doc-sync, doc-tripwire, metrics, branch-cleanup HITL.
- idea-pipeline: objective gates as `decide` nodes, host/fleet executor stages, typed entry gate replacing doctor/agent-resolution shell, stale feature-dev.yaml reference fixed.
- Operator gates on host runs pause instead of resolving an absent answer to a denial.
- Sync dev-wrap, dev-wrapall, dev-runall, dev-plan, dev-idea, dev-verifyall, dev-pr-review, sp:pr-reviewing, sp:wayfinder, spur-cli and spur-dev references, composition-lint, docs/03, docs/design satellites, ADR-119 consequence, CHANGELOG with BREAKING CHANGE note.

Out of scope:
- Wildcard `from` transitions (needs a released ts-dual-workflow-engine change); the cancel/deprecate edges stay explicit.
- Removing `spur feature verify` or any `spur builder pr-*` verb; the hidden deprecated `spur builder pr` alias is flagged for a separate decision, not removed here.
- history-anatomy and task-pipeline/task-lifecycle redesign.
- Pruning historical probe runs from the runs table.
- The already-committed Agents tab and project-registry lock fixes.

## Acceptance Criteria

```gherkin
Feature: Workflow consolidation: one owner per lifecycle, D65 primitives everywhere

  @core
  Scenario: R1 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution
    # covers: I1, I2, I3, I16
    Given a fresh checkout and a project initialised with spur init
    When the bundled and scaffolded workflow definitions are listed and validated
    Then feature-verification.yaml, pr-review.yaml and wayfinder-resolution.yaml are absent from config/workflows, the generated CLI config and the init scaffold manifest
    And composition-lint and spur workflow validate pass over the remaining definitions
    And no source file, CLI help text, sp skill, command or agent names a deleted workflow except the CHANGELOG and ADR history

  @core
  Scenario: R2 — Entering verifying runs the feature verification pass inside feature-lifecycle
    # covers: I5
    Given a feature whose linked tasks are all done
    When the feature moves from active to verifying
    Then feature-lifecycle's verifying entry runs spur feature verify for that feature in its own recorded verification run
    And no nested spur workflow run is started and SPUR_WORKFLOW_RUN_ACTIVE is not cleared
    And a failing repo-wide check records a FAIL receipt without raising an unclassified error

  @core
  Scenario: R3 — The verification receipt names feature-lifecycle as its verifier
    # covers: I6
    Given a PASS receipt written by the verifying entry
    When the feature moves from verifying to done
    Then the strict feature check accepts the receipt whose verifier identity is the feature-lifecycle definition and digest
    And a stale, missing or FAIL receipt still denies the hop
    And a receipt recorded under the retired feature-verification identity is reported as stale with a re-verify command

  @core
  Scenario: R4 — A feature with every linked task terminal can advance to verifying on its own
    # covers: I7
    Given an active feature whose linked tasks are all done or cancelled
    When feature sync runs for that feature
    Then the feature moves to verifying through the guarded feature-lifecycle edge
    And an active feature with any non-terminal linked task stays active

  @core
  Scenario: R5 — wrapup-pipeline never changes feature status
    # covers: I9
    Given a wrap-up run for tasks that belong to a feature
    When the run reaches its terminal state
    Then the feature's status is unchanged by the run
    And the wrapup-pipeline definition declares no feature-transition or feature-verify state and accepts no feature var

  @core
  Scenario: R6 — wrapup-pipeline validates its task list with one typed gate
    # covers: I10
    Given wrap-up input with a malformed task list, an unknown WBS or a task not yet done
    When the run starts
    Then a single command.gate backed by packages/app/src/workflow/wrapup rejects the input and the run ends failed naming the offending entry
    And a valid empty list ends the run skipped
    And no wrap-up state repeats the record, residual sweep or feature sync that task-pipeline's done close already performs

  @core
  Scenario: R7 — wrapup-pipeline keeps doc sync, the doc tripwire, metrics and the branch cleanup pause
    # covers: I11
    Given a valid wrap-up run for completed tasks
    When the run executes
    Then the doc-sync agent stage, the doc tripwire, metrics recording and the branch-cleanup operator pause still run in that order
    And the definition is at most 250 lines including comments

  @core
  Scenario: R8 — idea-pipeline routes its objective checks through the decision catalog
    # covers: I12
    Given an idea-pipeline run under any profile
    When the feature-check and batch-create results are recorded
    Then the run routes on those recorded results with no operator pause at either stage
    And the idea-recommendation and needs-design rescues run as decide actions whose decision ids exist in config/decisions/idea-pipeline.yaml
    And the idea evaluation and design review pauses remain operator decisions under the interactive profile

  @core
  Scenario: R9 — idea-pipeline starts on a typed entry check and dispatches stages through the host or fleet executor
    # covers: I13, I14
    Given an idea-pipeline run started with executor host or executor fleet
    When the start state runs
    Then input validation and executor readiness are one typed check whose failure names the missing input or executor
    And every agent.run stage dispatches through the selected executor without per-stage doctor or agent-resolution shell
    And the definition no longer references feature-dev.yaml and is at most 600 lines including comments

  @core
  Scenario: R10 — An interactive operator pause on a host run waits for an answer
    # covers: I20
    Given an idea-pipeline run with executor host, the interactive profile and no recorded answer for idea-eval
    When the run reaches idea-eval through spur workflow run or spur workflow continue with --json
    Then the run pauses with the operator question instead of ending cancelled
    And an explicit no or cancel answer still ends the run cancelled

  @core
  Scenario: R11 — Callers, skills and docs describe only the surviving workflows
    # covers: I4, I15, I17
    Given the consolidated workflow set
    When the sp commands dev-wrap, dev-wrapall, dev-runall, dev-plan, dev-idea, dev-verifyall and dev-pr-review, the sp skills pr-reviewing, wayfinder, spur-cli and spur-dev, docs/03, the docs/design satellites and ADR-119 are read
    Then each describes the surviving workflows and the direct spur feature verify and spur builder pr-* verbs
    And the CHANGELOG carries a BREAKING CHANGE note naming the three removed workflows and the override migration
    And the hidden spur builder pr alias is listed as an open decision rather than removed

  @edge
  Scenario: R12 — Each consolidated workflow has a repeatable end-to-end proof
    # covers: I18
    Given a fixture project with a fixture feature and tasks
    When the feature-lifecycle, wrapup-pipeline and idea-pipeline end-to-end runs execute
    Then each run reaches its expected terminal state and writes a run artifact that the test asserts
    And bun run spur-check-feature passes at feature close
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1246 | feature-lifecycle runs feature verification on verifying entry; remove feature-verification.yaml | wip |
| 1247 | feature sync advances an active feature to verifying when all linked tasks are terminal | todo |
| 1248 | Unanswered operator pauses on host runs pause instead of resolving to a denial | todo |
| 1249 | wrapup-pipeline stops changing feature status and validates tasks with one typed gate | todo |
| 1250 | idea-pipeline on D65 primitives: typed entry gate, decide routing, executor dispatch | todo |
| 1251 | Remove pr-review and wayfinder-resolution workflows; skills call the verbs directly | todo |
| 1252 | Consolidation sweep: docs, references, CHANGELOG and end-to-end proofs | todo |
| 1253 | Workflow engine: wildcard from transitions for cancel/deprecate edges (deferred) | blocked |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-18T05:21:28.222Z moved Q → D66 (system)
- 2026-10-18T06:45:10.247Z backlog → active (system)

