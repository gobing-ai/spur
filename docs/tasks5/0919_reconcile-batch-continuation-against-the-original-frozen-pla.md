---
schema_version: 1
name: Reconcile batch continuation against the original frozen plan
status: blocked
template: standard
created_at: 2026-09-22T02:56:46.302Z
updated_at: "2026-09-22T02:58:02.026Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w06
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0914", "0915"]
---

## 0919. Reconcile batch continuation against the original frozen plan

### Background

The batch driver already freezes membership, topologically orders tasks, persists results and reads session checkpoints. Its documented latest-checkpoint read needs identity-sensitive reconciliation so unrelated newer memory cannot become authoritative. Reuse the existing batch reports/worktree markers and child receipts. Covers proposed feature R6. Depends on W01 and W02.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W06 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Bind continuation to the original selector, project/worktree identity, frozen task membership/order and the corresponding child-run evidence.
- [ ] R2. Treat session checkpoints as hints: ignore unrelated newer checkpoints and reconcile current task metadata and child proof before skipping or repeating work.
- [ ] R3. Keep dependency-correct sequential execution as default and existing opt-in isolated parallel execution with one writer per tree.
- [ ] R4. Preserve evidence in the invoking tree before worktree cleanup and report partial, blocked, failed and stale results explicitly.

### Acceptance Criteria

- [ ] AC1 — A resumed batch keeps its original membership and worktree identity even when task listings or newer unrelated checkpoints differ. (req: R1)
- [ ] AC2 — Only a reconciled current child result is skipped; stale or mismatched evidence produces an explicit recheck/block outcome. (req: R2)
- [ ] AC3 — Ordering and write ownership remain correct for sequential and opt-in independent parallel fixtures. (req: R3)
- [ ] AC4 — Partial outcomes and invoking-tree evidence survive worktree cleanup without being reported as a completed batch. (req: R4)
- [ ] AC5 — Batch continuation uses the original authorized set (req: R1)

Feature-level traceability: this task delivers D63 scenario R6; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend or validate the existing frozen plan/report/checkpoint artifacts only where a concrete gap is reproduced. Do not introduce a batch YAML, coordinator daemon, new status machine or parallel ledger. Freshly listed tasks do not join a resumed batch implicitly. A changed dependency/spec may invalidate admission and require re-planning; it cannot silently rewrite the authorized frozen set. G66 member persistence is an execution substrate, not proof of per-task result validity.

### Plan

- [ ] 1. Trace current freeze, checkpoint, worktree marker and report persistence and reproduce an identity/reconciliation gap.
- [ ] 2. Fix the shared continuation boundary and use existing run/receipt APIs for child-result checks.
- [ ] 3. Exercise unrelated checkpoint, task added after freeze, changed dependencies, stale child PASS, lost worktree and mixed terminal results.
- [ ] 4. Update runall/parallel/next guidance and verify evidence preservation and isolated opt-in execution.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:02.026Z todo → blocked (system)

