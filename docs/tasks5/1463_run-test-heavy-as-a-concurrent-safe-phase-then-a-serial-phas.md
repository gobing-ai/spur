---
schema_version: 1
name: Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop
status: todo
template: feature-impl
created_at: 2026-11-27T07:07:41.710Z
updated_at: "2026-11-28T02:38:28.155Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

dependencies: ["1461", "1462"]
estimate_hours: 6
---

## 1463. Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop

### Background

Feature H162 (under H16; design `docs/design/heavy-suite-lanes.md` §3.3, §4). Uses the `heavy` manifest section (1461), the Board seed (1462) and the lane runner that H161 task 1460 adds to `scripts/commands/run-tests.ts` (root-path laning only). `test:heavy` today is two serial `run-tests` calls (`package.json:86`); it collapses to one launcher call so both phases share one Board seed. Covers R4, R5, R6.

**Refine corrections (2026-11-26)**
- Lane activation trigger was unstated → `test-repo-wide` (`package.json:94`) also passes `--config=bunfig.heavy.toml`, so heavy laning keys on that config **and** the positional filter `.heavy.test.`, never on the config alone.
- "executed test count not lower than baseline" had no source → Bun's dots reporter prints `Ran N tests across M files` and `N pass/fail/skip` per child; receipts read those lines from a tee'd log, no new reporter.
- "no heavy file collected by the default path" is already true (`bunfig.toml` `pathIgnorePatterns` includes `**/*.heavy.test.ts`) → kept as a regression check, not new work.

### Requirements

- [ ] R1. When the config is `bunfig.heavy.toml` and the positional args are exactly `.heavy.test.`, the launcher reads `heavy` from `config/test-lanes.json` and runs two sequential phases under one `registryDir`: concurrent phase = `lane: concurrent` paths at `--parallel=min(4, availableParallelism())` (override `SPUR_TEST_HEAVY_PARALLEL`, positive integer, else error), then serial phase = `lane: serial` paths at `--parallel=1`. The serial phase runs even when the concurrent phase fails; exit = first nonzero phase code. The watchdog applies per phase. A manifest path that does not exist fails before any phase starts, naming it. Every other heavy-config invocation (e.g. `test-repo-wide`) is unchanged.
- [ ] R2. `package.json` `test:heavy` becomes one `run-tests --config=bunfig.heavy.toml test --reporter=dots … .heavy.test.` call; `check` (`:90`) and `spur-check-feature` (`:93`) still run it; `bun run test` still collects no heavy file.
- [ ] R3. Every file in the 1461 baseline profile runs, and the executed test count (sum of `Ran N tests`) is not lower than the baseline's.
- [ ] R4. Three consecutive unsandboxed `bun run test:heavy` runs on the profiling host: median wall time ≤65 % of `heavy-profile.json` `baselineWallMs` (re-baselined from 60 % on 2026-11-27 by operator decision: the serial lane alone profiles at ~110 s of the 278 s baseline, so 60 % sat at the design floor; the first 3-run receipt measured 0.64), and no run has a failure the baseline lacked. A concurrent-lane file that flakes moves to `serial` (manifest edit + reason); assertions and timeouts are never loosened. Receipt `.spur/run/heavy-lanes-after.json`, cited in Testing.

Out of scope: classifying files (1461); the seed (1462); root-suite lanes (1460); coverage for heavy runs.

### Acceptance Criteria

- [ ] R4 — Concurrent-safe heavy files run concurrently while serial files keep serial execution
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature H162; design `docs/design/heavy-suite-lanes.md` §3.3, §4; upstream 1460, 1461, 1462.
- `package.json:86,90,93,94`; `bunfig.toml` `pathIgnorePatterns`; `scripts/commands/run-tests.ts:182`; `scripts/commands/test-suite-termination.test.ts`.

### History
