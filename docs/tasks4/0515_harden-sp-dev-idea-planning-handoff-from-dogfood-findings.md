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
updated_at: "2026-08-11T21:26:54.928Z"
---

## 0515. Harden sp-dev-idea planning handoff from dogfood findings

### Background
Operational hardening for feature I2 scenario R14 — Idea handoff is safe to execute. Dogfooding the feature through `config/workflows/idea-pipeline.yaml` exposed four concrete gaps: feature-create placed decomposition/checklist content in Goal and left Scope blank; design rejection had no explicit persistent feedback/reconciliation contract; the decomposed batch described ordering but created empty `dependencies[]`; and handoff recommended `/sp:dev-runall` although every created task failed `spur task check` with placeholder Acceptance Criteria and the feature task roster was stale. Fix these at the spine/workflow/skill/test layer using existing CLI verbs. Do not add task-batch schema fields or change the public CLI surface without separate operator consent. This task runs after the parity/content tasks so its edits reconcile with their final skill text.
### Requirements
- [ ] R1. Make feature-create guidance write concise Goal and Scope intent through `spur feature update`; decomposition output and completion checklists never enter Goal.
- [ ] R2. Persist design review and operator rejection feedback in `.spur/run/${vars.__runId}-idea-design-review.md`; the revision pass reads it and reconciles accepted design changes with feature AC through the feature CLI before decomposition.
- [ ] R3. When decomposition declares ordering, emit a run-scoped order sidecar and apply it after batch creation through existing `spur task deps`; missing or ambiguous title-to-WBS resolution fails before handoff.
- [ ] R4. Refresh the feature roster after successful batch creation.
- [ ] R5. Check every created task and generate a run-scoped handoff report that recommends `/sp:dev-refineall --feature <id> --auto --depth ready` when any task is unready; recommend runall only when all task checks pass.
- [ ] R6. Add focused workflow-definition and plugin contract tests reproducing the four dogfood findings.
- [ ] R7. Add no public CLI command/flag, task-batch schema field, dependency, persistence schema, or transport.

Non-goals: executing created tasks, changing task-batch.schema.json, introducing a new CLI finalizer, or redesigning the idea workflow.
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

  Scenario: R3 — Idea handoff is safe to execute
    Given decomposition emits a non-empty task-order sidecar
    When batch creation succeeds
    Then each dependency is applied with spur task deps or the pipeline fails before handoff

  Scenario: R4 — Idea handoff is safe to execute
    Given task batch creation succeeds
    When post-create finalization completes
    Then spur feature refresh has regenerated the feature task roster

  Scenario: R5 — Idea handoff is safe to execute
    Given at least one created task fails spur task check
    When the handoff report is generated
    Then it recommends ready-depth refineall and does not recommend runall

  Scenario: R6 — Idea handoff is safe to execute
    Given created tasks have encoded ordering, a refreshed roster, and passing task checks
    When the pipeline reaches handoff
    Then the report lists the feature and WBS set and recommends runall

  Scenario: R7 — Idea handoff is safe to execute
    Given the hardening uses existing feature, task deps, refresh, and check verbs
    When the change is reviewed
    Then no public CLI surface or task-batch schema field has been added
```
### Q&A
- **Design feedback transport:** reuse one run-scoped Markdown artifact. The approval prompt tells the operator to fill its `Operator feedback` section before rejecting; the next system-design pass must read it.
- **Ordering transport:** keep the public batch schema unchanged. Decomposition emits a private run artifact keyed by task names; post-create logic resolves names against `spur task list --feature --json` and applies existing `spur task deps` atomically.
- **Ambiguous resolution:** fail loudly before handoff; never guess between duplicate or missing task names.
- **Handoff authority:** a generated run-scoped report, not a static note, selects refineall versus runall from real task-check results.
### Design
Modify `config/workflows/idea-pipeline.yaml` and its current contract owners only:
`plugins/sp/skills/spur-dev/references/planning-workflow.md`, the relevant dev-idea/spur-dev guidance,
`packages/app/tests/workflow/idea-pipeline-definition.test.ts`, and an existing plugin structural
test where prompt text is already asserted. Do not add a CLI verb or batch-schema field.

Feature-create prompts the agent to write body-only Goal and Scope artifacts, then persists them via
`spur feature update <id> --section ... --from-file`. System-design owns
`.spur/run/${vars.__runId}-idea-design-review.md`; on rejection the operator records feedback there,
and the next pass must read it, revise the design, update invalidated feature AC through the CLI,
and leave `spur feature check <id>` passing before the positive taste decision routes to decomposition.

Decomposition continues to emit the existing schema-valid task batch and additionally emits
`.spur/run/${vars.__runId}-idea-task-order.json` with `{name, depends_on_names[]}` entries when
ordering exists. After `task batch-create`, deterministic shell logic resolves the unique names
from `spur task list --feature <id> --json`, applies `spur task deps <wbs> set ... --json`, and fails
on missing/duplicate names or a dependency error. It then runs `spur feature refresh --json`, checks
each created WBS, and writes `.spur/run/${vars.__runId}-idea-handoff.md`. Any failed task check makes
the report recommend ready-depth refineall; only an all-pass set recommends runall. The terminal
note points to this report. Task 0514 is assumed green and must not be re-owned.
### Plan
- [ ] Add run-scoped Goal/Scope and design-review artifact contracts to feature-create/system-design.
- [ ] Gate accepted design on reconciled feature AC and a passing feature check.
- [ ] Emit the private task-order sidecar and apply it after batch creation with `spur task deps`.
- [ ] Refresh the feature roster and check the frozen created-WBS set.
- [ ] Generate the conditional handoff report and replace the static runall recommendation.
- [ ] Extend idea-pipeline definition and plugin contract tests for all four findings.
- [ ] Run workflow validation, focused tests, feature/task checks, and confirm no public surface or schema diff.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenario R14
- Design: `docs/design/plugin-surface-parity.md` §9
- Workflow: `config/workflows/idea-pipeline.yaml`
- Existing tests: `packages/app/tests/workflow/idea-pipeline-definition.test.ts`; `plugins/sp/tests/skill-structure.test.ts`
- Existing verbs: `spur feature update|refresh|check`, `spur task list|deps|check`
- Dependency: 0514
### History
