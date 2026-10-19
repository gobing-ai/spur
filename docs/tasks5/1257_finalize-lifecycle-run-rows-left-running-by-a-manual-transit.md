---
schema_version: 1
name: Finalize lifecycle run rows left running by a manual transition
status: cancelled
template: issue
created_at: 2026-10-18T19:33:17.580Z
updated_at: "2026-10-19T03:03:08.692Z"

feature_id: D3
---

## 1257. Finalize lifecycle run rows left running by a manual transition

### Background

**Refine corrections (2026-10-18): no valid current implementation issue remains; cancel this filing.**

The filing interpreted a durable feature lifecycle row in an active/nonterminal state as an abandoned process. Current `packages/app/src/workflow/lifecycle-adapter.ts:300-320` already finalizes done as done and cancelled as failed/cancelled; other entity states deliberately keep the durable row running so later transitions attach/reseed it. `packages/app/src/workflow/lifecycle-adapter.ts:78-109` also provides lookup-only reconciliation for terminal writes that suppress lifecycle run creation.

The cited run run_524dae91-f944-40e6-855b-b382ac852773 and external key feature:D66 are absent from the current project DB, so the historical snapshot cannot establish a currently stuck terminal entity. A read-only query was used; no database rows were repaired or deleted.

The filing's claim that spur agent status renders these lifecycle rows as live is false: `apps/cli/src/commands/agent/status.ts:20-60` reads declared agent specs plus supervisor GET /api/processes. The hypothetical future exclusivity check does not justify adding a new sweep command.

Fresh evidence: `(cd packages/app && bun test tests/workflow/lifecycle-adapter.test.ts)` → 29 pass, 0 fail; terminal mapping, cancelled reconciliation, no-lifecycle lookup-only repair, nonterminal running and reopen behavior are covered. Receipt: .spur/run/refine-1257-lifecycle-tests.log.

Removed every original issue, R-item, AC and implementation step: per-transition terminalization would contradict the existing durable lifecycle contract; try/finally cannot guarantee cleanup after process termination; a new pid/lease sweeper lacks an ownership contract and is outside this invalid filing.

### Requirements

None retained. The terminal-close behavior already exists; nonterminal durable running state is intentional. No new sweep API, schema, UI change or failure policy is authorized by this cancelled task.

### Acceptance Criteria

None retained after issue validation. The existing lifecycle suite is the regression evidence for cancellation, not a claim of new delivery.

### Q&A

- Closed: cancel because all original issues are invalid, already addressed or speculative.
- Closed: do not finalize active/blocked/testing lifecycle entities merely because one CLI invocation returned.
- No pending delegation; this task is excluded from the implementation-ready set.

### Design

No implementation. Preserve one durable lifecycle run per entity, file-wins reseeding, existing done/cancelled finalization and lookup-only terminal reconciliation. If a new reproducible mismatch is found later, file its exact terminal entity/run state and owning writer under a separate issue; do not resurrect the generic abandoned-process premise.

### Plan

No implementation steps remain; cancelled after current-tree inspection, read-only DB lookup and 29 passing lifecycle tests.

### Root Cause

No current defect reproduced. The filing conflated a durable entity lifecycle row with a supervised process and overlooked the existing terminal-state finalization/reconciliation paths.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-19T03:03:08.692Z todo → cancelled (system)

