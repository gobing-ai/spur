---
schema_version: 1
name: Projects module shell with header and project-path identity
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.540Z
updated_at: "2026-09-12T04:58:47.937Z"
feature_id: G63
priority: P2
tags:
  - g6-program

---

## 0840. Projects module shell with header and project-path identity

### Background

The Board has no Projects module. `apps/web/src/modules/` holds `workspace`, `inbox`, `teams`,
`features`, `task-kanban`, `history`, `observability` — registered through
`apps/web/src/modules/registry.ts`. Workspace requires a project-local team and renders empty without
one (`apps/web/src/modules/workspace/WorkspaceShell.tsx:18`), which is exactly the concept overlap
this program removes.

The project switcher and `/api/projects*` already exist and supply selection; this task adds the
module that opens the selected project directly, with no second team or workspace selector.

Two projects may carry identical labels, so the module keys identity on the canonical worktree path —
the prototype covers this as LB-1 (`docs/reports/g6-projects-prototype.md`).

### Requirements

- **R1** — A `projects` module registered in the Board module registry, opening the switcher-selected
  project directly.
- **R2** — A compact header showing project/worktree, active strategy, orchestrator availability
  (missing versus offline), and fleet capacity.
- **R3** — Conversation, Agents, and Work are reachable as keyboard-navigable tabs with
  `aria-selected`; deep links resolve to a tab.
- **R4** — Identity is keyed on the canonical project path, never the label; two identically named
  projects stay unambiguous.
- **R5** — A project with zero agents, no orchestrator, or an unreachable worktree still opens and
  names what is missing.
- **R6** — Ships alongside Workspace/Inbox/Teams; no route is removed here (G64 owns retirement).
- **R7** — DESIGN.md tokens only; no new design-system dependency.

### Acceptance Criteria

```gherkin
Feature: Projects module shell with header and project-path identity

  @core
  Scenario: R1 — Projects opens the selected project with Conversation, Agents, and Work
    Given a registered project is selected in the switcher
    When the operator opens Projects
    Then the header shows worktree, strategy, orchestrator availability, and capacity
    And Conversation, Agents, and Work are reachable by keyboard

  @core
  Scenario: An empty project still opens
    Given a project with no agents and no bound orchestrator
    When it is opened
    Then the module renders and names what is missing rather than showing an empty shell

  @core
  Scenario: Identical labels stay distinct
    Given two registered projects with the same display name
    When either is opened
    Then the module resolves it by canonical worktree path
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

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Projects Board information architecture"
- Reference implementation: `docs/prototypes/g6-projects/index.html`; [projects prototype report](../reports/g6-projects-prototype.md) (LB-1 identical labels)
- Code: `apps/web/src/modules/registry.ts`; `apps/web/src/modules/workspace/WorkspaceShell.tsx:18`
- Design system: root `DESIGN.md`

### History
