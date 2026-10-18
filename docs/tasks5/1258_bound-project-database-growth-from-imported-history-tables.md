---
schema_version: 1
name: Bound project database growth from imported history tables
status: todo
template: issue
created_at: 2026-10-18T19:33:17.981Z
updated_at: "2026-10-18T19:33:37.373Z"

---

## 1258. Bound project database growth from imported history tables

### Background

The main tree's `.spur/spur.db` reached 8.9 GB on 2026-10-18 while the same project's fresh worktree database was 3.3 MB. Row counts in the main tree: `history_import_ledger` 4,413,985, `history_message` 3,494,990, `history_tool_call` 911,856, `history_board_tool_5m` 269,654, `history_board_message_5m` 227,519, `history_board_rollup_bucket` 104,561, `queue_jobs` 86,849, `rule_eval_runs` 288,272.

`spur self maintain` offers optimize/checkpoint/VACUUM but there is no retention or prune policy for the imported history tables, and `-shm` was 17 MB. Every project tree carries this cost, and worktree batches copy nothing (their own DB starts empty), so the two trees diverge silently.

### Requirements

- [ ] R1. Imported history tables have a documented retention policy with a prune verb (age- and/or row-bounded), and `spur self maintain` applies or reports it.
- [ ] R2. The prune keeps `task_run_links` and run provenance intact (the existing `history reset` contract).
- [ ] R3. A test seeds more rows than the bound and asserts the prune leaves a bounded table with provenance intact.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

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
