---
template: feature-impl
schema_version: 1
name: "Implement the CLI-safe canonical task-section verb"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-1", "cli", "sections", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.288Z"
updated_at: "2026-07-20T01:54:25.289Z"
---

## 0304. Implement the CLI-safe canonical task-section verb

### Background

Wave-1 of feature O (0290 R4). Provide a CLI-safe way to initialize/add canonical (wayfinder) task sections or an approved template/variant, so corpus sections are created through the gate rather than hand-authored. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0290) and docs/tasks2/0290_*.md.

### Requirements
R1. Add a validated CLI path to initialize or add canonical task sections (or an approved template/variant) without direct file edits (0290 R4).
R2. Enforce the section matrix and task-write guard on the new path; reject unknown or out-of-order sections (0290 R5).
R3. Keep JSON schema, runtime, and help text in sync so the SSOT cannot drift (0290 R6).
R4. Provide acceptance tests and record how feature O sequencing is represented until the gap ships (0290 R8).
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
