---
schema_version: 1
id: "F96"
name: "Residual sweep for task execution"
status: backlog
priority: P2
tags: []
created_at: "2026-09-24T18:48:46.363Z"
updated_at: "2026-09-24T18:57:51.874Z"
---

# F96: Residual sweep for task execution

## Goal

Make `/sp:dev-refine` → `/sp:dev-run` (or `/sp:dev-runall`) → `/sp:dev-wrap` close task leftovers without the operator's manual defensive prompt ("anything remained? get it all done, PASS and shippable"). Today a task can reach `done` with open P3 review findings, TODO markers added by its own diff, unchecked boxes or `/tmp/<wbs>-*` staging residue (e.g. 0947: PASS-with-findings, one P3 needing a post-merge regeneration). Leftovers become verdict evidence: a deterministic residual scan downgrades PASS, the existing verify→test-fix loop remediates within its budget, deferrable items become linked follow-up tasks, and leftovers that remain unfixable end in an honest, routable terminal state instead of silent `done`.

Prior art: task 0596's post-PASS `residual-sweep` stage in `task-pipeline2.yaml` was deleted (ADR-076) because it added a model query. `docs/design/workflow-composition-contract.md:324` left "read-only or bounded remediation followed by the full proof chain" open. This feature takes that path: the scan is deterministic (zero model queries on the clean path) and remediation reuses the existing proof chain.

## Scope

- In: a deterministic residual scanner plugin script (+ `.mjs` twin) writing `.spur/run/<wbs>-residuals.json`; folding its in-scope findings into the verify verdict for `task-pipeline.yaml`, standalone `/sp:dev-verify` and `/sp:dev-verifyall` (observe-only, valid under `--fix none`); passing the residual list to the existing `test-fix` remediation; filing deferrable leftovers as one deduplicated follow-up task per source task; an honest terminal path for unfixable leftovers (residual report, recovery command, next-router probe); `/sp:dev-runall --wrap` wrapping only tasks that reached `done` and reporting the rest; owning design satellite, `04_DESIGN` index row, help doc, command docs and routing table updates.
- Out: a new pipeline state or any extra model query on the clean path (ADR-076); auto-waiving P1/P2 findings; mutating task status from `/sp:dev-wrap` or making wrap fix code; new public `spur` nouns/verbs; changing `qualityGateMaxFixAttempts` defaults; repo-wide checks (owned by `spur-check-feature`).

## Acceptance Criteria

```gherkin
Feature: Residual sweep for task execution

  Scenario: R1 — Deterministic residual scan classifies task leftovers
    Given a task with a current `### Review` section and a run base recorded by precheck in `.spur/run/<wbs>-base.sha`
    When the residual scanner runs for that task
    Then it writes `.spur/run/<wbs>-residuals.json` listing open P1–P4 review findings from any Review table with a Priority column, TODO/FIXME/XXX/HACK lines added since the run base, unchecked `- [ ]` boxes in the task file and `/tmp/<wbs>-*` staging residue
    And each item is classified `blocking`, `deferrable`, `advisory` or `housekeeping` with a content-stable id and its source location
    And P1–P3 findings, added markers and unchecked boxes are `blocking` unless a fixer deferral with a reason covers a P3 or marker item
    And markers present before the run base are not reported, and a missing base reports the marker category as `not-scanned`
    And the scan performs no model query and writes only under `.spur/run/`

  Scenario: R2 — In-scope residuals downgrade a PASS verdict
    Given the verify answer derives a PASS verdict
    And the residual scan reports at least one blocking item
    When the verify stage binds the verdict artifact
    Then the verdict becomes PARTIAL with a `residual-sweep` check listing each blocking item
    And the same fold applies to standalone `/sp:dev-verify` and `/sp:dev-verifyall` under `--fix none`
    And the proof digest binding and the verify→record guard are unchanged

  Scenario: R3 — Existing remediation loop fixes residuals within budget
    Given a PARTIAL verdict caused by the residual sweep
    And the fix-attempt counter is below `qualityGateMaxFixAttempts`
    When the pipeline takes the verify→test-fix transition
    Then the test-fix step receives the blocking residual list as its fix targets
    And the run re-enters test-recheck → review → verify on a fresh digest
    And a clean re-scan lets the task reach `record` and `done` with no extra pipeline state

  Scenario: R4 — Deferrable leftovers become linked follow-up tasks
    Given a PASS verdict whose residual scan reports deferrable items
    When the task reaches `done` after the proof-bound `record` stage
    Then one follow-up task per source task is created through `spur task create --feature <feature> --skip-ready` with the dedup guard
    And the verdict's `residual-sweep` check lists the deferred ids and `<wbs>-residuals.json` records the follow-up WBS
    And the follow-up's Background names the source task and each deferred item with its reason
    And P4 findings are `advisory`: listed in the verdict evidence without a follow-up task
    And deferrable, advisory and housekeeping items never downgrade the verdict or consume fix budget
    And the same `done` entry removes only the task's own `/tmp/<wbs>-*` staging files
    And P1/P2 findings and unchecked boxes are never classified deferrable

  Scenario: R5 — Unfixable leftovers end in an honest routable terminal state
    Given blocking residuals remain after the fix budget is exhausted
    When the pipeline leaves verify
    Then the run ends `failed` and the task stays out of `done`
    And `.spur/run/<wbs>-residual-report.md` lists each remaining item with its location and attempted fixes
    And the run output prints one recovery command for the task
    And under `--auto` no blocking item is waived

  Scenario: R6 — Next-router routes residual-failed tasks to recovery
    Given a task whose latest verdict artifact carries a failing `residual-sweep` check
    When `/sp:dev-next` resolves that task
    Then it stops with the residual report and the recovery command instead of re-entering an automatic fix loop
    And the routing row is documented in the next-router routing table

  Scenario: R7 — Batch wrap covers only completed tasks
    Given `/sp:dev-runall --wrap` finished a batch where some tasks reached `done` and others did not
    When the batch wrap runs
    Then only `done` tasks are passed to the wrap-up pipeline
    And each excluded task is reported with its status and recovery command
    And `dev-runall.md` describes the wrap as once-per-batch without the per-task contradiction

  Scenario: R8 — Owning documents describe the residual contract
    Given the residual sweep ships
    When the owning documents are checked
    Then a `docs/design/` satellite owns the scanner schema, classification and terminal path with a `docs/04_DESIGN.md` index row
    And `dev-verify.md`, the routing table and the daily slash-command help describe residual behaviour
    And the ADR record notes the scan as observe-only evidence consistent with ADR-071 and ADR-076
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0949 | Residual scanner script: scan, fold, settle and report modes | todo |
| 0950 | Wire the residual sweep into task-pipeline: base capture, verify fold, done settle, failed report | todo |
| 0951 | Residual sweep for standalone verify, next-router C6 recovery row, and owning docs | todo |
| 0952 | dev-runall batch wrap covers only done tasks and reports the rest | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-24T18:55:11.761Z moved O → F96 (system)

