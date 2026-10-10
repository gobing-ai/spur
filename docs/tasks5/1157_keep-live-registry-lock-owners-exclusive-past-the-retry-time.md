---
schema_version: 1
name: Keep live registry lock owners exclusive past the retry timeout
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:34.693Z
updated_at: "2026-10-10T07:29:38.764Z"
feature_id: K3

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
---

## 1157. Keep live registry lock owners exclusive past the retry timeout

### Background

withLock removes a live lock after 2.5 seconds, enters a second writer, and lets the former owner later remove the replacement lock Evidence: `packages/app/src/services/project-registry.ts:321` and `packages/app/src/services/project-registry.ts:337`. Review a71c confirmed this using two withLock callbacks with the first held pending longer than the retry window; second callback entered before first released. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Fail acquisition on contention timeout instead of breaking a live or unidentified owner; ensure release removes only its own claim
- [ ] R2. Short contention still waits and serializes registry mutations without lost updates
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given a live registry lock owner whose work exceeds the retry budget
  When another writer attempts to acquire the lock
  Then the second callback cannot enter concurrently and cannot delete the live claim

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given a short-lived first writer followed by a queued registry update
  When the existing supported operation executes
  Then Short contention still waits and serializes registry mutations without lost updates
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Fail acquisition on contention timeout instead of breaking a live or unidentified owner; ensure release removes only its own claim Chosen direction follows the existing local seams. Reject elapsed time alone as evidence that a lock is stale. Targets: packages/app/src/services/project-registry.ts; packages/app/tests/services/project-registry.test.ts. Out of scope: new lock dependencies, changing registry schemas, unrelated process cleanup.

### Plan

1. Add a failing regression for AC1 using two withLock callbacks with the first held pending longer than the retry window; second callback entered before first released.
2. Implement the chosen direction in packages/app/src/services/project-registry.ts; packages/app/tests/services/project-registry.test.ts.
3. Run tests/services/project-registry.test.ts from its workspace and confirm AC1 plus existing happy paths; run the project gate.

If retaining stale-lock recovery is necessary, record owner identity and recover only proven dead claims. Reproduce the original holder releasing after a second acquisition attempt.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`packages/app/src/services/project-registry.ts:321` and `packages/app/src/services/project-registry.ts:337`

### History

- 2026-10-10T07:29:38.764Z backlog → todo (system)

