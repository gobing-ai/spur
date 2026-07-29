---
template: feature-impl
schema_version: 1
name: "Add explicit module ordering to the board registry and promote Observability to first module"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P2
tags: ["board", "web", "registry"]
dependencies: []
created_at: "2026-07-29T00:15:02.315Z"
updated_at: "2026-07-29T00:25:33.673Z"
---

## 0374. Add explicit module ordering to the board registry and promote Observability to first module

### Background

Board module order is currently an accident of alphabetization: `discoverViaGlob` sorts discovered modules by id (apps/web/src/modules/discover.ts:73) and `discoverViaFs` sorts directory names (:139), yielding features, observability, task-kanban, teams. `defaultModule` is simply `enabledList()[0]` (registry.ts:53), so Features is also the default landing route. The `WebModule` contract (modules/types.ts) has no ordering field at all, so the only way to reorder today is to rename a directory — which would break the id and route the registry validates on. The operator wants Observability first; this task makes ordering declarative instead of incidental.

### Requirements
- [ ] R1. Add an optional ordering key to the `WebModule` interface and honour it in discovery for both the glob path and the fs-fallback path.
- [ ] R2. Ordering must be partial: modules declaring the key sort by it; modules without it retain their existing relative order after them, so no untouched module changes position unexpectedly.
- [ ] R3. Set Observability's ordering so it is the first enabled module and therefore the default landing route.
- [ ] R4. Preserve the registry's fail-fast duplicate id and duplicate route validation, and the disable/enable slot-restoration behaviour.
- [ ] R5. Keep discovery pure and deterministic — the same inputs must always yield the same ordering, as the registry factory contract requires.
- [ ] R6. Cover the ordering comparator in the fs-fallback path, which is the branch reachable under bun test.
### Acceptance Criteria
```gherkin
Scenario: R1 — Observability is the Board's first module and default landing route
Scenario: R2 — Explicit ordering is declarative and partial
```
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

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
