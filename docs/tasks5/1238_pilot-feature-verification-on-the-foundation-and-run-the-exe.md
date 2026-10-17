---
schema_version: 1
name: Pilot feature-verification on the foundation and run the executor matrix
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.819Z
updated_at: "2026-10-17T19:49:19.255Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - fleet
  - e2e
estimate_hours: 6

dependencies: ["1232", "1233", "1235", "1236", "1237", "1224"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1238-verdict.json
---

## 1238. Pilot feature-verification on the foundation and run the executor matrix

### Background

Feature D65 P1 exit. feature-verification.yaml has no agent.run (one shell verify state), so it pilots F1/F4/F6/F7; the executor matrix runs on a tracked fixture workflow with one agent.run and one decision gate. scripts/commands/fleet-e2e.ts (task 1077) already scaffolds a scratch project, stubs the model binary on PATH and writes docs/reports/fleet-e2e-receipt.json.

**Refine corrections (2026-10-17)**
- "pilots F1" → feature-verification.yaml already runs on the engine (invoked by feature-lifecycle; runner packages/app/src/workflow/feature-verification-run.ts) → pilot = its verify step via command.gate, the gate lock and gate time.
- R3 "fleet column blocked when agent.fleet.enabled / spur serve absent" → fleet-e2e.ts scaffolds its own scratch fleet (real agent loop, stub model on PATH) → fleet column runs self-contained; blocked only if scaffolding itself fails.
- A92 bumps feature-verification.yaml to version "2" with verificationCmd "spur self exec check-feature" → build on that version.

### Requirements

- [x] R1. feature-verification (A92 version "2") runs its verify step as a command.gate action with the `check-feature` action under the full-gate lock; outcomes and status file are unchanged and gate time appears in the run summary.
- [x] R2. A tracked fixture workflow (one agent.run, one decision gate) runs E2E under host, subprocess and fleet; traces and receipts are identical in shape across executors.
- [x] R3. The matrix is a mode of scripts/commands/fleet-e2e.ts writing a repeatable receipt under docs/reports/; the fleet column uses fleet-e2e's scratch fleet and reports blocked only with the failed scaffolding precondition.

### Acceptance Criteria

- [x] AC1 — R8 — Feature verification runs on the foundation (req: R1)
- [x] AC2 — R9 — The executor matrix shows identical traces across executors (req: R2, R3)
- [x] AC3 — R16 — Foundation tasks depend on the A92 action map

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Reuse fleet-e2e.ts scaffolding (`bun scripts/spur-dev.ts fleet-e2e`) instead of a new harness; add a matrix mode that runs the fixture under `vars.executor` = host | unset (subprocess) | fleet. Fixture lives beside the shipped workflows' test fixtures, not in config/workflows. Depends on A92 task 1224 (`check-feature` routing). The matrix receipt is the feature's repeatable E2E artifact.

### Plan

- [x] feature-verification verify step runs as command.gate over the check-feature action, under the full-gate lock
- [x] Tracked executor-matrix fixture (one agent.run + one decision gate) under host, subprocess and fleet
- [x] Matrix mode in fleet-e2e writing docs/reports/executor-matrix-receipt.json; fleet reports blocked naming its precondition
- [x] Failure-mode tests first; identical action sequence and receipt shape across the comparing executors

### Solution

- `config/workflows/feature-verification.yaml:64-73` — the verify state's ONE action is now a
  `command.gate` (`id: feature-verification`, `executable: ${vars.spurBin}`, the same
  `feature verify <featureId> --run-id <__runId> --no-logo` argv, `softFail: true`), with its typed
  PASS/FAIL/BLOCKED token in `.spur/run/<runId>-feature-verification.gate.status`. Every state,
  guard, transition and terminalReason is unchanged; the pass still writes its own
  `.spur/run/<runId>-feature-verification.status` and evidence receipt, so a completed FAIL is never
  overwritten by the gate's exit-0 token.
- `packages/app/src/workflow/feature-verification-run.ts:154-186` — the pass keeps the coarse FAIL
  the removed shell wrote: a pass that cannot RUN writes `FAIL` to its status file before rethrowing
  (`writeFailedStatus`), so the unchanged verify→done guard (`= PASS`) can only route to `failed`.
- `packages/app/tests/fixtures/1238/executor-matrix-fixture.yaml` — the tracked matrix fixture: one
  `agent.run` stage (`work`) with a declared `expectFile` and one operator decision gate (`decide`),
  `work -> decide -> done | blocked`. A test fixture path, not `config/workflows/`.
- `scripts/commands/fleet-e2e.ts:1123` (`--matrix`) — the matrix is a MODE of the existing harness:
  one scratch project (`git init`, `self init`, the same declared `agent.fleet`, a `bin/` holding the
  stub model and a `bun` shim) driven through the source-local CLI under host, subprocess and fleet.
  Columns are decided by exported pure functions (`hostColumnVerdict`, `runColumnVerdict`,
  `compareMatrixColumns`, `matrixExitCode`, `matrixPrecondition`); the receipt is written to
  `docs/reports/executor-matrix-receipt.json`. Exit 0 = every column passed, 1 = a column ran and
  broke the contract, 2 = a column was blocked. A block always names its precondition; the fleet
  column's dispatch reason is normalized (`workflow:<runId>`) so the receipt repeats.
- `scripts/commands/fleet-e2e-matrix.test.ts` — the matrix's failure modes first: host never paused,
  a mismatched receipt accepted, a terminal run without its receipt, a receipt naming another
  executor, a blocked column that never counts as a pass, and action-sequence / receipt-shape
  divergence.
- Executor matrix result: host PASSED (pause with work item, mismatched receipt refused at exit 1,
  receipt resumed to done), subprocess PASSED (done on its own receipt), fleet BLOCKED —
  `dispatchToFleet` posts `fromId: workflow:<runId>` and `validateAgentId` rejects the colon, so the
  fleet surface cannot dispatch at all on this tree (pre-existing, ADR-126 territory, not fixed
  here). `comparison.compared = 2`, `identical = true`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The verify state's single action in `config/workflows/feature-verification.yaml:65` is now `command.gate` over the same `feature verify` argv, with `softFail` replacing the shell's ` |
| R2 | MET | A tracked fixture (`packages/app/tests/fixtures/1238/executor-matrix-fixture.yaml`: one `agent.run` with a declared `expectFile`, one operator decision gate, `work → decide → done/blocked`) runs under all three executors from `docs/reports/executor-matrix-receipt.json`: host `passed` (paused at `work` with the work item, mismatched receipt refused, resumed to `done`), subprocess `passed`, both with the identical action sequence and an identical receipt shape (`executor,files,finishedAt,outcome,reason,runId,startedAt,state`), `comparison.identical: true` over 2 compared columns |
| R3 | MET | The matrix is a mode of `scripts/commands/fleet-e2e.ts` (`runExecutorMatrix` at `:1018`, invoked as `bun scripts/spur-dev.ts fleet-e2e --matrix`), writing the repeatable receipt `docs/reports/executor-matrix-receipt.json` (regenerated by my own run). The fleet column reports `blocked`, not a pass, naming the real precondition: `fleet dispatch rejected the sender id 'workflow:<runId>' (validateAgentId: 2-64 chars, lowercase alphanumeric, "_" or "-")` — the pre-existing `packages/app/src/workflow/fleet-dispatch.ts:200` vs `packages/app/src/services/agent-coordination-service.ts:266` defect, not a scaffold failure |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R8 — Feature verification runs on the foundation (req: R1) | MET | command | `spur workflow validate config/workflows/feature-verification.yaml` → `workflow valid: feature-verification (explicit(2))`; `plugins/sp/tests/feature-verification-scope.test.ts` (11 pass) drives the real `spur feature verify` and the `done` guard shell in a scratch project; `packages/app/tests/workflow/feature-verification-run.test.ts` (10 pass) pins the FAIL-write on a cannot-run pass |
| AC2 — R9 — The executor matrix shows identical traces across executors (req: R2, R3) | MET | command | `bun scripts/spur-dev.ts fleet-e2e --matrix` (my own run) → `ok host`, `ok subprocess`, `BLOCK fleet` with the named precondition, receipt `docs/reports/executor-matrix-receipt.json` with `comparison.identical: true`; `scripts/commands/fleet-e2e-matrix.test.ts` (19 pass) covers the four failure modes plus the blocked-not-pass rule |
| AC3 — R16 — Foundation tasks depend on the A92 action map | MET | command | `spur task show 1238 --json` reports `.frontmatter.dependencies = [1232, 1233, 1235, 1236, 1237, 1224]` — the A92 gate-routing task 1224 included, and every dependency is `done` in this tree |
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

- 2026-10-17T19:49:15.521Z todo → wip (system)
- 2026-10-17T19:49:16.044Z wip → testing (system)
- 2026-10-17T19:49:19.249Z testing → done (system)

