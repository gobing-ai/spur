---
template: brainstorm
schema_version: 1
name: "Report mode spike: reproduce the omp forensics report through report --mode forensics"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:03:53.995Z"
updated_at: "2026-08-10T00:06:31.685Z"
---

## 0491. Report mode spike: reproduce the omp forensics report through report --mode forensics

### Background
**Type:** `wayfinder:prototype` · **Map:** E2 · **Depends on:** 0490

`spur history report` is today a pure renderer of the analyze artifact — it never opens the database —
with one hardcoded shape in `packages/domain/src/analytics/render-report.ts:165` (`renderReport`) plus
a markdown variant at `:193`. The operator has ruled that modes are built-in named renderers, not file
templates: `report --mode spend|forensics|…` resolves to a TS renderer, no template engine, no
variable-binding contract.

The question this ticket answers is whether that renderer can actually produce the sample report.
`.spur/run/sp-dev-findissue-20260806.md` is 423 lines of narrative: fifteen named phases with prose
characterizations, a bottleneck ranking presented two ways (wall time and LLM round-trips), and P1–P3
issues with diagnoses. Some of that is arithmetic over derived variables; some of it is judgment an
agent wrote. The split matters more than the renderer does — it decides how much of the forensics
report the CLI can emit unaided and how much still needs a model, which in turn decides what the
rewritten command is even for.

The `--mode` flag must also reach `daily` (map decision: `daily` stays and gains `--mode`), so the
mode registry is shared surface, not a `report`-local switch.
### Requirements
- R1 — Render a real forensics report from real artifact data through a `--mode forensics` renderer spike, and diff it section by section against the sample at `.spur/run/sp-dev-findissue-20260806.md`.
- R2 — Classify every section of the sample as mechanically derivable, partially derivable, or model-authored, so the CLI/model boundary is drawn from the actual output rather than from intent.
- R3 — Define the mode registry: how a mode is named, where it is registered, how `report` and `daily` both resolve one, and what happens on an unknown mode name.
- R4 — State the contract between a mode and the artifact: which derived variables a mode requires, and how a mode fails when the artifact predates them or the source lacks the primitive.
- R5 — Confirm the existing default behavior survives — `report` with no `--mode` renders what it renders today, and `assertArtifactVersion` staleness banners still fire.
- R6 — Assess whether the markdown and human renderers stay separate functions or collapse into the mode registry, since three near-identical renderers is the shape this ticket could accidentally create.
### Acceptance Criteria
```gherkin
Feature: 0491 wayfinder investigation

  Scenario: R1 — the spike renders real data, not a fixture
    Given an analyze artifact built from imported sessions
    When the forensics mode renderer is run
    Then a report is produced from that artifact
    And it is compared section by section against the omp sample

  Scenario: R2 — the CLI/model boundary is drawn from output
    Given the rendered spike and the omp sample side by side
    When each sample section is classified
    Then every section is marked derivable, partially derivable or model-authored
    And the classification cites what data the section needed

  Scenario: R3 — one registry serves both verbs
    Given report and daily both select a mode
    When the registry is defined
    Then both resolve modes through the same surface
    And an unknown mode name fails with a listed set of valid modes

  Scenario: R5 — today's output does not regress
    Given report invoked with no mode flag
    When the spike is in place
    Then the rendered output matches current behavior
    And staleness banners still fire on stale artifacts
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
