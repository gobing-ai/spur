---
schema_version: 1
name: Prototype rest and GTD dispatch traces with capacity and restart failures
status: todo
template: feature-impl
created_at: 2026-09-11T18:07:39.271Z
updated_at: "2026-09-11T18:08:05.368Z"
feature_id: G6
priority: P1
tags:
  - wayfinder:prototype

dependencies: ["0828"]
---

## 0829. Prototype rest and GTD dispatch traces with capacity and restart failures

### Background

G6 needs evidence that a real orchestrator can use existing workflows while the harness enforces delivery, eligibility, and capacity. Consume the runtime/migration investigation before designing the prototype. Pending operator choices are modeled explicitly as assumptions or alternate traces; this task cannot approve autonomy scope.

### Requirements

- [ ] R1. Produce a local runnable simulation over the identified service seams for human request, hold/reply, assignment, task workflow outcome, and orchestrator result handling.
- [ ] R2. Exercise rest/dispatch races, persisted strategy across restart, duplicate requests/results, stale owner rejection, unavailable executors, blocked tasks, and exhausted capacity without live agents.
- [ ] R3. Demonstrate one write slot per project, exact concrete-instance assignment when roles repeat, no hot model polling, and no task completion inferred solely from process exit.
- [ ] R4. Publish traces and a minimal strategy extension contract that reuses existing task workflow/verification owners and identifies unresolved policy choices without inventing new runtime infrastructure.

### Acceptance Criteria

- [ ] R1: A runnable local prototype demonstrates the full request-to-result loop with fake executors and explicit correlation.
- [ ] R2: Saved traces cover all listed restart/race/failure cases and expose ambiguous outcomes rather than silently replaying them.
- [ ] R3: A regression check fails on double write-slot ownership, wrong instance dispatch, or process-exit-as-task-success.
- [ ] R4: The linked report names reused workflow owners, the minimal extension seam, assumptions, and remaining operator decisions.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

An isolated prototype/report is the deliverable. Default comparison is rest drains running work and GTD selects already-authorized eligible tasks, clearly labeled pending operator response. Keep transport, strategy disposition, run outcome, and task verification separate. Do not create a second workflow engine or modify production dispatch.

### Plan

1. Load the runtime inventory and current operator decisions from G6.
2. Build the smallest fake-executor simulation covering the proposed loop and state boundaries.
3. Run the failure/capacity traces and save commands and observable outcomes.
4. Report what existing services cover, what extensions remain necessary, and the policy decisions still requiring Robin.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
