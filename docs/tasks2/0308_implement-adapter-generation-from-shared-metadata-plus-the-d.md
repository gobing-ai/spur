---
template: feature-impl
schema_version: 1
name: "Implement adapter generation from shared metadata plus the drift-test contract"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "adapters", "drift-test", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.469Z"
updated_at: "2026-07-20T03:32:22.469Z"
---

## 0308. Implement adapter generation from shared metadata plus the drift-test contract

### Background

Wave-2 of feature O (0283 R4/R8, dependency tier 2). Generate/validate Claude Code slash and Codex dollar-skill adapters from common command metadata, plus the drift-test contract that keeps them honest. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0283) and docs/tasks2/0283_*.md.

### Requirements
R1. Implement generation/validation of Claude Code `/sp:dev-*` slash and Codex `$sp-dev-*` skill wrappers from shared command metadata (name, argument-hint, allowed-tools, skill target) (0283 R4).
R2. Enforce that wrappers carry invocation syntax + the delegation line only — no domain workflow prose; lifecycle semantics live in the dispatched skill (0283 R4).
R3. Implement the drift-test contract: (a) contract test — every wrapper's skill target exists and resolves; (b) metadata-parity test — slash vs dollar-skill wrappers over the same command carry identical name/argument-hint; (c) no-prose test — wrapper bodies contain no lifecycle prose beyond the delegation line (grep gate) (0283 R8).
R4. Implement platform/skill snapshot invalidation (a command's `.md` snapshotted at session start runs the stale body; adapters version the snapshot and a fresh session is required to trust an in-session dogfood of a just-edited command) (0283 R7).
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
