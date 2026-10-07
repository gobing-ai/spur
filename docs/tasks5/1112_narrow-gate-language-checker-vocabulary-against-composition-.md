---
schema_version: 1
name: Narrow gate-language checker vocabulary against composition prose false positives
status: todo
template: feature-impl
created_at: 2026-10-07T07:29:50.751Z
updated_at: "2026-10-07T07:34:14.858Z"
feature_id: F91

ac_altitude: task-local
---

## 1112. Narrow gate-language checker vocabulary against composition prose false positives

### Background

`hasGateLanguage()` at `packages/app/src/services/task-check.ts:457` flags bare words (`merged`, `approved`, `HITL`, …) anywhere in task prose. Factual hit during task 1106 enrichment (2026-10-07): the composition sentence "…merged back into one step" tripped the L4 gate-language WARN in a test-hardening task with no merge surface. Advisory WARNs that fire on prose train operators to dismiss them — an integrity cost to the F91 corpus-gate surface.

### Requirements

- [ ] R1. Ambiguous vocabulary (`merged`, `approved`) no longer fires on git-unrelated prose: either require co-occurrence with a git-context cue (branch/commit/PR/merge-commit) or drop the bare word from the vocabulary — pick the variant that keeps the real HITL/approval hits firing, and record the choice in a code comment explaining WHY.
- [ ] R2. A regression test reproduces the 1106 false positive ("merged back into one step" composition sentence) and asserts no WARN; existing true-positive fixtures still warn.

### Acceptance Criteria

- [ ] AC1 — Composition and testing prose no longer triggers the gate-language WARN; true human-confirmation vocabulary still warns

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T07:34:14.858Z backlog → todo (system)

### Notes

This task's own body deliberately quotes the flagged vocabulary (Background, R1, R2) — the residual L4 gate-language WARN on those sections is self-referential evidence for R1 and MUST NOT be reworded away. Factual reproduction: 2026-10-07 task 1106 enrichment, composition sentence "…integrated back into one step" (originally the git verb) tripped the WARN with no merge surface. Vocabulary source of truth: `hasGateLanguage()` at `packages/app/src/services/task-check.ts:457-460`; shared by `task check` L4 and TaskService write-time warnings — fix both consumers by changing the predicate, not the call sites (single source of truth comment, :455).

