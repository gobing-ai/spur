---
template: feature-impl
schema_version: 1
name: "Implement the stage-registry schema and types"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-1", "stage-registry", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.237Z"
updated_at: "2026-07-20T01:54:25.239Z"
---

## 0301. Implement the stage-registry schema and types

### Background

Wave-1 of feature O (implementation of spec ticket 0282). Build the canonical stage-registry schema: a typed, versioned declarative record describing each lifecycle stage. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0282, ~line 142) and docs/tasks2/0282_*.md. This is the dependency root — wave-2 envelope/adapter work references the stage identity this schema defines.

### Requirements
R1. Define the stage-record type with identity, version, aliases, typed inputs/outputs, artifacts, reasoning-skill reference, required references, deterministic gates, mutation class, timeout/retry, model eligibility/fallback, context layers, and observability fields (0282 R1).
R2. Encode the authority boundaries in the type: registry describes a stage; workflow owns sequencing/state; skill owns reasoning; CLI/scripts own deterministic mutation/validation; adapters own platform syntax only (0282 R2).
R3. Model the execution kinds inline / subprocess / deterministic-only / hitl / irreversible as a discriminated union that cannot claim current-agent execution for subprocess stages (0282 R4).
R4. Version the schema (major/minor compat rule: consumer at major N accepts N.x; required-field add/remove/rename is a new major; optional-field/alias add is minor) (0282 R1 + evidence extension rule).
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
