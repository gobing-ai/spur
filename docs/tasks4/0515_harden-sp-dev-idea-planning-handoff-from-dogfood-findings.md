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
updated_at: "2026-08-11T22:26:28.330Z"
---

## 0515. Harden sp-dev-idea planning handoff from dogfood findings

### Background
Operational hardening for feature I2 scenario R14 — Idea handoff is safe to execute. This task owns the guidance contract: Goal/Scope intent through `spur feature update` and the design-review feedback/reconciliation artifact. The finalization machinery (order sidecar + deps, roster refresh, readiness-gated handoff report) moved to 0518, and the regression tests + no-surface guard to 0519, by the 2026-08-11 decomposition.

Dogfooding the feature through `config/workflows/idea-pipeline.yaml` exposed four concrete gaps; this task covers the first two (feature-create placed decomposition/checklist content in Goal and left Scope blank; design rejection had no explicit persistent feedback/reconciliation contract). The remaining two (ordering not encoded; handoff recommended runall while tasks were unready) live in 0518. Fix at the spine/workflow/skill/test layer using existing CLI verbs. Do not add task-batch schema fields or change the public CLI surface without separate operator consent.

Rubric: E3 D1 L1 C0 R0 = 5 → split (size gate: 7 R-items > cap 5); guidance slice kept here.
### Requirements
- [ ] R1. Make feature-create guidance write concise Goal and Scope intent through `spur feature update`; decomposition output and completion checklists never enter Goal.
- [ ] R2. Persist design review and operator rejection feedback in `.spur/run/${vars.__runId}-idea-design-review.md`; the revision pass reads it and reconciles accepted design changes with feature AC through the feature CLI before decomposition.

Non-goals: executing created tasks, changing task-batch.schema.json, introducing a new CLI finalizer, or redesigning the idea workflow (ordering/roster/handoff live in 0518; tests in 0519).
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
- [ ] Add run-scoped Goal/Scope contract guidance to feature-create via `spur feature update --section --from-file`.
- [ ] Persist design-review feedback in the run-scoped artifact; gate accepted design on reconciled feature AC and a passing feature check.
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
