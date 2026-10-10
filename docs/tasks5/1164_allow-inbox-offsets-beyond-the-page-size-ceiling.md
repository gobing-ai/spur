---
schema_version: 1
name: Allow inbox offsets beyond the page-size ceiling
status: todo
template: feature-impl
created_at: 2026-10-10T07:30:38.183Z
updated_at: "2026-10-10T07:30:43.875Z"
feature_id: G1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
---

## 1164. Allow inbox offsets beyond the page-size ceiling

### Background

Inbox offset reuses parseLimit and clamps offsets above 500, causing repeated pages instead of older messages Evidence: `apps/server/src/modules/messages/index.ts:35` and `apps/server/src/modules/messages/index.ts:145`. Review a71c confirmed this using actual Hono requests with offsets 500, 550 and 1000 all forwarded offset 500 through an injected service. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Parse offset independently as a nonnegative safe integer without the limit ceiling, retaining the 500 maximum for page size
- [ ] R2. Missing offset remains undefined, invalid or negative offset falls back to zero, and page limits remain capped at 500
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given an inbox with more than 1000 messages and requests for offsets 500, 550 and 1000
  When the Hono inbox route forwards pagination to coordination.getInbox
  Then each valid offset is forwarded unchanged and successive pages remain distinct

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given missing, invalid and negative offsets and an excessive page limit
  When the existing supported operation executes
  Then Missing offset remains undefined, invalid or negative offset falls back to zero, and page limits remain capped at 500
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Parse offset independently as a nonnegative safe integer without the limit ceiling, retaining the 500 maximum for page size Chosen direction follows the existing local seams. Reject raising a shared cap because it still breaks sufficiently large offsets and changes limit behavior. Targets: apps/server/src/modules/messages/index.ts; apps/server/tests/modules/messages/index.test.ts. Out of scope: new query flags, response shape changes, inbox persistence redesign.

### Plan

1. Add a failing regression for AC1 using actual Hono requests with offsets 500, 550 and 1000 all forwarded offset 500 through an injected service.
2. Implement the chosen direction in apps/server/src/modules/messages/index.ts; apps/server/tests/modules/messages/index.test.ts.
3. Run tests/modules/messages/index.test.ts from its workspace and confirm AC1 plus existing happy paths; run the project gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`apps/server/src/modules/messages/index.ts:35` and `apps/server/src/modules/messages/index.ts:145`

### History

- 2026-10-10T07:30:43.875Z backlog → todo (system)

