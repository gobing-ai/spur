---
template: feature-impl
schema_version: 1
name: "Add Teams bulk Up/Down controls without Roster"
description: ""
status: todo
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P1
tags: ["teams", "roster-redistribution"]
dependencies: []
created_at: "2026-07-15T23:03:21.128Z"
updated_at: "2026-07-15T23:03:53.834Z"
---

## 0266. Add Teams bulk Up/Down controls without Roster

### Background

M1 dropped Roster and redistributed bulk Up/Down. CLI and POST /api/team/:team/up|down exist, but the Board lacks an obvious bulk control surface. Operators currently need CLI for team-wide start/stop.

### Requirements
R1. Add a Teams UI control (Terminal toolbar or Processes header or thin Team Control strip) for team Up and Down.
R2. Call existing POST /api/team/:team/up and .../down (with optional check/purge as designed).
R3. Show success/error feedback; refresh process/team status after action.
R4. Do not reintroduce a Roster tab.
R5. Tests cover control presence and mocked API posts.
### Acceptance Criteria
```gherkin
@core
Scenario: Team Up and Down are available without Roster
  Given a project with at least one configured team
  When the operator clicks Up for that team in the Teams UI
  Then POST /api/team/:team/up is issued
  And process/team status refreshes

@core
Scenario: Down stops the team via existing API
  Given a running team
  When the operator clicks Down
  Then POST /api/team/:team/down is issued
  And no Roster tab is present
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Bulk team controls on the Board (Roster redistribution finish)**

- Server: `POST /api/team/:team/up` and `.../down` already exist (team module).
- UI placement (recommend Processes header or thin strip above Teams tabs):
  - Team select (reuse teams list) + Up + Down buttons.
  - Confirm modal on Down (destructive), similar to Terminal stop confirm.
- Keep Terminal per-member Start/Stop; bulk is team-scoped.
- Do not re-add RosterTab.
### Plan
1. Add TeamControlStrip component (or Processes/Terminal header controls).
2. Wire Up/Down to existing APIs with fetchWithTimeout.
3. Confirm modal for Down; error banner on failure.
4. Tests for buttons + POST URLs.
5. Manual smoke with spur serve + configured team.
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
