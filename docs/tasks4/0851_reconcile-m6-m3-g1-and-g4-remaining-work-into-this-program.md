---
schema_version: 1
name: Reconcile M6, M3, G1, and G4 remaining work into this program
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.303Z
updated_at: "2026-09-12T04:56:47.408Z"
feature_id: G64
priority: P3
tags:
  - g6-program

dependencies: ["0846"]
---

## 0851. Reconcile M6, M3, G1, and G4 remaining work into this program

### Background

Four existing features overlap this retirement and must not be duplicated. M6 carries Workspace
Overview removal and the Inbox/Teams label split (backlog). M3 carries Teams board UX (verifying).
G1 owns message events, API, and watch. G4 owns occupant identity, identity-pinned wait, and
coordination run records.

G1 and G4 stay authoritative — G61–G63 reuse them rather than forking a parallel path (G61 Notes).
M6 and M3 describe work on surfaces this feature retires, so their remaining scope either becomes a
concrete task here or is closed at its own owner with evidence.

G64's Notes are explicit: do not re-status M3, M6, G1, or G4 as part of this planning.

### Requirements

- **R1** — M6's remaining scope is either converted to a concrete task under this program or closed at
  its own owner with evidence.
- **R2** — M3's verifying work is reconciled against the retirement rather than re-implemented on a
  surface being removed.
- **R3** — G1 and G4 remain authoritative for message transport and occupant identity; this program
  reuses them.
- **R4** — No duplicate ticket is created for work an existing feature already owns.
- **R5** — The reconciliation is recorded so the overlap is auditable after the fact.

### Acceptance Criteria

```gherkin
Feature: Reconcile overlapping features into the retirement program

  @core
  Scenario: Overlapping scope is resolved once
    Given M6 and M3 carry work on surfaces this feature retires
    When the reconciliation completes
    Then each remaining item is either a concrete task here or closed at its owner with evidence
    And no duplicate ticket exists for work an existing feature already owns

  @core
  Scenario: Existing owners are preserved
    Given G1 owns message transport and G4 owns occupant identity
    When this program ships
    Then both remain authoritative and are reused rather than forked
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
- Overlapping owners: M6 (Workspace Overview removal / Inbox-Teams label split), M3 (Teams board UX), G1 (message events/API/watch), G4 (occupant identity)
- Constraint: do not re-status M3, M6, G1, or G4 here (G64 Notes)
- Feature index: `docs/features/INDEX.md`

### History
