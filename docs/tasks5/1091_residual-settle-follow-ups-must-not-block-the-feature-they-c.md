---
schema_version: 1
name: Residual-settle follow-ups must not block the feature they came from
status: backlog
template: standard
created_at: 2026-10-05T02:56:39.064Z
updated_at: "2026-10-05T02:56:47.606Z"

feature_id: F96
---

## 1091. Residual-settle follow-ups must not block the feature they came from

### Background

Task 1085's record hop ran `residual-scan settle`, which filed a follow-up for the two operator-deferred P3 findings (`residual-settle: filed follow-up 1086 for 2 deferred item(s)`) and linked it to the feature the run had just completed (E72). E72 then failed its done-gate with `L4.verifying-incomplete-tasks … 1 linked task(s) are not done/cancelled: 1086`, so closing E72 required re-homing the follow-up into a new root feature (`O`) — an operator-visible dead end: the act of deferring a residual made the feature unclosable.

AC-subset note: the scenario below is new for F96's AC; add it there when this task is refined.

### Requirements

- [ ] R1. A follow-up filed by residual settle is not linked to the feature whose run produced it (file it unlinked, or under an explicitly named follow-up feature).
- [ ] R2. The deferral stays recorded: the follow-up cites the source task and the review dispositions, and the source feature can reach `done` while it stays open.
- [ ] R3. A regression test covers the settle path with a deferred finding.

### Acceptance Criteria

- [ ] AC1 — A feature closes while its run's deferred residuals stay open

Task-local verification: a settle fixture with one deferred P3 files the follow-up, and `feature check <feature> --strict --as done` on the completing feature reports no `L4.verifying-incomplete-tasks`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: change the filing site (`residual-scan` settle / its step wrapper) so the follow-up carries no feature edge by default; keep the source-task citation in its Background.
- Alternative if an edge is wanted: a dedicated follow-up feature named by the caller, never the completing feature.
- Invariants: deferrals are still non-blocking for the source run's own gate; no change to scan/fold classification.

### Plan

- [ ] 1. Reproduce with a fixture: deferred finding → follow-up task linked to the completing feature → `feature check --as done` fails.
- [ ] 2. Change the linkage in the settle path.
- [ ] 3. Regression test on the settle path.
- [ ] 4. Gates: `(cd packages/app && bun test tests/services/residual-scan.test.ts)`, `bun run typecheck`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
