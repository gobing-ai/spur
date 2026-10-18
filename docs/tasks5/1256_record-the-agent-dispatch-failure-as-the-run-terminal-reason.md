---
schema_version: 1
name: Record the agent dispatch failure as the run terminal reason
status: todo
template: issue
created_at: 2026-10-18T19:33:17.168Z
updated_at: "2026-10-18T19:33:36.102Z"

---

## 1256. Record the agent dispatch failure as the run terminal reason

### Background

Six of the eight `task-pipeline` runs in the D66 batch recorded `runs.terminal_reason = 'failed-check'` although every one of them died in an `action_runs.agent.run` dispatch (attestation refusal, model-not-found, ambiguous model, provider OAuth failure, account session limit, 45-minute implement timeout). Only `6078a8a6` recorded `retry-exhausted`.

`failed-check` names the quality-gate hop, so an operator reading the runs table or a Board status is pointed at the gate rather than the executor. Reproduced from `.spur/spur.db`: `select substr(id,1,8), terminal_reason from runs where workflow_name='task-pipeline' and status='failed'`.

### Requirements

- [ ] R1. A run whose terminal stage failed inside `agent.run` records a reason that names the failing hop and the executor (`agent-run:<executor>` or equivalent), not `failed-check`.
- [ ] R2. A dispatch failure keeps its own error class (attestation, model resolution, provider auth/quota, timeout) so the runs table is filterable by cause.
- [ ] R3. A regression test asserts the recorded reason for one dispatch failure per class.

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
