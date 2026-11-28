---
schema_version: 1
name: Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop
status: done
template: feature-impl
created_at: 2026-11-27T07:07:41.710Z
updated_at: "2026-11-28T02:52:12.882Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

dependencies: ["1461", "1462"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 1463. Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop

### Background

Feature H162 (under H16; design `docs/design/heavy-suite-lanes.md` §3.3, §4). Uses the `heavy` manifest section (1461), the Board seed (1462) and the lane runner that H161 task 1460 adds to `scripts/commands/run-tests.ts` (root-path laning only). `test:heavy` today is two serial `run-tests` calls (`package.json:86`); it collapses to one launcher call so both phases share one Board seed. Covers R4, R5, R6.

**Refine corrections (2026-11-26)**
- Lane activation trigger was unstated → `test-repo-wide` (`package.json:94`) also passes `--config=bunfig.heavy.toml`, so heavy laning keys on that config **and** the positional filter `.heavy.test.`, never on the config alone.
- "executed test count not lower than baseline" had no source → Bun's dots reporter prints `Ran N tests across M files` and `N pass/fail/skip` per child; receipts read those lines from a tee'd log, no new reporter.
- "no heavy file collected by the default path" is already true (`bunfig.toml` `pathIgnorePatterns` includes `**/*.heavy.test.ts`) → kept as a regression check, not new work.

### Requirements

- [x] R1. When the config is `bunfig.heavy.toml` and the positional args are exactly `.heavy.test.`, the launcher reads `heavy` from `config/test-lanes.json` and runs two sequential phases under one `registryDir`: concurrent phase = `lane: concurrent` paths at `--parallel=min(4, availableParallelism())` (override `SPUR_TEST_HEAVY_PARALLEL`, positive integer, else error), then serial phase = `lane: serial` paths at `--parallel=1`. The serial phase runs even when the concurrent phase fails; exit = first nonzero phase code. The watchdog applies per phase. A manifest path that does not exist fails before any phase starts, naming it. Every other heavy-config invocation (e.g. `test-repo-wide`) is unchanged.
- [x] R2. `package.json` `test:heavy` becomes one `run-tests --config=bunfig.heavy.toml test --reporter=dots … .heavy.test.` call; `check` (`:90`) and `spur-check-feature` (`:93`) still run it; `bun run test` still collects no heavy file.
- [x] R3. Every file in the 1461 baseline profile runs, and the executed test count (sum of `Ran N tests`) is not lower than the baseline's.
- [x] R4. Three consecutive unsandboxed `bun run test:heavy` runs on the profiling host: median wall time ≤65 % of `heavy-profile.json` `baselineWallMs` (re-baselined from 60 % on 2026-11-27 by operator decision: the serial lane alone profiles at ~110 s of the 278 s baseline, so 60 % sat at the design floor; the first 3-run receipt measured 0.64), and no run has a failure the baseline lacked. A concurrent-lane file that flakes moves to `serial` (manifest edit + reason); assertions and timeouts are never loosened. Receipt `.spur/run/heavy-lanes-after.json`, cited in Testing.

Out of scope: classifying files (1461); the seed (1462); root-suite lanes (1460); coverage for heavy runs.

### Acceptance Criteria

- [x] R4 — Concurrent-safe heavy files run concurrently while serial files keep serial execution
- [ ] R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path
- [ ] R6 — A before/after receipt shows test:heavy at or under 65 percent of baseline with zero new failures across 3 runs

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:20:16.097Z

- Activation: heavy config + `.heavy.test.` filter together (closed 2026-11-26; protects `test-repo-wide`).
- Phase failure policy: run serial phase regardless, first nonzero exit wins (closed).
- Test-count source: Bun dots summary lines from tee'd logs (closed; no extra reporter).
- Concurrent width: `min(4, cores)` default (closed).

#### Q&A entry — 2026-11-27T18:38:15.000Z

- **Closed — the dependency edge on 1460 is dropped; `dependencies` is now `[1461, 1462]`.** 1460 was
  cancelled on 2026-11-27, and a frozen task never reads as `done` (ADR-137), so the edge could never be
  satisfied and `spur task preflight 1463` stopped the task on it (A2 "unmet: 1460"). What this task
  actually needed from 1460 — the lane-loop shape in `scripts/commands/run-tests.ts` — landed
  independently (`3bb7d13fc feat(test): lane test:heavy as concurrent then serial phases (1463)`), and
  1461/1462 are `done`. Remaining work is the three-run proof and the recorded sections, not a build.
  Re-pointing rather than un-deprecating 1460 was chosen because 1460's own finding (scheduling is not
  the lever for the root suite) is what cancelled it; re-opening it would resurrect a measured dead end.

### Design

**Chosen:** reuse the 1460 lane loop (`runSuiteChild` per lane) with sequential phases, coverage off, no merge. **Rejected:** one heavy child at higher `--parallel` (timing-sensitive proofs flake; serial guarantees lost); running serial files concurrently with the concurrent phase (breaks serial isolation); a second launcher call per phase (two `registryDir`s ⇒ two Board seeds).

**Frozen names**
- `run-tests.ts`: `HEAVY_CONFIG_BASENAME = 'bunfig.heavy.toml'`, `HEAVY_FILTER = '.heavy.test.'`; phases passed as explicit `./<path>` args; forwarded flags (`--reporter=dots`, `--timeout`) kept on both phases; the existing `--path-ignore-patterns` args become unnecessary and are dropped from `package.json` because files are explicit.
- Env `SPUR_TEST_HEAVY_PARALLEL`, read with `getEnvVar`.
- Phase summary line to stderr: `run-tests: phase <concurrent|serial> files=<n> exit=<code> wall=<mm:ss>`.
- Receipt `.spur/run/heavy-lanes-after.json`: `{ runs: [{ wallMs, exitCode, phases: [{ name, files, wallMs, exitCode, tests, pass, fail, skip }] }], medianWallMs, baselineWallMs, ratio }`.

**Precedence:** an empty phase is skipped (no child); manifest read errors are fatal before spawning; root-path laning (1460) and heavy laning are mutually exclusive branches selected before any spawn.

**Anti-patterns:** no `--bail`; no retries; no timeout increases; do not drop or `skip` a file to hit 60 %; do not schedule by duration (`--timings`) in this task.

**Dependencies:** assumes 1460's lane loop shape and `ROOT_PATH_SET` branch; 1461's `heavy` rows and baseline receipt (must be `sandboxed: false`); 1462's seed env from the same `registryDir`.

### Plan

1. Write failure modes first as launcher-level tests in `scripts/commands/test-suite-termination.test.ts`'s style (existing launcher test file) with a stub manifest and tiny fixture tests: serial file never in the concurrent phase, phase-1 failure still runs phase 2 and exits nonzero, missing manifest path fails before spawn, `test-repo-wide` shape not laned, empty phase skipped (R1).
2. Implement the heavy branch in `run-tests.ts` until green.
3. Collapse `test:heavy` in `package.json`; confirm `check`/`spur-check-feature` unchanged and `bun run test` collects no heavy file (R2).
4. Unsandboxed, on the 1461 profiling host: `bun run test:heavy 2>&1 | tee` ×3; build `.spur/run/heavy-lanes-after.json`; compare test counts and wall time against `heavy-profile.json` (R3, R4). Flaky concurrent file ⇒ move to serial with reason, rerun all three.
5. `bun run spur-check`; `bun run test:heavy` is part of `spur-check-feature`.

### Solution

| File | Change (landed in `3bb7d13fc feat(test): lane test:heavy as concurrent then serial phases (1463)`) |
| --- | --- |
| `scripts/commands/run-tests.ts` (35–38, 273–330, 370–378) | Heavy laning branch: activation is the shape `--config=bunfig.heavy.toml test … .heavy.test.` (`HEAVY_CONFIG_BASENAME` + `HEAVY_FILTER`, `:273-293`), so `test-repo-wide` — which passes the same config without the bare filter — stays one unlaned child. `SPUR_TEST_HEAVY_PARALLEL` is read through `getEnvVar` and must be a positive integer or the launch refuses before any spawn (`:296-299`); a manifest row naming a missing file throws before spawning (`:302`); `runHeavyPhases` (`:322`) runs the `lane: concurrent` paths at `min(4, availableParallelism())` then the `lane: serial` paths at `--parallel=1` under one `registryDir`, so both phases share one Board seed (1462). The serial phase runs even when the concurrent phase fails and the first nonzero phase code wins; each phase is bounded by the existing watchdog. Empty phases are skipped. |
| `package.json` (`test:heavy`) | Collapsed from two serial `run-tests` calls to one launcher call (`run-tests --config=bunfig.heavy.toml test --reporter=dots --timeout=20000 .heavy.test.`); `check` and `spur-check-feature` still invoke it, and `bun run test` still collects no heavy file because `bunfig.toml` `pathIgnorePatterns` keeps `**/*.heavy.test.ts` out of the default path. |
| `config/test-lanes.json` (`heavy[]`) | The 1461 profile rows gained `lane: concurrent|serial` (13 concurrent, 7 serial); `test-lanes --check` keeps the classification from drifting. |
| `scripts/commands/run-tests.test.ts` (101–170) | The R1 failure modes, written first: concurrent-then-serial ordering with the serial file strictly after the concurrent phase, a concurrent failure still running the serial phase and exiting nonzero, a missing manifest file failing before any spawn, a malformed `SPUR_TEST_HEAVY_PARALLEL` refusing before any spawn, and the `test-repo-wide` shape never reading the manifest. |
| `.spur/run/heavy-lanes-after.json` (regenerated 2026-11-28) | The R4 receipt from three consecutive unsandboxed runs on the profiling host (10 cores): 178 s / 173 s / 167 s, all exit 0, zero failures; median 173,000 ms against the 278,395 ms baseline = **ratio 0.621** (bar 0.65). Assembled from the three tee'd logs by `.spur/run/heavy-lanes-assemble.ts`, so each number is re-derivable from `heavy-run-{1,2,3}.log`. |

**Scope note.** No assertion, timeout or file classification was touched to reach the ratio: the 20 manifest files ran in full (13 concurrent + 7 serial), the executed test count is 88 per run against the baseline's 87 pass + 1 skip = 88, and nothing moved to the default path. The dependency edge on the cancelled 1460 was dropped (`deps: [1461, 1462]`, commit `ab4916d64`) because the lane-loop shape it "assumed" landed in `3bb7d13fc` independently.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/run-tests.ts:273` defines the activation shape (`HEAVY_CONFIG_BASENAME` + bare `HEAVY_FILTER`), `:296` reads `SPUR_TEST_HEAVY_PARALLEL` via `getEnvVar` and refuses a non-positive-integer value before any spawn, `:302` fails on a manifest row naming a missing file, `:322` `runHeavyPhases` runs `lane: concurrent` at `min(4, cores)` then `lane: serial` at `--parallel=1` under one `registryDir` (one Board seed), with the serial phase running after a concurrent failure and the first nonzero code winning. Tests: `scripts/commands/run-tests.test.ts:101` (ordering), `:118` (failure still runs serial), `:140` (missing file), `:148` (bad env), `:166` (`test-repo-wide` unlaned). |
| R2 | MET | `package.json` `test:heavy` is one `run-tests --config=bunfig.heavy.toml test --reporter=dots --timeout=20000 .heavy.test.` call; `check` and `spur-check-feature` still reference it; `bunfig.toml` `pathIgnorePatterns` keeps `**/*.heavy.test.ts` out of `bun run test`. |
| R3 | MET | All 20 manifest files ran in every one of the three runs (13 concurrent + 7 serial, `run-tests.test.ts`-covered lane routing; receipt `.spur/run/heavy-lanes-after.json` phase `files` counts); executed test count 66 + 22 = 88 per run vs the baseline's 87 pass + 1 skip = 88 (`.spur/run/heavy-profile.json`). |
| R4 | MET | Three consecutive unsandboxed runs on the profiling host (10 cores): 178 s / 173 s / 167 s, all exit 0, every phase `fail: 0`. Median 173,000 ms vs `baselineWallMs` 278,395 ms = **ratio 0.621** (bar 0.65). Receipt `.spur/run/heavy-lanes-after.json`, logs `.spur/run/heavy-run-{1,2,3}.log`, assembler `.spur/run/heavy-lanes-assemble.ts`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC R4 — Concurrent-safe heavy files run concurrently while serial files keep serial execution | MET | test | `scripts/commands/run-tests.test.ts:101` asserts the serial file's child starts only after the whole concurrent phase and that each file runs once; live receipt shows `phase concurrent files=13` then `phase serial files=7 exit=0` |
| AC R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path | MET | command | three runs each execute 88 tests with `fail: 0` (66 + 22) against the baseline's 88; `config/test-lanes.json` still lists 20 heavy rows (13 concurrent / 7 serial) and `test-lanes --check` passes; no timeout, assertion or `skip` edit in the change set; `bunfig.toml` still ignores `**/*.heavy.test.ts` |
| AC R6 — A before/after receipt shows test:heavy at or under 65 percent of baseline with zero new failures across 3 runs | MET | command | `.spur/run/heavy-lanes-after.json`: `ratio 0.621`, `medianWallMs 173000`, `baselineWallMs 278395`, `runs[].exitCode = [0,0,0]`, every phase `fail: 0` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature H162; design `docs/design/heavy-suite-lanes.md` §3.3, §4; upstream 1460, 1461, 1462.
- `package.json:86,90,93,94`; `bunfig.toml` `pathIgnorePatterns`; `scripts/commands/run-tests.ts:182`; `scripts/commands/test-suite-termination.test.ts`.

### History

- 2026-11-28T02:52:05.473Z todo → wip (system)
- 2026-11-28T02:52:07.173Z wip → testing (system)
- 2026-11-28T02:52:12.769Z testing → done (system)

