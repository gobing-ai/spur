---
schema_version: 1
name: Engine-owned leases for the gate, worktree and fleet occupancy
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-17T16:13:26.299Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - engine
  - gate
estimate_hours: 4

dependencies: ["1234"]
---

## 1235. Engine-owned leases for the gate, worktree and fleet occupancy

### Background

Feature D65 F6. The host-wide gate lock was removed in f1d3c2caa (script cleanup); since then duplicate gates contended for 40 min in one run. Leases must be acquired and released by the engine around a stage.

**Refine corrections (2026-10-17)**
- Background "40 min in one run" and R1 "per-working-tree lease" → task 1127 measured 43/64 full gates overlapping across sessions and worktrees on one host (load flakes) → restore the host-wide full-gate lock exactly as task 1127 designed it (ADR-140 item 6, D65 R6 retitled).
- Lock source at f1d3c2caa^: quality-gate.ts ~:743–765 (mkdir lock; env SPUR_GATE_LOCK_DIR, SPUR_GATE_LOCK_POLL_MS, SPUR_GATE_LOCK=off, SPUR_GATE_LOCK_TOKEN re-entry, SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS); plugins/sp/tests/quality-gate-lock.heavy.test.ts deleted with it → restore the heavy test.
- AC1 title → new D65 R6 title.

### Requirements

- [ ] R1. Full gates take one host-wide lock (holder = run id + pid; re-entry via SPUR_GATE_LOCK_TOKEN); a second full gate on the host from any session or worktree waits; light/recheck tiers do not take it.
- [ ] R2. The lock releases on terminal, cancel and failure; a lock whose holder pid is dead is reclaimed; SPUR_GATE_LOCK=off disables it.
- [ ] R3. Worktree (ADR-127) and fleet occupancy leases keep their current owners; the engine acquires/releases them around the stage.

### Acceptance Criteria

- [ ] AC1 — R6 — Engine leases serialize full gates across sessions on one host

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:25.897Z

- Scope: host-wide, per task 1127 evidence (closed, refine 2026-10-17; corrected my own per-tree premise in ADR-140 and D65).

### Design

Restore the task 1127 lock from `f1d3c2caa^` (quality-gate.ts ~:743–765, mkdir lock under SPUR_GATE_LOCK_DIR, poll SPUR_GATE_LOCK_POLL_MS, token re-entry) unchanged in scope: host-wide, because contention was cross-worktree. Restore plugins/sp/tests/quality-gate-lock.heavy.test.ts as the regression check (runs under test:heavy). Shares quality-gate.ts with 1234 — land after it. Rejected: per-tree key (re-admits the measured cross-worktree contention), a generic lease service (one consumer per lease).

### Plan

- [ ] Failure modes: crashed holder, nested re-entry, two worktrees, cancel mid-gate, lock disabled
- [ ] Restore lock + heavy test from f1d3c2caa^ onto the A92/1234 quality-gate.ts
- [ ] Engine acquire/release around worktree and fleet stages

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History
