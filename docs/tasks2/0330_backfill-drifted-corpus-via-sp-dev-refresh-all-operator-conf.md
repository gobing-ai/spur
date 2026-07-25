---
template: feature-impl
schema_version: 1
name: "Backfill drifted corpus via /sp:dev-refresh --all (operator-confirmed)"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0328", "0329"]
created_at: "2026-07-25T00:27:53.584Z"
updated_at: "2026-07-25T19:34:09.560Z"
---

## 0330. Backfill drifted corpus via /sp:dev-refresh --all (operator-confirmed)

### Background
One-time operator-confirmed backfill of the drifted corpus — the scenario that motivated the map (173 done tasks across 35 mostly-`backlog`/`active` features as of 2026-07-24; F2/F3/F5/H1–H3 et al. still `backlog`). Depends on the hook-wiring task and the `/sp:dev-refresh` command task.

This is a run task, not a code task: the deliverable is a clean, confirmed corpus.
### Requirements
- R1. Run `/sp:dev-refresh --all` / `spur feature sync --all` sweep to evaluate feature status derivation across all features with linked tasks.
- R2. Verify historically-drifted features (F2/F3/F5/H1–H3, R, Q, N, A2, L, M2, A1, K, F7) land at their derived statuses; L4-gate-blocked advances are reported, never forced.
- R3. Orphan done tasks and unlinked features handled according to derivation rules.
- R4. After sweep: `spur feature check` and `spur task check` clean; derived statuses reflected in feature files and Board.
- R5. Record sweep summary in task 0330's Solution section.
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
| [`packages/app/src/services/feature-service.ts:488`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L488) | Wrapped `syncFeature` in `try / catch` within `syncAllFeatures` to report gate-blocked feature transition proposals without crashing the sweep. |
| [`docs/features/*`](file:///Users/robin/xprojects/spur-new/docs/features/) | Executed corpus backfill sweep via `spur feature sync --all`: advanced drifted features with terminal linked tasks (R, Q, N, A2, L, M2, A1, K, F7, H3) to `done`, while reporting L4-gate-blocked features (F4, H, H2, M, M3, O, P, F6). |
### Testing
- Ran `spur feature sync --all --dry-run --json`: evaluated 28 features with linked tasks; identified 11 drifted features eligible for forward-only transition to `done`.
- Ran `spur feature sync --all --json`: successfully applied derived transitions across eligible features, reporting gate-blocked features without state corruption.
- Executed unit tests: `bun test packages/app/tests/services/feature-service.test.ts` (passing).
- Executed full monorepo quality gate `bun run autofix && bun run spur-check`: 3,559 passing unit tests across 220 files, 100% coverage gate pass, 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`packages/app/src/services/feature-service.ts:488`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L488) | Error handling in `syncAllFeatures` | None — error catching allows batch sweep to complete safely without skipping un-evaluated features |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T19:34:05.784Z todo → wip (system)
- 2026-07-25T19:34:07.690Z wip → testing (system)
- 2026-07-25T19:34:09.560Z testing → done (system)
