---
template: feature-impl
schema_version: 1
name: "Implement feature-status derivation engine, spur feature sync verb, and Board sync endpoint"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-25T00:27:46.310Z"
updated_at: "2026-07-25T06:46:18.688Z"
---

## 0327. Implement feature-status derivation engine, spur feature sync verb, and Board sync endpoint

### Background
Implements the map's derivation-rules decision (see `docs/tasks2/0322_decide-feature-status-derivation-rules-and-where-the-sync-lo.md` — Solution section).

Terrain: sync handler stub at `apps/server/src/modules/feature/handlers.ts:121`; direction enum at `packages/contracts/src/feature.ts:147`; status enum at `packages/domain/src/planning/schema.ts:23`; existing service `packages/app/src/services/feature-service.ts` (`collectTasksByFeature` at :276 already groups tasks per feature); link helper `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- R1. `deriveFeatureStatus(featureId)` in `packages/app` feature-service: pure proposal `{ from, to, reason, requiresConfirm? , gateBlocked? }` implementing the conservative forward-only mapping.
- R2. Application goes through `spur feature advance` hops / lifecycle guards — never raw status sets.
- R3. CLI verb `spur feature sync <id> [--all] [--dry-run] [--json]`: prints proposals with derivation reasons; `--all` sweeps features with linked tasks; `--dry-run` reports only.
- R4. Un-stub `POST /features/{id}/sync`: `pull` delegates to the same service and returns `{ direction, affectedTasks, newStatus? }`; `push` returns an explicit not-implemented error.
- R5. `docs/04_DESIGN.md` updated in the same commit (T3): verb surface + pull/push semantics.
- R6. Tests: unit tests per mapping rule incl. gate interaction and reopen flag; CLI verb integration test; handler contract test. Coverage gate pass.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`packages/app/src/services/feature-service.ts:310`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L310) | Added `deriveFeatureStatus`, `syncFeature`, and `syncAllFeatures` implementing conservative forward-only mapping per ADR/0322, including L4 AC gate evaluation before `verifying`/`done` and confirm-gated reopen proposals. |
| [`packages/app/src/index.ts:77`](file:///Users/robin/xprojects/spur-new/packages/app/src/index.ts#L77) | Re-exported `FeatureSyncProposal`, `FeatureSyncOptions`, `FeatureSyncResult`, and `FeatureSyncAllResult`. |
| [`apps/cli/src/commands/feature.ts:358`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands/feature.ts#L358) | Registered `spur feature sync [id] [--all] [--dry-run] [--force] [--json]` CLI subcommand. |
| [`apps/server/src/modules/feature/handlers.ts:121`](file:///Users/robin/xprojects/spur-new/apps/server/src/modules/feature/handlers.ts#L121) | Un-stubbed `POST /features/{id}/sync` HTTP endpoint: `pull` delegates to `FeatureService.syncFeature`; `push` returns explicit not-implemented error. |
| [`docs/04_DESIGN.md:297`](file:///Users/robin/xprojects/spur-new/docs/04_DESIGN.md#L297) | Documented `spur feature sync` CLI command surface and HTTP sync handler semantics. |
| [`packages/app/tests/services/feature-service.test.ts:597`](file:///Users/robin/xprojects/spur-new/packages/app/tests/services/feature-service.test.ts#L597) | Added comprehensive unit tests for feature derivation rules, L4 gate interaction, confirm-gated reopening, and bulk sync. |
| [`apps/cli/tests/commands/feature.test.ts:454`](file:///Users/robin/xprojects/spur-new/apps/cli/tests/commands/feature.test.ts#L454) | Added integration tests for `spur feature sync` CLI flags (`--dry-run`, `--all`, `--json`). |
| [`apps/server/tests/modules/feature/handlers.test.ts:295`](file:///Users/robin/xprojects/spur-new/apps/server/tests/modules/feature/handlers.test.ts#L295) | Added unit tests for server sync handler `pull` and `push` responses. |
### Testing
- Executed `bun test packages/app/tests/services/feature-service.test.ts`: 41 passing unit tests.
- Executed `bun test apps/cli/tests/commands/feature.test.ts`: 37 passing integration tests.
- Executed `bun test apps/server/tests/modules/feature/handlers.test.ts`: 16 passing server handler tests.
- Executed `bun run autofix && bun run spur-check` quality gate: 3,553 passing unit tests across 220 files with 100% coverage gate pass and 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`packages/app/src/services/feature-service.ts:310`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L310) | Derivation mapping logic | None — conservative forward-only mapping verified by unit tests; L4 gate correctly blocks premature transition to verifying/done |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T06:43:15.711Z todo → wip (system)
- 2026-07-25T06:46:17.167Z wip → testing (system)
- 2026-07-25T06:46:18.688Z testing → done (system)
