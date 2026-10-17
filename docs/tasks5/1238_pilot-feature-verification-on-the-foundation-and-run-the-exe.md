---
schema_version: 1
name: Pilot feature-verification on the foundation and run the executor matrix
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.819Z
updated_at: "2026-10-17T16:13:28.982Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - fleet
  - e2e
estimate_hours: 6

dependencies: ["1232", "1233", "1235", "1236", "1237", "1224"]
---

## 1238. Pilot feature-verification on the foundation and run the executor matrix

### Background

Feature D65 P1 exit. feature-verification.yaml has no agent.run (one shell verify state), so it pilots F1/F4/F6/F7; the executor matrix runs on a tracked fixture workflow with one agent.run and one decision gate. scripts/commands/fleet-e2e.ts (task 1077) already scaffolds a scratch project, stubs the model binary on PATH and writes docs/reports/fleet-e2e-receipt.json.

**Refine corrections (2026-10-17)**
- "pilots F1" → feature-verification.yaml already runs on the engine (invoked by feature-lifecycle; runner packages/app/src/workflow/feature-verification-run.ts) → pilot = its verify step via command.gate, the gate lock and gate time.
- R3 "fleet column blocked when agent.fleet.enabled / spur serve absent" → fleet-e2e.ts scaffolds its own scratch fleet (real agent loop, stub model on PATH) → fleet column runs self-contained; blocked only if scaffolding itself fails.
- A92 bumps feature-verification.yaml to version "2" with verificationCmd "spur self exec check-feature" → build on that version.

### Requirements

- [ ] R1. feature-verification (A92 version "2") runs its verify step as a command.gate action with the `check-feature` action under the full-gate lock; outcomes and status file are unchanged and gate time appears in the run summary.
- [ ] R2. A tracked fixture workflow (one agent.run, one decision gate) runs E2E under host, subprocess and fleet; traces and receipts are identical in shape across executors.
- [ ] R3. The matrix is a mode of scripts/commands/fleet-e2e.ts writing a repeatable receipt under docs/reports/; the fleet column uses fleet-e2e's scratch fleet and reports blocked only with the failed scaffolding precondition.

### Acceptance Criteria

- [ ] AC1 — Feature verification runs on the foundation (req: R1)
- [ ] AC2 — The executor matrix shows identical traces across executors (req: R2, R3)
- [ ] AC3 — Foundation tasks depend on the A92 action map

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Reuse fleet-e2e.ts scaffolding (`bun scripts/spur-dev.ts fleet-e2e`) instead of a new harness; add a matrix mode that runs the fixture under `vars.executor` = host | unset (subprocess) | fleet. Fixture lives beside the shipped workflows' test fixtures, not in config/workflows. Depends on A92 task 1224 (`check-feature` routing). The matrix receipt is the feature's repeatable E2E artifact.

### Plan

- [ ] Port feature-verification verify to command.gate on the A92 version
- [ ] Author fixture workflow
- [ ] Matrix mode in fleet-e2e.ts + receipt
- [ ] Run matrix; record any blocked precondition honestly

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
