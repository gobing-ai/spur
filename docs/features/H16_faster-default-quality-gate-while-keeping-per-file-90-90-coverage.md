---
schema_version: 1
id: "H16"
name: "Faster default quality gate while keeping per-file 90/90 coverage"
status: backlog
priority: P2
tags: []
created_at: "2026-10-10T05:19:09.284Z"
updated_at: "2026-10-13T18:35:58.463Z"
---

# H16: Faster default quality gate while keeping per-file 90/90 coverage

## Goal

Make the default `bun run gate` path faster without moving the coverage floor.

On the 2026-10-09 capture, `bun run spur-check` spent 520.34s in one single-process `bun test` (10757 pass, 0 fail, 629 files) and then exited 1 because one measured file was under the per-file function floor. Format, lint's second Biome pass, typecheck, and pre-check together are tens of seconds beside that. This feature cuts the default path: heavy process and browser proofs leave it, scripts are called in-process, Biome runs once, repeat typecheck reuses a cache, and the host-wide gate lock stops wrapping the whole in-process suite.

Per measured file, line coverage and function coverage both stay at or above 90 percent. That is `bunfig.toml` `coverageThreshold = { lines = 0.9, functions = 0.9 }`, applied per file, with coverage left on. Coverage instrumentation and migration replay are not the speed lever.

## Scope

**In scope**

- Move CLI-spawn, real `bun install`, Chromium/CDP, dev-supervisor, and host-lock proofs off the default `bun test` path that `bun run gate` and `bun run spur-check` use, onto their own script. Keep those proofs runnable. `bun run check` (what CI already invokes) still runs that script, composed from `package.json`, so the proofs are not dropped.
- Call the script under test in-process. Keep a child process only when that process is the behavior under test, and then one process per file rather than one per assertion.
- Default-suite parallelism bar (revised 2026-10-13): Bun 1.4.3 is pinned in `.prototools` and `bun run test` now passes `bun test --parallel` (PR #9), while the `bun run check` path (`test:coverage`, `test:heavy`) stays serial and keeps `bunfig.toml`'s per-file 90/90 floor. Bar state: a parallel run finishing green is evidenced by CI `verify` on `5715de2e8`; `--no-isolate` actually honored, and beats the serial baseline, are **not** measured.
- Run Biome once on the `bun run gate` path. Make a repeat `bun run typecheck` reuse a cache (incremental or project references) while an error in an imported workspace `.ts` file still fails the check.
- Narrow `scripts/commands/gate-lock.ts` so the in-process suite does not hold `acquireGateLock` for its whole run. Keep the lock for work that touches shared host state. Do not remove the lock from task 1127.
- Bring `plugins/sp/scripts/run-summary.ts` back to at least 90 percent function coverage by tests, so a green test run can exit 0. The captured run was 75.00 percent functions and 97.40 percent lines.

**Out of scope**

- Treating coverage instrumentation, the text reporter, or `createMigratedDb` / the 53 CLI migrations as the speed work. Do not set `coverage = false`, drop either reporter, lower either threshold, or add measured sources to `coveragePathIgnorePatterns` to go faster. Task 0587 already measured coverage overhead at about 1.1s / 1.7 percent on the then-~65s suite; a 2026-10-09 `--config` override with `coverage = false` still printed a coverage table, so there is no new on/off number.
- Task 1150's load fixture and timeout budgets. Task 1127's lock semantics other than the scope of what the default suite holds. H15's shipped `deferQualityGate` policy. H52's shipped "full spur-check at most twice" bound.
- Enabling `bun test --parallel` **on the retired Bun 1.3.14 pin** (the default passes `--parallel` on 1.4.3; see the parallelism-bar bullet in Scope). A full `--parallel --no-isolate` run on that pin wedged (one worker near 99 percent CPU, a zombie child, stdout frozen) and was killed. Do not quote that run as a speedup. `--timings` is absent from `bun test --help` on 1.3.14.
- A new public `spur` noun or verb. Edits to `.github/workflows/`. Reopening done feature D64 (it owns the two-tier check and the catalogue, not this wall-time slice).

## Acceptance Criteria

```gherkin
Feature: Faster default quality gate while keeping per-file 90/90 coverage

  @core
  Scenario: R1 — Heavy proofs leave the default test path
    Given the default test script used by bun run gate and bun run spur-check
    When that script runs
    Then it does not run the host-lock suite, the real-browser board proof, release-ops install proofs, the dev supervisor, or the other named heavy process proofs
    And those proofs still run from their own script
    And bun run check still invokes that script

  @core
  Scenario: R2 — Scripts under test are called in-process unless the process is the subject
    Given a test whose subject is a script function rather than a child process
    When the default suite runs that test
    Then it calls the function in-process
    And a test whose subject is the process boundary keeps one child process for the file

  @core
  Scenario: R3 — The parallel default holds only while its bar is measured
    Given the repo is on a Bun that honors bun test --parallel
    When bun run test runs the default suite
    Then it may pass --parallel only while the recorded bar is met
    And --no-isolate honored and beats-serial-baseline are measured and recorded before any speedup is claimed
    And the per-file 90/90 floor still holds

  @core
  Scenario: R4 — The gate runs Biome once and repeat typecheck reuses a cache
    Given a clean tree
    When bun run gate reaches its check steps
    Then Biome check runs once on that path
    And a second bun run typecheck on the unchanged tree reuses a cache
    And a type error in an imported workspace TypeScript source still fails the check

  @core
  Scenario: R5 — The host lock does not wrap the in-process suite
    Given two worktrees starting the default in-process suite
    When the first suite is still running
    Then the second is not blocked for the length of that suite by acquireGateLock
    And work that touches shared host state still takes the lock
    And SPUR_GATE_LOCK=off still disables the lock

  @core
  Scenario: R6 — Per-file line and function coverage stay at or above 90 percent
    Given the default suite has finished with no failing tests
    When Bun applies coverageThreshold per measured file
    Then every measured file is at or above 90 percent lines and 90 percent functions
    And plugins/sp/scripts/run-summary.ts meets that function floor by tests
    And the threshold values in bunfig.toml are unchanged
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1154 | Implement the faster default gate without lowering the 90/90 coverage floor | todo |
<!-- END AUTO-GENERATED -->

## Notes

Hierarchy (2026-10-10). Not a new root. D64, H15, and H52 are done, and a live task under a done feature is `L4.feature-terminal`.

- D64 owns the two-tier `spur-check` primitive and the workflow catalogue. It does not own the wall time of the default test hop.
- H15 owns how often a parallel batch pays the full gate (`deferQualityGate`). It does not own how long that gate's test hop takes.
- H52 owns the pipeline bound "full spur-check at most twice per task."
- H1 is the live daily-workflow parent and already carries the host lock (task 1127) and the load-flake follow-up (task 1150). H16 is the sibling that owns the default gate's own hop cost. H1 had a free child digit (H11–H15 were taken).

Operator instruction for the filed task: implement every 2026-10-09 gate-performance suggestion except suggestion 3, and keep per-file line coverage and function coverage at or above 90 percent.

## History

### 2026-10-13 — the parallel default shipped ahead of the recorded bar (PR #9)

`main` (`5715de2e8`) pins Bun 1.4.3 and `package.json` `test` passes `bun test --parallel`; `test:coverage` and `test:heavy` stay serial, so `bun run check` and CI keep the per-file 90/90 floor. The bar this feature recorded was not measured on the way in: `--no-isolate` actually honored, and beats the serial baseline, are outstanding; only "a quiet-machine run that finishes" has CI evidence.

Open conflict for the owner: **R3** still requires the default invocation to *not* pass `--parallel`, so R3 currently fails against `main`. Re-scoping the feature or retiring R3 against a measured bar is an owner decision, not a mechanical sync.

