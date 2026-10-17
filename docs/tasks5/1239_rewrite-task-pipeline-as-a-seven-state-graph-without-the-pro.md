---
schema_version: 1
name: Rewrite task-pipeline as a seven-state graph without the proof chain
status: todo
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-17T16:13:29.797Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - task-pipeline
estimate_hours: 8

dependencies: ["1238", "1224"]
---

## 1239. Rewrite task-pipeline as a seven-state graph without the proof chain

### Background

Feature D65 P2. task-pipeline has 16 states; the test-fix loop (~450 min) exceeds implement (356 min) and verifiedOutcome was reached on 4/274 tasks. Target: precheck → implement (exit on green light gate) ⇄ escalate → gate ⇄ remediate → review (+AC traceability) → [approve] → done|failed|cancelled.

**Refine corrections (2026-10-17)**
- "enumerate verifiedOutcome readers" → consumers found: packages/app/src/services/history-service.ts, packages/domain/src/analytics/render-report.ts, packages/domain/src/analytics/artifact.ts → each must tolerate the field's absence (history keeps old runs).
- "gate builtin" → command.gate invoking `spur task gate` (task 1234 correction).

### Requirements

- [ ] R1. Routing states (triage, test-fail-triage, review-fail-triage) become decision calls on transitions using the existing catalog decisions.
- [ ] R2. test/test-recheck merge into one gate state (command.gate → `spur task gate`, mode by visit/receipt, tree-hash reuse, full-gate lock); verify merges into review (sp:functional-review R→file:line).
- [ ] R3. The proof chain is removed: proofDigest/fingerprint, receipt preconditions, verifiedOutcome production, the record stage (→ deterministic done onEnter); evidence = tree-hash gate receipt + review verdict. history-service.ts, render-report.ts and artifact.ts tolerate absent verifiedOutcome.
- [ ] R4. The run executes on every executor and passes the matrix on a real task.

### Acceptance Criteria

- [ ] AC1 — The task pipeline runs as a seven-state graph without the proof chain (req: R1, R2, R3, R4)
- [ ] AC2 — A passing gate receipt is reused while the tree hash is unchanged (req: R2)
- [ ] AC3 — Foundation tasks depend on the A92 action map

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

One YAML rewrite consuming command.gate, the lock and decision gates; A92 task 1224 edits the same gate vars, so this lands after it. Deleting the proof chain retires ADR-071 machinery per ADR-140; the three verifiedOutcome consumers (history-service.ts, render-report.ts, artifact.ts) treat absence as "not reported", not failure, so historical runs keep rendering. Rejected: keeping verifiedOutcome as a derived field (it measured 4/274 and the operator skips it).

### Plan

- [ ] Enumerate consumers of proof-chain fields
- [ ] Rewrite YAML; validate + self-contained lint
- [ ] Run one real task E2E under host and subprocess; fleet when available

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
