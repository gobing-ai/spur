---
schema_version: 1
name: Engine-owned leases for the gate, worktree and fleet occupancy
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.818Z
updated_at: "2026-10-18T02:28:55.174Z"
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

Follow-up implementation: packages/app/src/services/workflow-worktree-lease.ts:15 holds a fenced engine-run lease on an actual task worktree across host pauses, refuses competing live runs, and releases on terminal/cancel. packages/app/tests/services/workflow-worktree-lease.test.ts:10 verifies ownership, renewal loss, storage errors and terminal release through the real workflow service. The gate and fleet write-slot claims remain distinct.

Output-isolation follow-up: packages/app/tests/services/quality-gate-lock.test.ts:170 now captures all four gate entrypoint calls through the existing synchronous try/finally boundary. The light PASS diagnostic and status JSON are asserted after stdout is restored. Production output is unchanged. The exact full-suite baseline passed 11,372 tests with zero failures; the output-specific subprocess assertion failed before this test fix and passes afterward (7 tests / 30 assertions). Evidence: .spur/run/output-leak-fix/baseline-tests.log and .spur/run/output-leak-fix/output-repro-{red,green}.log.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 172 — (pass) gate lock (D65 1235) > run and recheck both take the lock; light and status never do [249.27ms]; fresh targeted run exited 0; @run `.spur/run/output-leak-fix/final-tests.log` — full gate PASS, 11372 tests / 0 failures and no per-test output headings; `.spur/run/output-leak-fix/focused-output.log` — all 7 lock tests / 30 assertions pass with stdout captured |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 173 — (pass) gate lock (D65 1235) > a failing gate releases the claim, so the next gate takes it without waiting [5.23ms]; fresh targeted run exited 0; @run `.spur/run/output-leak-fix/final-tests.log` — full gate PASS, 11372 tests / 0 failures and no per-test output headings; `.spur/run/output-leak-fix/focused-output.log` — all 7 lock tests / 30 assertions pass with stdout captured |
| R3 | MET | packages/app/src/services/workflow-worktree-lease.ts:13 and packages/app/tests/services/workflow-worktree-lease.test.ts:10 — engine acquisition, host-pause retention, competing-run refusal, same-run continue, cancellation, terminal release and fenced abort pass; live fleet member ownership remains pinned through completion; @run `.spur/run/output-leak-fix/final-tests.log` — full gate PASS, 11372 tests / 0 failures and no per-test output headings; `.spur/run/output-leak-fix/focused-output.log` — all 7 lock tests / 30 assertions pass with stdout captured |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — Engine leases serialize full gates across sessions on one host | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 172 — (pass) gate lock (D65 1235) > run and recheck both take the lock; light and status never do [249.27ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 173 — (pass) gate lock (D65 1235) > a failing gate releases the claim, so the next gate takes it without waiting [5.23ms]; fresh targeted run exited 0; packages/app/src/services/workflow-worktree-lease.ts:13 and packages/app/tests/services/workflow-worktree-lease.test.ts:10 — engine acquisition, host-pause retention, competing-run refusal, same-run continue, cancellation, terminal release and fenced abort pass; live fleet member ownership remains pinned through completion; @run `.spur/run/output-leak-fix/final-tests.log` — full gate PASS, 11372 tests / 0 failures and no per-test output headings; `.spur/run/output-leak-fix/focused-output.log` — all 7 lock tests / 30 assertions pass with stdout captured |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 172 — (pass) gate lock (D65 1235) > run and recheck both take the lock; light and status never do [249.27ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 173 — (pass) gate lock (D65 1235) > a failing gate releases the claim, so the next gate takes it without waiting [5.23ms]; fresh targeted run exited 0 |
| R3 | MET | packages/app/src/services/workflow-worktree-lease.ts:13 and packages/app/tests/services/workflow-worktree-lease.test.ts:10 — engine acquisition, host-pause retention, competing-run refusal, same-run continue, cancellation, terminal release and fenced abort pass; live fleet member ownership remains pinned through completion |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R6 — Engine leases serialize full gates across sessions on one host | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 172 — (pass) gate lock (D65 1235) > run and recheck both take the lock; light and status never do [249.27ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/app-tests.log` line 173 — (pass) gate lock (D65 1235) > a failing gate releases the claim, so the next gate takes it without waiting [5.23ms]; fresh targeted run exited 0; packages/app/src/services/workflow-worktree-lease.ts:13 and packages/app/tests/services/workflow-worktree-lease.test.ts:10 — engine acquisition, host-pause retention, competing-run refusal, same-run continue, cancellation, terminal release and fenced abort pass; live fleet member ownership remains pinned through completion |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/design/workflow-execution-foundation.md:19 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

Output-isolation follow-up reviewed: packages/app/tests/services/quality-gate-lock.test.ts:170 captures all four synchronous entrypoint calls until the existing finally restores stdout. Both light/status messages are asserted, all previous lock and release assertions remain, and the full suite has no stray output headings. The output-specific regression was red before the change and green afterward. Fresh full gate: .spur/run/output-leak-fix/final-tests.log — 11372 pass / 0 fail; coverage and pre/post rules pass. The earlier stale-tree certification refusal is retained in first-confirmation-tree-moved.log and was resolved by running against the stable externally committed tree.

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T18:32:34.406Z todo → wip (system)
- 2026-10-17T18:32:35.015Z wip → testing (system)
- 2026-10-17T18:32:39.694Z testing → done (system)

