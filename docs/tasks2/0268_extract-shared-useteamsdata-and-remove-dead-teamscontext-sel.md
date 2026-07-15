---
template: feature-impl
schema_version: 1
name: "Extract shared useTeamsData and remove dead TeamsContext selection"
description: ""
status: todo
type: task
profile: standard
feature_id: M2
parent_wbs: null
priority: P2
tags: ["teams", "cleanup"]
dependencies: []
created_at: "2026-07-15T23:03:21.145Z"
updated_at: "2026-07-15T23:04:02.182Z"
---

## 0268. Extract shared useTeamsData and remove dead TeamsContext selection

### Background

TerminalTab comments note a deferred useTeamsData hook; TeamsContext still exposes selection unused after Roster removal. Deduplicate polling and delete dead selection API before release.

### Requirements
R1. Introduce useTeamsData (or equivalent) for GET /api/team/teams with poll + AbortController.
R2. TerminalTab (and Processes bulk controls if needed) consume the hook.
R3. Remove unused selectedTeamId/selectedMemberId/select from TeamsContext if no consumers remain, or mark provider dead and drop it from shell.
R4. No behavior regression for Terminal pickers or Messages unfiltered feed.
R5. Update tests; no Roster references.
### Acceptance Criteria
```gherkin
@core
Scenario: Dead TeamsContext selection is gone or unused
  Given the web Teams module source
  When searching for selectedTeamId consumers in production UI
  Then no path depends on Roster-era shared selection

@edge
Scenario: Terminal still loads teams after hook extraction
  Given teams exist in config
  When TerminalTab mounts
  Then team dropdown populates as before
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Shared teams fetch + delete dead selection**

- Extract `useTeamsData(): { teams, error, reload }` with 5s poll (match TerminalTab TEAMS_POLL_MS).
- TerminalTab uses the hook; bulk controls (0266) can share it.
- Audit TeamsContext: if only provider shell remains, remove selection fields and simplify provider or delete if unused.
- Surgical: no Messages behavior change.
### Plan
1. Add useTeamsData.ts; migrate TerminalTab.
2. Grep and remove dead selection API.
3. Regression tests for Terminal pickers.
4. lint + test teams module.
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
