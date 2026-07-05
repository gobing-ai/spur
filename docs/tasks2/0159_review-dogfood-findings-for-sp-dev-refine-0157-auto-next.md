---
template: review
schema_version: 1
name: Review dogfood findings for sp-dev-refine 0157 auto-next
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: [review]
dependencies: []
created_at: 2026-06-29T23:55:30.798Z
updated_at: 2026-06-30T01:20:51.511Z
---

## 0159. Review dogfood findings for sp-dev-refine 0157 auto-next

### Background
Dogfood source: `docs/dogfood/2026-06-29-sp-dev-refine-0157-auto-next-dogfood.md`.

Command under test:

```bash
$sp-dev-dogfood "$sp-dev-refine 0157 --auto --next" --save --task --full
```

The run completed successfully: refine skipped synthesis because target sections were already L3-clean,
the `--next` implementation branch completed task `0157`, focused plugin checks passed, and the task
transitioned to `done`.

#### Review Findings

The findings below are workflow-quality issues captured under `--full`; none blocked task `0157`.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P3 | `docs/tasks2/0157_migrate-rd3-engineering-operations-pack-to-sp.md` | `spur task check 0157 --json` passes at `done` but still warns that Testing lacks a numeric coverage claim or `N/A`. `spur task record` generated the Testing section from a valid PASS verdict but did not include the required coverage phrase. | Teach `spur task record` to emit `Coverage: N/A` for docs-only/verdict-only tasks, or update the checker to accept verdict-generated Testing sections without coverage when checks are non-code docs/skill changes. |
| P4 | `docs/tasks2/0157_migrate-rd3-engineering-operations-pack-to-sp.md` | The generated task has no `feature_id`, so all checks carry an advisory L4 warning. This is expected for ad hoc migration tasks but creates noise in dogfood reports. | Decide whether migration/dogfood tasks should link to a standing feature, or whether the check should support an explicit no-feature rationale for review/meta tasks. |
| P4 | dogfood operation | A parallel `spur task show` and `spur task check` caused a transient SQLite `SQLITE_BUSY_RECOVERY` on the read path. The retry succeeded when serialized. | Dogfood runners should serialize Spur CLI reads/writes against the local SQLite DB, or add a retry wrapper for read-only task operations. |
### Plan

- [ ] Fix P1 findings
- [ ] Fix P2 findings
- [ ] Fix all the remaining findings if any
- [ ] Re-review the changed code

### Solution

| File | Lines | What / Why |
|------|-------|------------|
| `packages/app/src/services/task-record.ts` | 170 | Add `Coverage: N/A` line to `renderTesting` output — the verify pipeline does not measure code coverage, so the verdict-generated Testing section must carry an explicit `N/A` claim to satisfy the `spur task check` L3 coverage regex (`task-check.ts:256`). |
| `packages/app/tests/services/task-record.test.ts` | 167-169 | Assert `Coverage: N/A` appears in `renderTesting` output — guards against regression of the P3 fix. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| P3 | MET | renderTesting now emits 'Coverage: N/A' at packages/app/src/services/task-record.ts:170; test asserts it at packages/app/tests/services/task-record.test.ts:169; 39 tests pass |
| P4-feature-id | DEFERRED | Advisory only — review/meta tasks have no natural feature; deferred per task 0159 Review section |
| P4-sqlite-busy | DEFERRED | Advisory only — transient read-path contention; deferred per task 0159 Review section |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
Post-implementation reflection — the P3 finding from the prior dogfood (task 0157) is resolved; P4 findings are advisory and left for policy decisions.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P3 | `packages/app/src/services/task-record.ts:170` | `renderTesting` did not emit a coverage claim, so `spur task check` warned "Testing should include numeric coverage claim or N/A" on verdict-generated Testing sections. | Fixed: `renderTesting` now emits `Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)`. The checker regex at `task-check.ts:256` matches `N/A`. Test added at `task-record.test.ts:169`. |
| P4 | `docs/tasks2/0157_migrate-rd3-engineering-operations-pack-to-sp.md` | Task has no `feature_id`, so all checks carry an advisory L4 warning. Expected for ad hoc migration/review tasks. | Deferred: decide whether migration/dogfood tasks should link to a standing feature, or whether the check should support an explicit no-feature rationale. |
| P4 | dogfood operation | Parallel `spur task show` and `spur task check` caused a transient `SQLITE_BUSY_RECOVERY`. | Deferred: serialize Spur CLI reads/writes against the local SQLite DB, or add a retry wrapper for read-only task operations. |
### References

### History
- 2026-06-30T01:15:49.176Z backlog → todo (system)
- 2026-06-30T01:17:02.125Z todo → wip (system)
- 2026-06-30T01:19:35.110Z wip → testing (system)
- 2026-06-30T01:20:51.511Z testing → done (system)
