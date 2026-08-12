---
template: issue
schema_version: 1
name: "Make WBS-targeted task checks consistent across configured folders"
description: ""
status: done
type: issue
profile: standard
feature_id: F
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T23:29:09.142Z"
updated_at: "2026-08-12T00:45:45.773Z"
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
**Solution**

WBS-targeted `task check` now resolves like `task show`/`task path`, and every explicit folder override is normalized before use. Change map (file:line):

- **R1 — Targeted lookup across configured folders.** `apps/cli/src/commands/task.ts:1020-1038` — the `task check` handler branches on invocation shape: WBS + no `--folder` locates via `makeTaskLocator(context).findByWbs(wbs)` (the configured-folder `TaskLocator` already used by the L4 edge checks); WBS + `--folder` locates via `TaskLocator.forSingleDir(context.fs, tasksDir)`; no WBS keeps the existing active/explicit directory enumeration untouched (R3). The per-result human print is hoisted into a shared `printResult` so both branches emit identical output.
- **R2 — Normalize explicit overrides.** `apps/cli/src/commands/task.ts:1005` — the handler resolves `options.folder ?? activeFolder` through `context.fs.resolve()` so relative and absolute spellings are identical when `TaskCheckService.resolveProjectRootFromTasksDir()` derives the project root; `apps/cli/src/commands/task.ts:1225` — the shared `makeService` factory applies the same normalization to its `folderOverride`. No new noun/verb/flag/config key/state/fallback (R4).
- **R5 — Regression lock.** `apps/cli/tests/commands/task.test.ts:694-845` — new `seedTwoFolderCorpus()` fixture (active `docs/tasks4`, inactive `docs/tasks2`, the 0197 layout) with three tests: R1 targeted inactive-folder check resolves (was "Task not found"), R2 relative/absolute `--folder` parity with a valid root-relative `file:line` citation and no false `L4.stale-line-anchor`, R3 unscoped check/list remain active-only. Red→green: R1/R2 failed pre-fix, R3 passed (guard).
- **R4 — Docs.** `docs/04_DESIGN.md:993` (`spur task check` row: targeted vs unscoped vs explicit-folder resolution) and `plugins/sp/skills/spur-cli/references/tasks.md:237-244` (folder-resolution paragraph) synchronized in the same change.

Live repro on the exposing case: `task check 0197 --strict-core` (task in inactive `docs/tasks2`, no `--folder`) previously exited 1 with "Task 0197 not found"; now reports `0197 (wip): PASS` with zero stale-anchor warnings.
### Testing
**Testing**

Verified 2026-08-11 via `/sp:dev-verify 0522 --auto --next --focus all` (standalone; verdict artifact
`.spur/run/0522-verdict.json` written this run — gitignored, verdict: PASS).

Commands run and outcomes:

- `bun test apps/cli/tests/commands/task.test.ts --test-name-pattern 'R1: targeted|R2: relative|R3: unscoped'` → 3 pass / 0 fail. Red→green: R1 and R2 failed pre-fix ("Task not found" / relative-folder stale-anchor), R3 passed as the unscoped-semantics guard.
- `bun test apps/cli/tests/commands/task.test.ts` → 151 pass / 0 fail (full file).
- `bun test plugins/sp` → 667 pass / 0 fail (spur-cli reference change).
- `bun run --filter @gobing-ai/spur typecheck` → exit 0; all 7 workspaces typecheck exit 0 (spur-check lint phase).
- `biome check . --error-on-warnings` → clean, no fixes applied.
- Golden path (changed CLI surface, run this session): `bun run apps/cli/src/index.ts task check 0197 --strict-core` → exit 0, `0197 (wip): PASS`, zero stale-anchor warnings. Pre-fix the same invocation exited 1 with "Task 0197 not found" — the exposing defect.
- `bun run test` → 4860 pass / 24 fail. All 24 failures are in the seven port/serve/registry suites (createServerContext, healthModule, project-start, ProjectRegistry, rpc client, spur projects CLI, startServer) — sandbox `EPERM` listen/write denials, a documented environment artifact; zero failures on the changed surface (task/check/locator).
- `bun run test-cf` → blocked by sandbox `EPERM` (wrangler log under `~/Library/Preferences/.wrangler`, `listen 127.0.0.1`) — environmental, not code.
- `bun run build` → all workspaces compiled (incl. dist binary compile); the binary link step hit sandbox `EPERM` unlinking the `~/.bun/bin/spur` shim — environmental. `apps/cli/spur.js` rebuilt and carries the fix.
- `bun run corpus-check` → 1 NEW error at the time: 0522's own Testing placeholder at status `testing` — cleared by this section write.

Coverage: changed handler branch (`apps/cli/src/commands/task.ts:1020-1038`) exercised by the three new regression tests plus the 151-test file suite; no below-threshold flag on changed files in the full-suite coverage table.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/cli/src/commands/task.ts:1020-1038` — WBS + no `--folder` locates via `makeTaskLocator(context).findByWbs`; regression test `R1: targeted check resolves a WBS in a configured inactive folder` (`apps/cli/tests/commands/task.test.ts:751`) |
| R2 | MET | `apps/cli/src/commands/task.ts:1005` handler + `apps/cli/src/commands/task.ts:1225` factory normalize via `context.fs.resolve()`; parity test `R2: relative and absolute --folder spellings return identical findings` (`apps/cli/tests/commands/task.test.ts:775`) |
| R3 | MET | unscoped branch unchanged (active/explicit enumeration only); guard test `R3: unscoped check and list scan only the active folder` (`apps/cli/tests/commands/task.test.ts:821`) |
| R4 | MET | no new noun/verb/flag/config key/state file/fallback — `git status --porcelain` shows only `apps/cli/src/commands/task.ts`, its test, and the two doc files; `docs/04_DESIGN.md:993` + `plugins/sp/skills/spur-cli/references/tasks.md:237` synchronized |
| R5 | MET | three regression tests in `apps/cli/tests/commands/task.test.ts:694-845`; full gates above |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — A targeted check resolves an inactive configured task | MET | test | `task.test.ts` R1 test; live `task check 0197 --strict-core` exit 0 |
| R2 — Relative and absolute folder overrides are equivalent | MET | test | `task.test.ts` R2 parity test (`toEqual` on findings, no stale-line-anchor) |
| R3 — Unscoped commands retain active-folder semantics | MET | test | `task.test.ts` R3 test (check + list active-only) |
| R4 — The fix introduces no new CLI surface | MET | command | `git status --porcelain` — only `apps/cli/src/commands/task.ts`, `apps/cli/tests/commands/task.test.ts`, `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/tasks.md` changed |
| R5 — Regression coverage proves both fixes | MET | test | R1/R2 red→green this session; file suite 151/151 |

**Design conformance**: 3/3 design items DONE — locator branch (not re-walking filenames), `context.fs.resolve()` normalization at both call sites, docs synced; no deviations. Anti-patterns all avoided (no `task list` widening, no inactive-folder unscoped scan, no re-homing, no pipeline state, no `docs/tasks2` special-case, no Pi runtime change).

Verdict: **PASS** (5/5 requirements MET, 5/5 AC MET, evidence-rule pass, design conformance pass).
### Review
**Review**

SECUA review of the 0522 diff (uncommitted): `apps/cli/src/commands/task.ts` (locator branch + two
normalization sites), `apps/cli/tests/commands/task.test.ts` (fixture + 3 regression tests),
`docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/tasks.md`. Disposition: **PASS** — no
P1–P3 findings.

| Severity | Finding | Resolution |
| --- | --- | --- |
| P4 | `makeService` folder normalization now also applies to `resolve`/`path`/`list`/`create` `--folder` handling — behavior-preserving (relative spellings resolved against the same project root the fs facade already used; absolute paths unchanged) | Advisory only — no action. |
| P4 | `resolveProjectRootFromTasksDir` recognizes only the `/docs/tasksN` convention; arbitrary folder names still derive one level up (pre-existing limitation, surfaced by the parity fixture which intentionally uses the corpus convention) | Out of scope — documented in the fixture comment. |

Dimension notes: **S** — `--folder` remains an explicit operator override; resolution via `context.fs.resolve()` adds no new traversal surface. **E** — targeted lookup scans the configured folder set sequentially (bounded by folder count); unscoped path untouched. **C** — invocation-shape branching preserves the old not-found error + exit 1 and the JSON envelope; output parity covered by the 151-test file suite. **U** — targeted check now behaves like `task show`/`task path` (the documented contract); no new flags. **A** — reuses the existing `TaskLocator` (no new abstraction, no duplicated folder walking); `printResult` hoist removes print duplication between branches.

Residual risk: none blocking. The stale `dist/cli/spur` compiled binary currently linked at `~/.bun/bin/spur` predates this fix — environment concern, not a code finding (transitions were driven via the source-tree CLI so `$spurBin` carried the fix).
### References
- Task 0197 — concrete configured inactive-folder reproduction
- Task 0521 — cancelled Pi-loop diagnosis and forensic separation
- `apps/cli/src/commands/task.ts:918-1055` — current `task check` handler
- `packages/app/src/services/task-locator.ts:58-92` — existing configured-folder locator
- `packages/app/src/services/task-check.ts:198-203` — project-root derivation
- `docs/04_DESIGN.md:993` — authoritative `task check` surface
- `plugins/sp/skills/spur-cli/references/tasks.md` — operator-facing task CLI reference
### History
- 2026-08-12T00:38:41.256Z todo → wip (system)
- 2026-08-12T00:38:41.930Z wip → testing (system)
- 2026-08-12T00:45:45.773Z testing → done (system)
