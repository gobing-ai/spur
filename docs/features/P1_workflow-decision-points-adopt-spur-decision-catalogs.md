---
schema_version: 1
id: "P1"
name: "Spur decision production readiness: events and workflow adoption"
status: backlog
priority: P2
tags: []
created_at: "2026-10-06T18:15:41.140Z"
updated_at: "2026-10-07T00:59:48.013Z"
---

# P1: Workflow decision points adopt spur decision catalogs

## Goal

Make `spur decision` production ready: every decision it serves is observable and traceable on the system event bus, and every fuzzy decision point in Spur's shipped workflows moves onto a catalog decision through a documented, gradual plan — one decision point per slice, each landing only after the recorded decision events show its DecisionMaker is reliable enough.

## Scope

**In scope**

- Decision lifecycle events on the system event bus, emitted from the `DecisionService.decide` seam for both `spur decision run` and workflow `decide`: `decision.start`, `decision.success`, `decision.failure`, `decision.end`, plus `decision.rejected` for caller mistakes (unknown id, unregistered maker) that throw before any backend call. A new `decision` event source; bounded, metadata-only payloads (input keys and evidence digest, never raw input values); run/workflow/node/WBS correlation when called from a workflow.
- Persisting those events to `system_events` for `spur decision run` and workflow runs, so they are visible to the Board, SSE and `workflow trace`.
- A decision reliability report derived from recorded events (accept rate, fallback reasons, confidence, latency per decision id and maker) — the evidence each adoption slice cites.
- A comprehensive audit of `config/workflows/*.yaml` classifying each step as adopt, rescue-only, keep-deterministic or keep-human, published as a design satellite with a staged adoption roadmap.
- `spur decision` enhancements the roadmap needs (catalog entries for new decision points, run correlation, evidence-file inputs).
- Gradual adoption, one decision point per slice: the task-pipeline decides (`task-triage`, `failure-class`, `review-failure-class`, task 1094), then idea-pipeline `idea-recommendation` and `needs-design`, history-anatomy `anatomy-validation-verdict`, then catalog-backed evidence mode for HITL gate decisions. Deterministic parsing stays first; a decision only resolves output the parser cannot classify.
- End state: no shipped workflow declares an inline decide question; inline options are deprecated for one release with a warning, then removed.

**Out of scope**

- Replacing deterministic PASS/FAIL gates (pr-review, wayfinder, wrapup, feature-verification, history structure-gate, task-pipeline command gates) with model decisions — a model must never turn a deterministic FAIL into a PASS.
- Changing bundled HITL gates from `mode: never`; only project overrides that opt into evidence mode use catalog decisions.
- Upstream changes to `@gobing-ai/ts-ai-decision`; choosing reliability thresholds in code (the evidence bar is an operator call recorded per slice).

**Entry condition**

Event, report and audit slices start immediately. Each workflow adoption slice starts only when the reliability report shows recorded evidence for its decision id and effective maker.

## Acceptance Criteria

```gherkin
Feature: Spur decision production readiness: events and workflow adoption

  @core
  Scenario: R1 — Workflow decide action resolves a catalog decision by id
    # covers: I9, I10
    Given a workflow declares a decide action with decision task-triage instead of an inline question and choices
    When the state runs on the inline driver or the subprocess runner
    Then the action writes the same schemaVersion 1 result row shape as before with value, source, reason and evidence digest
    And evidence files are redacted and bounded before any backend call
    And with the decide backend switch off the row carries the catalog fallback with source default

  @core
  Scenario: R2 — Every AI decision in shipped workflows comes from a catalog
    # covers: I10
    Given every decision point has been migrated
    When workflow validation runs over the shipped workflow definitions
    Then no shipped workflow declares an inline decide question
    And a decide action naming a decision id absent from the resolvable catalogs fails validation with the missing id

  @edge
  Scenario: R3 — Inline decide options keep working for one release with a deprecation warning
    # covers: I10
    Given a project-local workflow that still declares an inline decide question and choices
    When the workflow runs
    Then the action executes as before and emits one deprecation warning naming the decision id

  @core
  Scenario: R4 — An accepted decision emits start, success and end events in order
    # covers: I1, I2, I3, I6
    Given the decision task-triage resolves through a maker that answers with confidence above its minimum
    When the decision is served through spur decision run or a workflow decide action
    Then the system event bus receives decision.start, decision.success and decision.end in that order
    And all three events carry the same decision invocation id
    And decision.success carries the value, confidence and maker
    And decision.end carries the duration, value, source model and reason accepted

  @core
  Scenario: R5 — A fallback decision emits start, failure and end events in order
    # covers: I1, I2, I4, I5
    Given the decision failure-class resolves to its fallback because of low confidence, no backend, a timeout or a maker error
    When the decision is served
    Then the system event bus receives decision.start, decision.failure and decision.end in that order
    And decision.failure carries the fallback value, the reason and the confidence when one exists
    And a maker error message in decision.failure is redacted and bounded
    And decision.end carries source default and the same reason

  @edge
  Scenario: R6 — A caller mistake emits decision.rejected before any maker call
    # covers: I5, I6
    Given a request names an unknown decision id or an unregistered maker
    When the decision is requested
    Then the system event bus receives one decision.rejected event naming the decision id and the error kind
    And no decision.start event and no maker call happen
    And the caller still receives the same error as before

  @core
  Scenario: R7 — Decision event payloads stay metadata-only and carry run correlation
    # covers: I5, I6
    Given a workflow run decides failure-class with input values and an evidence file
    When the decision events are emitted
    Then decision.start lists the input keys, the evidence digest, the maker source and the catalog layer but no input values or evidence text
    And every decision event carries the run id, workflow name, node id and task WBS from the calling run
    And a decision served by spur decision run outside a workflow carries caller cli and no run correlation

  @core
  Scenario: R8 — Decision events persist to the system event ledger
    # covers: I6
    Given the system event ledger is attached for spur decision run and for workflow runs
    When a decision is served on either path
    Then every decision event is stored in system_events under the decision source
    And the events are visible to the Board event stream and workflow trace for that run

  @core
  Scenario: R9 — A reliability report summarizes recorded decision outcomes per decision and maker
    # covers: I8, I9
    Given recorded decision events for several decision ids and makers
    When the operator requests the decision reliability report
    Then the report shows per decision id and maker the sample count, accepted rate, fallback count by reason, median confidence and latency percentiles
    And the report reads only recorded events and makes no maker call
    And a decision id with no recorded events is reported as having no evidence

  @core
  Scenario: R10 — The workflow audit classifies every shipped workflow step
    # covers: I7, I8
    Given the shipped workflow definitions under config/workflows
    When the audit is published as a design satellite
    Then every step that parses agent output, reads an agent signal, decides inline or asks the operator is listed with a classification of adopt, rescue-only, keep-deterministic or keep-human
    And each adopt or rescue-only entry names its catalog decision id, closed choices and fallback
    And the satellite orders the adoption slices with the reliability evidence each slice needs

  @core
  Scenario: R11 — Unparseable agent output resolves through a catalog decision
    # covers: I9, I10
    Given the idea-pipeline discovery report whose recommendation line the deterministic parser cannot classify
    When the recommendation step runs
    Then the idea-recommendation catalog decision classifies the report into proceed, reshape or drop
    And a fallback outcome routes the run to the operator pause exactly as an unknown recommendation does today
    And a recommendation the deterministic parser classifies never calls a maker

  @edge
  Scenario: R12 — A deterministic FAIL is never overturned by a decision
    # covers: I7, I10
    Given a history-anatomy validator report that the deterministic verdict check reads as FAIL
    When the anatomy-validation-verdict decision is consulted for ambiguous verdict text
    Then a verdict the deterministic check reads as FAIL stays FAIL
    And the decision fallback is FAIL
    And deterministic status checks in pr-review, wayfinder, wrapup, feature-verification and history stay free of decision calls

  @edge
  Scenario: R13 — Operator gates in evidence mode resolve through catalog decisions
    # covers: I9, I10
    Given a project override sets an operator gate to evidence mode
    When the gate is reached
    Then the gate answer comes from a catalog decision and emits the decision lifecycle events
    And bundled gates keep mode never and still pause for the operator
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1094 | Migrate workflow decide action to catalog references | blocked |
| 1095 | Emit decision lifecycle events and persist them to the system event ledger | todo |
| 1096 | Report decision reliability from recorded decision events | todo |
| 1097 | Rescue unparseable idea-pipeline recommendation and needs-design signals with catalog decisions | todo |
| 1098 | Rescue ambiguous history-anatomy verdicts without overturning FAIL | todo |
| 1099 | Route evidence-mode operator gates through catalog decisions | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
