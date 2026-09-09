---
schema_version: 1
name: Fix test hermeticity and dogfood-harness findings from run 20260908-2330-devrun-0815
status: todo
template: issue
created_at: 2026-09-09T17:11:57.002Z
updated_at: "2026-09-09T17:39:53.448Z"

priority: P2
---

## 0817. Fix test hermeticity and dogfood-harness findings from run 20260908-2330-devrun-0815

### Background

Findings batch from dogfood run 20260908-2330-devrun-0815 (inline `/sp-dev-run 0815 --auto --next --agent inline --worktree --force`; protocol `sp:dogfood-testing@1.2`). The run reached terminal `failed`: the pipeline FSM behaved contract-correctly, but the quality gate was environment-blocked, and the operator hand-confirmed the gate before authorizing merge-back (main `a2c0dac8a`). The code-level findings are already fixed and merged in `39563d002` (ts-db ^0.4.62 lockstep, workaround deletions, four no-row assertion repairs) and are NOT in scope here.

This task owns the remaining open findings from the run report (`docs/dogfood/2026-09-08-dev-run-0815-dogfood.md`, validator rc=0) plus the six residuals parked in task 0815 References, so 0815 can be closed without orphaning them.

**Premise correction (2026-09-09 refine, `--depth ready`).** The run report's P1 finding states the leaking file is a *gitignored* `.spur/config.yaml` that is *absent in CI*. Both halves are false in this tree and the corrected premise changes the fix:

- `.spur/config.yaml` is **tracked** (`git ls-files .spur`; present at the run's BASE_SHA `3f11b875`) and `git check-ignore` does not match it. A `git worktree add` therefore materializes it, and CI checks it out too — file presence is not the worktree/CI divergence.
- The `.spur` paths that config references are tracked **relative symlinks** into `config/`: `.spur/rules -> ../config/rules`, `.spur/tasks -> ../config/tasks`, `.spur/plugins -> ../config/plugins` (all mode `120000` in `git ls-files -s`). They resolve identically in a worktree.
- What is genuinely worktree-divergent under `.spur/` is the untracked/ignored runtime state: `spur.db*` (`.gitignore:128`), `run/`, `backups/`, `logs/`, `reports/`, `agents/*` (`.gitignore:136`). The run's own "worktree importer schema stamp" fix (worktree-local `spur migrate`) is the `spur.db` half of exactly this.

The reproducible, tree-verifiable defect behind the P1 class is therefore **cwd binding, not file presence**: a test that omits `cwd` binds the CLI to whatever `process.cwd()` happens to be, so the operator's live project root — its config, its DB, its executor/team roster — becomes a test input. R1 is rewritten against that.

### Requirements

**R1 (P1, CLI test cwd hermeticity).** No test may bind the CLI to the repository's own project root by accident. `main()` resolves `const cwd = options.cwd ?? process.cwd()` (`apps/cli/src/index.ts:57`) and `resolveConfigLayers` joins `cwd ?? process.cwd()` with `.spur/config.yaml` (`packages/config/src/loader.ts:171`); `tests/setup.ts:58` suppresses only the **global** layer via `SPUR_SKIP_GLOBAL_CONFIG`, so the **project** layer — the live `.spur/config.yaml` with its `agent.executors`, `agent.team`, `rules.paths` and `tasks.folders` — plus the live `.spur/spur.db` reach any test that omits `cwd`. Observable outcome: every CLI invocation under `bun run test` either receives an explicit `cwd` or resolves to a hermetic root, and a check fails when a test resolves the repository's own `.spur/config.yaml`. Confirmed no-`cwd` call sites: `apps/cli/tests/commands/workflow.test.ts:136,141`.

**R2 (P2, spawn-heavy test timeouts).** Spawn-heavy cases must not fail on a loaded machine for lack of time budget. Neither `bunfig.toml` nor `apps/cli/bunfig.toml` sets `timeout`, so Bun's 5 s default applies while each case pays a nested cold boot: `plugins/sp/hooks/task-write-guard.test.ts:43-59` spawns `bun <hook>` which itself spawns `bun run apps/cli/src/index.ts task resolve --strict --json`; `scripts/commands/eval-pipeline.ts:445,514` `Bun.spawnSync`s the CLI and a full `spur workflow run`. Observable outcome: spawn-heavy cases carry an explicit timeout sized for a cold CLI boot under load, and a `bun run test` failure reproduces when the same file is run standalone.

**R3 (P2, verify-answer-lint AC identity parity).** The linter's AC identity index and its requirement-id parser must accept the same corpus spellings. `extractRequirementIds` already accepts the bold form (`plugins/sp/scripts/verify-answer-lint.ts:253`, `/\*\*(R\d+(?:\.\d+)*)\b/g`), while `buildAcIdentityIndex` (`:317-341`) indexes only list-marker labels (`/^[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*(?::|$)/gm`) and `Scenario:` titles — so a bold-paragraph AC resolves to nothing and forces a manual checklist projection before verify can pass. Observable outcome: an AC declared as `**AC1 (R1) — <title>**` on its own line resolves through `resolveAcIdentity` exactly as the checklist spelling does.

**R4 (P3, proof-fingerprint scoping doc).** `docs/04_DESIGN.md` must state what `computeProofInputFingerprint` binds and what it deliberately does not, so an operator can tell a safe task-file edit from a digest-breaking one. Ground truth to document: git tree minus `DEFAULT_EXCLUDE_GLOBS` = `['docs/tasks*', 'docs/features*']` (`packages/app/src/workflow/proof-input-fingerprint.ts:172`), plus task sections `['Background', 'Requirements', 'Acceptance Criteria', 'Design', 'Plan']` (`:249`) folded in via `taskSpecPath`, plus feature sections `['Goal', 'Scope', 'Acceptance Criteria']` (`:281`) via `featureSpecPath`. `Solution` / `Testing` / `Review` are out of the input set by design, which is why record-time evidence writes leave the digest unchanged.

**R5 (residual owner surface).** The six residuals parked in task 0815 References (importer `Promise.race` timeout deferral; ts-db README at-least-once note; P4 sweep-reason vocabulary; TS-server restart after dep bumps; cog merge-message convention; importer-schema `spur migrate` remedy) must have a named going-forward owner surface in this task's References, so task 0815 can transition to done without orphaning them (0815 Q&A precondition, 2026-09-09).

**Out of scope (non-goals).** The ts-db `queryFirst` null→undefined change and its assertion repairs (already merged, `39563d002`); task 0815's own `record`/`done` transition (owned by 0815); task 0816's plugins conflict-audit residuals; the run report's P3 stale-`plugins/sp/spur.js` finding (mitigated by the AGENTS.md source-local-CLI rule, stays report-owned); any redesign of `bun test` runner topology or a bespoke serial-shedding scheduler.

### Acceptance Criteria

- [ ] AC1 (R1) — a CLI invocation with no explicit `cwd` under `bun run test` does not resolve the repository's own `.spur/config.yaml`; the check added in `packages/config/tests/loader.test.ts` fails before the fix and passes after, and every fixture test that passes an explicit `cwd` still passes
- [ ] AC2 (R2) — `plugins/sp/hooks/task-write-guard.test.ts` and `scripts/commands/eval-pipeline.test.ts` pass standalone and inside `bun run test` on a deliberately loaded machine, with no timeout failures and no varying failure set
- [ ] AC3 (R3) — an AC declared as `**AC1 (R1) — <title>**` resolves through `verify-answer-lint` exactly as the checklist spelling does, and `ac-style-guide.md` lists the bold-paragraph form among the accepted AC id forms
- [ ] AC4 (R4) — `docs/04_DESIGN.md` names what the proof fingerprint binds (exclude globs, task section list, feature section list) and what it deliberately omits, citing `proof-input-fingerprint.ts` by `path:line`, in the same commit as any related code change
- [ ] AC5 (R5) — the six 0815 residuals appear verbatim in this task's `### References` with 0815 named as their origin, and task 0815 has no remaining orphan blocker
- [ ] AC6 (gate) — `bun run spur-check` exits 0 on the final change with no suppressions, no weakened assertions, and no `--no-verify`

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-09T17:39:34.216Z

**Q1 (closed, 2026-09-09 refine `--depth ready`) — Is the P1 finding's "gitignored `.spur/config.yaml`, absent in CI" premise true?**
No. `.spur/config.yaml` is tracked and was tracked at the run's BASE_SHA `3f11b875`; `.spur/{rules,tasks,plugins}` are tracked relative symlinks into `config/`. Corrected in Background; R1 rewritten from "file presence" to "cwd binding", which is reproducible from the current tree. Evidence: `git ls-files .spur`, `git ls-files -s .spur` (mode `120000`), `git cat-file -e 3f11b875:.spur/config.yaml`, `git check-ignore` non-match.

**Q2 (closed) — Is R2's flake really parallel-resource contention?**
Not as such. `bun test` has no `timeout` set in either `bunfig.toml`, so the 5 s default applies to cases that pay a nested cold CLI boot (`runGuard` spawns `bun <hook>` which spawns `bun run apps/cli/src/index.ts`). Machine load pushes those past 5 s. The fix is an explicit per-test budget, not a scheduler. If explicit timeouts do not stabilize the suites, escalate back to the report's serial-shedding direction — but only with a reproduction that survives a raised timeout.

**Q3 (closed) — R3: extend the linter or forbid the style in the template?**
Extend the linter. `extractRequirementIds` already accepts the bold form for R-ids (`verify-answer-lint.ts:253`), so rejecting it for ACs is an internal inconsistency, and the task templates (`config/templates/task/*.md`) carry an empty `### Acceptance Criteria` heading with no style mandate — there is no template authority to point at. `ac-style-guide.md` becomes the single authority and gains the bold form.

**Q4 (deferred, owner: implementer) — Should `SPUR_SKIP_PROJECT_CONFIG` also be honoured by `loadSpurConfig`'s own `cwd = process.cwd()` default (`loader.ts:247`)?**
Gate it in `resolveConfigLayers` only, which `loadSpurConfig` calls at `:248` — one seam covers both. Revisit only if a caller is found that bypasses `resolveConfigLayers`; none exists today (all call sites pass `cwd`: `apps/cli/src/index.ts:59,71,88`, `apps/server/src/serve.ts:567,598,637`, `apps/server/src/context.ts:478,568`).

### Design

**WHAT.** Four independent fixes plus one bookkeeping move. No shared abstraction ties them; do not invent one. R1 and R2 both touch test hermeticity but have different root causes and different files — keep the diffs separate.

**WHY.** The run's gate was red for two unrelated reasons (a cwd-bound test input and a too-small time budget) that presented as one "nondeterministic flake" cloud. Fixing them as one thing is how the original report reached a false premise.

**WHERE / frozen names.**

*R1 — project-layer isolation (`packages/config/src/loader.ts`, `tests/setup.ts`, one new check).*
Add a project-layer skip symmetric to the existing global one, in the single place that already owns layer resolution:

- `packages/config/src/loader.ts` → `resolveConfigLayers(cwd?)`: gate the project layer on a new env var **`SPUR_SKIP_PROJECT_CONFIG`**, matched exactly as the global one is (`!== 'true'`), and **only when `cwd` was not passed explicitly**. An explicitly-passed `cwd` always wins — fixture tests that build a temp project with its own `.spur/config.yaml` and pass `cwd: dir` must keep working unchanged. Implementation shape: branch on whether the argument was supplied, not on comparing the resolved path to `process.cwd()`.
- `tests/setup.ts` → set `process.env.SPUR_SKIP_PROJECT_CONFIG = 'true'` next to the existing `SPUR_SKIP_GLOBAL_CONFIG` line (`:58`), with a comment naming this task.
- Reproduction check: a test asserting that `main(['workflow','list','--json'], { output, dbUrl: ':memory:' })` — **no `cwd`** — does not resolve the repository's own `.spur/config.yaml`. Put it in `packages/config/tests/loader.test.ts` (layer resolution is that file's subject) rather than inventing a new hermeticity suite.

*R2 — explicit timeouts (`plugins/sp/hooks/task-write-guard.test.ts`, `scripts/commands/eval-pipeline.test.ts`).*
Bun's per-test timeout is the third argument to `test(name, fn, timeout)`. Set it on the spawn-heavy cases only, with a named constant at the top of each affected file (e.g. `const SPAWN_TIMEOUT_MS = 30_000;`) and a one-line comment saying it covers a nested cold CLI boot. Do **not** add a global `timeout` to either `bunfig.toml` — that would mask real hangs everywhere else.

*R3 — AC identity parity (`plugins/sp/scripts/verify-answer-lint.ts`).*
In `buildAcIdentityIndex` (`:317-341`), add one more `matchAll` pass over the `Acceptance Criteria` section for the bold form and feed each capture through the existing `declareIdentity`, so the bold spelling and its leading token both register exactly as the checklist branch already does. Reuse `declareIdentity` / `normalizeAcTitle` — do not add a second normalizer, and do not touch `resolveAcIdentity`'s error text beyond naming the newly accepted form. Then extend `plugins/sp/skills/spur-dev/references/ac-style-guide.md` to list the bold-paragraph form among the accepted AC id forms, so lint and guide agree.

*R4 — documentation only (`docs/04_DESIGN.md`).*
One paragraph in the existing proof-chain prose near the `proofDigest` / completion-gate material (`docs/04_DESIGN.md:2496-2580`). Cite the three constants by `path:line`. No new satellite doc; `docs/design/workflow-composition-contract.md` already owns the chain's mechanics and this is a scoping note on it.

*R5 — References only.* Copy the six items verbatim into this task's `### References` under a heading that names 0815 as the origin. No code.

**Precedence / non-obvious behavior.** `SPUR_SKIP_PROJECT_CONFIG` must not outrank an explicit `cwd`; the ordering is `explicit cwd` > `env skip` > `process.cwd()`. Getting this backwards silently disables every fixture-config test while leaving them green-looking (they would assert against a no-config default and still pass some cases) — that is the failure mode to guard with the reproduction check.

**Anti-patterns — do not implement.**
- Do not delete, move, gitignore, or rewrite `.spur/config.yaml`; it is tracked, shared, and correct.
- Do not add a bespoke serial-shedding scheduler, a load gate, or a test-runner wrapper for R2. The budget is the bug.
- Do not raise timeouts globally in `bunfig.toml`.
- Do not "fix" R1 by hardcoding a repo-root path comparison, or by `process.chdir()` anywhere in tests.
- Do not weaken or skip any assertion to make the gate green (AGENTS.md).
- Do not re-open the merged ts-db work from `39563d002`.

**Cross-task.** No `dependencies[]` are declared. This task assumes `39563d002` has landed (verified: reachable from `main`). It must leave task 0815 able to transition — R5's References move is 0815's stated precondition; nothing else here blocks or is blocked by 0815.

**Surface impact.** No public `spur` noun/verb/flag changes, so no public-surface consent is needed. `SPUR_SKIP_PROJECT_CONFIG` is a test/hermeticity env knob on an existing internal seam; document it alongside `SPUR_SKIP_GLOBAL_CONFIG` wherever that one is already documented (`docs/04_DESIGN.md` config-layering surface) in the same commit (T3).

### Plan

1. **(R1) Reproduce the binding.** Add a failing test in `packages/config/tests/loader.test.ts` proving a no-`cwd` CLI invocation resolves the repository's own `.spur/config.yaml`. Confirm it fails before any source change.
2. **(R1) Add the project-layer skip.** `packages/config/src/loader.ts` → `resolveConfigLayers`: honour `SPUR_SKIP_PROJECT_CONFIG` only when `cwd` was not supplied. Explicit `cwd` keeps winning.
3. **(R1) Enable it under test.** `tests/setup.ts` → set the env var beside `SPUR_SKIP_GLOBAL_CONFIG` (`:58`). Re-run step 1's test — now green.
4. **(R1) Prove no fixture regressed.** `bun test tests/commands/workflow.test.ts tests/commands/agent-team.test.ts tests/config-layering.test.ts` from **inside `apps/cli`**, plus `bun test packages/config` from the repo root.
5. **(R2) Time-box the spawn-heavy cases.** Add `SPAWN_TIMEOUT_MS` + per-test timeouts in `plugins/sp/hooks/task-write-guard.test.ts` and `scripts/commands/eval-pipeline.test.ts`. No `bunfig.toml` change.
6. **(R2) Verify under load.** Run both files standalone, then again with the machine deliberately loaded; confirm identical results and no timeout failures.
7. **(R3) Fix the linter.** Extend `buildAcIdentityIndex` for the bold form; add a unit test that a `**AC1 (R1) — <title>**` AC resolves. Run `verify-answer-lint` against a bold-AC answer to confirm PASS.
8. **(R3) Sync the guide.** Add the bold-paragraph form to the accepted AC id forms in `plugins/sp/skills/spur-dev/references/ac-style-guide.md`, same commit.
9. **(R4) Document the fingerprint scope.** One paragraph in `docs/04_DESIGN.md` naming the exclude globs and both section lists with `path:line` citations; also document `SPUR_SKIP_PROJECT_CONFIG` beside `SPUR_SKIP_GLOBAL_CONFIG` (T3, same commit as step 2).
10. **(R5) Move the residuals.** Copy the six 0815 items verbatim into this task's `### References` via `spur task update 0817 --section References`. Then 0815 is unblocked.
11. **Gate.** `bun run autofix` → `bun run spur-check` → `git status --short`. Full gate runs once, at the end — not per step. No `--no-verify`, no suppressions.
12. **Commit.** Atomic Conventional Commits, one per requirement group where the diffs are independent; docs travel with their code change (T3).

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

**Run evidence**

- Dogfood report: `docs/dogfood/2026-09-08-dev-run-0815-dogfood.md` (run `20260908-2330-devrun-0815-52b8babf`, BASE_SHA `3f11b875`, validator rc=0). §6 P1/P2/P3 findings are the origin of R1–R4.
- Merged code fixes from the same run (out of scope here): `39563d002` → merge `1a0d3af5d` → `a2c0dac8a`.
- Gate artifacts `.spur/run/0815-test-gate.*` are gone — the worktree and branch `sp/run-0815-d872` were deleted at merge-back. R1/R2 must be re-derived from the tree, which this task's Requirements do by `path:line`.

**Ground-truth citations frozen at refine time (2026-09-09)**

- cwd fallback: `apps/cli/src/index.ts:57`; `packages/config/src/loader.ts:171,247`
- global-layer-only test suppression: `tests/setup.ts:58`
- no-`cwd` CLI call sites in tests: `apps/cli/tests/commands/workflow.test.ts:136,141`
- spawn-heavy cases: `plugins/sp/hooks/task-write-guard.test.ts:43-59`; `scripts/commands/eval-pipeline.ts:445,514`
- AC identity index vs requirement-id parser: `plugins/sp/scripts/verify-answer-lint.ts:317-341` vs `:253`
- proof fingerprint inputs: `packages/app/src/workflow/proof-input-fingerprint.ts:172,249,281`; pipeline scoping comment `config/workflows/task-pipeline.yaml:100-104`

**Residuals adopted from task 0815 References (R5 — this is now their owner surface)**

1. **Deferred: importer timeout `Promise.race` fallback** — `packages/app/src/services/history-service.ts:432` wraps the import promise in a `Promise.race` timeout; A21 (0813) host-approved deferring the native-deadline replacement of this fallback. Direction: revisit once scheduler/history consumers fully run on shared native execution policies; verify no double-kill semantics.
2. **Deferred: ts-db README queue-delivery statement** — ts-libs repo README lacks an explicit at-least-once (no exactly-once) delivery statement for the queue-job lease path (P3b residual from A21 0812/0813). Direction: one-paragraph semantics note in the ts-db README next time that package ships.
3. **Deferred: P4 sweep-reason vocabulary** — user-facing sweep reason string retained deliberately at `apps/server/src/serve.ts:273` (asserted `apps/server/tests/serve.test.ts:1373`); only wrong code comments were fixed in 0813. Direction: rename alongside the next user-visible sweep-surface change, not standalone.
4. **Environment: TS server stale module cache after dependency bumps** — after `bun install` version changes, the LSP keeps serving pre-bump types (6 false positives on `bounded-child-run*` in the A21 session, all ledger-dispositioned). Direction: restart the TS server (or session) after dependency sync before trusting diagnostics.
5. **Process: cog rejects default merge-commit messages** — every merge needs the manual `chore: merge <branch> into main` rename (precedent `12c913716`, `f2265f4d7`, and this run's `1a0d3af5d`). Direction: lefthook `prepare-commit-msg` rewrite or a documented convention in `AGENTS.md`.
6. **Process: importer-schema drift after dependency bumps** — `importer-schema-check` fails with recorded-vs-installed version drift in gitignored `.spur/spur.db`; remedy is a manual `spur migrate` per checkout. Direction: fold the migrate into the check's remedy path or a postinstall hook.

None of the six is in this task's Acceptance Criteria beyond AC5 (adoption). They are parked here as the durable owner surface, not scheduled work.

### History
