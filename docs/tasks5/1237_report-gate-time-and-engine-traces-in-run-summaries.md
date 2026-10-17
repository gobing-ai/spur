---
schema_version: 1
name: Report gate time and engine traces in run summaries
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.819Z
updated_at: "2026-10-17T19:16:40.900Z"
feature_id: D65
priority: P2
tags:
  - observability
  - workflow
estimate_hours: 2

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1237-verdict.json
---

## 1237. Report gate time and engine traces in run summaries

### Background

Feature D65 F7. gateFromReceipt looks for `.spur/run/${runId}-check-receipt.json` (run-summary-render.ts:199) but receipts are written as `<wbs>-check-receipt.json`, and run-summary.ts:598 hard-codes `gate: { ms: null }` — gate time has never been reported.

**Refine corrections (2026-10-17)**
- No corrections: run-summary-render.ts:199 (`${runId}-check-receipt.json`), quality-gate.ts:655/:914 (`<wbs>-check-receipt.json`) and run-summary.ts:598 (hard-coded null) confirmed.

### Requirements

- [x] R1. Run summaries resolve the gate receipt by the run's wbs (and the gate builtin's receipt path when present) and report gate ms.
- [x] R2. Engine-executed runs report stage times from action_runs without inline trace verbs.

### Acceptance Criteria

- [x] AC1 — R7 — Run summaries report gate time and engine-emitted traces (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Root-cause fix in the shared lookup both callers use; no new artifact. Regression check: an E2E run summary over a fixture run with a real receipt shows non-null gate ms.

### Plan

- [x] Fix the lookup (resolve by the identity recorded inside the receipt) + wire the close path's gate
- [x] Verify against a real `.spur/run/<wbs>-check-receipt.json` written by this batch's gate

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/workflow/run-summary-render.ts:178` |
| `packages/app/src/workflow/run-summary-render.ts:198` |
| `packages/app/src/workflow/run-summary-render.ts:208` |
| `packages/app/src/workflow/run-summary-render.ts:238` |
| `packages/app/src/workflow/run-summary-render.ts:243` |
| `packages/app/src/workflow/run-summary-render.ts:9` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:21` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:279` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:28` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:461` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:475` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:605` |
| `packages/app/tests/workflow/run-summary-cli.test.ts:612` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Root cause was a path/identity mismatch: the gate writes `.spur/run/<wbs>-check-receipt.json` with the run identity recorded INSIDE it, while the summary looked only for `<runId>-check-receipt.json`, so every summary rendered a null gate. `gateFromReceipt` (`packages/app/src/workflow/run-summary-render.ts:209`) now tries the run-id path first, then takes the first receipt in the run dir whose recorded `runId` is this run, and never reads a foreign one. Both callers resolve it: the `spur workflow summary` CLI (`packages/app/src/workflow/run-summary-cli.ts:96`) and the close writer (`packages/app/src/workflow/run-summary-render.ts:174`), which previously left the built summary's placeholder untouched. Proven on this repo's own receipt: `.spur/run/1237-check-receipt.json` carries `runId 1237c-…` and `gateRuntimeMs`, and the renderer emits `of which gate (informational) |
| R2 | MET | Stage windows come from `action_runs` rows through `ActionRunDao` (`packages/app/src/workflow/progress-projection.ts:250`) and the summary windows over `progress.states[].actions[].attempts[]` timestamps — no inline trace verb and no inline-run artifact is read. The engine's own runs therefore report stage times with no driver bookkeeping; nothing needed changing here |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R7 — Run summaries report gate time and engine-emitted traces (req: R1, R2) | MET | command | `packages/app/tests/workflow/run-summary-cli.test.ts` (25 pass, run inside the app workspace) covers the run-id receipt, the WBS-named receipt resolved by its recorded identity, a foreign receipt still refused, an unreadable receipt, and the CLI end-to-end rendering the resolved gate time from a cwd that holds this run's receipt. `spur task gate 1237 run` → `quality gate PASS` (log `.spur/run/1237-test-gate.log`) |
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

- 2026-10-17T19:16:36.324Z todo → wip (system)
- 2026-10-17T19:16:36.819Z wip → testing (system)
- 2026-10-17T19:16:40.894Z testing → done (system)

