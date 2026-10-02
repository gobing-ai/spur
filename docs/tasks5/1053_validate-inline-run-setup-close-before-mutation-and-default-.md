---
schema_version: 1
name: Validate inline-run-setup close before mutation and default terminal reason
status: todo
template: feature-impl
created_at: 2026-10-02T17:06:32.169Z
updated_at: "2026-10-02T17:07:30.626Z"
feature_id: D62

---

## 1053. Validate inline-run-setup close before mutation and default terminal reason

### Background

Session review of run c88b0ef3 (task 1048, 2026-10-02) found `inline-run-setup.ts --close --run-id <id> --status done` returning `{"ok":false,"code":"NO_ACTION_ROWS"}` while the runs row was ALREADY mutated: status=done, completed_at stamped (10:15:03.786Z — the failing call's own timestamp), terminal_reason left NULL. The error text then instructs "emit --action/--actions-file during the run (no backfill)" — impossible to follow because the row is already closed. A second `--close --status done --reason done` (after emitting the action batch) healed the row, proving the mutation happens before validation.

Also: `--status done` without `--reason` leaves terminal_reason NULL; only an explicit `--reason` writes it.

### Requirements

- [ ] R1. `--close` must validate (action_rows non-empty for `done`, status/reason enum, run exists and is non-terminal or idempotent) BEFORE any UPDATE; a failing validation leaves the row byte-identical (no status, no completed_at, no terminal_reason write).
- [ ] R2. `--close --status done` without `--reason` defaults terminal_reason to `done` (closed enum 0937 R2); explicit `--reason` still wins.
- [ ] R3. Error output for the validate-first failure keeps the current NO_ACTION_ROWS guidance but is now truthful (row untouched).

### Acceptance Criteria

AC1. On a runs row with zero action_runs, `--close --status done` exits nonzero, reports NO_ACTION_ROWS, and a direct DB read shows the row unchanged (status/terminal_reason/completed_at all untouched).
AC2. `--close --status done` on a row WITH action_runs but no `--reason` yields status=done AND terminal_reason=done in one call.
AC3. Unit tests cover both paths; existing close tests still pass.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-02T17:07:14.629Z backlog → todo (system)

