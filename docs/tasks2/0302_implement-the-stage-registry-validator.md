---
template: feature-impl
schema_version: 1
name: "Implement the stage-registry validator"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-1", "stage-registry", "validation", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.274Z"
updated_at: "2026-07-20T01:54:25.274Z"
---

## 0302. Implement the stage-registry validator

### Background

Wave-1 of feature O (0282 R3). Compile-time/load-time validation of the registry graph from the sibling schema task. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0282) and docs/tasks2/0282_*.md.

### Requirements
R1. Validate the whole registry graph at load time and reject before execution (0282 R3 + AC2).
R2. Cross-reference checks that fail with actionable diagnostics for missing skills, commands, gates, workflows, adapters, or artifact paths (0282 R3).
R3. Reject cyclic transitions, unknown gates, unsupported transitions, and incompatible model policy before any corpus mutation or agent invocation (0282 AC2).
R4. Emit the same stage/run identifiers for observability on both pass and fail paths (0282 Design).
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
