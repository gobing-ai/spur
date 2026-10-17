---
schema_version: 1
name: Report gate time and engine traces in run summaries
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.819Z
updated_at: "2026-10-17T16:13:27.932Z"
feature_id: D65
priority: P2
tags:
  - observability
  - workflow
estimate_hours: 2

---

## 1237. Report gate time and engine traces in run summaries

### Background

Feature D65 F7. gateFromReceipt looks for `.spur/run/${runId}-check-receipt.json` (run-summary-render.ts:199) but receipts are written as `<wbs>-check-receipt.json`, and run-summary.ts:598 hard-codes `gate: { ms: null }` — gate time has never been reported.

**Refine corrections (2026-10-17)**
- No corrections: run-summary-render.ts:199 (`${runId}-check-receipt.json`), quality-gate.ts:655/:914 (`<wbs>-check-receipt.json`) and run-summary.ts:598 (hard-coded null) confirmed.

### Requirements

- [ ] R1. Run summaries resolve the gate receipt by the run's wbs (and the gate builtin's receipt path when present) and report gate ms.
- [ ] R2. Engine-executed runs report stage times from action_runs without inline trace verbs.

### Acceptance Criteria

- [ ] AC1 — Run summaries report gate time and engine-emitted traces (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Root-cause fix in the shared lookup both callers use; no new artifact. Regression check: an E2E run summary over a fixture run with a real receipt shows non-null gate ms.

### Plan

- [ ] Fix lookup + remove hard-coded null
- [ ] Verify against an existing .spur/run receipt

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
