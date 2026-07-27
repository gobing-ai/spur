---
template: issue
schema_version: 1
name: "Decide the observability contract for Features detail action lifecycle"
description: ""
status: todo
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0352"]
created_at: "2026-07-27T17:49:50.605Z"
updated_at: "2026-07-27T18:10:23.766Z"
---

## 0354. Decide the observability contract for Features detail action lifecycle

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Operator wants better observability of button-group action handling — track status and feedback effectively. Today: button-local `…` spinner and global `api-error` events.
### Requirements
R1. Define the observable lifecycle states for a feature action (e.g. confirmed → queued → running → succeeded | failed | cancelled) and where each is stored (client-only, system events, job row).

R2. Decide user-facing feedback surfaces on Board (in-panel banner, toast, activity stream, status chip on the feature) — minimum viable set for ship.

R3. Define correlation id / runId propagation from click → event stream → UI.

R4. State how failures surface (recoverable vs terminal) and whether partial results of sync/check are shown.

R5. Decision only. Depends on 0352 async model.
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
