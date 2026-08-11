---
template: feature-impl
schema_version: 1
name: "Run real-data full-mode verification pass for history import (0504 R1 on the 1.7 GB DB)"
description: ""
status: todo
type: task
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T03:54:32.827Z"
updated_at: "2026-08-11T03:54:50.680Z"
---

## 0505. Run real-data full-mode verification pass for history import (0504 R1 on the 1.7 GB DB)

### Background



### Requirements
- [ ] R1. Run a real-data all-source full dry-run using a source-local CLI (`bun run apps/cli/src/index.ts`), recording the provenance header; confirm the reported stale-row counts match the stale Gemini/OpenCode rows identified during 0504 forensics without mutating the database.
- [ ] R2. Execute one full-mode write for the affected sources and confirm the source-scoped reconciliation removed the stale target/tool/ledger/checkpoint rows.
- [ ] R3. Re-run the same full dry-run/write and confirm a second full run reports zero changes.
- [ ] R4. Verify `PRAGMA integrity_check = ok`, zero unknown messages, and zero orphan tool calls on the 1.7 GB database after the pass.
### Acceptance Criteria
Scenario: Real-data dry-run previews the exact reconciliation
  Given the 1.7 GB history database with known stale derived rows
  When an all-source full dry-run is executed via a source-local CLI
  Then the transcript records the source-local binary and importer version before the run
  And the reported stale-row counts match the forensics findings without changing the database

Scenario: Full write applies the reconciliation transactionally
  When one full-mode write is executed for the affected sources
  Then stale target, tool, ledger, and checkpoint rows are removed per source in one transaction
  And no manual SQLite statements were required

Scenario: Second full run is a no-op
  When the same full run is executed again
  Then it reports zero changes

Scenario: Post-pass integrity
  Then `PRAGMA integrity_check` returns `ok` and the database has zero unknown messages and zero orphan tool calls
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

E

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
