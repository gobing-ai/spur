---
schema_version: 1
name: Run the root suite as two lanes with merged-LCOV threshold gate and prove the wall-time drop
status: todo
template: feature-impl
created_at: 2026-11-27T06:56:54.808Z
updated_at: "2026-11-27T07:00:47.287Z"
feature_id: H161
priority: P1
tags:
  - testing
  - performance
  - coverage

dependencies: ["1459"]
---

## 1460. Run the root suite as two lanes with merged-LCOV threshold gate and prove the wall-time drop

### Background

Feature H161 (under H16; design docs/design/laned-root-test-suite.md §3.2-3.4, §4). Uses the manifest from the classifier task. scripts/commands/run-tests.ts runs one bun child; it must run the subprocess lane at the package.json --parallel bound and the in-process lane at availableParallelism, merge LCOV, apply bunfig per-file thresholds on the merged result, and keep task-1203 certification. Covers R1, R3, R4, R5 (after), R6.

### Requirements

- [ ] R1. When forwarded args are the root path set, the launcher spawns two concurrent bun children (subprocess lane from config/test-lanes.json at the --parallel value; in-process lane at availableParallelism, override SPUR_TEST_INPROC_PARALLEL), each under the existing heartbeat/watchdog with its own coverage dir; other invocations behave as today.
- [ ] R2. Bun in-child coverageThreshold is disabled via the launcher config copy; the launcher merges both LCOV files per SF record and fails nonzero naming file and metric when a file is under the bunfig line/function threshold, honoring coveragePathIgnorePatterns.
- [ ] R3. --publish-coverage certifies the merged lcov.info only when both lanes exit 0, the merged gate passes, and the tree is unchanged.
- [ ] R4. After receipt: laned main-suite wall time <=250s, and three consecutive laned runs exit 0 with no timeout-shaped failure; stored as task evidence beside the baseline.

### Acceptance Criteria

- [ ] R1 — The launcher runs the root suite as a subprocess lane and an in-process lane
- [ ] R3 — Coverage thresholds are evaluated on the merged result of both lanes
- [ ] R4 — Canonical coverage certification still publishes only on a fully green unchanged-tree run
- [ ] R5 — A wall-time receipt shows the main suite at or under 250 seconds
- [ ] R6 — Three consecutive laned runs complete with no new timeouts

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: two concurrent children in the existing launcher, merge+gate in the launcher. Rejected: N-way file sharding (same merge cost, no contention control); raising --parallel only (reintroduces c8d5ca0f2 timeouts — kept only if the baseline receipt beats laning). Invariants: single call site in package.json; exit code is nonzero if any lane or the gate fails; certification contract unchanged. Fallback if the subprocess lane times out under concurrency: run lanes sequentially, in-process first. Key signatures: mergeLcov(a: string, b: string): string; evaluateThresholds(lcov: string, cfg): Breach[].

### Plan

1. Write LCOV merge/threshold failure modes and fixture cases first (overlapping SF, FN-only records, ignored paths, empty lane).
2. Implement merge + gate; compare against a single-process run threshold result.
3. Wire lanes into run-tests.ts.
4. Run 3 consecutive full suites; record after receipt.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-27T07:00:09.288Z feature_id U → H161 (system)

