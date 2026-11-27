---
schema_version: 1
name: Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop
status: todo
template: feature-impl
created_at: 2026-11-27T07:07:41.710Z
updated_at: "2026-11-27T07:08:38.397Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

dependencies: ["1461", "1462", "1460"]
---

## 1463. Run test:heavy as a concurrent-safe phase then a serial phase and prove the wall-time drop

### Background

Feature H162 (design docs/design/heavy-suite-lanes.md §3.3, §4). Uses the heavy manifest section from the profiling task and the lane runner H161 task 1460 adds to scripts/commands/run-tests.ts (root-path laning only). test:heavy today is two serial run-tests calls (package.json:86); it collapses to one launcher call so both phases share one Board seed. Covers R4, R5, R6.

### Requirements

- [ ] R1. Under --config=bunfig.heavy.toml, the launcher runs the manifest concurrent lane at bounded --parallel (default 4, env SPUR_TEST_HEAVY_PARALLEL), then the serial lane at --parallel=1; phases are sequential and the watchdog applies per phase. Exit is nonzero if either phase fails.
- [ ] R2. package.json test:heavy becomes one run-tests call; bun run check still runs it; no heavy file is collected by the default bun run test path.
- [ ] R3. Every file in the baseline profile runs and the executed test count is not lower than the baseline.
- [ ] R4. Three consecutive unsandboxed bun run test:heavy runs on the profiling host are recorded; median wall time is at or under 60 percent of the R1 baseline and no run has a failure the baseline lacked. A concurrent-lane file that flakes moves to the serial lane; assertions and timeouts are never loosened.

### Acceptance Criteria

- [ ] R4 — Concurrent-safe heavy files run concurrently while serial files keep serial execution
- [ ] R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path
- [ ] R6 — A before/after receipt shows test:heavy at or under 60 percent of baseline with zero new failures across 3 runs

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: reuse the H161 lane runner with sequential phases (concurrent then serial) and no coverage merge (heavy runs have coverage off). Rejected: raising --parallel for one heavy child (timing-sensitive proofs flake, build lock still serializes) and running the serial lane concurrently with the concurrent lane (breaks the serial-isolation guarantee). Invariants: single package.json entry; serial files never overlap another heavy file; the manifest is the only lane SSOT. Execution budget: three full heavy runs (~10 min) plus one regression pass; persist each run receipt as it lands.

### Plan

1. Write failure modes first: a serial file scheduled in the concurrent phase, a phase failure masked by the next phase, a missing manifest file at run time, a watchdog kill in phase 1.
2. Extend the lane runner for the heavy config.
3. Collapse test:heavy in package.json.
4. Run 3 consecutive unsandboxed heavy runs; record the after receipt against the R1 baseline.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
