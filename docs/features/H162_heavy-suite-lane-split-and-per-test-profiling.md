---
schema_version: 1
id: "H162"
name: "Heavy-suite lane split and per-test profiling"
status: active
priority: P2
tags: []
created_at: "2026-11-27T06:55:01.144Z"
updated_at: "2026-11-27T17:04:55.343Z"
---

# H162: Heavy-suite lane split and per-test profiling

## Goal

Cut the wall time of `bun run test:heavy` (~196–277s across recent feature-verification passes), the second-largest share of every `spur-check-feature` and `spur feature verify` pass after the root suite (H161), without dropping, weakening, or relocating any heavy proof. The levers, in order of evidence: one shared Board build per heavy run instead of one `astro build` per browser file, then concurrent execution of heavy files that share no host state.

## Scope

**In scope**
- A per-file wall-time profile of every `.heavy.test.` file and the end-to-end `test:heavy` baseline, recorded as a receipt.
- One Board build per heavy run, reused by the browser/board heavy files, with freshness bound to the current source.
- A committed heavy-lane manifest classifying each file as concurrent-safe or serial (shared host state or timing-sensitive), guarded against drift.
- Concurrent execution of the concurrent-safe heavy files; serial files keep today's ordering.
- A before/after wall-time receipt and a 3-consecutive-run zero-new-failure proof.

**Out of scope**
- The root suite lanes (H161).
- Moving heavy proofs back onto the default path, deleting them, or loosening their assertions or timeouts.
- The dsh executor E2E's sandbox and credential prerequisites (operator-owned environment).
- Changing the feature-verification receipt digest or reuse policy.

## Acceptance Criteria

- [ ] R1 — A per-file heavy profile and end-to-end baseline are recorded as a receipt
- [ ] R2 — Every heavy file is classified concurrent-safe or serial in a committed manifest guarded against drift
- [ ] R3 — The browser and board heavy files reuse one Board build per heavy run
- [ ] R4 — Concurrent-safe heavy files run concurrently while serial files keep serial execution
- [ ] R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path
- [ ] R6 — A before/after receipt shows test:heavy at or under 60 percent of baseline with zero new failures across 3 runs

```gherkin
Feature: Heavy-suite lane split and per-test profiling

  @core
  Scenario: R1 — A per-file heavy profile and end-to-end baseline are recorded as a receipt
    # covers: I1
    Given the current `bun run test:heavy` script on a host where Chromium can launch
    When the profiler runs every `.heavy.test.` file on its own and then the full script once
    Then a receipt records per-file wall time, test count, pass/fail and skip state for every heavy file
    And it records the end-to-end wall time of the unchanged script as the baseline
    And it records the time spent in Board builds separately from browser proof time

  @core
  Scenario: R2 — Every heavy file is classified concurrent-safe or serial in a committed manifest guarded against drift
    # covers: I2
    Given a committed heavy-lane manifest naming each `.heavy.test.` file with a lane and the host state it shares
    When a `.heavy.test.` file exists that the manifest does not name, or the manifest names a missing file
    Then a repo check fails naming the file
    And files that assert wall-time ratios or interval overlap are classified serial

  @core
  Scenario: R3 — The browser and board heavy files reuse one Board build per heavy run
    # covers: I4
    Given the heavy files that call buildBoardToTemp today
    When `bun run test:heavy` runs
    Then `astro build` runs once per distinct build configuration for the whole run, not once per file
    And the shared build is produced from the current working tree in that run, never reused from a previous run
    And a file that needs a distinct base path or build option still gets its own build

  @core
  Scenario: R4 — Concurrent-safe heavy files run concurrently while serial files keep serial execution
    # covers: I3
    Given the heavy-lane manifest
    When `bun run test:heavy` runs
    Then concurrent-safe files run concurrently at a bounded parallelism
    And serial files run one at a time with no concurrent heavy file alongside them
    And `test:heavy` stays the single package.json entry and `bun run check` still runs it

  @core
  Scenario: R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path
    # covers: I5
    Given the baseline receipt's heavy file list and test count
    When the changed `bun run test:heavy` runs
    Then every baseline heavy file runs and the executed test count is not lower
    And no assertion, timeout, or skip condition in a heavy test was loosened
    And no heavy file is collected by the default `bun run test` path

  @core
  Scenario: R6 — A before/after receipt shows test:heavy at or under 60 percent of baseline with zero new failures across 3 runs
    # covers: I6
    Given the R1 baseline wall time
    When the changed `bun run test:heavy` runs 3 consecutive times on the same host
    Then the median end-to-end wall time is at or under 60 percent of the baseline
    And no run has a failure that the baseline run did not have
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1463 | Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop | todo |
| 1461 | Profile every heavy test file and commit a heavy lane manifest with a drift guard | testing |
| 1462 | Build the Board once per heavy run as a run-scoped seed copied per caller | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-27T07:00:09.784Z moved V → H162 (system)
- 2026-11-27T17:04:55.343Z backlog → active (system)

