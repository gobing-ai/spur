---
template: feature-impl
schema_version: 1
name: "Centralize task section creation and target-state lifecycle validation"
description: ""
status: todo
type: task
profile: standard
feature_id: F92
parent_wbs: null
priority: P1
tags: ["task-contract", "section-matrix", "lifecycle"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T20:06:22.451Z"
updated_at: "2026-08-18T20:08:12.569Z"
---

## 0591. Centralize task section creation and target-state lifecycle validation

### Background

The tracked section matrix says it drives both creation and validation, and docs/04_DESIGN.md says buildTaskSkeleton is the single producer. Current create/batch-create instead prefer template-as-full-skeleton rendering, while task-service.ts and task.ts retain hand-maintained fallback section policies. Lifecycle guards also run task check against the on-disk current status before PlanningWriteService writes the target status, so testing-to-done evaluates the testing row and never executes done.gate:true. --strict-core is only a label over default severity. This task restores one section authority and makes transition validation target-aware without changing the legal lifecycle graph. Operator consent for the additive public --as option was recorded on 2026-08-18.

### Requirements
- R1. Make `config/tasks/section-matrix.yaml` the sole semantic source for task headings during create and batch-create. Both paths use `buildTaskSkeleton` plus existing template-body extraction. Templates may supply bodies/guidance but not the heading list. Delete `DEFAULT_CREATION_SECTIONS` and the manually authored `FALLBACK_MATRIX`; packaged or compiled execution loads data copied/generated from the canonical YAML and fails loudly with attempted paths if no canonical asset is available.
- R2. Add optional `asStatus`/`effectiveStatus` support to `TaskCheckService` and expose the operator-authorized `spur task check --as <status>` option. Validate against canonical task statuses. Frontmatter schema validation reads the real document, while lifecycle-dependent L2/L3/L4 policy evaluates `asStatus ?? frontmatter.status`. Omitted `--as` remains behavior-compatible. Preserve `--strict-core` temporarily as a compatibility alias and reject contradictory option combinations explicitly.
- R3. Run `wip → testing` and `testing → done` checks as `testing` and `done` respectively in lifecycle YAML and the adapter-unavailable/`--no-lifecycle` inline backstop. A denied transition leaves the file byte-identical and reports stable findings. Update `docs/04_DESIGN.md`, CLI/skill references, config comments, compiled-layout coverage, and focused create/check/lifecycle tests in the same change. Do not alter the legal status graph or unrelated templates.
### Acceptance Criteria
```gherkin
Feature: Task section and target-state validation

  Scenario: R1 — Matrix alone determines created sections
    Given a task template variant and creation status
    When spur task create or batch-create renders the task
    Then the section headings come from the canonical section matrix entry
    And templates contribute section bodies and guidance without owning document layout

  Scenario: R2 — Transition gates evaluate target status
    Given a task transitioning from one lifecycle status to another
    When the lifecycle structural guard runs
    Then task validation evaluates the matrix and status-dependent rules as the target status
    And the task file is not mutated before the guard allows the transition

  Scenario: R3 — Missing target-required sections deny transition
    Given a task whose current-status check passes but whose target status requires an absent section
    When the task attempts that transition
    Then the transition is denied with the stable missing-section finding
    And the task remains byte-identical
```
### Q&A
- **Why creation and target-state validation are one task:** both are consumers of the same section matrix. Splitting them would intentionally leave a release where creation and lifecycle checking disagree about the contract.
- **Does `--as` mutate the task or lifecycle engine state?** No. It is a read-only validation projection used before the atomic write. Frontmatter remains the source for the current status and schema validation.
- **What happens to `--strict-core`?** Keep it as a temporary compatibility alias during this task because workflows and installed plugins may still call it. Target-state selection supplies the real done semantics. Remove the alias only in a separately reviewed compatibility change.
- **What if neither project-local nor packaged matrix exists?** Fail loudly. A permissive handwritten fallback makes the same task validate differently by installation layout and defeats the SSOT.
- **Does this change section contents?** Only which headings are created. Template body fragments and guidance remain reusable inputs. Existing task files are not migrated.
- **Public surface authorization:** Robin accepted the proposed `spur task check --as <status>` design on 2026-08-18 after reviewing the current-state/target-state defect.
### Design
**Decision.** Keep the existing section matrix and TaskCheckService; add target-status evaluation to them. Do not add a new validation engine or a second lifecycle profile config.

**Primary seams.**

| Area | Intended change |
| --- | --- |
| config/tasks/section-matrix.yaml | Remains the tracked semantic SSOT; comments match actual creation/check behavior |
| packages/domain/src/planning/task-skeleton.ts | buildTaskSkeleton remains the one heading/layout producer; template extraction supplies bodies |
| packages/app/src/services/task-service.ts | create and batchCreate always resolve matrix entry and build through the canonical skeleton path; delete inline section fallback |
| packages/app/src/services/planning-check-base.ts and task-check.ts | Evaluate matrix and status-sensitive rules with effectiveStatus = asStatus ?? frontmatter.status |
| apps/cli/src/commands/task.ts | Add --as, validate status, pass asStatus, remove semantic fallback constant, and pass transition target to inline guards |
| config/workflows/task-lifecycle.yaml | Invoke task check with --as testing or --as done |
| apps/cli/tests and packages/app/tests | Pin create layout, current-vs-target checks, guard denial, no-lifecycle parity, and zero-write failure |

**Invariants.** The task file stays unchanged until the guard passes. Omitted --as preserves current-status diagnostics. Both create verbs use the same producer. Packaged fallback is data copied/generated from canonical YAML, never a second handwritten policy.

**Rejected.** Do not encode transition profiles in another YAML; status/variant obligations already exist. Do not mutate frontmatter temporarily for checks. Do not make --strict elevate all warnings at done. Do not keep template-as-skeleton and filter headings afterward; that remains two layout authorities.
### Plan
- [ ] Add focused failing tests proving create/batch-create currently ignore matrix layout and testing-to-done checks the current row.
- [ ] Thread asStatus/effectiveStatus through TaskCheckService and status-dependent checks with omitted-option compatibility tests.
- [ ] Add and validate task check --as <status>; update JSON/human diagnostic expectations and CLI golden path.
- [ ] Wire lifecycle YAML and inline/no-lifecycle backstop to target statuses; assert guard denial leaves bytes unchanged.
- [ ] Switch both creation paths to matrix-driven buildTaskSkeleton plus template bodies; delete template-as-layout branches and hard-coded section fallbacks.
- [ ] Ensure bundled/compiled resolution uses the canonical matrix asset or fails loudly; add missing-asset regression coverage.
- [ ] Update docs/04_DESIGN.md and spur-cli task references, retaining --strict-core only as a documented compatibility alias.
- [ ] Run narrow task-service/task-check/lifecycle/CLI tests first, then bun run autofix, bun run spur-check, bun run lint, bun run test, bun run test-cf, and bun run build.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Canonical matrix: `config/tasks/section-matrix.yaml`
- Matrix schema/type: `apps/cli/schemas/section-matrix.schema.json`; `packages/domain/src/planning/task-skeleton.ts`
- Creation paths: `packages/app/src/services/task-service.ts` (`create`, `batchCreate`)
- Checker: `packages/app/src/services/planning-check-base.ts`; `packages/app/src/services/task-check.ts`
- CLI loading/options/backstop: `apps/cli/src/commands/task.ts`
- Mutation ordering: `packages/app/src/services/planning-write-service.ts`
- Lifecycle guards: `config/workflows/task-lifecycle.yaml`
- Existing target-state precedent: `apps/cli/src/commands/feature.ts` and `packages/app/src/services/feature-check.ts` (`--as`/`asStatus`)
- Normative design: `docs/04_DESIGN.md` §7.4
- Relevant tests: `apps/cli/tests/commands/task.test.ts`; `packages/app/tests/services/task-service.test.ts`; `packages/app/tests/services/task-check.test.ts`; lifecycle adapter/write-service tests
### History
