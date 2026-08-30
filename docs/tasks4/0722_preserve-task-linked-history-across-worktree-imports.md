---
schema_version: 1
name: "Preserve task-linked history across worktree imports"
status: todo
template: issue
created_at: 2026-08-30T18:25:36.935Z
updated_at: "2026-08-30T18:27:20.880Z"
feature_id: E6
---

## 0722. Preserve task-linked history across worktree imports

### Background
Feature A6 was implemented in an isolated worktree and merged correctly, but its ignored
`.spur/spur.db` disappeared with the worktree. A source-local `history import --source all` added
56 raw history rows while `task_run_links` and `history_run_session` remained unchanged, leaving
tasks 0703–0712 with zero task-linked sessions. Future worktree cleanup must consolidate this
portable correlation state before removing the source database.
### Requirements
- [ ] R1. Default `spur history import` discovers every active Git worktree for the current repository and scans each worktree's run-owned agent-session roots; explicit `--file` or `--root` remains caller-directed.
- [ ] R2. Before importing raw history, the current database idempotently imports task-linked `task_run_links` and matching `history_run_session` rows from sibling worktree `.spur/spur.db` files. It never merges unrelated run-store or lifecycle tables.
- [ ] R3. `--dry-run` reports the correlation rows it would import without mutating the current database, and normal JSON/text output reports the databases and row counts consolidated.
- [ ] R4. Create-mode worktree cleanup runs the existing source-local incremental history import while the worktree still exists; import failure retains the worktree and branch.
- [ ] R5. The cross-worktree correlation boundary is documented and covered by focused app/CLI/contract tests; no schema migration or new public command is added.
### Acceptance Criteria
```gherkin
Feature: Worktree-safe history import

  @core
  Scenario: R8 — Active worktree sessions join their tasks
    Given a sibling Git worktree has a task-run link, a matching run-session mapping, and run-owned JSONL
    When default history import runs from the invoking tree
    Then the correlation rows are imported idempotently
    And the JSONL message is queryable through the task selector

  @core
  Scenario: R9 — Dry-run previews without mutation
    Given a sibling worktree database contains task-linked correlation rows
    When history import runs with --dry-run
    Then the result reports the rows that would be consolidated
    And the invoking database remains unchanged

  @core
  Scenario: R10 — Cleanup preserves correlation before removal
    Given a create-mode worktree batch completed successfully
    When WT-4 prepares to remove the worktree
    Then source-local incremental history import runs while the worktree database and session roots still exist
    And an import failure routes to retention rather than removal
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Reuse the existing `HistoryService.importAll` choke point. The CLI resolves active worktree roots
once with `git worktree list --porcelain`; the service reads sibling databases read-only, copies
only task links plus session mappings for those linked run IDs, then uses the same roots for
run-session JSONL discovery. WT-4 invokes the existing import before removal. Whole-database copy,
shared SQLite storage, schema changes, and a new CLI verb are deliberately excluded.
### Plan
- [ ] Add active-worktree discovery at the CLI boundary and thread roots into `HistoryService`.
- [ ] Consolidate task-linked correlation rows once per import-all run and expose bounded counts.
- [ ] Extend run-owned JSONL discovery across those roots and cover mutation/dry-run/idempotency.
- [ ] Amend the WT-4 cleanup contract and its static regression test.
- [ ] Update the history/worktree design contract, run focused tests, then the project gates.
### Root Cause
`HistoryService.runSessionAugmentedRoots` reads only `<current-cwd>/.spur/run` and only mappings
already present in the current DB. Git merges tracked files, while `.spur/spur.db` is ignored and
worktree-local. Task 0720 preserved verdict/report files but explicitly prohibited importing
`task_run_links`; therefore WT-4 removed the only task↔run and run↔session join state. Raw JSONL
re-import cannot recreate either relational edge.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
