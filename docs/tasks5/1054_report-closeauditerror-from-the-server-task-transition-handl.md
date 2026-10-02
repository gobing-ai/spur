---
schema_version: 1
name: Report closeAuditError from the server task transition handler
status: todo
template: issue
created_at: 2026-10-02T20:15:07.141Z
updated_at: "2026-10-02T20:15:58.346Z"
feature_id: D62

---

## 1054. Report closeAuditError from the server task transition handler

### Background

Review finding F5 from task 1051 (1051 ## Review, 2026-10-02): the CLI reports `closeAuditError` (`apps/cli/src/commands/task.ts:680,1258`) but the server transition handler drops it (`packages/app/src/services/task-transition.ts:99-101`). The asymmetry means server-driven transitions lose the same close-audit failure signal AC3 of 1051 deliberately surfaced for inline closes (handler reports bookkeepingError with replay guidance at `apps/server/src/modules/task/handlers.ts:101-115`). Pre-existing, out of 1051 scope; natural symmetry follow-up.

### Requirements

- R1: Server-driven task transitions surface `closeAuditError` with task identity (wbs, target status, error) and the same replay guidance pattern the CLI uses, symmetric with 1051 AC3's handler treatment of bookkeepingError.
- R2: The transport DTO stays unchanged (log-and-continue pattern per 1051 AC3) unless the oRPC contract owner decides otherwise.

### Acceptance Criteria

- AC1: A handler-level test injects a close-audit failure and asserts the server log/error path carries wbs, target status, error, and replay guidance; the transition outcome itself is unchanged.
- AC2: Existing `apps/server/tests/modules/task/handlers.test.ts` suite stays green (27 pass at 1051 review re-run).

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
