---
schema_version: 1
name: "Batch execution model: per-task subagent isolation with parallel fan-out"
status: todo
template: issue
created_at: 2026-09-30T13:44:23.137Z
updated_at: "2026-09-30T14:00:40.900Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1017. Batch execution model: per-task subagent isolation with parallel fan-out

### Background

Filed from the A9 post-batch review (root causes RC2 + RC-E). The A9 batch ran 8 sequential task pipelines inside ONE host session: 23 compactions (context saturation), slower turns as context grew, and evidence loss forcing re-derivation loops (e.g., the post-compaction search for the P4 count-drift claim failed and had to be marked evidence-unavailable). Tasks also ran strictly sequentially although W0/W1 and parts of W2 were independent. Related prior work: 0931 (per-task worktrees with rebase, done), 0984 (`--task-file` single-task worktree finish), 1012 (persist-out forwards only the run record; task-cited artifacts were hand-copied — the evidence-forwarding gap this task closes).

### Requirements

- [ ] R1. Per-task pipeline execution in a fresh-context subagent: the host stays a thin orchestrator (resolve set → topo-sort → dispatch → collect verdicts); each child runs the task pipeline for ONE task and returns the verdict + artifact paths.
- [ ] R2. Evidence forwarding: the child's task-cited `.spur/run` artifacts (verdict.json, verify-answer, test-gate receipt, precheck/residuals/diffstat) land in the main tree automatically — extends 1012 persist-out to the full artifact set.
- [ ] R3. Parallel children get worktree isolation (builds on 0931); one writer per tree; tasks sharing a workspace serialize even when the dependency graph would allow parallelism.
- [ ] R4. Host context stays bounded: the orchestrator consumes only verdict summaries + artifact paths (no raw logs); target zero compactions during a ≤8-task batch.
- [ ] R5. Fan-out policy: parallel only when tasks have no dependency edge AND disjoint workspace footprints; max concurrency configurable (default 2).
- [ ] R6. Failure semantics: child failure → verdict FAIL recorded, dependents skipped per existing topo behavior, batch continues.
- [ ] R7. Acceptance dry-run: a 2-task independent batch executes concurrently, both evidence sets land in the main tree, and host compaction count is unchanged.
- [ ] R8. No new public CLI noun — orchestrator behavior extends the existing dev-runall/pipeline driver surfaces (ADR-065/130 public-surface consent respected).

### Acceptance Criteria

- [ ] AC1 — Orchestrator dispatches per-task children with fresh context and collects verdicts without ingesting raw logs (req: R1, R4)
- [ ] AC2 — Child evidence artifacts land in the main tree without manual copying (req: R2)
- [ ] AC3 — Independent tasks run concurrently with worktree isolation; workspace-sharing or dependent tasks serialize (req: R3, R5)
- [ ] AC4 — Child failure records FAIL and skips dependents without corrupting the batch (req: R6)
- [ ] AC5 — The 2-task dry-run meets R7 targets (req: R7)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Study `plugins/sp/skills/spur-dev/references/execution-batch.md` (batch driver loop) and the delegation contract for fresh-context children; decide child transport (subagent vs headless CLI) under the evidence-forwarding constraint.
2. Extend the inline-run-driver service: per-task dispatch + verdict/artifact collection (bounded orchestrator consumption, R4).
3. Implement full artifact persist-out (with 1012 — coordinate; 1012 owns the run-record half).
4. Concurrency policy + topo integration (R5): disjoint-footprint check, max concurrency, shared-workspace serialization.
5. Failure path (R6): verdict FAIL + dependent skip.
6. Tests: dispatch isolation, artifact landing, dependency/shared-workspace serialization, failure path.
7. Dogfood: 2-task independent batch dry-run; record concurrency + compaction count + stage timings vs the A9 baseline in Testing.

### Root Cause

Architectural: one long-lived host context accumulated eight pipelines' worth of state; compaction was the symptom, evidence re-derivation the recurring tax. Bounding context by construction — fresh context per task boundary — removes the failure mode instead of tuning it. Sequential-only execution then multiplied the same tax across tasks that were independent.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Unit tests per R5/R6 (+ artifact landing R2, orchestrator consumption R4).
- Dogfood dry-run (2 independent tasks): measured concurrency, both evidence sets in main tree, compaction count delta 0, timing vs A9 baseline.
- Coordinate receipts with 1016's two-tier gate so children inherit receipt reuse.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Siblings: 1012 (persist-out run-record half), 1016 (gate receipts), 0931 (per-task worktrees), 0984 (`--task-file` finish).
- `plugins/sp/skills/spur-dev/references/execution-batch.md`; `packages/app/tests/services/inline-run-driver.test.ts`.
- Session evidence: compact_count=23 at 2026-09-30; A9 wall 31.5h vs ~14–16h tool-active.
- Public-surface governance: `docs/design/harness-surface-governance.md` (R8 constraint).

### History
