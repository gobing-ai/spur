---
template: issue
schema_version: 1
name: "Decide who emits intention: skill declaration, inferred judge, or hybrid"
description: ""
status: todo
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "routing", "determinism"]
dependencies: []
created_at: "2026-07-27T01:27:19.129Z"
updated_at: "2026-07-27T01:53:19.830Z"
---

## 0344. Decide who emits intention: skill declaration, inferred judge, or hybrid

### Background
Wayfinder ticket for map B2. Type: grilling (`sp:dev-refine`). **Absorbed ticket 0345 on 2026-07-26.**

The operator's diagnosis is verified: `extractPhase` (`packages/app/src/services/agent-service.ts`)
only classifies prompts shaped like slash commands, so CLI, subagent, and workflow dispatches get no
stage and fall through to `agent.default`.

**The two-layer contract is already ruled (map B2 → Notes), and this ticket works inside it:**

| Layer | Owns | Home |
| --- | --- | --- |
| 1 | intention → tier | shared reference file under `plugins/sp`, included by the skills that need it |
| 2 | tier → executor | operator's `.spur/config.yaml` |

`sp` names intentions and tiers, never an executor or model. Two earlier proposals are already
closed out by that ruling: **per-skill intention declaration** does not survive the spine — a
comprehensive skill such as `plugins/sp/skills/spur-dev` carries refine, plan, implement, verify and
wrap intentions at once and cannot declare a single one — and **a separate LLM judge call per
dispatch** is not what "LLM-as-Judge" meant. The executing agent reads the reference table and picks
which intention applies to the operation it is already performing; the tier→executor step is then a
deterministic config lookup. The only judgment is intention classification, bounded by a fixed
vocabulary.

What remains open is the contract itself: what the intentions *are*, how a dispatcher on each of the
four paths carries one, and what happens when config does not map a declared intention. That is this
ticket.
### Requirements
R1. Define the intention vocabulary — the actual value list. Cover the work the 21 currently
    stage-less commands do, not just the 10 that have stage records today.

R2. Decide the reference file's location and format under `plugins/sp`, and which skills include it.
    Follow the existing `references/*.md` convention rather than inventing a new mechanism.

R3. For each of the four dispatch paths — slash command, `spur agent run`, subagent, workflow step —
    state concretely how the intention is carried and how a multi-intention skill like `sp:spur-dev`
    selects the right one per operation.

R4. Define the behavior when a skill declares an intention the operator's config does not map: hard
    error, silent default, or warning plus default.

R5. Define the behavior when no intention is available and none can be classified.

R6. State how an operator override interacts with a declared intention — whether an explicit
    executor bypasses routing entirely, or pins one axis and leaves escalation live.

R7. State the versioning story for `sp` and `spur` shipping on independent release cadences, given
    the vocabulary lives in the plugin and the mapping in the operator's config.

R8. Do not implement — end at a recorded decision. Implementation is decomposed once the map clears.
### Acceptance Criteria

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
