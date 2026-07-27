---
template: issue
schema_version: 1
name: "Unify the --agent selector namespace with agent.executors"
description: ""
status: todo
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P1
tags: ["wayfinder:prototype", "cli", "backward-compat"]
dependencies: []
created_at: "2026-07-27T01:27:19.143Z"
updated_at: "2026-07-27T01:27:19.143Z"
---

## 0346. Unify the --agent selector namespace with agent.executors

### Background

Wayfinder ticket for map B2. Type: prototype (`sp:code-implementation`, rough take).

Verified functional hole: `resolveAgentExplicit` (`packages/app/src/services/agent-service.ts:808`) resolves `--agent <name>` through `resolveAgentName`, which knows agent binaries only. `resolveExecutorSelector` (`:757`) — used by `agent.default` and stage routing — tries executors first and falls back to a binary name. So `agent.default: omp-zai` resolves while `--agent omp-zai` fails with `Unknown agent: omp-zai`. The model and tier layer is unreachable from the command line.

This is the cheapest real win on the map and is deliberately independent of the intention redesign: it closes a hole that exists today, under either outcome of B2-02. It is scoped as a prototype so the ergonomics can be reacted to before the larger design lands.

Note the naming question rides along: whether the flag becomes `--executor` with `--agent` as a deprecated alias, or `--agent` simply gains executor-awareness.

### Requirements
R1. Make explicit selection executor-aware so any name valid in `agent.default` is valid for `--agent`, reusing the existing executor-first-then-binary lookup rather than adding a second resolution path.

R2. Preserve current behavior for bare binary names (`--agent claude`, `--agent omp`) — no regression for existing users or docs.

R3. Define precedence when an executor and an agent binary share a name (both `omp` and `claude` currently collide in the operator's config).

R4. Produce a rough take, not a finished feature: enough to react to the ergonomics, including whether `--executor` should become the preferred spelling.

R5. Cover the change with a test asserting `--agent <executor-name>` resolves to that executor's agent and model.

R6. Record in the task body whether this should ship ahead of the rest of the map or land with it.
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
