---
schema_version: 1
name: Sync run state.json sidecar with DB on workflow run close
status: todo
template: issue
created_at: 2026-10-02T17:00:22.383Z
updated_at: "2026-10-02T17:01:28.870Z"
feature_id: E7

---

## 1051. Sync run state.json sidecar with DB on workflow run close

### Background

Captured from the creation title: "Sync run state.json sidecar with DB on workflow run close".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

- [ ] AC1 — After `spur workflow run … --close --status done`, the run's `state.json` reports the
      terminal status with `updatedAt` ≥ close time (or the sidecar is derived from the DB row and
      cannot diverge). Evidence: test on the close path asserting sidecar/DB agreement.
- [ ] AC2 — Runs whose sidecar is already stale (`running` while the DB row is terminal) are
      tolerated/reconciled by the read or close path without error. Evidence: test with a
      hand-stale sidecar fixture.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

`spur workflow run --close` (inline-run-setup close path) updates the persisted run row in
`.spur/spur.db` (`status=done`, `completed_at` set) but does not update the two-file run record's
`state.json` sidecar, which stays `"status": "running"` forever.

Observed live in session for run `f1988a82-9a20-4c5d-bb82-6430301b2c0f` (task 1049, 2026-10-02):

- DB: `{"status":"done","completed_at":"2026-10-02T11:02:02.739Z"}`
- Sidecar: `.spur/memory/runs/f1988a82-….state.json` → `"status": "running"`

Hypothesis (unverified against engine source): the close verb treats the DB row as the authoritative
ledger and never rewrites the startup-time sidecar. Confirmation needed: read the close
implementation in the workflow/run persistence path (E7 two-file record surface).

Impact: any consumer reading `state.json` (Board inspection, history import, run-resume eligibility)
sees a phantom running run. Adjacent but distinct from 1048's terminal-reason work (run-dao rows).

### Solution

On the close path, update the sidecar in the same operation as the DB row, or derive sidecar status
from the DB row at read time (single writer, no divergence).

Evidence anchors: `writer.closeRun` updates only the run row —
`packages/app/src/services/inline-run-setup.ts:1097-1098`; the two-file state merge writer exists but
is not invoked on close — `packages/app/src/services/inline-run-setup.ts:936`. Preferred: call the
existing state-merge writer with the terminal status right after `closeRun` succeeds.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
