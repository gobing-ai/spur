---
template: issue
schema_version: 1
name: "Decide which operations belong on the Features detail action group per status"
description: ""
status: todo
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0349"]
created_at: "2026-07-27T17:49:44.771Z"
updated_at: "2026-07-27T18:10:17.581Z"
---

## 0351. Decide which operations belong on the Features detail action group per status

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Given the ops inventory (0349), decide which operations appear on the Features **detail** action group, for each feature status: primary row, overflow, or never (elsewhere only). This is the membership matrix the UI redesign binds to.
### Requirements
R1. Produce a per-status matrix: operation → primary | overflow | never, with one-line reason each.

R2. Explicitly place at least: FSM transitions (start/verify/complete/rework/block/unblock/cancel), sync (and pull vs push), check, advance, move, refresh, brainstorm, plan, add-child, add-task, link-task.

R3. State default for newly discovered ops from 0349 not listed in R2.

R4. Do not implement UI. Do not decide async/confirm details (0352/0353) beyond noting ops that are inherently expensive or destructive.

R5. Record the matrix in the task Solution; map Decisions so far gets a one-line gist on close.
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
