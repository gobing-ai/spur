---
template: issue
schema_version: 1
name: "Inventory Board action-runner patterns (FeatureDetail, TaskDetail jobs, Teams confirm, SSE)"
description: ""
status: todo
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-27T17:49:42.940Z"
updated_at: "2026-07-27T18:10:13.151Z"
---

## 0350. Inventory Board action-runner patterns (FeatureDetail, TaskDetail jobs, Teams confirm, SSE)

### Background
Wayfinder ticket for map F81. Type: **research** (`wayfinder:research`).

Operator wants async-by-default actions and better observability. Task board already enqueues actions via jobs; Features detail still uses `actionLoading` and awaits the HTTP call. Confirm patterns exist on Teams. This ticket maps the **existing** Board/server patterns so the async-runner decision (0352) is evidence-based.
### Requirements
R1. Document FeatureDetail action dispatch paths (sync HTTP, modals, cancel confirm, error via `api-error` custom event).

R2. Document TaskDetail / TaskService.fulfillAction job enqueue + queue.* system events and how the UI observes completion (if at all).

R3. Document Teams confirm-before-destructive patterns (stop/down modals).

R4. Document relevant SSE/system-event surfaces the Features shell already subscribes to (`feature.*`).

R5. Inventory only — no decision on which model Features adopts (that is 0352).
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
