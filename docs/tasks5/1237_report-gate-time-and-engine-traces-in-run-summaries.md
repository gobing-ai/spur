---
schema_version: 1
name: Report gate time and engine traces in run summaries
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.819Z
updated_at: "2026-10-18T02:02:11.026Z"
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

Follow-up implementation: packages/app/src/services/quality-gate.ts:601 binds receipts to the engine __runId when no explicit runId is present. packages/app/src/workflow/run-summary-cli.ts:1 retains engine and gate timing without compatible transcript data; unavailable usage remains n/a. docs/reports/d65-real-task-pipeline-receipt.json:1 records three completed runs whose summary gate times equal actual typed gate receipts.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 84 — (pass) 1146 — gate receipt and batch roll-up > D65 1237 R1: a WBS-named gate receipt resolves by the identity it records [0.88ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/summary-green.log` line 28 — (pass) 1146 — writeCloseSummary (R1/AC1/AC2) > 1237 R2: engine timings survive an unavailable host transcript [0.65ms]; fresh targeted run exited 0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — Run summaries report gate time and engine-emitted traces | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 84 — (pass) 1146 — gate receipt and batch roll-up > D65 1237 R1: a WBS-named gate receipt resolves by the identity it records [0.88ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/summary-green.log` line 28 — (pass) 1146 — writeCloseSummary (R1/AC1/AC2) > 1237 R2: engine timings survive an unavailable host transcript [0.65ms]; fresh targeted run exited 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: HIGH

#### Per-Requirement Traceability
| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | @run `.spur/run/d65-verifyall/app-tests.log` line 84 — (pass) 1146 — gate receipt and batch roll-up > D65 1237 R1: a WBS-named gate receipt resolves by the identity it records [0.88ms]; fresh targeted run exited 0 |
| R2 | MET | @run `.spur/run/d65-verifyall/summary-green.log` line 28 — (pass) 1146 — writeCloseSummary (R1/AC1/AC2) > 1237 R2: engine timings survive an unavailable host transcript [0.65ms]; fresh targeted run exited 0 |

#### Acceptance Criteria Verification
| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R7 — Run summaries report gate time and engine-emitted traces | MET | test | @run `.spur/run/d65-verifyall/app-tests.log` line 84 — (pass) 1146 — gate receipt and batch roll-up > D65 1237 R1: a WBS-named gate receipt resolves by the identity it records [0.88ms]; fresh targeted run exited 0; @run `.spur/run/d65-verifyall/summary-green.log` line 28 — (pass) 1146 — writeCloseSummary (R1/AC1/AC2) > 1237 R2: engine timings survive an unavailable host transcript [0.65ms]; fresh targeted run exited 0 |


#### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | functional/SECUA/architecture | docs/design/workflow-execution-foundation.md:19 | Inline review completed; requirement and AC evidence is listed above; prior verification blockers are resolved | RESOLVED |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T19:16:36.324Z todo → wip (system)
- 2026-10-17T19:16:36.819Z wip → testing (system)
- 2026-10-17T19:16:40.894Z testing → done (system)

