---
template: feature-impl
schema_version: 1
name: "Harden sp-dev-idea planning handoff from dogfood findings"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["dogfood", "planning-workflow", "plugins/sp"]
dependencies: ["0514"]
ac_numbering: task-local
created_at: "2026-08-11T20:43:29.598Z"
updated_at: "2026-08-11T23:04:12.950Z"
---

## 0515. Harden sp-dev-idea planning handoff from dogfood findings

### Background
Operational hardening for feature I2 scenario R14. This task owns only the first two dogfood findings: feature creation currently records an ID without an explicit Goal/Scope write contract, and design rejection currently has no persistent operator-feedback artifact for the revision pass. Task 0518 owns post-create ordering, roster refresh, and conditional handoff; 0519 owns regression coverage and the no-surface verification.

Current-tree premises verified during ready refinement: `config/workflows/idea-pipeline.yaml` has `feature-create`, `system-design`, and `design-approval` states; feature creation currently writes only `*-idea-feature-id.txt`; the design approval prompt has no feedback path; exits from system design do not re-run `spur feature check`. `spur feature update <id> --section <name> --from-file <path>` is the existing corpus write seam.

The change remains in the workflow/guidance layer and uses existing CLI verbs. It does not add a task-batch schema field, new CLI verb/flag, ordering logic, finalization state, or task execution.

Rubric: E3 D1 L1 C0 R0 = 5 → split; this guidance/reconciliation slice stays separate from 0518 finalization and 0519 tests.
### Requirements
- [ ] R1. In `feature-create`, produce run-scoped `*-idea-goal.md` and `*-idea-scope.md` bodies containing concise intent and explicit in/out boundaries, then persist both through `spur feature update --section ... --from-file`; decomposition/checklist output must never enter Goal.
- [ ] R2. Make `system-design` create/read `.spur/run/${vars.__runId}-idea-design-review.md` with `Proposed design`, `Operator feedback`, and `Reconciliation` sections. The rejection prompt directs the operator to record feedback there; a revision reads it, reconciles invalidated AC through `spur feature update`, and every accepted/auto-approved design exit runs `spur feature check <id>` before decomposition.

Non-goals: order sidecars, dependency application, roster refresh, handoff recommendation, task execution, task-batch schema changes, or new public CLI surface (0518/0519 own the remaining work).
### Acceptance Criteria
```gherkin
Feature: Safe idea-pipeline planning handoff

  Scenario: R1 — Idea handoff is safe to execute
    Given feature-create has selected or created a feature
    When Goal and Scope are written
    Then they contain concise intent and boundaries rather than task decomposition or checklists

  Scenario: R2 — Idea handoff is safe to execute
    Given the operator rejects a design after recording feedback in the run-scoped review artifact
    When system-design runs again
    Then it reads the feedback and reconciles invalidated feature AC through spur feature update
```
### Q&A
- **Goal/Scope artifacts:** `.spur/run/<runId>-idea-goal.md` and `-idea-scope.md`, body-only; the workflow persists them with `spur feature update` after selecting or creating the feature.
- **Design feedback transport:** one `.spur/run/<runId>-idea-design-review.md` artifact with fixed `Proposed design`, `Operator feedback`, and `Reconciliation` headings. Reject means edit `Operator feedback`; retry means read and reconcile it.
- **AC reconciliation:** system-design uses the existing feature section-update verb when feedback invalidates AC, and design exit is conditional on `spur feature check` passing.
- **Ownership:** 0518 alone owns order/finalization/handoff mechanics; 0519 owns regression tests. This task must not pre-implement either slice.
### Design
Modify the tracked workflow SSOT `config/workflows/idea-pipeline.yaml` and mirror its user-facing contract in `plugins/sp/skills/spur-dev/references/planning-workflow.md` plus `plugins/sp/commands/dev-idea.md` only where that wrapper describes outputs.

In `feature-create`, have the agent write three expected files: the existing feature-id file plus body-only Goal and Scope artifacts at `.spur/run/${vars.__runId}-idea-{goal,scope}.md`. Follow with shell actions that require both files to be non-empty and call `$spurBin feature update "$featureId" --section Goal|Scope --from-file ...`; failure stops the state. Goal is intent only; Scope has explicit in-scope/out-of-scope boundaries.

In `system-design`, require `.spur/run/${vars.__runId}-idea-design-review.md` with fixed headings `## Proposed design`, `## Operator feedback`, and `## Reconciliation`. On first pass, create it; on retry, read existing operator feedback, revise the design/ADR artifacts, document reconciliation, and update Acceptance Criteria through the existing CLI only when feedback invalidates a scenario. Change the design-approval prompt to tell the operator to edit `Operator feedback` before answering no. Add `$spurBin feature check "$featureId"` to both paths that leave design for `decompose` (auto-approved and interactive-approved), so stale/invalidated AC cannot proceed.

Do not add states, ordering artifacts, dependency logic, roster refresh, handoff report generation, schema fields, or public commands here. Existing workflow-definition tests must remain green; 0519 adds the focused regressions after 0518 lands.
### Plan
- [ ] Update `feature-create` to capture and persist run-scoped Goal/Scope bodies through `spur feature update` (R1).
- [ ] Add the fixed design-review artifact contract to `system-design` and the rejection prompt; make revision consume feedback and reconcile changed AC (R2).
- [ ] Require `spur feature check` on auto-approved and interactive-approved design exits before decomposition (R2).
- [ ] Sync only the affected planning-workflow/dev-idea guidance; do not implement 0518 finalization or 0519 tests.
- [ ] Run `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json` and `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts plugins/sp/tests/skill-structure.test.ts`; verify no CLI/schema/dependency/persistence/transport diff.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenario R14
- Design: `docs/design/plugin-surface-parity.md` §9
- Workflow SSOT: `config/workflows/idea-pipeline.yaml`
- Guidance: `plugins/sp/skills/spur-dev/references/planning-workflow.md`; `plugins/sp/commands/dev-idea.md`
- CLI seams: `spur feature update`; `spur feature check`
- Dependency: 0514
- Dependents: 0518 (post-create finalization), 0519 (regression/no-surface verification)
### History
