---
template: issue
schema_version: 1
name: "Decide the confirmation matrix for Features detail actions"
description: ""
status: todo
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0351", "0352"]
created_at: "2026-07-27T17:49:48.949Z"
updated_at: "2026-07-27T18:10:21.188Z"
---

## 0353. Decide the confirmation matrix for Features detail actions

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Important lifecycle ops must not fire accidentally. Cancel already confirms; most FSM transitions do not. Decide the confirmation matrix for the action group.
### Requirements
R1. For every operation retained in 0351 (primary + overflow), decide: no confirm | soft confirm (modal) | hard confirm (type name / explicit risk copy).

R2. Specify confirm copy requirements for destructive ops (cancel, rework, push-sync that rewrites status, move if in group).

R3. State interaction with async runner (0352): confirm **before** enqueue, never after.

R4. Decision only. Depends on 0351 membership and 0352 runner (ordering of confirm vs enqueue).
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
