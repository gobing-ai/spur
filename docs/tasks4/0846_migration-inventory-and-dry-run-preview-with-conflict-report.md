---
schema_version: 1
name: Migration inventory and dry-run preview with conflict reporting
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.298Z
updated_at: "2026-09-12T04:56:46.490Z"
feature_id: G64
priority: P2
tags:
  - g6-program

---

## 0846. Migration inventory and dry-run preview with conflict reporting

### Background

The preserve/convert/retire matrix is already written
(`docs/reports/g6-runtime-inventory.md` §4) but nothing executes it. The corpus holds four spec
populations that must be told apart before anything is rewritten: generated specs materialized from
`agent.team.<id>`, hand-authored specs, orphan specs whose team no longer exists, and teams whose
`work_dir` disagrees with the registered project path.

Robin owns the cutover window and has not selected one (G64 Notes). Evidence therefore has to precede
the decision: a report he can read before authorizing any destructive step.

This task writes nothing. Conversion is the next task.

### Requirements

- **R1** — An inventory of every legacy artifact per the §4 matrix, classified as convert, preserve,
  re-link, or retire.
- **R2** — A dry-run preview listing each planned action with its target identity and its conflicts.
- **R3** — Zero writes: no file, config, or database row changes during inventory or preview.
- **R4** — Conflicts are named explicitly: two legacy teams resolving to one project path, `work_dir`
  disagreeing with the project, orphan specs, and duplicate spec ids.
- **R5** — Output is machine-readable (`--json`) as well as operator-readable.

### Acceptance Criteria

```gherkin
Feature: Migration inventory and dry-run preview

  @core
  Scenario: Migration previews before it changes anything
    Given an existing project with team config, generated specs, manual specs, and orphans
    When the migration runs in dry-run
    Then it reports every conversion, preservation, and retirement with its conflicts
    And no file, config, or database row has changed

  @core
  Scenario: Conflicts are named, not summarized
    Given two legacy teams resolving to one project path
    When the preview runs
    Then the conflict is reported with both sources and no merge is proposed
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
- Disposition matrix: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4 preserve/convert/retire
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Migration and delivery order"
- Gate: Robin owns the compatibility and removal window (G64 Notes)

### History
