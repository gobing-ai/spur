---
template: issue
schema_version: 1
name: "Make WBS-targeted task checks consistent across configured folders"
description: ""
status: todo
type: issue
profile: standard
feature_id: F
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T23:29:09.142Z"
updated_at: "2026-08-11T23:31:43.851Z"
---

## 0522. Make WBS-targeted task checks consistent across configured folders

### Background
Task 0197 exposed a deterministic mismatch in the task CLI while it lived in configured inactive
folder `docs/tasks2` and the active folder was `docs/tasks4`:

- `spur task show 0197 --json` and `spur task path 0197 --json` resolve the task across configured
  folders.
- `spur task check 0197 --json` reports `Task 0197 not found` because the command enumerates only the
  active directory before calling the already multi-folder-aware checker.
- `spur task check 0197 --folder docs/tasks2 --json` finds the task but reports false
  `L4.stale-line-anchor` warnings. The same command with the absolute folder path passes with zero
  findings.

This mismatch breaks the task-pipeline precheck and lifecycle guards for a valid WBS outside the
active folder. It also contradicts the repository's WBS lookup contract. The operator selected the
target behavior on 2026-08-11: targeted WBS checks search configured folders; explicit relative
folders normalize to absolute paths; unscoped scans and `task list` remain active-folder-only.

The Pi repeated-output incident that led to this discovery is not this bug's root cause and is out
of scope. Its session evidence is preserved in cancelled task 0521.
### Requirements
- [ ] **R1 — Resolve targeted checks across configured folders.** `spur task check <wbs>` uses the
      existing `TaskLocator` folder set when `--folder` is omitted, matching `task show/path/update`.
- [ ] **R2 — Honor explicit folder scope.** When `--folder <path>` is present, normalize it through
      `context.fs.resolve()` and restrict lookup to that resolved directory; relative and absolute
      spellings produce the same findings.
- [ ] **R3 — Preserve active-only scans.** `spur task check` without a WBS and `spur task list` keep
      scanning only the active folder. Do not widen board/list membership or corpus semantics.
- [ ] **R4 — Keep the public surface stable.** Add no noun, verb, flag, config key, state file, or
      fallback. Update `docs/04_DESIGN.md` and the `sp:spur-cli` task reference to state the targeted
      versus unscoped behavior.
- [ ] **R5 — Lock the regression.** Add focused CLI tests for configured inactive-folder lookup,
      relative/absolute `--folder` parity with a root-relative `file:line` citation, and unchanged
      active-only unscoped scanning; run targeted tests and the repository gates.
### Acceptance Criteria
```gherkin
Feature: Consistent task checks across configured folders

  @core
  Scenario: R1 — A targeted check resolves an inactive configured task
    Given `docs/tasks4` is active and task 0197 exists only in configured folder `docs/tasks2`
    When `spur task check 0197 --json` runs without `--folder`
    Then it checks task 0197 instead of reporting it missing
    And its L4 edges still resolve through all configured task folders

  @core
  Scenario: R2 — Relative and absolute folder overrides are equivalent
    Given task 0197 contains a valid root-relative `file:line` citation
    When it is checked once with `--folder docs/tasks2` and once with the absolute folder path
    Then both invocations check the same file
    And both return the same findings without a false stale-line-anchor warning

  @core
  Scenario: R3 — Unscoped commands retain active-folder semantics
    Given active and inactive configured folders both contain tasks
    When `spur task check --json` or `spur task list --json` runs without a WBS
    Then only active-folder tasks are returned

  @core
  Scenario: R4 — The fix introduces no new CLI surface
    Given the existing `task check [wbs] [--folder <path>]` command
    When configured-folder consistency is implemented
    Then no noun, verb, flag, config key, state file, or fallback is added
    And the design and CLI reference document targeted versus unscoped resolution

  @core
  Scenario: R5 — Regression coverage proves both fixes
    Given focused CLI fixtures for active and inactive task folders
    When the task command tests run
    Then targeted configured-folder lookup, folder-path parity, and active-only scans pass
```
### Q&A
**Q: Is this the root cause of Pi's repeated text?**  
A: No. It is an independent Spur defect exposed during that run. Task 0521 preserves the forensic
separation.

**Q: Should all task commands scan every configured folder?**  
A: Only WBS-targeted lookup. Unscoped `check` and `list` remain active-only so board membership and
bulk-operation scope do not change.

**Q: What does explicit `--folder` mean?**  
A: It remains a strict single-folder override. Resolve it to an absolute path before lookup and
checking; do not merge configured folders into that explicit scope.

**Q: Is a new flag or warning mode needed?**  
A: No. The existing `TaskLocator`, `--folder`, and JSON shapes are sufficient.

**Q: Was the behavior change approved?**  
A: Yes. On 2026-08-11 the operator selected the replacement task with targeted configured-folder
lookup, normalized relative overrides, and active-only unscoped scans.
### Design
Use the existing locator; add no new abstraction or public API.

1. In `apps/cli/src/commands/task.ts`, resolve every explicit task-folder override with
   `context.fs.resolve()`. This makes `docs/tasks2` and its absolute spelling identical before
   `TaskCheckService.resolveProjectRootFromTasksDir()` derives the project root.
2. In the `task check` handler, branch only on invocation shape:
   - WBS + no `--folder`: locate with `makeTaskLocator(context).findByWbs(wbs)`.
   - WBS + `--folder`: locate with `TaskLocator.forSingleDir(context.fs, resolvedFolder)`.
   - no WBS: retain the existing active/explicit directory enumeration.
3. Pass the located absolute `filePath` to the existing multi-folder-aware `TaskCheckService`; do
   not duplicate filename walking or L1–L4 validation.
4. Update `docs/04_DESIGN.md` and
   `plugins/sp/skills/spur-cli/references/tasks.md` in the same change.

Primary targets: `apps/cli/src/commands/task.ts`, `apps/cli/tests/commands/task.test.ts`,
`docs/04_DESIGN.md`, and `plugins/sp/skills/spur-cli/references/tasks.md`.

Anti-patterns: do not widen `task list`; do not make no-WBS `task check` scan inactive folders; do
not re-home archived tasks; do not add `taskFolder` state to the pipeline; do not special-case
`docs/tasks2`; do not modify Pi/provider runtime behavior.
### Plan
- [ ] **P1 (R1, R2).** Add failing CLI tests for inactive configured WBS lookup and relative versus
      absolute folder parity, using a valid root-relative `file:line` citation.
- [ ] **P2 (R1, R2).** Normalize explicit folder paths and route WBS-targeted checks through the
      existing `TaskLocator` with strict explicit-folder semantics.
- [ ] **P3 (R3).** Add/retain a regression assertion that unscoped check/list results contain only
      active-folder tasks.
- [ ] **P4 (R4).** Synchronize `docs/04_DESIGN.md` and the `sp:spur-cli` task reference; add no new
      command surface.
- [ ] **P5 (R5).** Run the focused task-command test first, then `bun run autofix`,
      `bun run spur-check`, `bun run lint`, `bun run test`, `bun run test-cf`, and `bun run build`;
      verify task/corpus gates and intentional git status.
### Root Cause
`apps/cli/src/commands/task.ts:999-1017` constructs `task check` targets by reading only
`tasksDir` (active folder unless explicitly overridden), so a WBS-specific check never reaches the
configured-folder `TaskLocator` already supplied to `TaskCheckService` at
`apps/cli/src/commands/task.ts:1300-1310`.

The same command leaves a relative override unresolved at `apps/cli/src/commands/task.ts:1002`.
For `docs/tasks2`, `packages/app/src/services/task-check.ts:198-203` does not match the absolute
`/docs/tasksN` pattern and derives `docs` as the project root; line-anchor validation then probes
`docs/packages/...` at `packages/app/src/services/task-check.ts:1029-1038`, producing false stale
anchors. The shared service factory has the same unnormalized override at
`apps/cli/src/commands/task.ts:1197-1200`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Task 0197 — concrete configured inactive-folder reproduction
- Task 0521 — cancelled Pi-loop diagnosis and forensic separation
- `apps/cli/src/commands/task.ts:918-1055` — current `task check` handler
- `packages/app/src/services/task-locator.ts:58-92` — existing configured-folder locator
- `packages/app/src/services/task-check.ts:198-203` — project-root derivation
- `docs/04_DESIGN.md:993` — authoritative `task check` surface
- `plugins/sp/skills/spur-cli/references/tasks.md` — operator-facing task CLI reference
### History
