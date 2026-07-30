---
template: feature-impl
schema_version: 1
name: "Server feature-action job consumer and action handler cutover"
description: ""
status: todo
type: task
profile: standard
feature_id: F83
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-29T23:22:42.905Z"
updated_at: "2026-07-29T23:23:31.513Z"
---

## 0386. Server feature-action job consumer and action handler cutover

### Background
Implements: R1 — Feature action enqueue returns runId and queued status
Implements: R6 — check remains the sole synchronous exception

Parent F83. Depends on contract + FeatureService.fulfillAction (0385). Un-stubs the server feature action handler and registers feature-action beside task-action.

Server half of R1; check endpoint remains synchronous (R6).

Rubric: E4 D1 L2 C1 R1 = 9 → decompose child (server job + consumer).
### Requirements
- [ ] R1. Register job kind `feature-action` and `runFeatureActionJob` consumer parallel to `task-action` / `runTaskActionJob`.
- [ ] R2. Cut over `os.feature.action.handler` from the empty stub to FeatureService.fulfillAction with jobQueue.enqueue('feature-action', job).
- [ ] R3. Successful jobs emit/allow feature.updated (or equivalent) so the detail panel can refresh; failures mark the job failed (queue.job.failed).
- [ ] R4. check endpoint remains synchronous and does not enqueue feature-action.
- [ ] R5. Server tests cover enqueue response shape and reject path for unknown feature.
### Acceptance Criteria
```gherkin
Scenario: R1 — Feature action enqueue returns runId and queued status
  Given a running serve context with job queue
  When POST /features/{id}/action dispatches a supported action
  Then response data has runId and status queued
  And a feature-action job is enqueued

Scenario: R6 — check remains the sole synchronous exception
  Given the feature check endpoint
  When check is invoked
  Then it does not enqueue a feature-action job
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Approach: Copy the task-action wiring pattern in apps/server/src/serve.ts and task handlers; map brainstorm/plan to real spur/agent command strings (same channel options as input schema).
Rejected: In-process fire-and-forget without queue (loses durability and SSE lifecycle).
Invariants: jobId returned to client equals FeatureActionResponse.runId; no new transport.
### Plan
1. Define FEATURE_ACTION_JOB + payload validation.
2. Implement runFeatureActionJob command dispatch.
3. Wire handler through fulfillAction + jobQueue.
4. Tests for handler + consumer happy/fail paths.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

F83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
