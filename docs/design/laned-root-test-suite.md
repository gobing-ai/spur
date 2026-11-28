---
kind: design
title: Laned root test suite — subprocess lane plus full-parallel in-process lane
status: proposed
created_at: 2026-11-26
updated_at: 2026-11-27
related: [feature H161, feature H16, task 1203, commit c8d5ca0f2]
tags: [testing, coverage, performance]
---

# Laned root test suite

## 1. Issue and scope

The root `bun run test` suite (13,523 tests / 923 files) takes 519 s at `--parallel=2`
(`.spur/run/test-lanes-baseline.json`) and is the largest share of every `spur-check`,
`spur-check-feature` and `spur feature verify` pass (~13 min).
The cap to two workers (commit c8d5ca0f2) came from subprocess-spawning tests timing out under
CPU-count fan-out. Feature H161 (under H16) splits the suite into two lanes inside the existing launcher. Out of
scope: `test:heavy` (feature H162) and the feature-verification receipt policy.

## 2. Context and constraints

- One launcher owns the suite: `scripts/commands/run-tests.ts` builds the hermetic env, runs one bun
  child under a heartbeat/watchdog (`runSuiteChild`), and, with `--publish-coverage`, certifies
  `.coverage/lcov.info` through `startCanonicalRun` / `certifyCanonicalRun`
  (`packages/app/src/rules/coverage-certification.ts`).
- `bunfig.toml` sets per-file `coverageThreshold = { lines = 0.9, functions = 0.9 }`. Bun evaluates it
  inside one process over that process's coverage, so a file exercised by tests in two processes would
  read low in each.
- 144 of those 923 files spawn subprocesses, directly or through one imported spawning helper
  (`Bun.spawn`, `spawnSync`, `execSync`, `$\`…\``). They hold 1,112 s of the 1,346 s of recorded test
  time (82.7%) across 12.7% of the files, which is why the split targets them rather than the width of
  one child.

## 3. Solution

1. **Classifier (built).** A committed manifest `config/test-lanes.json` lists the subprocess-lane
   files as `root.subprocess[] = { path, reason, durationMs }`, where `reason` is `direct` or
   `helper:<tests-path>#<exportedName>` and entries are repo-relative and sorted.
   `bun scripts/spur-dev.ts test-lanes [--timings <junit.xml>] [--check] [--spawn-cost <out.json>]`
   regenerates it from a static
   scan of every root test file — a direct spawn token, or an import by name of an exported non-test
   helper under `tests/` whose body spawns (one level deep) — and merges per-file `durationMs` from a
   JUnit profiling run; `--check` exits 1 naming each drifting path without writing. Classifier logic
   is coverage-gated in `packages/app/src/rules/test-lanes.ts`; the generator is a thin ADR-130
   repository source generator.
2. **Drift guard (built).** `repo-wide-tests/test-lanes-manifest.test.ts` runs inside `test-repo-wide`
   (hence `spur-check-feature`) and fails, naming the path, when a spawning file is missing from the
   manifest or a listed file no longer exists or no longer spawns. Top-level manifest keys other than
   `version`/`root` are preserved verbatim on regeneration, so the heavy section
   ([heavy-suite-lanes](heavy-suite-lanes.md)) survives it.
2a. **Spawn-cost receipt (built, task 1475).** `--spawn-cost <out.json>` runs every `root.subprocess`
   file alone in its own workspace under `scripts/commands/spawn-cost-preload.ts` (a child counter that
   wraps `Bun.spawn`/`Bun.spawnSync`/`Bun.$`, through which Bun's `node:child_process` shim passes) and
   writes `{ wallMs, testCount, failCount, skipCount, exitCode, children }` per file, sorted by wall
   time, with per-kind totals. The receipt is the before/after pair a lane-cost change cites; the
   classification above is untouched by it.
3. **Two children, one launcher (rejected — measured by 1460, cancelled).** `run-tests.ts` runs the subprocess lane at
   `--parallel=2` (today's proven bound) and the in-process lane at `--parallel=<availableParallelism>`.
   The two lanes run concurrently. Each child gets its own coverage directory; Bun's in-child
   `coverageThreshold` is disabled through the config copy the launcher already writes.
4. **Merge and gate (rejected with 3).** The launcher merges both LCOV files per `SF:` record (union of `DA`/`FN`
   hits, recomputed `LF/LH/FNF/FNH`), evaluates the bunfig thresholds per file on the merged result
   (respecting `coveragePathIgnorePatterns`), writes `<coverageDir>/lcov.info`, and fails nonzero on
   any breach, naming file and metric.
5. **Certification (rejected with 3).** Unchanged contract: certification runs only when both lanes exit 0, the threshold
   gate passes, and the tree is unchanged; it certifies the merged file.

## 4. Contract and compatibility

- `package.json` `test` stays the single call site; its `--parallel` flag becomes the subprocess-lane
  bound, and the in-process width defaults to the core count (env override `SPUR_TEST_INPROC_PARALLEL`).
- Exit code: nonzero if either lane fails or the merged threshold gate fails. Watchdog applies per lane.
- Targeted `bun test` runs and the heavy/repo-wide configs (`--config=bunfig.heavy.toml`, no coverage)
  are untouched: laning activates only when the forwarded args include the root path set.
- Receipts: `.spur/run/test-lanes-timing.json` records per-lane wall time; the before/after receipt
  for R5/R6 is stored as task evidence.

## 5. Tradeoffs and open questions

- Alternative measured first: raise the single child to `--parallel=4` — 496 s against 519 s, and it
  reproduces the c8d5ca0f2 contention as one 20 s timeout (`runLightGate`, temporary git repo). A ~23 s
  gain is not worth an intermittent timeout, so the laned design must beat both; lane scheduling is
  parked until it does.
- Running both lanes concurrently shares cores; if the subprocess lane still times out, run lanes
  sequentially (in-process first) — still expected well under 250s.
- LCOV merge sits on the certification path; it must be covered by fixture tests comparing merged
  thresholds with a single-process baseline.
- **Outcome (2026-11-27, operator decision).** Task 1460 built items 3–5, measured them on a 10-core host
  and reverted them: lanes together ran 501 s or 356 s with 24 timeouts, and the subprocess lane alone at
  width 4 took 286 s against a 519 s baseline. The 144 subprocess files are latency-bound on spawned
  children, so ≤250 s is unreachable by scheduling. H161 is re-scoped to R2 (classifier + drift guard,
  items 1–2); per-test spawn cost is the follow-up (task 1475).
