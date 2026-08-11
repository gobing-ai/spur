---
template: feature-impl
schema_version: 1
name: "Idea handoff finalization: task ordering, roster refresh, readiness-gated recommendation"
description: ""
status: todo
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["idea", "workflow", "plugins/sp"]
dependencies: ["0515"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.890Z"
updated_at: "2026-08-11T23:05:27.340Z"
---

## 0518. Idea handoff finalization: task ordering, roster refresh, readiness-gated recommendation

### Background
Split from task 0515 (feature I2, decomposition 2026-08-11). This task owns the post-create finalization exposed by dogfood: encode decomposition order after atomic batch creation, refresh the feature's generated task roster, evaluate the newly created tasks, and generate a conditional handoff report. Task 0515 supplies the Goal/Scope and design-feedback contract; 0519 adds regression coverage.

Current-tree premises verified during ready refinement: `decompose` emits only `*-idea-task-batch.json`; `batch-create-run` currently invokes batch-create without `--json`; success transitions directly to a static runall note. Source-local `task batch-create --json` returns `{ created, wbs, parentsWired }`, with `wbs[]` in input-array order; `task deps <wbs> set ...`, `feature refresh --feature <id>`, and `task check <wbs> --json` already provide every deterministic seam required.

Implements feature I2 scenario R14. Ordering: after 0515, before 0519. No public CLI verb/flag, task-batch schema field, dependency, persistence, or transport is added.

Rubric: E3 D1 L1 C0 R0 = 5 → split; post-create mechanics remain separate from guidance and tests.
### Requirements
- [ ] R1. Decomposition always emits `.spur/run/${vars.__runId}-idea-task-order.json` as an array of `{ name, depends_on_names[] }`. After `task batch-create --json`, map input names to returned WBS values by their documented shared order, reject duplicate/missing/unknown names, and apply each non-empty dependency set through `spur task deps <wbs> set ... --json` before handoff.
- [ ] R2. After dependency application, run `spur feature refresh --feature <id> --json` so the feature roster reflects the created tasks and statuses.
- [ ] R3. Check every WBS from the captured batch-create result and write `.spur/run/${vars.__runId}-idea-handoff.md`: any failed `task check` recommends `/sp:dev-refineall --feature <id> --auto --depth ready` and omits runall; an all-pass set recommends `/sp:dev-runall --feature <id> --auto`. The terminal note points only to this report.

Non-goals: new CLI finalizer, task-list title lookup, task-batch schema changes, task execution, or changes to 0515's feature/design guidance.
### Acceptance Criteria
```gherkin
Feature: Safe idea-pipeline planning handoff
  Scenario: R1 — Idea handoff is safe to execute
    Given decomposition emits a non-empty task-order sidecar
    When batch creation succeeds
    Then each dependency is applied with spur task deps or the pipeline fails before handoff

  Scenario: R2 — Idea handoff is safe to execute
    Given task batch creation succeeds
    When post-create finalization completes
    Then spur feature refresh has regenerated the feature task roster

  Scenario: R3 — Idea handoff is safe to execute
    Given at least one created task fails spur task check
    When the handoff report is generated
    Then it recommends ready-depth refineall and does not recommend runall
```
### Q&A
- **Canonical artifacts:** `*-idea-task-order.json`, `*-idea-batch-create-result.json`, and `*-idea-handoff.md`, all run-scoped.
- **Order shape:** a JSON array of `{ name: string, depends_on_names: string[] }`; emit `[]` when no ordering exists. It is private workflow data and is not added to `task-batch.schema.json`.
- **Name mapping:** zip validated batch item names with `batch-create --json` `wbs[]` by index, after equal-length and unique-name checks. Do not re-query `task list` or guess between duplicate titles.
- **Workflow shape:** add one `handoff-finalize` state between successful batch creation and terminal handoff. A dependency/refresh/mapping error fails the run; an unready task is a successful planning outcome recorded as a refineall recommendation.
- **Readiness profile:** plain `task check --json` evaluates task structure without promoting expected in-batch prerequisite warnings; strict feature verification remains a later execution concern.
### Design
Modify only `config/workflows/idea-pipeline.yaml` and affected planning guidance. Keep `task-batch.schema.json` unchanged.

`decompose` must emit the existing task batch and the private `.spur/run/${vars.__runId}-idea-task-order.json` array. A following shell action validates that the sidecar is an array, that batch task names are unique, and that every sidecar name/dependency refers to exactly one batch name; `[]` is valid.

Change `batch-create-run` to capture source-local `$spurBin task batch-create --file ... --json` output atomically in `.spur/run/$__runId-idea-batch-create-result.json`. The command writes the existing done sentinel only after JSON parses and `created == (.wbs | length)`; failure retains the existing retry behavior. The CLI contract guarantees `wbs[]` order matches the input batch order.

Add state `handoff-finalize` between `batch-create-run` success and `handoff`. Its shell action:

1. Zips batch item names to result WBS values after equal-length/unique-name checks.
2. Applies each non-empty `depends_on_names` list with `$spurBin task deps <wbs> set <dep-wbs...> --json`; any mapping or CLI error exits non-zero before terminal handoff.
3. Runs `$spurBin feature refresh --feature "$featureId" --json`.
4. Runs `$spurBin task check <wbs> --json` for the frozen result WBS list and writes one Markdown handoff report containing feature ID, WBS list, per-task outcome, and exactly one next command: ready-depth refineall if any check fails, otherwise auto runall.

Change the terminal note to point at `*-idea-handoff.md`; remove the static runall command. Do not add a CLI verb, script abstraction, schema field, title lookup, or task execution. Task 0519 owns regression assertions for the new state/artifacts.
### Plan
- [ ] Emit and validate the canonical run-scoped order sidecar during decomposition (R1).
- [ ] Capture/validate atomic `batch-create --json` output and preserve existing retry sentinels (R1).
- [ ] Add `handoff-finalize`; zip batch names to result WBS values, apply `task deps`, and fail on any ambiguous/missing mapping or CLI error (R1).
- [ ] Refresh the feature roster, check the frozen WBS list, and generate the mutually exclusive refineall/runall handoff report (R2/R3).
- [ ] Point the terminal note to the report and sync affected planning guidance; do not touch CLI/schema/runtime surfaces.
- [ ] Run workflow validation plus `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts`; 0519 adds the focused regression cases.
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
- CLI contracts: `spur task batch-create --json`; `spur task deps`; `spur task check`; `spur feature refresh --feature`
- Dependency: 0515
- Dependent task: 0519
### History
