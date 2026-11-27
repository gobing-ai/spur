---
kind: design
title: Laned root test suite — subprocess lane plus full-parallel in-process lane
status: proposed
created_at: 2026-11-26
updated_at: 2026-11-26
related: [feature H161, feature H16, task 1203, commit c8d5ca0f2]
tags: [testing, coverage, performance]
---

# Laned root test suite

## 1. Issue and scope

The root `bun run test` suite (13,505 tests / 921 files) takes ~491s at `--parallel=2` and is the
largest share of every `spur-check`, `spur-check-feature` and `spur feature verify` pass (~13 min).
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
- 137 non-heavy test files spawn subprocesses (`Bun.spawn`, `spawnSync`, `execSync`, `$\`…\``).

## 3. Solution

1. **Classifier.** A committed manifest `config/test-lanes.json` lists the subprocess-lane files.
   A generator scans test files for spawn usage and folds in recorded per-file durations; a
   repo-wide test fails when a spawning file is missing from the manifest (drift guard).
2. **Two children, one launcher.** `run-tests.ts` runs the subprocess lane at
   `--parallel=2` (today's proven bound) and the in-process lane at `--parallel=<availableParallelism>`.
   The two lanes run concurrently. Each child gets its own coverage directory; Bun's in-child
   `coverageThreshold` is disabled through the config copy the launcher already writes.
3. **Merge and gate.** The launcher merges both LCOV files per `SF:` record (union of `DA`/`FN`
   hits, recomputed `LF/LH/FNF/FNH`), evaluates the bunfig thresholds per file on the merged result
   (respecting `coveragePathIgnorePatterns`), writes `<coverageDir>/lcov.info`, and fails nonzero on
   any breach, naming file and metric.
4. **Certification.** Unchanged contract: certification runs only when both lanes exit 0, the threshold
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

- Alternative measured first: raise the single child to `--parallel=4`. Cheaper, but reintroduces the
  contention c8d5ca0f2 fixed; the laned design wins only if its receipt beats it.
- Running both lanes concurrently shares cores; if the subprocess lane still times out, run lanes
  sequentially (in-process first) — still expected well under 250s.
- LCOV merge sits on the certification path; it must be covered by fixture tests comparing merged
  thresholds with a single-process baseline.
