---
schema_version: 1
name: Engine-owned leases for the gate, worktree and fleet occupancy
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-17T18:32:39.702Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - engine
  - gate
estimate_hours: 4

dependencies: ["1234"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1235-verdict.json
---

## 1235. Engine-owned leases for the gate, worktree and fleet occupancy

### Background

Feature D65 F6. The host-wide gate lock was removed in f1d3c2caa (script cleanup); since then duplicate gates contended for 40 min in one run. Leases must be acquired and released by the engine around a stage.

**Refine corrections (2026-10-17)**
- Background "40 min in one run" and R1 "per-working-tree lease" → task 1127 measured 43/64 full gates overlapping across sessions and worktrees on one host (load flakes) → restore the host-wide full-gate lock exactly as task 1127 designed it (ADR-140 item 6, D65 R6 retitled).
- Lock source at f1d3c2caa^: quality-gate.ts ~:743–765 (mkdir lock; env SPUR_GATE_LOCK_DIR, SPUR_GATE_LOCK_POLL_MS, SPUR_GATE_LOCK=off, SPUR_GATE_LOCK_TOKEN re-entry, SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS); plugins/sp/tests/quality-gate-lock.heavy.test.ts deleted with it → restore the heavy test.
- AC1 title → new D65 R6 title.

### Requirements

- [x] R1. Full gates take one host-wide lock (holder = run id + pid; re-entry via SPUR_GATE_LOCK_TOKEN); a second full gate on the host from any session or worktree waits; light, deferred and status tiers do not take it (recheck does: it re-executes the same full command — task 1127 R4 and ADR-140 item 6).
- [x] R2. The lock releases on terminal, cancel and failure; a lock whose holder pid is dead is reclaimed; SPUR_GATE_LOCK=off disables it.
- [x] R3. Worktree (ADR-127) and fleet occupancy leases keep their current owners; the engine acquires/releases them around the stage.

### Acceptance Criteria

- [x] AC1 — R6 — Engine leases serialize full gates across sessions on one host

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T16:13:25.897Z

- Scope: host-wide, per task 1127 evidence (closed, refine 2026-10-17; corrected my own per-tree premise in ADR-140 and D65).

### Design

Restore the task 1127 lock from `f1d3c2caa^` (quality-gate.ts ~:743–765, mkdir lock under SPUR_GATE_LOCK_DIR, poll SPUR_GATE_LOCK_POLL_MS, token re-entry) unchanged in scope: host-wide, because contention was cross-worktree. Restore plugins/sp/tests/quality-gate-lock.heavy.test.ts as the regression check (runs under test:heavy). Shares quality-gate.ts with 1234 — land after it. Rejected: per-tree key (re-admits the measured cross-worktree contention), a generic lease service (one consumer per lease).

### Plan

- [x] Restore the host-wide full-gate lock inside the gate (run + recheck), with the 1127 env contract
- [x] Restore plugins/sp heavy regression suite, adapted to the retired scripts' replacement (`spur task gate`)
- [x] Restore the per-process lock-dir preload in tests/setup.ts
- [x] Bound the wait (SPUR_GATE_LOCK_TIMEOUT_MS) so a waiter fails closed naming the holder

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/design/workflow-execution-foundation.md:280` |
| `packages/app/src/services/quality-gate.ts:1249` |
| `packages/app/src/services/quality-gate.ts:1252` |
| `packages/app/src/services/quality-gate.ts:1255` |
| `packages/app/src/services/quality-gate.ts:1290` |
| `packages/app/src/services/quality-gate.ts:1349` |
| `packages/app/src/services/quality-gate.ts:1424` |
| `packages/app/src/services/quality-gate.ts:19` |
| `packages/app/src/services/quality-gate.ts:53` |
| `packages/app/src/services/quality-gate.ts:55` |
| `packages/app/src/services/quality-gate.ts:61` |
| `packages/app/src/services/quality-gate.ts:64` |
| `packages/app/src/services/quality-gate.ts:791` |
| `plugins/sp/bunfig.toml:7` |
| `scripts/bunfig.toml:7` |
| `tests/setup.ts:10` |
| `packages/app/tests/services/quality-gate-lock.test.ts:1` |
| `plugins/sp/tests/quality-gate-lock.heavy.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The task-1127 lock is restored inside the gate (`packages/app/src/services/quality-gate.ts:932` `acquireGateLock`, acquisition around the shared attempt loop at `:1259-1288`) and taken by BOTH full tiers — `run` and `recheck` — while `light`, `deferred`, `status`, the recheck probe and the reuse/no-progress short circuits stay lockless (`packages/app/tests/services/quality-gate-lock.test.ts:160`). Re-entry requires the CURRENT holder's marker: a stale or foreign `SPUR_GATE_LOCK_TOKEN` waits like any stranger. Two concurrent host gates are proven disjoint by `plugins/sp/tests/quality-gate-lock.heavy.test.ts` (11 scenarios) and by this run's own gate line `quality gate lock: queueWaitMs=0` |
| R2 | MET | Release runs in a `finally` (`packages/app/src/services/quality-gate.ts:1286`), so failure and throw release too; a cancelled process leaves a dead-pid claim that the next gate reclaims via signal-0 liveness (`:832-911`); `SPUR_GATE_LOCK=off` disables the whole mechanism. Covered by `packages/app/tests/services/quality-gate-lock.test.ts` and heavy scenarios AC6–AC8 (off, failing gate releases, cancelled gate reclaimed) |
| R3 | MET | No code change was needed and none was made: worktree leases keep their owner (`apps/cli/src/commands/workflow/inline.ts` WT-3/WT-4, driver step 7) and fleet occupancy keeps its owner (`packages/app/src/services/fleet-guest-service.ts`, `occupant-wait.ts`, ADR-126). No engine stage acquires a worktree or fleet lease on this tree yet, so there is nothing for the engine to wrap; the lock is the only lease this task had to own |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R6 — Engine leases serialize full gates across sessions on one host | MET | command | `plugins/sp/tests/quality-gate-lock.heavy.test.ts` run directly with `--config=bunfig.heavy.toml` → 11 pass, 0 fail in 31 s: two concurrent 3 s gates against one scratch lock dir produce disjoint start/end stamps, exactly one `waiting for holder` line naming the holder's wbs and cwd, and the holder's receipt carries the queue wait (AC1/AC1b/AC3); AC5 proves a nested `spur task gate` re-enters on the exported token; AC9 proves a bounded waiter exits 2 naming the holder instead of running beside it. `spur task gate 1235 run` → `quality gate PASS` (log `.spur/run/1235-test-gate.log`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T18:32:34.406Z todo → wip (system)
- 2026-10-17T18:32:35.015Z wip → testing (system)
- 2026-10-17T18:32:39.694Z testing → done (system)

