---
template: issue
schema_version: 1
name: "Decide the unified async action-runner model for Features detail actions"
description: ""
status: todo
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0350"]
created_at: "2026-07-27T17:49:46.654Z"
updated_at: "2026-07-27T18:10:19.153Z"
---

## 0352. Decide the unified async action-runner model for Features detail actions

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Most feature actions are time-consuming; the operator wants **async-by-default** and a **unified** way to handle all button-group triggers so the UI does not block. Task board already has a job path; Features does not.
### Requirements
R1. Decide the unified action-runner model for Features detail: (A) extend task-style job queue to feature actions, (B) client fire-and-forget with optimistic UI + SSE, (C) hybrid (sync for cheap FSM, async for agent/sync/check), or a named third option.

R2. Define the request/response contract the Board uses after click (e.g. `{ runId, status: queued }`) and what "done" means for the user still on the page vs navigated away.

R3. State which ops may remain synchronous exceptions (if any) and why.

R4. Bound reuse of TaskService.fulfillAction vs a new FeatureService.fulfillAction / shared ActionRunner.

R5. Decision only — no implementation. Depends on 0350 patterns inventory.
### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

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
