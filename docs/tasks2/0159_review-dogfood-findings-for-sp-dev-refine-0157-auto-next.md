---
schema_version: 1
name: "Review dogfood findings for sp-dev-refine 0157 auto-next"
description: ""
status: backlog
type: review
template: review
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["review"]
dependencies: []
created_at: "2026-06-29T23:55:30.798Z"
updated_at: 2026-06-29T23:55:47.085Z
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

### Review

Post-implementation reflection — filled **after** the first fix round: what went wrong, what
remains to fix before closing, and any **back-issues** (new findings surfaced by the fix).

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1       |      |         |                |
| P2       |      |         |                |

### References

### History
