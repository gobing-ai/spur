---
schema_version: 1
name: Retire spur team after migrating its callers to owning nouns
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.302Z
updated_at: "2026-09-12T04:56:46.836Z"
feature_id: G64
priority: P2
tags:
  - g6-program

dependencies: ["0847"]
---

## 0848. Retire spur team after migrating its callers to owning nouns

### Background

`spur team` carries assign, status, up, down, start, and stop. Retiring the noun before those
capabilities land elsewhere would delete function, which the design forbids: `TeamService`
capabilities are moved, not deleted with the command
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "CLI and Board disposition").

Robin's brief is explicit that launching consolidates into `spur self` or config, with no separate
`spur team` CLI exposure.

Public-surface consent governs any new verb added to an owning noun
(`docs/design/harness-surface-governance.md`).

### Requirements

- **R1** — Each of assign / status / up / down / start / stop is reachable under its owning noun
  (`spur agent`, `spur message`, `spur projects`, `spur self`, or the task write service) before
  removal.
- **R2** — `TeamService` capabilities are moved, not deleted alongside the command.
- **R3** — Any new verb on an owning noun follows public-surface consent with design context.
- **R4** — Plugin, workflow, and script callers of `spur team` are migrated in the same slice.
- **R5** — Removal is gated on Robin's recorded cutover window; until then the noun warns rather than
  disappears.
- **R6** — No capability is lost with the command; a coverage table maps each old verb to its new home.

### Acceptance Criteria

```gherkin
Feature: Retire spur team after migrating its callers

  @core
  Scenario: spur team is retired only after its callers move
    Given the team noun's assign, status, up, down, start, and stop callers
    When the noun is removed
    Then each capability is reachable under its owning noun
    And no capability is lost with the command

  @core
  Scenario: Removal waits for the recorded window
    Given no cutover window has been recorded
    When the migration slice ships
    Then the noun warns about retirement and continues to work
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
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "CLI and Board disposition"
- Governance: `docs/design/harness-surface-governance.md` (public-surface consent)
- CLI reference: `plugins/sp/skills/spur-cli/references/`

### History
