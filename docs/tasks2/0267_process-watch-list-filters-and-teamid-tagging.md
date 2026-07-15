---
template: feature-impl
schema_version: 1
name: "Process watch list filters and teamId tagging"
description: ""
status: todo
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P2
tags: ["teams", "process-registry"]
dependencies: []
created_at: "2026-07-15T23:03:21.136Z"
updated_at: "2026-07-15T23:03:57.966Z"
---

## 0267. Process watch list filters and teamId tagging

### Background

After 0264, GET /api/team/processes returns supervisor processes + ProcessRegistry executions. The UI shows a flat list. Operators need running-only / source filters, and supervised spawns should carry teamId when known for grouping.

### Requirements
R1. Supervisor start path tags teamId when the agent belongs to a known team (from team config / roster materialize).
R2. ProcessesTab offers filters: running-only, source (supervisor|one-shot|other), optional team.
R3. Filter state may be ephemeral (no persistence required for v1).
R4. Empty state when filters hide all rows.
R5. Tests for filter logic (unit on buildWatchRows or pure filter helper) + API teamId when available.
### Acceptance Criteria
```gherkin
@core
Scenario: Process watch list can focus running registry executions
  Given supervised and exited one-shot executions exist
  When the operator enables running-only filter
  Then exited rows are hidden

@edge
Scenario: Supervised spawns carry teamId when team membership is known
  Given agent alpha-claude belongs to team alpha
  When supervisor starts the agent
  Then the registry execution includes teamId alpha (or equivalent association)
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Filters + teamId on registry rows**

- UI: lightweight toggle/selects above Processes table (running-only, source multi-select).
- Pure helper `filterWatchRows(rows, filters)` for unit tests.
- Server: when SupervisorService starts an agent, resolve teamId from team config if available (TeamService or config map passed into supervisor). Pass `teamId` in PipeProcessOptions.
- If team membership is ambiguous (agent in multiple teams), pick first or leave unset — document in Q&A.
### Plan
1. Add filterWatchRows helper + UI controls in ProcessesTab.
2. Thread teamId into supervisor start when resolvable.
3. Tests for filters and teamId tag.
4. Update empty-state copy for "no matches".
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

M2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
