---
schema_version: 1
name: Classify subprocess-heavy root test files into a committed lane manifest with a drift guard
status: todo
template: feature-impl
created_at: 2026-11-27T06:56:54.805Z
updated_at: "2026-11-27T07:00:36.058Z"
feature_id: H161
priority: P1
tags:
  - testing
  - performance

---

## 1459. Classify subprocess-heavy root test files into a committed lane manifest with a drift guard

### Background

Feature H161 (under H16; design docs/design/laned-root-test-suite.md §3.1). The root suite caps at --parallel=2 (commit c8d5ca0f2) because subprocess-spawning tests time out under CPU-count fan-out. Before laning, record which files spawn and how long each takes, plus the baseline wall time at --parallel=2 and the --parallel=4 single-child alternative. Covers scenario R2 and the before half of R5.

### Requirements

- [ ] R1. A generator scans root test files (./apps/cli ./apps/server ./apps/web ./packages ./plugins ./scripts, non-heavy) for subprocess usage (Bun.spawn, spawnSync, execSync, execFileSync, Bun $ shell, child_process) and writes config/test-lanes.json listing subprocess-lane files, sorted, with per-file duration where recorded.
- [ ] R2. A repo-wide test fails, naming the file, when a spawning root test file is absent from the manifest or a listed file no longer exists.
- [ ] R3. Record a before receipt: wall time of the current --parallel=2 suite and of a single child at --parallel=4 (timeouts counted), stored under .spur/run/test-lanes-baseline.json and cited in Testing.

### Acceptance Criteria

- [ ] R2 — The subprocess lane membership is derived from evidence and guarded against drift

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: committed JSON manifest plus a static spawn-usage scan (deterministic, reviewable) enriched with recorded durations. Rejected: runtime auto-classification each run (non-deterministic lane membership) and tag comments inside test files (921 files to touch). Invariants: manifest paths are repo-relative and sorted; generator is idempotent; drift guard lives in repo-wide-tests so it runs in spur-check-feature. Placement: generator under scripts/commands per ADR-130 (repo policy fixture).

### Plan

1. Write failure modes for the scan (aliased imports, helpers that spawn indirectly) first.
2. Implement generator + manifest.
3. Add repo-wide drift test.
4. Run baseline timings and write the receipt.

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

