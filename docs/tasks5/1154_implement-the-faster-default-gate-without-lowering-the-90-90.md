---
schema_version: 1
name: Implement the faster default gate without lowering the 90/90 coverage floor
status: todo
template: feature-impl
created_at: 2026-10-10T05:19:45.655Z
updated_at: "2026-10-10T05:36:17.700Z"
feature_id: H16

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
---

## 1154. Implement the faster default gate without lowering the 90/90 coverage floor

### Background

The 2026-10-09 profile of `bun run gate` (`package.json`: `format` then `spur-check`) put about 95 percent of the wall time in one single-process `bun test`. A finished `bun run spur-check` in worktree `spur-new-runall-1149-1148-1146-9e41` logged `Ran 10757 tests across 629 files. [520.34s]`, 10757 pass, 0 fail, then exited 1 because the per-file function floor failed. Post-check never ran. The only row under 90 percent was `plugins/sp/scripts/run-summary.ts` at 75.00 percent functions and 97.40 percent lines.

Beside that, on a quieter sample: Biome `check` about 2s (1324–1329 files), `bun run typecheck` about 15s wall and 47s CPU, pre-check about 8s (51 rules). `bundle:config` is negligible. A second worktree waited `queueWaitMs=521539` on the host lock while a 520s suite held it.

This task implements the profile's suggestions 1, 2, 4, 5, and 6. Suggestion 3 is excluded: do not chase coverage instrumentation or the 53 CLI migrations, and do not turn coverage off. The operator restated the floor: per measured file, line coverage and function coverage must both stay at or above 90 percent.

Suggestion map:

1. Heavy process and browser proofs leave the default `bun test` path. Their own script still runs them, and `bun run check` still invokes that script.
2. Call the script under test in-process, except where the child process is the subject. One process per file, not per assertion.
4. Do not switch the default suite to `bun test --parallel` on Bun 1.3.14. That pin accepted `--no-isolate` and still launched workers with `--isolate`. A full `--parallel --no-isolate` run wedged and was killed. `--timings` is not in `bun test --help` on this pin.
5. Run Biome once on the gate path. Make a repeat typecheck reuse a cache. Workspace packages export `.ts`, so `skipLibCheck` does not skip those imports.
6. Stop wrapping the whole in-process suite in `acquireGateLock`. Keep the lock for shared host state.

Bun 1.3.14 is the pin these negative results were taken on (`bun test --help`, not the website docs that describe Bun 1.4). Re-measure on the Bun this repo actually runs before treating any of those flags as available.

Feature H16 holds this work. D64, H15, and H52 are done, and a live task under a done feature is `L4.feature-terminal`. Their goals are the two-tier check, batch gate deferral, and the "at most twice" pipeline bound. They do not own this wall time. The scenario titles match H16 R1–R6, so feature check links all six. Writing those scenarios set `ac_altitude: task-local` (the gherkin AC writer, task 1132). `ac_numbering: task-local` binds each requirement to its scenario. Keep the titles identical to H16 if they change.

Related, not this task: 1127 shipped the host lock; 1150 owns load-flake timeouts; 0587 measured coverage overhead at about 1.1s / 1.7 percent on a ~65s suite; 0939 shipped the light gate, and the observed recheck still launched `qualityGateCmd='bun run spur-check'`. Do not replace this task with "use the light gate."

A partial `bun test` overwrites `.coverage/lcov.info` and then fails the per-file floor with 0 test failures. That is expected. It is not a reason to lower the floor.

**Refine corrections (2026-10-09)**

- `run-summary.ts` at 75.00 percent functions → on `main` (8904ced9a) `bun test plugins/sp/tests/run-summary.test.ts` measures 96.15 percent functions / 94.52 percent lines. The 75 percent capture came from worktree `spur-new-runall-1149-1148-1146-9e41`, whose unlanded branch (task 1146, commit 93c74362a) rewrites `plugins/sp/scripts/run-summary.ts` and its test. → R6 no longer carries a run-summary work item; 1146 owns its own file's floor through its own gate. AC6 stays as the invariant check.
- "`gate-lock.ts` wraps the suite" was the only lock site named → the observed `queueWaitMs=521539` line is printed by `runQualityGate` (`packages/app/src/services/quality-gate.ts:1166-1204`), which takes `acquireGateLock` around the whole `qualityGateCmd` (`bun run spur-check`) attempt loop. The pipeline path is the one that blocked the second worktree. → R5 now covers both sites: `runQualityGate` and `spur-check`'s `gate-lock.ts` hop.
- "exclude that file explicitly" was unspecified → probed on Bun 1.3.14 in scratch: root `pathIgnorePatterns` excludes a file from discovery; an explicit path to an ignored file does not run it; a run of only heavy files still applies the per-file `coverageThreshold` and exits 1 (`--coverage=false` does not help); `bun --config=<file> test` replaces the root bunfig (preload included) and lets a filter find the excluded files. → Design freezes a `*.heavy.test.ts` suffix plus `bunfig.heavy.toml` with coverage off.
- Describe-level moves (`rule.test.ts:434`, `db.test.ts:1128`) → Bun excludes by file, not by describe. → those describes move into new sibling `*.heavy.test.ts` files.
- R2 said "import the function" from the script → the three inline-run files spawn `plugins/sp/scripts/inline-run-setup.ts`, thin ADR-130 glue whose top-level `main()` calls `process.exit`. The logic lives in `packages/app/src/services/inline-run-setup.ts` (`runInlineRunTraceMode` :1224, `runInlineRunFingerprint` :1816, `runInlineRunSetup` :2003). → in-process means calling those app exports, not importing the script.
- Bun pin: confirmed 1.3.14 (`package.json` `packageManager`, `.github/workflows/ci.yml:19`). `bun test --help` lists `--parallel`, `--isolate`, `--path-ignore-patterns`; no `--no-isolate`, no `--timings`. Biome 2.4.16 `check` accepts `--write` with `--error-on-warnings`. TypeScript 6.0.3. `*.tsbuildinfo` is already gitignored (`.gitignore:52`).
- Script consumers the implementer must keep green: `plugins/sp/tests/feature-verification-scope.test.ts:55` pins `spur-check-new === spur-check`; `scripts/commands/gate-lock.test.ts` drives the wrapper; `packages/app/tests/services/quality-gate.test.ts` and `plugins/sp/tests/quality-gate-lock.test.ts` assert 1127's lock behavior through `runQualityGate`.
- Only one heavy lane consumer was named (`bun run check`) → heavy proofs would then run only in CI. → `spur-check-feature` (ADR-119 feature-scoped pass) and `spur-check:full` also run the heavy lane.

### Requirements

- [ ] R1. **Suggestion 1 — heavy proofs leave the default `bun test` path.** The default script that `bun run gate` and `bun run spur-check` run (`package.json` `test`; `test:coverage` and `test:full` share its globs) must not execute the proofs below. They run from one new script, `test:heavy`. `bun run check` (CI's entry), `bun run spur-check-feature`, and `bun run spur-check:full` invoke `test:heavy`. Do not edit `.github/workflows/`.

  Move off the default path (each lands as a `*.heavy.test.ts` file; see Design):

  - `plugins/sp/tests/quality-gate-lock.test.ts` (about 37.8s, 8 tests, spawns `bun plugins/sp/scripts/quality-gate.ts`, child timeout 120s). Rename the whole file. Its expectations change with R5.
  - `apps/cli/tests/release-ops.test.ts` (about 33.7s). `runBumpVer` / `runDropTags` are already in-process; the cost is real git plus `bun install`. The install and throwaway-repo git cases move to `release-ops.heavy.test.ts`. A fast case with no install stays in `release-ops.test.ts` if the default suite needs it for the 90/90 floor.
  - `apps/web/tests/modules/board-runtime-browser.test.ts` (about 25.3s, one test). Rename the file. Keep the skip when no Chromium is installed.
  - `scripts/commands/dev-all.test.ts` (about 20.7s, 5 supervisor tests). The supervisor process is the subject; rename the file, keep the spawn. (`scripts/**` is coverage-ignored, so this move cannot drop a measured file.)
  - `plugins/sp/tests/inline-run-installed.test.ts` (spawns `node` on the installed `.mjs`, plus git). Rename the file, keep the spawn.
  - `apps/cli/tests/commands/rule.test.ts:434` describe `rule run SQLITE_BUSY busy-wait integration`. Move the describe into `apps/cli/tests/commands/rule-busy.heavy.test.ts`. Do not shorten the 4s hold.
  - `packages/domain/tests/db.test.ts:1128` describe `SQLite contention: WAL + busy_timeout`. Move it into `packages/domain/tests/db-contention.heavy.test.ts`. Do not shrink the timeout that is the assertion.

  `apps/cli/tests/commands/workflow-run-from.test.ts` (about 23.8s, 23 spawn/`runCli` sites) is converted under R2 first. It stays on the default path only if the converted file no longer spends multiple seconds on process proofs. Cases that still need a child workflow process move to `workflow-run-from.heavy.test.ts`.

- [ ] R2. **Suggestion 2 — call the logic in-process unless the process is the subject.** `apps/cli/tests/helpers.ts:61` already says to prefer in-process `main()` and use `runCli()` only when the process boundary is under test. Apply it to the hot files only.

  - `plugins/sp/tests/inline-run-setup.test.ts`, `inline-run-trace.test.ts`, `inline-run-close-reason.test.ts`: each `spawnSync('bun', [SCRIPT, …])` where SCRIPT is `plugins/sp/scripts/inline-run-setup.ts`. Replace per-assertion spawns with direct calls to the `packages/app/src/services/inline-run-setup.ts` exports the script dispatches to (`runInlineRunTraceMode`, `runInlineRunSetup`, `runInlineRunFingerprint`, `writeInlineRunOutcome`), passing `projectRoot` explicitly instead of a child `cwd`. Keep at most one spawn per file as the glue smoke (flag parsing and exit code of the real script).
  - `apps/cli/tests/commands/workflow-run-from.test.ts`: use the in-process `main()` helper where the assertion is about command output or state, not the child.

  Do not import `plugins/sp/scripts/inline-run-setup.ts` into a test (its top-level `main()` calls `process.exit`), and do not add an exported entry to it (ADR-130 glue budget). Where a child process is the behavior (lock suite, dev supervisor, installed `.mjs`, real workflow child), keep the spawn. Do not change 1150's timeout budgets; if 1150 or 1146 has landed a change to `inline-run-trace.test.ts`, rebase onto it and keep its numbers.

- [ ] R3. **Suggestion 4 — the default suite stays serial on this Bun.** `package.json` `test`, `test:coverage`, and `test:full` must not pass `--parallel` while `bun test --help` does not list a `--no-isolate` that workers honor. On 1.3.14 the help lists `--parallel` ("Implies --isolate") and no `--no-isolate`; an earlier full `--parallel --no-isolate` run wedged and was killed, so it is not a speedup result. `--timings` is absent.

  Record the upgrade bar in the R3 guard test's header comment (package.json cannot hold comments): a later Bun whose help lists `--no-isolate` and whose workers are not started with `--isolate`; a quiet-machine run of the default suite that finishes, beats that suite's serial baseline, keeps the per-file 90/90 floor, and does not wedge. Add a regression test that `test`, `test:coverage`, and `test:full` do not contain `--parallel`.

- [ ] R4. **Suggestion 5 — Biome once on the gate path, and a typecheck cache.** Today `gate` runs `format` (`biome check . --write`) and then `spur-check` → `lint` (`biome check . --error-on-warnings`), so Biome runs twice. After this task `bun run gate` runs exactly one `biome check . --write --error-on-warnings`. Standalone `bun run lint` still runs `biome check . --error-on-warnings` and typecheck; standalone `bun run spur-check` still runs `lint` and so still rejects a dirty tree; `bun run format` is unchanged.

  `typecheck` runs `tsc --noEmit` in 8 workspaces plus `scripts/tsconfig.json` and `plugins/sp/tsconfig.json`; none sets `incremental` or `composite`, and `packages/app` / `packages/domain` export `./src/*.ts`, so `skipLibCheck` does not skip them. Add `"incremental": true` to each of those tsconfigs (build info lands in gitignored `*.tsbuildinfo`). A second `bun run typecheck` on an unchanged tree must be cheaper than the cold run, and a type error in an imported workspace `.ts` file must still fail. If incremental does not cache `--noEmit` on TS 6.0.3, use project references instead; do not land a config that does not speed the repeat check. Record cold and repeat wall/CPU.

- [ ] R5. **Suggestion 6 — the host lock does not wrap the in-process suite.** Two sites hold `acquireGateLock` (`packages/app/src/services/quality-gate.ts:845`) around the whole default suite today:

  1. `runQualityGate` (`quality-gate.ts:1166-1204`) around the `qualityGateCmd` attempt loop — the pipeline path that produced `queueWaitMs=521539`.
  2. `spur-check` / `spur-check-new` running `bun scripts/commands/gate-lock.ts -- bun run test`.

  After this task neither holds the lock across the default suite. `spur-check` runs `bun run test` without the wrapper. `runQualityGate` no longer calls `acquireGateLock`; it still records `gateRuntimeMs`, and reports `queueWaitMs: 0` so the verdict/receipt shape is unchanged (no schema change). The lock moves to the command that needs exclusivity: `test:heavy` runs as `bun scripts/commands/gate-lock.ts -- bun --config=bunfig.heavy.toml test …`, so the timing-sensitive heavy proofs serialize host-wide. Re-entry via `SPUR_GATE_LOCK_TOKEN` stays in `acquireGateLock` so a caller that already holds the lock does not deadlock.

  Keep `acquireGateLock`, `gate-lock.ts`, `tests/setup.ts:13` private `SPUR_GATE_LOCK_DIR`, `SPUR_GATE_LOCK=off`, and `SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS`. Prove the narrower scope with fast tests: `runQualityGate` with a held lock in a private dir completes without waiting; `gate-lock.ts` still waits on a held lock and honors `SPUR_GATE_LOCK=off`. Do not run two real full gates as the proof.

- [ ] R6. **Coverage floor, unchanged.** Per measured file, lines and functions both stay at or above 90 percent. Leave `bunfig.toml` `coverage = true`, reporters `text` and `lcov`, `coverageDir = ".coverage"`, and `coverageThreshold = { lines = 0.9, functions = 0.9 }`. Do not add entries to `coveragePathIgnorePatterns`. The only new root-bunfig change is `pathIgnorePatterns` gaining `"**/*.heavy.test.ts"`. `recommended-post-check` still reads `.coverage/lcov.info`.

  Moving a test off the default path must not leave a measured file under either floor. If a moved test was the only coverage for a function, keep or add a fast in-process case on the default path. `plugins/sp/scripts/run-summary.ts` is at 96.15 / 94.52 on `main`; if 1146 lands first, its gate must already hold that file at the floor — this task does not take over 1146's file.

  Out of scope (suggestion 3): coverage-instrumentation cost, `createMigratedDb`, the 53 CLI migrations.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Heavy proofs leave the default test path (req: R1)
  Given the default test script used by bun run gate and bun run spur-check
  When that script runs
  Then it does not run the host-lock suite, the real-browser board proof, release-ops install proofs, the dev supervisor, or the other named heavy process proofs
  And those proofs still run from their own script
  And bun run check still invokes that script
```

```gherkin
Scenario: AC2 — Scripts under test are called in-process unless the process is the subject (req: R2)
  Given a test whose subject is a script function rather than a child process
  When the default suite runs that test
  Then it calls the function in-process
  And a test whose subject is the process boundary keeps one child process for the file
```

```gherkin
Scenario: AC3 — The default suite stays serial until Bun honors parallel without isolate (req: R3)
  Given the repo is on a Bun that does not honor bun test --parallel --no-isolate
  When bun run gate runs the default suite
  Then the test invocation does not pass --parallel
  And the recorded upgrade bar requires a quiet-machine run that finishes, beats the serial baseline, and keeps the per-file 90/90 floor
```

```gherkin
Scenario: AC4 — The gate runs Biome once and repeat typecheck reuses a cache (req: R4)
  Given a clean tree
  When bun run gate reaches its check steps
  Then Biome check runs once on that path
  And a second bun run typecheck on the unchanged tree reuses a cache
  And a type error in an imported workspace TypeScript source still fails the check
```

```gherkin
Scenario: AC5 — The host lock does not wrap the in-process suite (req: R5)
  Given two worktrees starting the default in-process suite
  When the first suite is still running
  Then the second is not blocked for the length of that suite by acquireGateLock
  And work that touches shared host state still takes the lock
  And SPUR_GATE_LOCK=off still disables the lock
```

```gherkin
Scenario: AC6 — Per-file line and function coverage stay at or above 90 percent (req: R6)
  Given the default suite has finished with no failing tests
  When Bun applies coverageThreshold per measured file
  Then every measured file is at or above 90 percent lines and 90 percent functions
  And plugins/sp/scripts/run-summary.ts meets that function floor by tests
  And the threshold values in bunfig.toml are unchanged
```

### Q&A

#### Q&A entry — 2026-10-10

Operator: file one task that gets the gate-performance suggestions done, except suggestion 3. Per-file line coverage and function coverage must both stay at or above 90 percent.

Chosen: one task under new feature H16. Scenario titles match H16 R1–R6. The AC writer recorded `ac_altitude: task-local`. Suggestion 3 is an exclusion inside R6, not work. The 75 percent function gap on `run-summary.ts` is in R6 so the floor is met by tests, not by lowering `coverageThreshold`.

#### Q&A entry — 2026-10-10T05:36:17.699Z

Refine (depth ready), closed decisions:

- Lock site: `runQualityGate` stops calling `acquireGateLock`, not only `gate-lock.ts`. Reason: the observed 521s queue wait was the pipeline path; narrowing only the manual wrapper would leave AC5 false for pipeline worktrees. The lock moves to `test:heavy`. 1127's tests are rewritten to that contract.
- Heavy lane mechanism: `*.heavy.test.ts` + `bunfig.heavy.toml` (coverage off) run via `bun --config`. Probed on 1.3.14; a heavy-only run under the root bunfig fails the per-file threshold.
- Heavy lane consumers: `check` (CI), `spur-check-feature`, `spur-check:full`, `spur-check-new:full`. Not the per-task gate.
- `run-summary.ts`: 96.15/94.52 on `main`; the 75 percent gap belongs to 1146's unlanded branch. Removed from this task's work.
- R3 guard lives in `feature-verification-scope.test.ts` (default path), not `repo-wide-tests` (feature-scoped only).

### Design

One task, because the moves interact. A spawn-heavy file is either converted (R2) or moved (R1), and either choice changes which files the default coverage trace measures (R6). Splitting them would let one land and drop a file under 90 percent.

#### Frozen names

| Name | Kind | Value |
| --- | --- | --- |
| `*.heavy.test.ts` | file suffix | every heavy proof file; nothing else uses it |
| `bunfig.toml` `[test] pathIgnorePatterns` | root config | `["vendors/**", "drizzle/**", "**/*.heavy.test.ts"]` |
| `bunfig.heavy.toml` | new root file | `[test]` with `coverage = false`, `preload = ["./tests/setup.ts"]`, `pathIgnorePatterns = ["vendors/**", "drizzle/**"]`; no `coverageThreshold` |
| `test:heavy` | package script | `bun run bundle:config && bun scripts/commands/gate-lock.ts -- bun --config=bunfig.heavy.toml test --reporter=dots .heavy.test.` |
| `spur-check:tests` | package script | `bun run test-pre-check && bun run test && bun run test-post-check` |
| `spur-check`, `spur-check-new` | package script | `bun run lint && bun run spur-check:tests` (identical; `feature-verification-scope.test.ts:55` pins that) |
| `gate` | package script | `biome check . --write --error-on-warnings && bun run typecheck && bun run spur-check:tests` |
| `check` | package script | `bun run lint && bun run test:coverage && bun run test:heavy` |
| `spur-check-feature`, `spur-check:full`, `spur-check-new:full` | package script | append `&& bun run test:heavy` |
| new heavy files | tests | `apps/cli/tests/commands/rule-busy.heavy.test.ts`, `packages/domain/tests/db-contention.heavy.test.ts`, `apps/cli/tests/release-ops.heavy.test.ts`, optional `apps/cli/tests/commands/workflow-run-from.heavy.test.ts`; renamed: `quality-gate-lock.heavy.test.ts`, `board-runtime-browser.heavy.test.ts`, `dev-all.heavy.test.ts`, `inline-run-installed.heavy.test.ts` |
| R3 guard | test | `repo-wide-tests` is feature-scoped, so put it on the default path: extend `plugins/sp/tests/feature-verification-scope.test.ts` (it already reads `package.json` scripts) with the no-`--parallel` assertion and the upgrade-bar comment |

No new public `spur` verb, no new env var, no schema change.

#### Why this heavy-lane mechanism (probed on Bun 1.3.14)

Bun excludes by file through `pathIgnorePatterns`; there is no per-describe exclude, and an explicit path to an ignored file does not run it. A run of only heavy files under the root bunfig would apply `coverageThreshold` to the few source files they touch and exit 1 with 0 failures; `--coverage=false` does not override that. `bun --config=<file> test` replaces the root bunfig (its preload included) and a substring filter (`.heavy.test.`) then discovers the suffix. The floor is enforced by the default suite; the heavy lane exists to exercise process boundaries, not to measure coverage.

Rejected: a separate top-level directory like `repo-wide-tests/` (heavy files import workspace-relative helpers and fixtures; moving them breaks those paths); listing heavy files by name in `pathIgnorePatterns` (drifts when a file is added); `--path-ignore-patterns` on the CLI (it replaces, not merges, the bunfig list, and still leaves the coverage threshold problem).

#### In-process boundary

For the inline-run files, call the `packages/app/src/services/inline-run-setup.ts` exports directly and assert on the returned exit code, the written state under the temp `projectRoot`, and captured stdout/stderr. Keep one spawn of `inline-run-setup.ts` per file for the glue's flag parsing and exit code. Keep `spawnSync` / `Bun.spawn` wherever the assertion is about a child process: the lock held by another pid, the supervisor lifecycle, the installed `.mjs`, a real workflow child. The roughly 60 other `runCli()` sites are out of scope.

#### Parallel

The guard is a negative: the default scripts stay serial, and a test fails if `--parallel` appears in `test`, `test:coverage`, or `test:full`. The upgrade bar is a comment beside that assertion, not a Bun upgrade. Directory-order workers can pin all of `apps/cli` on one worker, so shrinking files comes first.

#### Biome and typecheck

`gate` inlines the one Biome call that both writes and fails on warnings, then `typecheck`, then the shared `spur-check:tests`. That is why `spur-check:tests` exists: `gate` and `spur-check` share one tail and cannot drift. Standalone `lint`, `format`, and `spur-check` keep their current Biome behavior.

Typecheck: `"incremental": true` per tsconfig first; project references only if the measured repeat run is not faster. Do not point `exports` at emitted `.js`.

#### Lock scope

1127's lock stays host-wide (`~/.config/spur/run/full-gate.lock` unless `SPUR_GATE_LOCK_DIR`), and `acquireGateLock` is unchanged. What changes is who calls it: `runQualityGate` and `spur-check` stop; `test:heavy` starts (through `gate-lock.ts`). A configured `qualityGateCmd` that includes `bun run check` therefore still serializes its heavy hop. The default suite already runs with a private lock dir from `tests/setup.ts:13`.

Update 1127's tests to the new contract rather than deleting them: `quality-gate.test.ts` lock cases assert `runQualityGate` does not wait on a held lock and reports `queueWaitMs: 0`; `quality-gate-lock.heavy.test.ts` asserts serialization through `gate-lock.ts`; `gate-lock.test.ts` keeps the wrapper's wait/off/re-entry cases. Regenerate `plugins/sp/lib/quality-gate.generated.*` with `bun run build:plugin-lib && bun run build:scripts` after the `quality-gate.ts` change.

Accepted tradeoff: two worktrees may run the default suite at once and contend for CPU. 1150 owns load-flake timeouts; do not raise budgets here.

#### Anti-patterns

- Do not lower `coverageThreshold` or add to `coveragePathIgnorePatterns`.
- Do not delete `acquireGateLock`, `gate-lock.ts`, or the private-dir preload.
- Do not import `inline-run-setup.ts` into tests or add an exported `main` to it.
- Do not use `--parallel` in any default script, and do not upgrade Bun here.
- Do not edit `.github/workflows/`.
- Do not shorten the SQLite busy hold or the WAL timeout that the moved describes assert.

#### Docs

Update the sentences that this changes: `AGENTS.md` build section (`spur-check` chain; add `bun run test:heavy` and where it runs), `docs/03_ARCHITECTURE.md` around :1146-1171 (gate scope / `spur-check` chain), and any design satellite that says the host lock wraps the whole suite (`rg -n "gate-lock|full-gate lock" docs/design docs/03_ARCHITECTURE.md`). No ADR unless `docs/00_ADR.md` records the 1127 lock region as a decision (`rg -n "1127" docs/00_ADR.md` returned nothing at refine time).

#### Dependencies and concurrent work

No `dependencies[]`. Worktree `spur-new-runall-1149-1148-1146-9e41` (tasks 1146/1148/1149, all `todo` on `main`) edits `plugins/sp/tests/inline-run-trace.test.ts` and `plugins/sp/scripts/run-summary.ts`. Implement after that branch lands, or rebase onto it before the R2 conversion. Worktree `spur-new-runall-1137-1144-1147-33f9` does not touch these files. Task 1150 (`todo`) owns timeout budgets in `inline-run-trace.test.ts`; keep whatever it lands.

#### Out of scope

Suggestion 3. H15 `deferQualityGate`. H52's twice-per-task bound. 1150's load fixture. A Bun upgrade. Workflow-file edits. `runCli` sites outside the named hot files.

### Plan

- [ ] Step 0 — preconditions. Confirm `bun --version` is 1.3.14 and re-read `bun test --help`. Check whether worktree `spur-new-runall-1149-1148-1146-9e41` has landed on `main`; if not, wait or plan to rebase before touching `inline-run-trace.test.ts`. Do not start a full gate while another holds the host lock.
- [ ] Baseline (quiet machine): wall time of `bun run test` and of a cold `bun run typecheck` (wall + CPU via `/usr/bin/time -l`). Label the 520.34s capture as a loaded host.
- [ ] R1: add `bunfig.heavy.toml`, the `**/*.heavy.test.ts` entry in root `pathIgnorePatterns`, and `test:heavy`. Rename/split the R1 files to the frozen names. Run `bun run test:heavy` once and confirm every moved proof executes.
- [ ] R2: convert the three inline-run files to app-service calls (one glue spawn each kept) and `workflow-run-from.test.ts` to in-process `main()`; move any remaining child-workflow cases to `workflow-run-from.heavy.test.ts`.
- [ ] R6 check after R1/R2: full default `bun run test`; no measured file under 90 lines or functions. Add fast in-process cases where a move dropped coverage.
- [ ] R5: remove `acquireGateLock` from `runQualityGate` (report `queueWaitMs: 0`), drop the `gate-lock.ts` hop from `spur-check`/`spur-check-new`, wrap `test:heavy` in it. Update 1127's tests to the new contract. Regenerate `plugins/sp/lib/quality-gate.generated.*`.
- [ ] R4: add `spur-check:tests`, rewrite `gate`, `spur-check`, `spur-check-new` per Design. Confirm `biome check . --write --error-on-warnings` writes fixes and still exits non-zero on an unfixable warning (scratch file). Add `"incremental": true` to the ten tsconfigs; measure a repeat `bun run typecheck`; inject a type error in a `packages/domain/src` export consumed by `packages/app` and confirm the repeat run fails, then revert it.
- [ ] R3: extend `plugins/sp/tests/feature-verification-scope.test.ts` with the no-`--parallel` assertion over `test`, `test:coverage`, `test:full`, and the upgrade-bar comment.
- [ ] Wire `test:heavy` into `check`, `spur-check-feature`, `spur-check:full`, `spur-check-new:full`. Leave `.github/workflows/` alone.
- [ ] Docs: update `AGENTS.md` build section, `docs/03_ARCHITECTURE.md` gate-scope lines, and any design satellite naming the old lock region.
- [ ] After numbers (quiet machine): default `bun run test` wall, repeat `bun run typecheck`, coverage table with no measured file under 90/90, and one `bun run test:heavy` pass. Then `bun run spur-check` and `bun run gate` end to end.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature H16. Parent H1 (daily workflow). Not D64, H15, or H52: those are done and own a different edge.
- Task 1127 (done) — host-wide gate lock. This task moves which commands take it.
- Task 1150 (todo) — load-sensitive timeouts. Keep its budgets.
- Task 1146 (todo, in worktree `spur-new-runall-1149-1148-1146-9e41`) — rewrites `run-summary.ts` and edits `inline-run-trace.test.ts`; land or rebase first.
- Task 0587 — coverage overhead on Bun 1.3.14, about 1.1s / 1.7 percent. Suggestion 3, excluded.
- Task 0939 — light gate tier. The observed recheck still used `bun run spur-check`.
- ADR-119 / task 0872 — `spur-check-feature` scope; `plugins/sp/tests/feature-verification-scope.test.ts`.
- ADR-130 — script glue budget (`plugins/sp/scripts/inline-run-setup.ts`).
- `package.json` scripts `gate`, `format`, `lint`, `typecheck`, `test`, `test:coverage`, `test:full`, `check`, `spur-check`, `spur-check-new`, `spur-check-feature`, `spur-check:full`.
- `bunfig.toml` `[test]`.
- `scripts/commands/gate-lock.ts`, `scripts/commands/gate-lock.test.ts`.
- `packages/app/src/services/quality-gate.ts` `acquireGateLock` :845, `runQualityGate` lock region :1166-1204; `packages/app/tests/services/quality-gate.test.ts`; `plugins/sp/tests/quality-gate-lock.test.ts`.
- `packages/app/src/services/inline-run-setup.ts` :1224, :1816, :2003.
- `tests/setup.ts:13` private `SPUR_GATE_LOCK_DIR`.
- `apps/cli/tests/helpers.ts:61` `runCli` vs in-process `main()`.
- `config/rules/recommended-post-check.yaml`, `config/rules/quality/coverage-gate.yaml`.
- `.github/workflows/ci.yml` runs `bun run check`. Do not edit it.

### History

- 2026-10-10T05:22:18.325Z backlog → todo (system)

