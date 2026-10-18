---
schema_version: 1
name: Finalize lifecycle run rows left running by a manual transition
status: todo
template: issue
created_at: 2026-10-18T19:33:17.580Z
updated_at: "2026-10-18T19:33:36.739Z"

---

## 1257. Finalize lifecycle run rows left running by a manual transition

### Background

After 1246 reached `done` through `spur task record` + `spur task update ... done` plus `spur feature sync D66`, the project database holds `run_524dae91-f944-40e6-855b-b382ac852773` with `workflow_name='feature-lifecycle'`, `external_key='feature:D66'`, `status='running'`, empty `metadata_json`, and no `completed_at`. Nothing later finalizes it, so a Board or `spur agent status` read shows a live lifecycle run that no process owns.

Reproduced from `.spur/spur.db`: `select id, workflow_name, status, external_key from runs where status='running'`.

### Requirements

- [ ] R1. A lifecycle run opened by a task/feature transition is finalized (`done`/`failed`/`cancelled`) when the transition completes, including on the manual `spur task update` path.
- [ ] R2. `spur self status` or an ops verb can list and sweep run rows whose owning process is gone, so a crash does not leave a phantom `running` row.
- [ ] R3. A regression test drives one manual transition and asserts no `running` lifecycle row remains.

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
