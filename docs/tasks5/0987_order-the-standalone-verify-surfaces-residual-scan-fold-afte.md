---
schema_version: 1
name: Order the standalone verify surfaces' residual-scan fold after record flips
status: backlog
template: feature-impl
created_at: 2026-09-27T20:48:32.768Z
updated_at: "2026-09-27T20:49:04.584Z"
feature_id: F96

---

## 0987. Order the standalone verify surfaces' residual-scan fold after record flips

### Background

0983 reordered the pipeline FSM: `residual-scan scan|fold` now runs in the `record` state AFTER `spur task record` flips verdict-proven Requirement/AC boxes, so a PASS verdict with proven boxes no longer folds PARTIAL (0967 root cause). The standalone surfaces — `/sp:dev-verify` (`plugins/sp/commands/dev-verify.md:43-46`) and `/sp:dev-verifyall` (`plugins/sp/commands/dev-verifyall.md:76-78`) — still run scan+fold before `spur task record`/the done transition, so the same under-crediting survives there: a clean task with unticked-but-verdict-proven R/AC boxes folds PASS→PARTIAL and `foldVerdict` never restores PARTIAL→PASS. `docs/design/task-residual-sweep.md` (rule owner) documents both orders; the standalone one is pending this fix.

### Requirements

- [ ] R1. `/sp:dev-verify` runs its residual scan+fold only after its `spur task record` step has applied verdict-driven box flips (or explicitly documents + guards the standalone-only rationale if record is out of scope for that command).
- [ ] R2. `/sp:dev-verifyall` gets the same ordering treatment.
- [ ] R3. `docs/design/task-residual-sweep.md` mode table + terminal-path table match the shipped standalone order.
- [ ] R4. A regression test or scripted check pins the standalone ordering for both surfaces.

### Acceptance Criteria

- [ ] AC1 — Standalone verify of a clean task with unticked-but-proven boxes no longer downgrades PASS→PARTIAL (req: R1, R2)
- [ ] AC2 — Rule-owner doc matches shipped order on both surfaces (req: R3)
- [ ] AC3 — Ordering pinned by a check (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
