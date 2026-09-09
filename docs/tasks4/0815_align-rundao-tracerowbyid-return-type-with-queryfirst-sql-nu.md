---
schema_version: 1
name: Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics
status: todo
template: issue
created_at: 2026-09-09T01:51:22.437Z
updated_at: "2026-09-09T01:51:58.636Z"

---

## 0815. Align RunDao.traceRowById return type with queryFirst SQL-NULL semantics

### Background

Deferred P4 from task 0809 (verify + re-review findings tables). `RunDao.traceRowById` declares `undefined` as its not-found fallthrough, but the underlying `queryFirst` surfaces a SQL-NULL row as `null`. 0809 R3 fixed the runtime symptom with a `?? undefined` normalization at `packages/app/src/workflow/actions/run-artifact.ts:327`; the type-accuracy retype was out of 0809 scope.

Scope: align the DAO contract (either type the return as including `null`, or normalize to `undefined` inside the DAO and drop the call-site guard). Check other `queryFirst`-backed DAO lookups for the same declared-vs-actual mismatch. Out of scope: changing refusal behavior — the `no authoritative row` refusal contract from 0809 R3 must stay exact.

### Requirements

<!-- R-numbered expectations for the fix. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

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
