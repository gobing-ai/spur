---
template: feature-impl
schema_version: 1
name: "Implement context-envelope layers and canonical serialization"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "context-envelope", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.423Z"
updated_at: "2026-07-20T03:32:22.425Z"
---

## 0305. Implement context-envelope layers and canonical serialization

### Background

Wave-2 of feature O (implementation of spec ticket 0284, dependency tier 2 — references the stage identity from wave-1 task 0301). Build the typed envelope layers and their canonical serialization/order so stable content prefixes volatile and every layer is fingerprinted. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0284, ~line 188) and docs/tasks2/0284_*.md.

### Requirements
R1. Define each envelope layer as a typed record with canonical serialization/order (stable-first then volatile), size budget, content hash, provenance (owner, schema version, source revision, generated-at), and a cacheability classification (stable-prefix-eligible vs volatile) (0284 R1).
R2. Implement the ordered stack: harness policy, project authority, stage contract, feature/task state, indexed evidence, run state, volatile tool observations (0284 R1 + evidence:190).
R3. Implement minimal project/task snapshot schemas obtained via targeted `--json` verbs (`spur task show <wbs> --json`, `spur feature show <id> --json`, `spur status --json`), fingerprinted by content hash, never a full-file reread (0284 R2).
R4. Provide representative envelope assemblies for the refine, implement, review, verify, and dogfood stages, selecting required vs optional-disclosure layers per stage mutation class and gate set (0284 R7).
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
