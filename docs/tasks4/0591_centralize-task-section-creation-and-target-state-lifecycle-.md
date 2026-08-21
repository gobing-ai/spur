---
template: feature-impl
schema_version: 1
name: "Centralize task section creation and target-state lifecycle validation"
description: ""
status: done
type: task
profile: standard
feature_id: F92
parent_wbs: null
priority: P1
tags: ["task-contract", "section-matrix", "lifecycle"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T20:06:22.451Z"
updated_at: "2026-08-19T04:16:41.134Z"
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
- [x] Add focused failing tests proving create/batch-create currently ignore matrix layout and testing-to-done checks the current row.
- [x] Thread asStatus/effectiveStatus through TaskCheckService and status-dependent checks with omitted-option compatibility tests.
- [x] Add and validate task check --as <status>; update JSON/human diagnostic expectations and CLI golden path.
- [x] Wire lifecycle YAML and inline/no-lifecycle backstop to target statuses; assert guard denial leaves bytes unchanged.
- [x] Switch both creation paths to matrix-driven buildTaskSkeleton plus template bodies; delete template-as-layout branches and hard-coded section fallbacks.
- [x] Ensure bundled/compiled resolution uses the canonical matrix asset or fails loudly; add missing-asset regression coverage.
- [x] Update docs/04_DESIGN.md and spur-cli task references, retaining --strict-core only as a documented compatibility alias.
- [x] Run narrow task-service/task-check/lifecycle/CLI tests first, then bun run autofix, bun run spur-check, bun run lint, bun run test, bun run test-cf, and bun run build.
### Solution
Created one section authority + target-aware lifecycle validation (F92).

**R1 — matrix alone determines created sections.** Both `create` and `batchCreate` build
through `buildTaskSkeleton` (the single layout producer) with the section set resolved from
the canonical section matrix + universal `References`/`History`:

- `buildTaskSkeleton` in `create` — `packages/app/src/services/task-service.ts:565`
- `buildTaskSkeleton` in `batchCreate` — `packages/app/src/services/task-service.ts:1421`
- section set resolved by `sectionsForStatus` — `packages/app/src/services/task-service.ts:415`

`sectionsForStatus` fails loudly on a missing matrix or entry (no hand-maintained creation
fallback). The template-as-skeleton producers (`renderCreatedTaskContent`) and
`DEFAULT_CREATION_SECTIONS` were deleted, and `resolveTemplate` was removed from
`TaskServiceContext`, so the template never owns the heading list.

**R2 — transition gates evaluate the target status via `--as`.** `TaskCheckService.check`
projects `effectiveStatus = asStatus ?? frontmatter.status` for the matrix entry and the
L2/L3/L4 policy while L1 still reads the real document — `packages/app/src/services/task-check.ts:493-510`.
Omitted `--as` stays behavior-compatible. The CLI adds the canonical-status-validated
`--as <status>` option, rejects the `--corpus` combination, and keeps `--strict-core` as a
documented compatibility alias — `apps/cli/src/commands/task.ts:1044-1057`.

**R3 — missing target-required sections deny the transition, byte-identical.**
The lifecycle guards invoke `task check --as testing` / `--as done` —
`config/workflows/task-lifecycle.yaml:73,78`. The inline no-lifecycle backstop
`runDoneGateCheck` passes the transition target as `asStatus` — `apps/cli/src/commands/task.ts:1462-1481`.
Matrix loading fails loudly with the attempted paths when neither a project-local nor a
bundled canonical asset is reachable — `apps/cli/src/commands/task.ts:1511-1530`. The server
provides a bundled canonical matrix so server task creation keeps the same authority —
`apps/server/src/serve.ts:30-40`.

`--as`/`asStatus` precedent reused from `feature.ts`/`feature-check.ts` (0418). The
`checkVerdictArtifact` done-gate continues to consume 0590's normalized answer output via
`.spur/run/<wbs>-verdict.json` — unchanged.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Matrix alone determines created sections | MET | `packages/app/src/services/task-service.ts:565` (`create` → `buildTaskSkeleton`) and `packages/app/src/services/task-service.ts:1421` (`batchCreate` → `buildTaskSkeleton`); section set resolved by `sectionsForStatus` (`packages/app/src/services/task-service.ts:415`) which fails loudly on missing matrix/entry; `DEFAULT_CREATION_SECTIONS` and CLI `FALLBACK_MATRIX` deleted; tests `packages/app/tests/services/task-service.test.ts` (F92 R1 create layout, fail-loud, batchCreate matrix) |
| R2 — Transition gates evaluate target status via `--as` | MET | `packages/app/src/services/task-check.ts:493-510` `effectiveStatus = asStatus ?? frontmatter.status` drives L2/L3/L4 policy while L1 reads the real doc (omitted `--as` behavior-compatible); `apps/cli/src/commands/task.ts:1044-1057` adds canonical-status-validated `--as`, rejects `--corpus`, keeps `--strict-core` as documented alias; tests `packages/app/tests/services/task-check.test.ts` (F92 R2) + `apps/cli/tests/commands/task.test.ts` (--as projection/invalid/conflict) |
| R3 — Missing target-required sections deny transition, byte-identical | MET | lifecycle guards invoke check as the target: `config/workflows/task-lifecycle.yaml:73,78` (`--as testing`/`--as done`); inline no-lifecycle backstop `runDoneGateCheck` passes the transition target as `asStatus` (`apps/cli/src/commands/task.ts:1462-1481`); R3 test proves testing→done denies missing Review and leaves the file byte-identical (matrix loader fails loudly with attempted paths when no canonical asset is reachable — see Solution) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Matrix alone determines created sections | MET | test | `packages/app/tests/services/task-service.test.ts` F92 R1 (create/batchCreate headings from matrix, fail-loud on missing matrix/entry) |
| Scenario: R2 — Transition gates evaluate target status | MET | test | `packages/app/tests/services/task-check.test.ts` F92 R2 (`asStatus: testing`/`done` projects target row; omitted-compat); `apps/cli/tests/commands/task.test.ts` `--as done` reports target status; file unmutated before guard passes |
| Scenario: R3 — Missing target-required sections deny transition | MET | test | `packages/app/tests/services/task-check.test.ts` R3 (testing task missing Review passes current row, denied under `asStatus: done`, byte-identical read-only) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
## Review Report — 0591 (feature F92)

**Scope:** working-tree diff since implementation (uncommitted F92 changes, 19 files)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

| # | Severity | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 | architecture | `sectionsForStatus` hardcodes the universal `References`+`History` append outside the matrix (a mild deviation from "matrix alone"), though documented as structural/closed-world and consistent with check's universal-section handling | `packages/app/src/services/task-service.ts:432` |
| 2 | P4 | architecture | Matrix-resolution (project-local → bundled → fail-loud) duplicated in CLI `loadSectionMatrixUncached` and server `loadServerSectionMatrix` — candidate for a shared loader | `apps/cli/src/commands/task.ts:1515`, `apps/server/src/serve.ts:34` |
| 3 | P4 | correctness | `--as <status>` with no `<wbs>`/`--folder` projects every task in the active folder as the target (read-only, harmless); `--as`+`--corpus` is rejected, `--since`-without-`--corpus` is rejected separately | `apps/cli/src/commands/task.ts:1055` |

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — matrix alone determines created sections | MET | `task-service.ts:565,1421` both create + batchCreate route through `buildTaskSkeleton` with `sectionsForStatus` (matrix SSOT); `DEFAULT_CREATION_SECTIONS` (309) and CLI `FALLBACK_MATRIX` deleted; `sectionsForStatus` fails loudly on missing matrix/entry (`task-service.ts:409-435`); `loadSectionMatrix` fails loudly with attempted paths (`task.ts:1511`) |
| R2 — transition gates evaluate target status via `--as` | MET | `task.ts:1044-1060` adds `--as`, validates against canonical `TASK_STATUSES`, rejects `--corpus` combo, keeps `--strict-core` as documented alias; `task-check.ts:490-510` `effectiveStatus = asStatus ?? status` drives L2/L3/L4 policy while L1 reads real doc; omitted `--as` behavior-compatible |
| R3 — missing target-required sections deny transition, stable finding, byte-identical | MET | `task-lifecycle.yaml:73,78` guards use `--as testing` / `--as done`; inline backstop `runDoneGateCheck` passes target `status` (`task.ts:380,1468`); R3 test proves `testing→done` denies missing `Review` (`task-check.test.ts` F92 R3) and byte-identical read-only projection |

**Next:** no blockers/majors — ship; fold the two matrix-loader copies into one shared helper when convenient.
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
- 2026-08-18T20:53:58.225Z todo → wip (system)
- 2026-08-18T21:07:06.219Z wip → testing (system)
- 2026-08-18T21:07:22.902Z testing → done (system)
