---
template: feature-impl
schema_version: 1
name: "Implement the CLI-safe task dependency mutation verb"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-1", "cli", "dependencies", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.281Z"
updated_at: "2026-07-20T01:54:25.282Z"
---

## 0303. Implement the CLI-safe task dependency mutation verb

### Background

Wave-1 of feature O (implementation of spec ticket 0290). Add a validated CLI verb to mutate task dependencies[] without direct frontmatter edits, closing the gap that currently blocks machine-safe dependency wiring. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0290) and docs/tasks2/0290_*.md.

### Requirements
R1. Support dependency operations set/add/remove/clear via a single validated verb, with WBS-existence, self-edge, cycle, and duplicate validation (0290 R2).
R2. Make each operation atomic, emit machine-readable JSON output, and define stable exit codes for each failure class (0290 R2).
R3. Preserve the task-write guard, section matrix, history/update timestamps, lifecycle readiness, feature refresh, and backwards compatibility (0290 R5).
R4. Define migration behavior for existing direct-authored dependency arrays (0290 R7).
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
