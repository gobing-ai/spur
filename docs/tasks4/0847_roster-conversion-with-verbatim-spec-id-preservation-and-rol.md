---
schema_version: 1
name: Roster conversion with verbatim spec-ID preservation and rollback
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.301Z
updated_at: "2026-09-12T04:56:46.663Z"
feature_id: G64
priority: P2
tags:
  - g6-program

dependencies: ["0846", "0835"]
---

## 0847. Roster conversion with verbatim spec-ID preservation and rollback

### Background

This is the highest-risk step in the program. A spec id (`teamId-memberId`) **is** the mailbox
identity and the occupant address in `coordination_runs`; rewriting one orphans inbox rows and
coordination records with no rollback once ids change
(`docs/reports/g6-runtime-inventory.md` §4). The `<role>-<n>` suffix derives from frozen roster order
(`packages/app/src/services/team-service.ts:687-727`), so a reorder during conversion silently
reallocates identities.

Any alias table introduced to bridge an unavoidable rename is a compatibility shim and belongs under
ADR-058 with an explicit exit condition — not an indefinite dual-write.

Historical messages are never deleted.

### Requirements

- **R1** — `agent.team.<id>` blocks convert to project fleet declarations; hand-authored specs are
  preserved untouched.
- **R2** — Every spec id is preserved verbatim, or mapped through a recorded alias; no inbox or
  coordination row is orphaned.
- **R3** — Deterministic `<role>-<n>` derivation is preserved for existing members regardless of
  declaration order.
- **R4** — Conversion is idempotent: re-running changes nothing.
- **R5** — Backup before write and a rollback path that restores the prior state.
- **R6** — Any alias table is tracked under ADR-058 with an explicit exit condition; no indefinite
  dual-writing of rosters or queues.
- **R7** — Conflicts halt rather than merge or delete; no historical message is removed.

### Acceptance Criteria

```gherkin
Feature: Roster conversion with verbatim spec-ID preservation

  @core
  Scenario: Mailbox identity survives conversion
    Given generated specs addressed by existing inbox and coordination rows
    When the migration converts the roster
    Then every spec id is preserved verbatim or mapped through a recorded alias
    And no inbox or coordination row is orphaned

  @core
  Scenario: Conflicts halt rather than merge silently
    Given two legacy teams resolving to one project path, or a work_dir that disagrees with the project
    When the migration encounters them
    Then it reports the conflict and stops without merging or deleting
    And rollback restores the prior state

  @core
  Scenario: Re-running changes nothing
    Given a project already migrated
    When the migration runs again
    Then no further change is written
```

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

- Parent feature: [G64 — Retire Workspace, Inbox, Teams, and spur team](../features/G64_retire-workspace-inbox-teams-and-spur-team.md)
- Disposition matrix: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4, including rollback constraints
- Code: `packages/app/src/services/team-service.ts:687-727`, `:745-790` (deterministic `<role>-<n>` derivation)
- Compatibility shims tracked under ADR-058 (`docs/00_ADR.md`) with an explicit exit condition
- Preserved owner: G4 (occupant identity, coordination run records)

### History
