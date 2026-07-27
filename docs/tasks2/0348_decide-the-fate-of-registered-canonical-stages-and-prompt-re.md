---
template: issue
schema_version: 1
name: "Decide the fate of REGISTERED_CANONICAL_STAGES and prompt-regex phase detection"
description: ""
status: todo
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: ["wayfinder:grilling", "stage-registry", "adr-033"]
dependencies: ["0344"]
created_at: "2026-07-27T01:27:19.157Z"
updated_at: "2026-07-27T01:53:28.570Z"
---

## 0348. Decide the fate of REGISTERED_CANONICAL_STAGES and prompt-regex phase detection

### Background

Wayfinder ticket for map B2. Type: grilling (`sp:dev-refine`). Blocked by B2-02 and B2-03 — the emission model and vocabulary ownership determine what, if anything, the registry is still for.

The operator proposes removing `REGISTERED_CANONICAL_STAGES` outright. Verified context: it is a hardcoded `StageRecord[]` at `packages/domain/src/stage-registry/schema.ts:655` with no config door; it covers 10 stages while 21 `sp` commands have none; and its only entry point is `extractPhase`, a regex that matches slash-command-shaped prompts, so it is unreachable from CLI, subagent, and workflow dispatch.

But the registry carries more than a phase→tier lookup. `model_policy.fallback` encodes objective escalation (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted` → higher tier), and `validator.ts` enforces a transition DAG used elsewhere. Deleting the array without rehoming those loses capability that nothing else currently provides.

The live options are removal, demotion to a default intention→tier seed the operator's config overrides, or retention with a config override layer.

### Requirements
R1. Decide the fate of `REGISTERED_CANONICAL_STAGES`: remove, demote to an overridable default, or retain with an override layer. Record the decision and reason.

R2. State where objective escalation (`model_policy.fallback`) lives afterwards, or record explicitly that escalation is being dropped and why that is acceptable.

R3. State what happens to `extractPhase` and whether prompt-shape inference survives in any form.

R4. State the fate of the stage-registry graph validator and the transition DAG, which serve consumers beyond model routing.

R5. Confirm the answer covers all four dispatch paths, not just the slash path.

R6. Route the outcome through `sp:sys-architecture` and record whether it amends or supersedes ADR-033.

R7. Do not implement — end at a recorded decision.
### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
