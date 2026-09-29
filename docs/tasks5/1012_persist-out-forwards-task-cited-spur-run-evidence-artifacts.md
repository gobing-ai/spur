---
schema_version: 1
name: persist-out forwards task-cited .spur/run evidence artifacts
status: backlog
template: feature-impl
created_at: 2026-09-29T18:18:18.307Z
updated_at: "2026-09-29T18:20:46.766Z"
feature_id: A9

ac_altitude: task-local
---

## 1012. persist-out forwards task-cited .spur/run evidence artifacts

### Background

Observed during run 785c3ca9-fa8e-4ea8-b75e-81ccac2db600 (task 1008, WT-4 finish per task 0975 R1 / 0984 R2): `inline-run-setup.ts --persist-out --from <worktree> --task-file <f>` copied the run record (state.json + runId.md) into the main tree's `.spur/run/`, but NOT the evidence artifacts cited by the task file (`1008-verdict.json`, gate logs, review/verify answers, digests). All of them lived only in the gitignored worktree `.spur/run/` and would have been destroyed by worktree removal — they had to be hand-copied. The persist-out contract as implemented covers run rows only; task-cited evidence forwarding is the gap.

### Requirements

- **R1 (evidence forwarding)** — persist-out additionally copies the `.spur/run/` evidence files cited by the forwarded task file (e.g. `<wbs>-verdict.json`, gate logs, answers, digests) from the source tree into the target tree.
- **R2 (safe re-run)** — forwarding is idempotent: existing target files with identical content are skipped; differing content is reported, never silently overwritten.

### Acceptance Criteria

- [ ] AC1 — persist-out forwards task-cited `.spur/run/` evidence artifacts alongside the run record (req: R1)
- [ ] AC2 — Re-running persist-out is idempotent; conflicting target content is reported, not overwritten (req: R2)

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
