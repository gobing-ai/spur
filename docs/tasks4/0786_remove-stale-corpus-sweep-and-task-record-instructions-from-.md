---
schema_version: 1
name: "Remove stale corpus-sweep and task-record instructions from canonical capability sources"
status: todo
template: issue
created_at: 2026-09-06T18:27:45.428Z
updated_at: "2026-09-06T19:04:07.685Z"
feature_id: D6
priority: P2
dependencies: ["0785"]
---

## 0786. Remove stale corpus-sweep and task-record instructions from canonical capability sources

### Background
Audit 0781 F-08 found three canonical instructions contradicting shipped behavior: expert-spur mandates a post-batch corpus sweep; the task reference says record never transitions done; the gate checklist describes a synthetic docs PASS stub. Constitution T11 requires affected-input checks, TaskRecordService supports guarded record-to-done, and docs-pipeline runs measured read-only verification. Correct these projections after the runtime repair contracts settle; do not change their owners to match stale guidance.
### Requirements
- [ ] R1. Replace the routine expert-spur corpus sweep and report-field implication with checks of changed tasks/features plus required linked evidence. Preserve the explicit unsuppressed T10 audit for checker-policy changes; do not revive baselines or suppression.
- [ ] R2. Document record --transition done as a guarded operation: PASS is required, the supported lifecycle path and pipeline run-link are handled by the existing service, and normal done gates still apply. Preserve bare-section fallback and authored-content protection. No unconditional completion claim.
- [ ] R3. Replace the docs PASS-stub instruction with the actual measured read-only verification and artifact obligation. Keep missing/non-PASS evidence as a refusal; reflect final 0784/0785 contracts without duplicating their algorithms.
- [ ] R4. Validate canonical capability sources through the installed Superskill lifecycle and focused plugin contracts. Deliver canonical source changes only; report installed-version skew explicitly, without host installation or hand-editing generated adapters.
### Acceptance Criteria
Keep the feature-mapped scenario identity unchanged.

```gherkin
Feature: Current workflow capability instructions
  Scenario: R1 — Capability guidance follows current corpus and record owners
    Given the canonical expert-spur and task-record guidance
    When their instructions are checked against T11 and TaskRecordService
    Then ordinary batch edits do not trigger a corpus sweep
    And guarded record-to-done support is documented correctly
    And checker-policy changes still require the explicit T10 audit
    And docs completion requires measured verification rather than a synthetic PASS
    And canonical validation does not install or edit host adapters
```

Verification: run the existing plugin contract tests from plugins/sp, extending the nearest existing suite with assertions covering the three contradictory statements and their affirmative replacement obligations. Run superskill agent validate plugins/sp/agents/expert-spur.md --json and superskill skill validate on plugins/sp/skills/spur-cli and plugins/sp/skills/spur-dev. Report unavailable validation separately; do not substitute a claimed PASS.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-06T19:04:06.910Z

- Closed — Does --auto authorize host installation? No. Canonical source and validation are the deliverable; installation requires separate explicit scope.
- Closed — Should all corpus checks be removed? No. T11 is the ordinary path; T10 remains mandatory for checker-policy changes.
- Closed — Does guarded record-to-done bypass verification? No. Document the existing PASS/lifecycle/provenance behavior, not an unconditional shortcut.
- Closed — Should this task introduce a new ADR or rewrite all workflow guidance? No. Existing authority is clear; the three identified projections and directly contradictory linked text bound the work.
- Closed — Is guidance ready before runtime repair? Its edit is small, but final validation follows 0785 so it cannot freeze superseded proof/checkpoint statements.
### Design
#### Frozen design
Repair three canonical projections, not CLI behavior or the workflow engine. Own plugins/sp/agents/expert-spur.md, plugins/sp/skills/spur-cli/references/tasks.md, plugins/sp/skills/spur-dev/references/gate-checklists.md and only the nearest existing plugin contract tests. Keep command catalogs and lifecycle guards with their existing owners; links replace duplicate explanations when sufficient.

In expert-spur, change the post-batch obligation to affected task/feature checks and necessary linked evidence, and rename the report's refresh/corpus-sweep field to scoped validation with explicit T10 audit applicability. Do not remove checks or turn an ordinary batch into a full sweep.

In tasks.md, replace the categorical never-done sentence with the service's guarded done semantics. Verify the exact task record leaf help, TaskRecordService/TaskService.record and its regression tests before editing; retain UNKNOWN handling and authored Review/Solution preservation only as actually implemented. Link tasks/verbs.md for detailed verdict shapes rather than adding a second catalog. If a directly linked paragraph repeats the same false claim, repair that paragraph only.

In gate-checklists.md, replace only the synthetic docs-PASS sentence and directly affected references with the measured docs-pipeline verification contract. Do not edit numbered authority documents: ADR-108 and T10/T11 already settle this policy.

Use the applicable cc-agent-refine and cc-skill-refine lifecycle instructions for these capability edits, with target-specific changes constrained to this task. Read installed leaf help; agent validate and skill validate accept canonical paths and --json. Run validation once per affected canonical capability after the edit, plus focused plugin contracts (cli-surface-parity, skill-structure and the nearest command/gate contract). No quality-score campaign, generated snapshot churn, new test framework or adapter installation.

Dependency: 0785, transitively 0784, supplies final proof/checkpoint behavior before guidance validation. These are planning handoffs, not permission to install into host config. Installed copies may remain stale after canonical delivery; identify their divergence and the separately authorized installer step, without making host installation an acceptance requirement.

No new public noun/verb, dependency, engine, registry, cache, baseline, blanket strictness, fast-route activation, live-run mutation, external review request, host installation, or release. Workflow/source changes below are the implementation handoff, not actions performed by refine.

Execution budget: one owned task at a time; checkpoint after 45 minutes or two unsuccessful fix iterations in .spur/run/0786-execution-notes.md, preserving focused logs. Reproduce with targeted workspace tests before the single final project gate. requireDiff: source/tests for runtime tasks, canonical docs/tests for 0786; no fabricated source edit for refinement. Refinement itself changes planning sections only.
### Plan
- [ ] R1–R3: confirm the three mismatches against current constitution, task record help/service and docs-pipeline; add focused assertions that fail against the stale canonical text.
- [ ] R1–R3: apply the smallest canonical instruction corrections through capability lifecycle guidance; keep existing owners, links and completion safeguards.
- [ ] R4: run Superskill validation for the agent and two skills, then affected plugin contract tests; distinguish pre-existing findings from regressions.
- [ ] R4: record canonical validation evidence and any installed-copy skew. Do not install, publish, alter task statuses or run corpus-check unless checker policy itself changes.
- [ ] Run the applicable final project gate during implementation and record actual results; no implementation or verification-PASS artifact is produced by refinement.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- docs/plans/2026-09-06-workflow-conflict-audit.md — F-08.
- docs/99_PROJECT_CONSTITUTION.md — T10/T11; docs/00_ADR.md — ADR-108.
- packages/app/src/services/task-record.ts — RecordOptions.transition; TaskService.record and existing record tests.
- config/workflows/docs-pipeline.yaml — measured read-only verification.
- plugins/sp/skills/spur-cli/references/tasks/verbs.md — owned record/verdict details.
- Dependency 0785; upstream 0784. Superskill agent validate --help and skill validate --help checked during refinement.
### History
