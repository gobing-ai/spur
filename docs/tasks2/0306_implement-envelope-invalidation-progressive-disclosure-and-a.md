---
template: feature-impl
schema_version: 1
name: "Implement envelope invalidation, progressive disclosure, and attribution instrumentation"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "context-envelope", "invalidation", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.455Z"
updated_at: "2026-07-20T03:32:22.455Z"
---

## 0306. Implement envelope invalidation, progressive disclosure, and attribution instrumentation

### Background

Wave-2 of feature O (0284 R3-R6, dependency tier 2). Per-layer invalidation, reference routing that keeps safety/gate contracts mandatory-inline, and fresh-vs-reused attribution. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0284) and docs/tasks2/0284_*.md.

### Requirements
R1. Implement per-layer, fingerprint-driven invalidation triggers for corpus updates (mtime+hash), git changes (worktree SHA), config/model changes (config hash + model id), skill/reference version changes (manifest version), gate results (verdict-artifact hash), and tool outputs (never cached across stages) (0284 R3).
R2. Implement reference routing / progressive disclosure where optional references go through handles with explicit triggers and budgets, but safety, authorization, requirements-traceability, and mutation-gate contracts are mandatory inline layers that a cheap model cannot defer or omit (0284 R4).
R3. Enforce session/subprocess boundaries: inline stages may reuse captured stable layers within one dispatch; subprocess (`spur agent run`) stages start fresh and may only cross the boundary via fingerprinted on-disk artifacts whose invalidation fingerprint still matches (0284 R5).
R4. Implement instrumentation attributing fresh vs reused Spur layers by content-hash comparison, labeling provider cache dimensions only from verified raw usage (0281), never fabricating host cache hits when telemetry is absent (0284 R6).
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
