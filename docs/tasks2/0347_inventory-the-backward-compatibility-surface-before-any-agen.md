---
template: issue
schema_version: 1
name: "Inventory the backward-compatibility surface before any agent-config redesign"
description: ""
status: todo
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: ["wayfinder:research", "backward-compat"]
dependencies: []
created_at: "2026-07-27T01:27:19.150Z"
updated_at: "2026-07-27T01:27:19.150Z"
---

## 0347. Inventory the backward-compatibility surface before any agent-config redesign

### Background

Wayfinder ticket for map B2. Type: research (`sp:brainstorm` / direct investigation).

The operator has asked that any redesign of the `agent:` config section consider backward compatibility carefully. Nothing currently enumerates what depends on the present shape, and `spur` is published on npm, so consumers exist outside this monorepo.

Known touch points to start from, not an exhaustive list: `AgentConfigSchema` / `AgentExecutorConfigSchema` (`packages/config/src/index.ts`), `getExecutorTier` / `isTierEligible` / `TIER_RANK`, `REGISTERED_CANONICAL_STAGES` and `getCanonicalStage`, `extractPhase`, the retired `default-by-phase` shim, `agent.team[].members[].executor`, `task-pipeline.yaml`'s `vars.agent`, the `--agent` flag across every `/sp:dev-*` command, `apps/cli/schemas/spur-config.schema.json`, and `config/templates/` seeded by `spur init`.

This ticket produces the inventory the redesign is checked against. It is unblocked and can run at any time.

### Requirements
R1. Enumerate every consumer of the current `agent:` config shape across the monorepo — source, schemas, templates, workflow YAML, plugin `sp`, and docs — with file references.

R2. Identify which are operator-visible contracts (config keys, CLI flags, published JSON schema) versus internal implementation details that can change freely.

R3. Identify what `spur init` seeds today, since new projects inherit whatever shape it writes.

R4. Note which items are already deprecated or retired so the redesign does not preserve dead weight.

R5. Produce the inventory as a task artifact the later ADR can cite. Do not propose the redesign here.
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
