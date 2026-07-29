---
template: feature-impl
schema_version: 1
name: "Author and emit the team.* event family for team and member lifecycle"
description: ""
status: todo
type: task
profile: standard
feature_id: J3
parent_wbs: null
priority: P1
tags: ["observability", "teams", "data-plane"]
dependencies: ["0367"]
created_at: "2026-07-29T00:14:03.025Z"
updated_at: "2026-07-29T00:25:26.386Z"
---

## 0371. Author and emit the team.* event family for team and member lifecycle

### Background

There is no `team.*` event family anywhere in SYSTEM_EVENT_CATALOG. Team lifecycle operations — `spur team up`, `down`, `assign`, and the server's POST /api/team/:team/up and /down — emit nothing. The only adjacent signal is `agent.started`/`agent.stopped` from TeamOrchestrator and `process.spawned|exited|stopped` from SupervisorService, of which the entire ledger holds 3 rows. Meanwhile the Teams Activity tab already filters for the `'team.'` and `'supervisor.'` prefixes (ActivityTab.tsx:72) — prefixes that have never once fired. The Supervisor tabview in feature J4 has no data to render until this family exists, which is precisely the gap the operator anticipated when requesting it.

### Requirements
- [ ] R1. Define the `team.*` catalog entries covering team up, team down, member assignment, and member state change, with renderers, tiers, and payload policies consistent with the existing families.
- [ ] R2. Emit them from the owning services (TeamService, TeamOrchestrator, SupervisorService) on the injected event bus, following the existing `agent.*` wiring precedent from task 0237.
- [ ] R3. Payloads carry `teamId`, `memberId`, and `agentType` plus the operation outcome; they stay metadata-only, with no message bodies or command lines.
- [ ] R4. Resolve the row `actor` to the member identity via the existing `extractSystemEventActor` contract, extending it only if the member identity is not already reachable through `actor` or `agentId`.
- [ ] R5. An event referencing a member absent from the current roster must persist with null unresolved fields rather than being dropped.
- [ ] R6. Ensure the events reach the ledger from both the server path and the CLI path, consistent with the bridge task.
- [ ] R7. Add the new entries to the producer audit table with emit site and reachability status.
### Acceptance Criteria
```gherkin
Scenario: R15 — Team lifecycle transitions emit cataloged events
Scenario: R16 — Member state changes are attributable to a team and an agent type
Scenario: R17 — A team event for an unknown member still persists
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

J3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
