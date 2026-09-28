---
schema_version: 1
name: Order the standalone verify surfaces' residual-scan fold after record flips
status: done
template: feature-impl
created_at: 2026-09-27T20:48:32.768Z
updated_at: "2026-09-28T03:24:12.064Z"
feature_id: F96

priority: P2
ac_altitude: task-local
---

## 0987. Order the standalone verify surfaces' residual-scan fold after record flips

### Background

0983 reordered the pipeline FSM: `residual-scan scan|fold` now runs in the `record` state AFTER `spur task record` flips verdict-proven Requirement/AC boxes, so a PASS verdict with proven boxes no longer folds PARTIAL (0967 root cause). The standalone surfaces — `/sp:dev-verify` (`plugins/sp/commands/dev-verify.md:43-46`) and `/sp:dev-verifyall` (`plugins/sp/commands/dev-verifyall.md:76-78`) — still run scan+fold before `spur task record`/the done transition, so the same under-crediting survives there: a clean task with unticked-but-verdict-proven R/AC boxes folds PASS→PARTIAL and `foldVerdict` never restores PARTIAL→PASS. `docs/design/task-residual-sweep.md` (rule owner) documents both orders; the standalone one is pending this fix.

### Requirements

- [x] R1. `/sp:dev-verify` runs its residual scan+fold only after its `spur task record` step has applied verdict-driven box flips (or explicitly documents + guards the standalone-only rationale if record is out of scope for that command).
- [x] R2. `/sp:dev-verifyall` gets the same ordering treatment.
- [x] R3. `docs/design/task-residual-sweep.md` mode table + terminal-path table match the shipped standalone order.
- [x] R4. A regression test or scripted check pins the standalone ordering for both surfaces.

### Acceptance Criteria

- [x] AC1 — Standalone verify of a clean task with unticked-but-proven boxes no longer downgrades PASS→PARTIAL (req: R1, R2)
- [x] AC2 — Rule-owner doc matches shipped order on both surfaces (req: R3)
- [x] AC3 — Ordering pinned by a check (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Mirror the pipeline `record` state (0983) on the standalone surfaces: `task verdict` → `spur task record` (flips verdict-proven R/AC boxes) → `residual-scan scan` + `fold` → downgrade-only re-record so Testing carries the final verdict. No scanner change: `scan` already reads the live task file, so moving it after record is the whole fix. Record is in scope for both commands (it is the Testing writer), so no standalone-only rationale is needed (R1 first branch). Rejected: teaching `foldVerdict` to restore PARTIAL→PASS — it would let a stale pre-record scan pass unproven boxes.

### Plan

- [x] P1 — Reorder `/sp:dev-verify` residual-sweep contract after `spur task record` (R1).
- [x] P2 — Same for `/sp:dev-verifyall` per-task sweep (R2).
- [x] P3 — Reorder the `sp:code-verification` Step 10 standalone bash block + fold note (the skill both commands delegate to).
- [x] P4 — Update `docs/design/task-residual-sweep.md` mode table, terminal-path row and surface table (R3).
- [x] P5 — Pin the ordering on all three surfaces in `plugins/sp/tests/task-pipeline-resilience.test.ts`; mutation-check against the pre-fix text (R4).

### Solution

**Root cause.** 0983 moved the pipeline sweep after `task record`'s verdict-proven box flips; the standalone surfaces still ran scan+fold before record, so a clean task's unticked-but-proven boxes read as blocking and folded PASS→PARTIAL (0967 on the manual path).

**Change map.**
- `plugins/sp/commands/dev-verify.md:43` — sweep is post-record; downgrade-only re-record (R1).
- `plugins/sp/commands/dev-verifyall.md:75` — same per-task contract (R2).
- `plugins/sp/skills/code-verification/SKILL.md:262` — Step 10 block now `record` → `scan` (`:265`) → `fold` → re-record on non-PASS (`:268`); rationale note `:276`.
- `docs/design/task-residual-sweep.md:62-66` mode table (scan/fold callers post-record); `docs/design/task-residual-sweep.md:118-123` terminal path for a standalone blocking sweep; `docs/design/task-residual-sweep.md:140` surface table (R3).
- `plugins/sp/tests/task-pipeline-resilience.test.ts:676` — ordering pins for all three surfaces, `:693` record < scan < fold < re-record (R4). Behavior of the post-record sweep on a flipped task is already pinned by `:368` (0983).

**Verification.** Pins fail 4/4 against the HEAD surfaces and pass after the change.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-verify.md:43` sweep after `spur task record` + downgrade-only re-record; delegated skill block `plugins/sp/skills/code-verification/SKILL.md:262`; pinned by `plugins/sp/tests/task-pipeline-resilience.test.ts:676` |
| R2 | MET | `plugins/sp/commands/dev-verifyall.md:75` same post-record per-task contract; pinned by `plugins/sp/tests/task-pipeline-resilience.test.ts:676` |
| R3 | MET | `docs/design/task-residual-sweep.md:62-66` mode table; `docs/design/task-residual-sweep.md:118-123` terminal path; `docs/design/task-residual-sweep.md:140` surface table |
| R4 | MET | `plugins/sp/tests/task-pipeline-resilience.test.ts:676` (3 surface pins) + `plugins/sp/tests/task-pipeline-resilience.test.ts:693` record < scan < fold < re-record; `bun test tests/task-pipeline-resilience.test.ts tests/residual-scan.test.ts` (plugins/sp) 50 pass / 0 fail; mutation: 4 fail against HEAD~ surfaces |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:368` post-record sweep passes a flipped task and downgrades an open box (same scanner the standalone surfaces now run after record); `plugins/sp/tests/task-pipeline-resilience.test.ts:693` standalone order |
| AC2 | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:676` asserts every surface cites 0987 and drops "before spur task record"; doc rows `docs/design/task-residual-sweep.md:62-66` |
| AC3 | MET | test | `plugins/sp/tests/task-pipeline-resilience.test.ts:676`, `plugins/sp/tests/task-pipeline-resilience.test.ts:693` — 50 pass / 0 fail; mutation-checked (4 fail on pre-fix text) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-28T03:23:08.273Z backlog → todo (system)
- 2026-09-28T03:23:08.464Z todo → wip (system)
- 2026-09-28T03:23:51.739Z wip → testing (system)
- 2026-09-28T03:24:12.064Z testing → done (system)

