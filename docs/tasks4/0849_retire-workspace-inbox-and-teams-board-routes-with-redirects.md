---
schema_version: 1
name: Retire Workspace, Inbox, and Teams board routes with redirects
status: todo
template: feature-impl
created_at: 2026-09-12T04:55:45.302Z
updated_at: "2026-09-12T04:56:47.034Z"
feature_id: G64
priority: P2
tags:
  - g6-program

dependencies: ["0845"]
---

## 0849. Retire Workspace, Inbox, and Teams board routes with redirects

### Background

Workspace, Inbox, and Teams are registered Board modules
(`apps/web/src/modules/registry.ts`, with shells under `apps/web/src/modules/workspace`, `inbox`,
`teams`). G63 lands Projects alongside them; this task removes them once Projects covers their
function.

Bookmarks and deep links exist, so removal needs redirects into the equivalent Projects view rather
than a dead route.

The `--agent <spec-id>` warn-once shim is retired here too, after confirming no workflow or plugin
still uses it (`docs/reports/g6-runtime-inventory.md` §4).

### Requirements

- **R1** — Workspace, Inbox, and Teams navigation entries and modules are removed only after G63 is
  functionally complete.
- **R2** — Existing routes and bookmarks redirect into the equivalent Projects view; no Board
  capability becomes unreachable.
- **R3** — The `--agent <spec-id>` shim is removed after confirming no workflow or plugin usage.
- **R4** — Removal is gated on Robin's recorded cutover window.
- **R5** — Board tests referencing the retired modules move to their Projects equivalents rather than
  being deleted.

### Acceptance Criteria

```gherkin
Feature: Retire Workspace, Inbox, and Teams board routes

  @core
  Scenario: Board routes retire with a migration path
    Given Workspace, Inbox, and Teams routes and bookmarks
    When the navigation entries are removed
    Then existing routes redirect into the equivalent Projects view
    And no Board capability is unreachable

  @core
  Scenario: The spec-id shim retires only when unused
    Given the --agent spec-id warn-once shim
    When no workflow or plugin caller remains
    Then the shim is removed
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
- Code: `apps/web/src/modules/registry.ts`; `apps/web/src/modules/workspace`, `inbox`, `teams`
- Shim: `--agent <spec-id>` warn-once path — [G6 runtime inventory](../reports/g6-runtime-inventory.md) §4

### History
