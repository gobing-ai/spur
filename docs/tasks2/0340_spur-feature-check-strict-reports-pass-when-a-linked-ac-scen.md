---
template: feature-impl
schema_version: 1
name: "spur feature check --strict reports PASS when a linked AC scenario is known-unsatisfied"
description: ""
status: todo
type: task
profile: standard
feature_id: F3
parent_wbs: null
priority: P2
tags: ["cli", "gates", "feature-check", "traceability", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.191Z"
updated_at: "2026-07-26T23:50:31.192Z"
---

## 0340. spur feature check --strict reports PASS when a linked AC scenario is known-unsatisfied

### Background

From the 2026-07-26 dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, finding P2).

`spur feature check <id> --strict` validates that every feature AC scenario is **linked** to a task (DD-09 orphan-scenario check) but never asks whether the scenario is **satisfied**. The two diverged visibly on feature R2: the gate returned `R2: PASS` at a point when scenario R10 was documented UNMET in task 0335's own recorded verification, with the remaining work deferred to an unstarted follow-up task. A reader treating `feature check --strict` as "this feature is complete" would have been wrong, and this is the gate most likely to be read that way.

Evidence of satisfaction already exists in the corpus — per-task verdict artifacts (`.spur/run/<wbs>-verdict.json`) and the AC verification tables written into each task's `### Testing` section — so the gate has something to consult; it simply does not.

This needs a design decision before code: whether strict mode should consult verdict artifacts, whether an unsatisfied scenario is an error or a distinct 'linked but unverified' state, and how to treat scenarios whose covering task is still unstarted. Route through `sp:sys-architecture` before implementing.

### Requirements
R1. Decide and record (ADR entry or a `docs/design/` satellite, per the constitution routing) what `--strict` should assert about AC *satisfaction*, distinct from AC *linkage*. Name the evidence source it consults and the failure semantics.

R2. Distinguish at least three states per scenario rather than the current binary: linked-and-verified, linked-but-unverified (covering task not yet passed), and orphaned (no covering task).

R3. Preserve the current linkage check unchanged — this adds a dimension, it does not replace DD-09.

R4. Ensure a feature whose covering tasks are all `todo` cannot report a clean strict PASS as though the AC were met.

R5. Reproduce the R2 case as a regression test: a feature with full scenario→task linkage but a recorded UNMET scenario must not return a clean strict PASS.

R6. Non-goal: changing the non-strict check's behavior, or blocking feature transitions on this new signal without operator opt-in.
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

F3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
