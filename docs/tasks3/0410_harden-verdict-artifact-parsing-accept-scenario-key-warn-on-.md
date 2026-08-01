---
template: issue
schema_version: 1
name: "Harden verdict artifact parsing: accept scenario key, warn on zero-coverage PASS verdicts, and add fuzzy AC title matching"
description: ""
status: todo
type: issue
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
created_at: "2026-08-01T22:24:39.364Z"
updated_at: "2026-08-01T22:58:57.128Z"
---

## 0410. Harden verdict artifact parsing: accept scenario key, warn on zero-coverage PASS verdicts, and add fuzzy AC title matching

### Background
During H9 verification, model-authored PASS verdict artifacts used `scenario` instead of the canonical `id` field on coverage rows. `FeatureCheckService.readVerdictArtifact` silently filtered those rows, so valid-looking PASS artifacts contributed no scenario-verification evidence and produced misleading downstream L4 findings.

The narrow defect is malformed verdict compatibility and diagnostics. AC title matching remains exact after documented normalization; fuzzy semantic matching is intentionally out of scope because DD-09 is a specification traceability gate. Feature-sync retry policy is independent follow-up work, not a prerequisite for this parser fix.
### Requirements
R1. Verdict parsing accepts canonical `{ id, status }` rows and a compatibility alias `{ scenario, status }`, normalizing accepted rows to canonical `id` internally.

R2. When both `id` and `scenario` are present, `id` is authoritative; conflicting values produce an actionable malformed-row finding rather than silent selection.

R3. Missing artifacts, malformed JSON, absent arrays, empty arrays, malformed rows, and valid rows that do not match a feature scenario remain distinguishable outcomes.

R4. A PASS artifact containing rejected coverage rows emits an L4 warning that names the task WBS, artifact path, rejected-row count, and invalid fields. Rows are never silently dropped.

R5. A legitimate task with no applicable acceptance-criteria rows is not warned merely because an array is empty; diagnostics depend on malformed input, not row count alone.

R6. Canonical producers and documentation continue to emit `id`; accepting `scenario` is compatibility behavior, not a second canonical schema.

R7. Regression tests cover canonical `id`, compatible `scenario`, both keys equal, conflicting keys, unknown keys, empty arrays, malformed JSON, missing artifacts, and unmatched valid rows.

R8. Current repository lint, test, test-cf, and build gates remain green with no new `any` or suppression comments.
### Acceptance Criteria
```gherkin
Feature: verdict artifact parsing diagnostics

  Scenario: Canonical id-keyed rows remain supported
    Given a PASS verdict artifact with id-keyed coverage rows
    When feature-check reads the artifact
    Then the rows are parsed without compatibility warnings

  Scenario: Scenario-keyed rows are accepted as a compatibility alias
    Given a PASS verdict artifact with scenario-keyed coverage rows
    When feature-check reads the artifact
    Then each scenario value is normalized to the internal id field
    And matching MET rows can verify their feature scenarios

  Scenario: Conflicting id and scenario keys are rejected visibly
    Given a coverage row whose id and scenario values differ
    When feature-check reads the artifact
    Then the row is rejected
    And an L4 warning names the task, artifact, row, and conflicting fields

  Scenario: Unknown row keys are not silently discarded
    Given a PASS verdict artifact containing rows with neither id nor scenario
    When feature-check reads the artifact
    Then an L4 malformed-artifact warning reports the rejected-row count and invalid fields

  Scenario: Empty valid coverage is distinct from malformed coverage
    Given a readable verdict artifact with valid empty coverage arrays
    When feature-check reads the artifact
    Then it is not reported as a malformed-row problem
    And ordinary scenario-verification rules still determine feature coverage

  Scenario: Missing and malformed artifacts remain distinguishable
    Given one task with no verdict artifact and another with invalid JSON
    When feature-check evaluates scenario satisfaction
    Then the findings identify the correct failure mode and task WBS for each
```
### Q&A
**Q: Is `scenario` a new canonical verdict field?**  
A: No. `id` remains canonical. `scenario` is accepted only as compatibility input because model-authored H9 artifacts repeatedly used it.

**Q: Why not add fuzzy AC title matching?**  
A: DD-09 is a specification traceability gate. Similar wording is not proof of scenario identity; task and feature scenarios should share stable titles or explicit identifiers.

**Q: Why not warn on every PASS artifact with zero rows?**  
A: Zero applicable rows can be legitimate. The actionable defect is malformed or rejected input, which must be diagnosed explicitly.

**Q: Is feature-sync retry behavior part of this task?**  
A: No. It has different ownership and is tracked by task 0411.
### Design
Add a narrow verdict-row decoding result at the existing `FeatureCheckService` artifact boundary. It should return canonical accepted rows plus structured diagnostics for rejected rows and artifact-level failures. Keep `rowMatchesScenario` and DD-09 exact normalized-title semantics unchanged.

For each row, accept a string `id`; otherwise accept a string `scenario` as a compatibility alias. If both exist and differ, reject the row. Preserve enough context to emit one bounded L4 finding per task/artifact rather than one noisy finding per field. Canonical verdict writers, schema documentation, and examples continue to use `id`.

No fuzzy matcher, configuration threshold, mandatory feature-sync dry run, or human-output parsing belongs in this task.
### Plan
- [ ] Define accepted-row and artifact-diagnostic shapes at the feature-check boundary.
- [ ] Parse canonical id rows and normalize the scenario compatibility alias.
- [ ] Emit bounded actionable findings for conflicts, rejected rows, malformed JSON, and missing artifacts.
- [ ] Preserve exact normalized AC matching and legitimate empty-array behavior.
- [ ] Add the full compatibility and failure-mode regression matrix.
- [ ] Synchronize verdict schema documentation if compatibility behavior is externally visible.
- [ ] Run focused tests and the repository verification gate.
### Root Cause
`packages/app/src/services/feature-check.ts:607` filters coverage rows by `typeof r.id === 'string'` and returns `null` when no accepted rows remain. Rows using the model-natural `scenario` key, conflicting keys, and other malformed shapes are therefore collapsed into the same generic unverified path without an artifact-specific diagnostic.

The canonical schema uses `id`; H9 dogfood evidence records that three initially generated verdict artifacts used `acceptanceCriteria[].scenario`. The root defect is silent schema degradation at the read boundary, not insufficiently fuzzy scenario-title comparison.
### Solution
<!-- Filled during implementation: file:line change map and concise rationale. -->
### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `packages/app/src/services/feature-check.ts:591`
- `plugins/sp/skills/code-verification/references/verdict-schema.md:14`
- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:238`
- `plugins/sp/skills/spur-dev/references/ac-style-guide.md:141`
- `docs/dogfood/2026-08-01-sp-dev-runall-H9-dogfood.md:47`
- Task 0411 — bounded handling of blocked feature-sync results
### History
