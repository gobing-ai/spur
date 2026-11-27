---
kind: design
title: Heavy-suite lanes — shared Board build plus concurrent-safe and serial heavy phases
status: proposed
created_at: 2026-11-26
updated_at: 2026-11-27
related: [feature H162, feature H161, feature H16, task 0988]
tags: [testing, performance]
---

# Heavy-suite lanes

## 1. Issue and scope

`bun run test:heavy` (`package.json:86`) takes ~196–277s per feature-verification pass. It runs two
serial `run-tests` invocations under `bunfig.heavy.toml` (coverage off): 19 `.heavy.test.` files in
one child, then `integrations-browser.heavy.test.ts` alone. Feature H162 (under H16) cuts that wall
time without dropping, weakening, or relocating any heavy proof. Out of scope: the root suite lanes
(H161), the dsh executor E2E's sandbox/credential prerequisites, and the feature-verification
receipt policy.

## 2. Context and constraints

- Six heavy files build the Board with `buildBoardToTemp` (five production-shaped, one with
  `testAdapterDir`). Every build holds the cross-process `BUILD_LOCK`
  (`apps/web/tests/test-helpers/board-build.ts:108-120`) because `astro build` shares the workspace
  `.astro` cache, so builds serialize and cap any concurrency gain.
- Browser proofs are isolatable: CDP launches with `--remote-debugging-port=0` and a per-launch
  `--user-data-dir` (`apps/web/tests/test-helpers/cdp.ts:102-103`); fixture servers bind `port: 0`.
- `board-base-path.heavy.test.ts:90` writes into its build directory, so a shared build must not be
  handed out by reference.
- Timing-sensitive proofs: `fleet-e2e-batch-perf` asserts a serial/parallel wall-time ratio;
  `quality-gate-lock` asserts interval overlap/disjointness of concurrent gate processes (private
  `SPUR_GATE_LOCK_DIR`, so no host-lock contention, but CPU contention can skew it).
- Chromium cannot launch inside the agent sandbox ("Chromium did not report a DevTools port"), so
  browser timings must come from an unsandboxed host run.
- H161 adds the lane manifest (`config/test-lanes.json`) and lane runner to
  `scripts/commands/run-tests.ts`, active only for the root path set.

## 3. Solution

1. **Profile (built).** `bun scripts/spur-dev.ts test-lanes --profile-heavy` (the H161 generator
   command, no separate entrypoint) records each `.heavy.test.` file alone under
   `bunfig.heavy.toml` via the `run-tests` launcher — so env isolation matches the gate — then the
   unchanged `bun run test:heavy` once, then one timed production `astro build`, and writes
   `.spur/run/heavy-profile.json`: per file `{ path, wallMs, pass, fail, skip, exitCode, buildsBoard }`
   plus `{ baselineWallMs, baselineExitCode, boardBuildMs, cores, sandboxed, startedAt }`.
   `sandboxed: true` (Chromium cannot launch) marks the receipt as not a baseline.
2. **Run-scoped Board seed.** `run-tests.ts` exports `SPUR_TEST_BOARD_SEED_DIR=<registryDir>/board-seed`
   to its children; `registryDir` is the per-launcher-run temp dir already removed in the launcher's
   `finally`, so the seed needs no run id and no cleanup of its own. When the variable is set, the
   first production-shaped `buildBoardToTemp()` builds the seed under `BUILD_LOCK` (into a staging
   dir renamed into place, so a partial seed is never visible); every caller then copies the seed
   into its own `mkdtemp` dir. The caller still owns its copy and `removeBoardBuild` is unchanged.
   `testAdapterDir` builds keep building their own. Without the variable (a direct `bun test`)
   behaviour is today's: one build per call. (Refined 2026-11-26 from a `SPUR_TEST_RUN_ID` +
   `$TMPDIR/spur-board-seed-<runId>` design: same freshness, no extra cleanup path.)
3. **Heavy lanes (not built).** `config/test-lanes.json` gains a `heavy` array of
   `{ path, lane, shares, reason }`: `lane` is `concurrent | serial`, `shares` names the host state the
   file contends for (`browser | board-build | cli-spawn | sqlite | gate-lock | timing-sensitive |
   operator-env`), and `reason` cites the `path:line` that justified the lane. Any `timing-sensitive`
   file is serial, `fleet-e2e-batch-perf` and `quality-gate-lock` are serial, `gate-lock` alone is
   concurrent only for a file that isolates its lock dir, `operator-env` (operator credentials) is
   serial, and doubt resolves to serial. Under
   `--config=bunfig.heavy.toml`, the launcher runs the concurrent lane with bounded `--parallel`
   (default 4, env `SPUR_TEST_HEAVY_PARALLEL`), then the serial lane at `--parallel=1`, in one
   launcher invocation, so both lanes share one seed. Phases are sequential: a serial file never
   runs alongside another heavy file.
4. **Drift guard (built).** A repo-wide test fails, naming the file, when a `.heavy.test.` file is missing
   from the `heavy` array, the array names a missing file, a row carries an unknown `lane`/`shares`
   value, or a timing-sensitive row claims `concurrent`.

## 4. Contract and compatibility

- `package.json` `test:heavy` stays the single entry; it collapses to one `run-tests` call. `bun run
  check` still runs it. Coverage stays off for heavy runs; no LCOV merge is involved.
- Exit code: nonzero if either phase fails; the watchdog applies per phase.
- The seed never outlives the launcher run and is never read across runs, so every proof runs
  against the current working tree.
- Receipts: `.spur/run/heavy-profile.json` (before) and a 3-run after receipt are stored as task
  evidence.

## 5. Tradeoffs and open questions

- Seed-only (no lanes) may capture most of the gain with the least risk; the lane phase lands only
  if the post-seed profile still shows parallelizable cost.
- Copying a seed instead of handing out the path costs a recursive copy per caller, a small fraction
  of an `astro build`, and keeps mutating tests isolated.
- If a concurrent-lane file flakes under contention, it moves to the serial lane in the manifest;
  assertions and timeouts are never loosened.
