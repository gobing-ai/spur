---
template: standard
schema_version: 1
name: "0176 Wave D: prompt slimming and pipeline consolidation"
description: ""
status: todo
type: task
profile: standard
feature_id: null
parent_wbs: "0176"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-02T06:29:12.250Z"
updated_at: "2026-07-02T06:33:38.638Z"
---

## 0180. 0176 Wave D: prompt slimming and pipeline consolidation

### Background

Child task for 0176 Wave D. Fix F8, F9, and F10: duplicated/contradictory agent prompts, overlapping planning/idea pipeline ownership, embedded shell status ladders, and stale review-skill numbering.

### Requirements
- R1. Shrink workflow `agent.run` prompts so skills own criteria and formats; workflows should dispatch skills and artifact contracts.
- R2. Align decomposition prompts with the actual task-batch schema fields.
- R3. Replace planning-pipeline feature-id prose with `spur feature create`, or retire planning-pipeline if superseded by idea-pipeline.
- R4. Decide and record the fate of planning-pipeline before making broad edits to its behavior.
- R5. Promote wrapup feature status ladder behavior to a CLI verb or explicitly defer it with rationale.
- R6. Renumber or anchor `sp:code-verification` review-mode steps and fix stale references in related review docs.
- R7. Sync authoritative design docs for any CLI-surface change.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
