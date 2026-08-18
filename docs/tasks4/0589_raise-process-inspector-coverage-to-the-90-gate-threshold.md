---
template: issue
schema_version: 1
name: "Raise process-inspector coverage to the 90% gate threshold"
description: ""
status: cancelled
type: issue
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-18T17:17:41.050Z"
updated_at: "2026-08-18T17:45:35.966Z"
---

## 0589. Raise process-inspector coverage to the 90% gate threshold

### Background
**CANCELLED 2026-08-18 — the finding was false.**

This task was opened from task 0587's verify run, which read
`packages/app/src/services/process-inspector.ts` at 83.95% line coverage against the 90%
`coverage-gate` threshold (uncovered region `:126-138`, the `defaultRunPs` shell-out) and reported
`bun run spur-check` red.

That reading was a **sandbox artifact**. `apps/server/tests/context.test.ts:385` exercises
`defaultRunPs` for real — `ctx.processInventory().snapshot()` shells out to `ps` — and self-skips
when process spawn is unavailable:

```
if (!processSpawnAvailable()) {
    console.warn('[SKIP:spawn-denied] Spawning `ps` is denied in this environment. This process-inventory test executes in CI unsandboxed.');
    return;
}
```

Under the agent sandbox that guard fires, the region goes uncovered, and the gate reports a gap that
does not exist. Unsandboxed and in CI the file measures 100/100 and `spur-check` is green — confirmed
by the operator against a real run.

No work is required. Kept as a record of the diagnosis, not as a backlog item.

Standing lesson: before treating a coverage or gate failure under the sandbox as a defect, check the
suite for `[SKIP:*]` guards — the same trap as the `[SKIP:port-bind-denied]` port/serve suites.
### Requirements
N/A — task cancelled; the finding it was opened for does not reproduce outside the sandbox.
### Acceptance Criteria
N/A — task cancelled; the finding it was opened for does not reproduce outside the sandbox.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-18T17:43:36.063Z todo → cancelled (system)
