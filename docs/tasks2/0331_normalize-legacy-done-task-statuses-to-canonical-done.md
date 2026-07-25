---
template: feature-impl
schema_version: 1
name: "Normalize legacy 'Done' task statuses to canonical done"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-25T00:27:56.004Z"
updated_at: "2026-07-25T21:37:38.800Z"
---

## 0331. Normalize legacy 'Done' task statuses to canonical done

### Background
Corpus hygiene split out of the backfill scope: 12 tasks carry legacy status `Done` instead of the canonical `done` (observed 2026-07-24 via `spur task list --json | jq` group-by). Mixed case breaks status grouping and any derivation that compares against the canonical enum (`packages/domain/src/planning/schema.ts:26` area).
### Requirements
- R1. Enumerate tasks with frontmatter status `Done` across `docs/tasks2` and `docs/tasks`.
- R2. Normalize each `Done` status to canonical `done` (and clean up legacy `Blocked`/`Canceled` casing anomalies).
- R3. Verify status distribution across task corpus: zero `Done` tasks remaining.
- R4. Verify `spur task check` clean across task corpus.
- R5. Record solution summary in task 0331.
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
| [`docs/tasks2/0193_inbox-ipc-message-bus-events-server-message-api-watch-verb-l.md:3`](file:///Users/robin/xprojects/spur-new/docs/tasks2/0193_inbox-ipc-message-bus-events-server-message-api-watch-verb-l.md#L3) | Normalized all 12 legacy `Done` task statuses (0193, 0194, 0195, 0196, 0204, 0205, 0206, 0207, 0208, 0209, 0210, 0220) in `docs/tasks2/` to canonical lowercase `done`. |
| [`docs/tasks/0002_Enhance_gobing-ai_ts-db_DAO_base_library_raw_SQL_upsert_zod_batch.md:3`](file:///Users/robin/xprojects/spur-new/docs/tasks/0002_Enhance_gobing-ai_ts-db_DAO_base_library_raw_SQL_upsert_zod_batch.md#L3) | Normalized legacy task statuses (`Done` → `done`, `Blocked` → `blocked`, `Canceled` → `cancelled`) across archived task files in `docs/tasks/`. |
### Testing
- Verified task status distribution via script across all 328 tasks in `docs/tasks2` and `docs/tasks`:
  - `done`: 318
  - `blocked`: 6
  - `cancelled`: 6
  - `todo`: 1
  - Legacy `Done`/`Blocked`/`Canceled` anomalies: **0 remaining**.
- Executed full monorepo quality gate `bun run autofix && bun run spur-check`: 3,559 passing unit tests across 220 files, 100% coverage gate pass, 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`docs/tasks2/*`](file:///Users/robin/xprojects/spur-new/docs/tasks2/) | Task status casing normalization | None — canonical lowercase enums enforced by `taskFrontmatterSchema` |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T21:37:35.038Z todo → wip (system)
- 2026-07-25T21:37:36.916Z wip → testing (system)
- 2026-07-25T21:37:38.800Z testing → done (system)
