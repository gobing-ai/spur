---
template: feature-impl
schema_version: 1
name: "Implement feature-status derivation engine, spur feature sync verb, and Board sync endpoint"
description: ""
status: todo
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-25T00:27:46.310Z"
updated_at: "2026-07-25T00:29:09.325Z"
---

## 0327. Implement feature-status derivation engine, spur feature sync verb, and Board sync endpoint

### Background
Implements the map's derivation-rules decision (see `docs/tasks2/0322_decide-feature-status-derivation-rules-and-where-the-sync-lo.md` — Solution section).

Terrain: sync handler stub at `apps/server/src/modules/feature/handlers.ts:121`; direction enum at `packages/contracts/src/feature.ts:147`; status enum at `packages/domain/src/planning/schema.ts:23`; existing service `packages/app/src/services/feature-service.ts` (`collectTasksByFeature` at :276 already groups tasks per feature); link helper `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- `deriveFeatureStatus(featureId)` in `packages/app` feature-service: pure proposal `{ from, to, reason, requiresConfirm? , gateBlocked? }` implementing the conservative forward-only mapping — all linked tasks terminal (`done`/`cancelled`, ≥1 `done`) ⇒ propose advance toward `done` (stop before `verifying` when the L4 AC gate fails, report gate findings); any task `wip`/`testing` ⇒ propose `backlog→active`; all non-terminal `blocked` ⇒ propose `blocked`; empty set ⇒ no-op. New non-terminal task on a `done` feature ⇒ reopen proposal flagged `requiresConfirm` (never applied by `--all` or unattended paths).
- Application goes through `spur feature advance` hops / lifecycle guards — never raw status sets.
- CLI verb `spur feature sync <id> [--all] [--dry-run] [--json]`: prints proposals with derivation reasons; `--all` sweeps features with linked tasks; `--dry-run` reports only.
- Un-stub `POST /features/{id}/sync`: `pull` delegates to the same service and returns `{ direction, affectedTasks, newStatus? }`; `push` returns an explicit not-implemented error (never a silent no-op).
- `docs/04_DESIGN.md` updated in the same commit (T3): verb surface + pull/push semantics; ADR entry if FSM interaction needs rationale.
- Tests: unit tests per mapping rule incl. gate interaction and reopen flag; CLI verb integration test; handler contract test. New-file coverage ≥ 90%.
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

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
