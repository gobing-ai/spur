---
template: brainstorm
schema_version: 1
name: "Derived-variable mechanism spike: spur workflow orchestration vs in-analyze metric registry"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0489"]
ac_numbering: task-local
created_at: "2026-08-10T00:03:52.759Z"
updated_at: "2026-08-10T00:06:51.810Z"
---

## 0490. Derived-variable mechanism spike: spur workflow orchestration vs in-analyze metric registry

### Background
**Type:** `wayfinder:prototype` · **Map:** E2 · **Depends on:** 0489

The operator's framing was "empower `analyze` with `spur workflow` to build a flexible analysis
workflow deriving interim variables." That is one plausible mechanism, and it deserves a spike rather
than agreement, because the evidence cuts against it: `spur workflow` is a process orchestrator —
state-machine and transition-flow FSMs whose step kinds are `shell`, `agent.run`, `hitl.confirm`,
`file.read.into-var`, `note` (`config/workflows/task-pipeline.yaml`). It sequences *processes* and
carries string variables between them. Deriving a per-phase token rollup through it means shell steps
shelling back into `spur history analyze` and parsing stdout — the workflow engine would be
orchestrating a data pipeline it cannot see inside.

The alternative is a declarative derived-metric layer inside `analyze` itself, extending the Q1–Q10
set in `packages/domain/src/analytics/forensic-query.ts` with named, composable metrics that write
into the artifact. Cheaper, typed, testable, and it keeps the data mart in one place — but it is less
"flexible" in the sense of being non-user-authorable without a code change.

Build both against one real primitive and let the spike decide. Time decomposition (omp step 6) is the
right subject: it needs multiple inputs, per-session grouping, and arithmetic across rows, so it
exercises whatever the mechanism is actually bad at.
### Requirements
- R1 — Implement time decomposition (LLM latency vs tool execution vs idle, per session and per phase) twice: once orchestrated through a `spur workflow` definition, once as a derived metric inside `analyze`, both producing the same numbers from the same real data.
- R2 — Compare the two on evidence, not taste: lines of code, wall-clock runtime on a real day's data, what breaks when a source is missing, how each is unit-tested, and what a new metric costs to add afterwards.
- R3 — State how derived variables reach the artifact under the recommended mechanism, given that `HISTORY_ARTIFACT_SCHEMA_VERSION` is 1 and `assertArtifactVersion` rejects mismatches — additive optional block, v2 with migration, or side-car.
- R4 — Recommend one mechanism with a stated confidence level, and record honestly whether the spike contradicted the operator's `spur workflow` framing.
- R5 — Name the full derived-variable set the forensics report needs (phases, per-phase metrics, time decomposition, bottleneck ranking, issue candidates) and confirm the recommended mechanism carries all of them, not only the one spiked.
- R6 — Keep the spike out of the shipped surface: it is throwaway evidence, so state where the code lives and that it is not on the delivery path.
### Acceptance Criteria
```gherkin
Feature: 0490 wayfinder investigation

  Scenario: R1 — both mechanisms actually run
    Given a real imported day of history
    When both implementations of time decomposition are executed
    Then both emit LLM-latency, tool-execution and idle totals
    And the two results agree, or the disagreement is explained

  Scenario: R2 — the comparison is measured
    Given both spikes exist
    When they are compared
    Then the comparison reports code size, runtime and failure behavior from observation
    And the cost of adding a second metric is stated for each

  Scenario: R4 — the operator's framing is tested, not assumed
    Given the request named spur workflow as the mechanism
    When the recommendation is written
    Then it states plainly whether the evidence supports or contradicts that framing
    And it carries a HIGH, MEDIUM or LOW confidence rating

  Scenario: R5 — the whole report is covered, not just the spike
    Given the derived variables the forensics report consumes
    When the recommended mechanism is assessed
    Then every variable in the set is shown to be expressible
    And any variable that is not is named as a gap
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan

<!-- Follow-up steps or task/feature creation plan once the idea is ready to execute. -->

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
