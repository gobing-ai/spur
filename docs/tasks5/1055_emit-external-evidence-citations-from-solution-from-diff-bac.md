---
schema_version: 1
name: Emit external-evidence citations from solution-from-diff backfill
status: todo
template: issue
created_at: 2026-10-02T20:15:07.448Z
updated_at: "2026-10-02T20:15:59.159Z"
feature_id: D62

---

## 1055. Emit external-evidence citations from solution-from-diff backfill

### Background

Session defect observed 2026-10-02 while completing task 1051: the Solution change-map citations emitted for `@gobing-ai/ts-dual-workflow-engine/src/persistence.ts:108` and `:104-115` use a package-name path that the L4 anchor checker cannot resolve from the project root (`packages/app/src/services/task-check.ts`, L4.anchor-unresolved), which blocked the done transition (`spur task update ... done`) until both citations were manually rewritten to the frozen external-evidence form (`task-check.ts:255-262`: origin + backticked path + line number outside the backticks). The checker's own rule anticipates this ("move it to the external-evidence form if the file is not in this repo") but the citation producer does not honor it, so every diff touching an external `@gobing-ai/ts-*` engine risks a blocked done gate.

### Requirements

- R1: Solution change-map citations pointing at non-repo paths (workspace package names like `@gobing-ai/*`, node_modules) are emitted in the frozen external-evidence form at write time — decide and implement the owner surface: the `task record --solution-from-diff` backfill, the implement-phase change-map guidance, or L4 resolution of installed-package paths.
- R2: The failure mode stays fail-closed; the improvement removes the avoidable manual repair, not the gate.

### Acceptance Criteria

- AC1: A task whose change-map cites an external package path passes `spur task check <wbs> --as done` without manual citation repair (repro of the 1051 blocker now green by construction).
- AC2: In-repo citations still require repo-relative anchors (checker R2 behavior unchanged).

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
