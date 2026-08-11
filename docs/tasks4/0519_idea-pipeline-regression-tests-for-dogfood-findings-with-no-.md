---
template: feature-impl
schema_version: 1
name: "Idea-pipeline regression tests for dogfood findings with no-surface guard"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["idea", "workflow", "plugins/sp"]
dependencies: ["0518"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.899Z"
updated_at: "2026-08-11T23:06:18.699Z"
---

## 0519. Idea-pipeline regression tests for dogfood findings with no-surface guard

### Background
Split from task 0515 (feature I2, decomposition 2026-08-11). This final task locks the four dogfood defects behind focused workflow-definition and plugin-contract tests after 0515/0518 land: Goal/Scope intent, persistent design feedback and AC reconciliation, dependency/order finalization, and roster/readiness-aware handoff. It also proves the feature stayed on the harness/documentation surface.

Current test owners verified during ready refinement: `packages/app/tests/workflow/idea-pipeline-definition.test.ts` parses `config/workflows/idea-pipeline.yaml` and already asserts run-scoped artifacts/transitions; `plugins/sp/tests/skill-structure.test.ts` owns cross-surface Markdown contracts. `apps/cli/schemas/task-batch.schema.json` must remain unchanged and reject the private order field.

Implements feature scenarios R10 and R14. Ordering: after 0518; no production behavior beyond the workflow/guidance changes already owned by 0515/0518.

Rubric: E2 D1 L1 C0 R0 = 4 → split verification slice.
### Requirements
- [ ] R1. Extend `idea-pipeline-definition.test.ts` and `skill-structure.test.ts` with focused assertions for all four defects: Goal/Scope CLI writes; run-scoped design feedback plus AC recheck; order-sidecar mapping/dependency application; roster refresh plus mutually exclusive refineall/runall handoff recommendations.
- [ ] R2. Prove the private order sidecar did not change `apps/cli/schemas/task-batch.schema.json`, and review the 0515/0518/0519 diff to confirm no public CLI command/flag, package dependency, persistence schema, transport, or unrelated runtime file changed.

Non-goals: new test file, end-to-end agent execution, CLI/schema modification, duplicated workflow parser, or broad snapshot testing.
### Acceptance Criteria
```gherkin
Feature: Idea-pipeline regression coverage
  Scenario: R1 — Idea handoff is safe to execute
    Given the four dogfood findings are encoded as tests
    When the focused suite runs against an unhardened idea-pipeline definition
    Then each test fails and passes only with the 0515/0518 changes in place

  Scenario: R2 — Refinement changes no runtime surface
    Given the change set is limited to harness guidance and tests
    When the diff is reviewed
    Then no public CLI surface, task-batch schema, dependency, persistence, or transport changes
```
### Q&A
- **Workflow test owner:** extend `packages/app/tests/workflow/idea-pipeline-definition.test.ts`; it already parses the definition and understands states, actions, transitions, and run-scoped paths.
- **Plugin contract owner:** extend `plugins/sp/tests/skill-structure.test.ts` only for the mirrored planning-workflow/dev-idea statements.
- **No-surface proof:** assert the task-batch schema has no `depends_on_names` property and remains closed; verify the scoped git diff for CLI/package/schema/persistence/transport paths instead of adding a permanent diff-dependent test.
- **Execution scope:** tests inspect workflow/guidance contracts; they do not launch an agent or create real corpus tasks.
### Design
Extend existing test owners only.

In `packages/app/tests/workflow/idea-pipeline-definition.test.ts`, add focused cases that inspect parsed YAML/raw text for:

1. `feature-create` expected Goal/Scope artifacts and both `feature update --section` calls; Goal prompt excludes decomposition/checklist instructions.
2. The run-scoped `idea-design-review.md` path, fixed feedback/reconciliation headings, retry prompt consumption, and `feature check` on both design-to-decompose paths.
3. The `idea-task-order.json` and `idea-batch-create-result.json` artifacts, `handoff-finalize` state, batch/result length and unique-name validation markers, and `task deps ... set` before handoff.
4. `feature refresh --feature`, per-WBS `task check`, `idea-handoff.md`, refineall-when-failed/runall-when-clean strings, and absence of the old static runall terminal note.

Add a schema assertion in the same file (or the existing schema test owner if already imported) that `task-batch.schema.json` remains closed and has no `depends_on_names`, `dependencies`, or order-sidecar field. In `plugins/sp/tests/skill-structure.test.ts`, assert the affected planning-workflow/dev-idea guidance names the canonical artifacts and conditional recommendation without copying shell logic.

Use property/string assertions with diagnostic messages, not a full YAML snapshot. Verification reviews the commits for 0515/0518/0519 and requires no diff under `apps/cli/src`, task-batch schema, package manifests/lockfile, `packages/domain`, or `packages/contracts`. Do not create a new test file or run the workflow with real agents.
### Plan
- [ ] Add workflow-definition regressions for Goal/Scope and design-feedback/AC-recheck behavior (R1).
- [ ] Add workflow-definition regressions for order mapping/deps and roster/check/handoff behavior, including removal of the static runall note (R1).
- [ ] Extend the plugin structural owner for canonical planning guidance and add the closed-schema/no-order-field assertion (R1/R2).
- [ ] Run `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json`, `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts`, and `bun test plugins/sp/tests/skill-structure.test.ts`.
- [ ] Review the 0515/0518/0519 scoped diff and confirm no CLI source, task-batch schema, package manifest/lockfile, persistence, contracts, or transport change; run task/feature checks and record evidence (R2).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: I2, scenarios R10 and R14
- Design: `docs/design/plugin-surface-parity.md` §§8–9
- Dependencies: 0515 (feature/design guidance), 0518 (post-create finalization)
- Workflow test owner: `packages/app/tests/workflow/idea-pipeline-definition.test.ts`
- Plugin contract owner: `plugins/sp/tests/skill-structure.test.ts`
- Closed public schema: `apps/cli/schemas/task-batch.schema.json`
### History
