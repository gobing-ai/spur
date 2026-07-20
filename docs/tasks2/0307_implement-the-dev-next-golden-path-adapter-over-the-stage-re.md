---
template: feature-impl
schema_version: 1
name: "Implement the dev-next golden-path adapter over the stage registry"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "dev-next", "golden-path", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.462Z"
updated_at: "2026-07-20T03:32:22.462Z"
---

## 0307. Implement the dev-next golden-path adapter over the stage registry

### Background

Wave-2 of feature O (implementation of spec ticket 0283, dependency tier 2 — routes to the stage registry from wave-1). Preserve dev-next as the one-dispatch status-aware facade over canonical stages. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0283, ~line 163) and docs/tasks2/0283_*.md.

### Requirements
R1. Implement dev-next as a status-aware facade that resolves a task WBS or feature frontier, evaluates objective readiness and blockers, chooses at most one eligible stage, and reports current state, selected stage, reason, required confirmation/blocker, and next observable outcome (0283 R2/R3 + evidence:165).
R2. Preserve the invariants: one-primary-dispatch, multi-candidate HITL stop (bounded recommendation or required choice, never a recursive self-loop), child-owned `--next` chains, explicit overrides, and non-routes (0283 R3 + AC2).
R3. Keep specialist `/sp:dev-*` commands as thin compatibility/escape-hatch adapters that delegate lifecycle semantics — never parallel routers duplicating domain logic (0283 R3).
R4. Implement discoverability, help, error, dry-run/explain, and compatibility behavior so golden-path users need no workflow internals (0283 R5).
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
