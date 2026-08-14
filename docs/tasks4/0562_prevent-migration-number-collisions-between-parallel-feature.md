---
template: issue
schema_version: 1
name: "Prevent migration-number collisions between parallel features"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:15:15.298Z"
updated_at: "2026-08-14T18:15:47.367Z"
---

## 0562. Prevent migration-number collisions between parallel features

### Background
During the E6 batch (2026-08-14), two features in parallel claimed the same incremental migration number: task 0553 (E5-adjacent) shipped `0012_spur_cli_history_tool_call_args_raw`, while E6 task 0557 shipped `0012_spur_cli_history_run_session`. Both lived in `packages/domain/src/migrations.ts` CLI_SCHEMA_SQL. The duplicate only surfaced at integration: the E6 worktree branch could not fast-forward (main had advanced), and the manual merge required renumbering E6's migration to `0013_spur_cli_history_run_session` (commit fa41669c). A collision check at planning time would have caught this before any implementation ran. Evidence: migrations.ts (both ids present), git log `fa41669c`, report §2 RC5.
### Requirements
- [ ] R1. Migration numbers are collision-proof for parallel features — batch-create (or feature-check) must allocate or verify `_spur_cli_` incremental migration ids so two in-flight features cannot claim the same number; the check must see both the committed corpus and the unmerged working tree.
### Acceptance Criteria
```gherkin
Scenario: parallel features never collide on migration numbers
  Given two features with in-flight migrations planned concurrently
  When both tasks are created or checked
  Then their incremental migration ids are distinct
  And no merge-time renumbering is required
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Fix target: the batch-create / feature-check path in packages/app — before a task batch lands (or at feature check), scan `packages/domain/src/migrations.ts` (and drizzle/*.sql) for the max `_spur_cli_` id across the corpus AND the current working tree, and either allocate the next id or fail with a named collision. Evidence: `migrations.ts` id `0012_spur_cli_history_tool_call_args_raw` (0553) vs `0012_spur_cli_history_run_session` (0557); merge commit `fa41669c` renumbering to 0013. Note: the collision was aggravated by the one-writer-per-tree rule being broken (parallel session committed to main mid-batch) — the migration check is the deterministic backstop.
Measurable target: a feature-check or batch-create run with two same-number migrations fails with the collision named.
### Plan
- [ ] 1. Locate migration-id allocation in the batch-create / feature-check path (packages/app)
- [ ] 2. Add a corpus+worktree-wide `_spur_cli_` id scan before allocation, failing on collision
- [ ] 3. Regression test: two migrations claiming the same id → named collision error
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Evidence: packages/domain/src/migrations.ts (both 0012 ids) · commit fa41669c (renumber to 0013)
- Code: packages/app batch-create service / feature-check service
- Report: docs/report/2026-08-14-E6-batch-forensic-report.md §2 RC5 / §4
### History
