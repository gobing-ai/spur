---
schema_version: 1
name: "Harden runall batch WT-4: recheck main tip before FF, write merged marker only after ref move"
status: backlog
template: feature-impl
created_at: 2026-10-02T23:30:10.890Z
updated_at: "2026-10-02T23:30:23.481Z"
feature_id: D63

---

## 1059. Harden runall batch WT-4: recheck main tip before FF, write merged marker only after ref move

### Background

Session evidence (dogfood 2026-10-02-D62 runall batch, finding F1): the D62 batch FF was blocked twice by a concurrent writer committing to `main` mid-batch, and a `merged` worktree marker was written once before the merge ref actually moved, requiring a manual revert. Marker hygiene rule confirmed: the marker must reflect landed merges only. Direct fixes already applied in-session: none (recorded here intentionally). This task hardens the batch driver's WT-4 hop.

### Requirements

1. Before the WT-4 FF step, the driver re-reads the target branch tip and, if it moved since the batch base, reroutes to rebase-then-FF instead of a bare FF (disjoint-path check preserved).
2. The `merged` marker write is ordered strictly after the successful ref move, verified by reading the branch ref before flipping the marker.
3. The runbook text for WT-4 (plugins/sp skills reference, runall driver) carries both guards so inline and scripted drivers behave identically.

### Acceptance Criteria

- AC1: WT-4 procedure states an explicit pre-FF tip recheck with rebase fallback; grep for the recheck in the runall driver reference succeeds.
- AC2: WT-4 procedure states the marker flips only after a verified ref move; a simulated failed FF leaves the marker `active` in the runbook contract.

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
