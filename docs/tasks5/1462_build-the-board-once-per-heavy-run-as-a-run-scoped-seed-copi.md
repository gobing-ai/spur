---
schema_version: 1
name: Build the Board once per heavy run as a run-scoped seed copied per caller
status: todo
template: feature-impl
created_at: 2026-11-27T07:07:41.709Z
updated_at: "2026-11-27T07:07:41.808Z"
feature_id: H162
priority: P2
tags:
  - testing
  - performance

---

## 1462. Build the Board once per heavy run as a run-scoped seed copied per caller

### Background

Feature H162 (design docs/design/heavy-suite-lanes.md §3.2). Six heavy files call buildBoardToTemp (apps/web/tests/test-helpers/board-build.ts:108); five are production-shaped and one passes testAdapterDir. Every build holds BUILD_LOCK because astro build shares the .astro cache, so ~15s builds serialize (~90s per heavy run). board-base-path.heavy.test.ts:90 writes into its build dir, so a shared build must be copied, not shared by reference. Covers R3, and R5 for the touched files.

### Requirements

- [ ] R1. scripts/commands/run-tests.ts exports a fresh SPUR_TEST_RUN_ID to every bun child it spawns.
- [ ] R2. With SPUR_TEST_RUN_ID set, the first production-shaped buildBoardToTemp() in a run builds a seed under BUILD_LOCK into $TMPDIR/spur-board-seed-<runId>/; every later production-shaped call in the same run copies the seed into its own mkdtemp dir and returns it. Callers keep owning cleanup; removeBoardBuild is unchanged.
- [ ] R3. testAdapterDir builds and runs without SPUR_TEST_RUN_ID (direct bun test) keep today behaviour: one fresh build per call.
- [ ] R4. The launcher removes the seed directory when it exits, including on failure or watchdog kill; a seed is never read by a different run id.
- [ ] R5. No heavy assertion, timeout, or skip condition changes.

### Acceptance Criteria

- [ ] R3 — The browser and board heavy files reuse one Board build per heavy run
- [ ] R5 — No heavy proof is dropped, skipped, weakened, or moved to the default path

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: lazy run-scoped seed inside the existing helper, keyed by a launcher-issued run id and built under the existing lock, then copied per caller. Rejected: a launcher pre-build step (builds even when no browser file runs, adds a scripts/commands entry, ADR-130 placement cost); handing out the seed path (board-base-path mutates its dir); a content-hash cache across runs (stale-proof risk). Invariants: freshness is per launcher run; isolation per caller is preserved; the production-build alarm in runtime-distribution.test.ts still holds.

### Plan

1. Write the failure modes first: seed from a previous run id, a mutating caller, a testAdapterDir build racing the seed, a crashed seed build leaving a partial dir.
2. Export SPUR_TEST_RUN_ID from run-tests.ts and add seed cleanup.
3. Implement seed build + copy in board-build.ts.
4. Run the six board heavy files under one run-tests call unsandboxed; confirm one production astro build in the log.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
