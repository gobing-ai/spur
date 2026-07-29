---
template: feature-impl
schema_version: 1
name: "Add the Supervisor tabview as the Teams module's first and default-active tab"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P1
tags: ["board", "web", "teams", "supervisor"]
dependencies: ["0371"]
created_at: "2026-07-29T00:15:02.364Z"
updated_at: "2026-07-29T00:25:43.375Z"
---

## 0378. Add the Supervisor tabview as the Teams module's first and default-active tab

### Background

The Teams module opens on Terminal (tabs.ts:15-20, TeamsShell selects the first entry), giving no team-wide operational overview. The nearest thing, the Activity tab, is a flat six-column event table that filters on the `'team.'` and `'supervisor.'` prefixes (ActivityTab.tsx:72) which have never fired — the `team.*` family did not exist until J3 authored it. This task builds the per-team, per-member operational view the operator asked for, on top of that new family plus the existing `agent.*`, `process.*`, and `message.*` events and the live GET /api/team/teams roster already served by `useTeamsData`. Note the tab contract in tabs.ts is documented as append-only with id-stable entries; placing Supervisor first is a deliberate exception to that ordering note and must be recorded, not silently taken.

### Requirements
- [ ] R1. Add Supervisor as the Teams module's first tab and make it the default-active tab, while keeping Terminal, Process, Message, and Activity reachable with their ids unchanged.
- [ ] R2. Show each team with its members, member id, agent type, and current state, making running members visually distinguishable from stopped ones.
- [ ] R3. Show per-member uptime since start and the time and kind of the most recent activity, derived from the team and agent lifecycle events.
- [ ] R4. Reflect team and member lifecycle events as they arrive, without requiring a manual page reload.
- [ ] R5. Expose the existing start, stop, up, and down controls with behaviour identical to the current Teams surfaces, refreshing the view after a mutation completes.
- [ ] R6. Render a configured team with an empty roster as an explicit empty-roster state rather than omitting it.
- [ ] R7. Surface an error when the roster feed fails while keeping already-loaded event-derived activity visible.
- [ ] R8. Reuse the shared `useTeamsData` feed rather than adding a third polling implementation, and record the tab-ordering exception against the append-only note in tabs.ts.
### Acceptance Criteria
```gherkin
Scenario: R18 — Supervisor is the Teams module's first and default-active tab
Scenario: R19 — Each team shows its members and their live state
Scenario: R20 — Member rows surface uptime and last activity
Scenario: R21 — Team lifecycle events drive the view
Scenario: R22 — Existing team controls are available from Supervisor
Scenario: R23 — A team with no members renders an explicit empty state
Scenario: R24 — Supervisor degrades when the roster feed fails
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
