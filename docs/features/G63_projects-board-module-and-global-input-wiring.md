---
schema_version: 1
id: "G63"
name: "Projects board module and global input wiring"
status: backlog
priority: P2
tags: ["g6-program"]
created_at: "2026-09-12T04:42:44.189Z"
updated_at: "2026-09-12T04:45:20.841Z"
---

# G63: Projects board module and global input wiring

## Goal

Replace Workspace, Inbox, and Teams in the Spur Board with one **Projects** module — Conversation,
Agents, Work — and turn the global floating input from a UI stub into a real durable submission to
the selected project's orchestrator, with honest receipt and result states on every Board route.

This is the UI half of the G6 requirement and the part with no production code today:
`GlobalAgentBar` still clears the field and shows a stub notice
(`apps/web/src/components/GlobalAgentBar.tsx:36–39`).

## Scope

- In:
    - **Projects module** — opens the selected project directly, with a compact header showing
      project/worktree, active strategy, orchestrator availability, and fleet capacity. The existing
      project switcher supplies selection; no second team or workspace selector.
    - **Three views**: **Conversation** (human requests, orchestrator responses, holds, result links),
      **Agents** (roster → member detail: role/executor/current work, process, terminal, messages,
      activity), **Work** (reuses existing task/feature views; a task can be referenced into the
      conversation). A project with zero agents still opens and explains what is missing.
    - **Global input wired end to end** — same conversation and submission path on every Board route.
      Submission captures project identity and task/feature references explicitly; the server
      validates them against its project context and persists the request before acknowledging.
      The composer clears only the submitted revision after a durable receipt; a newer edited draft
      survives; drafts are retained per project and never leak across projects.
    - **Identity keyed on project path, never on label** — two projects with identical names must be
      unambiguous; navigation or a project switch cannot retarget an in-flight request, and a late
      result lands in its originating project.
    - **Honest states, each distinct and actionable**: `queued-awaiting-orchestrator` (never rendered
      as "working"), orchestrator missing vs offline, `rest-held`, `executor-unavailable`, `blocked`,
      `failed-delivery`, `outcome-unknown` (guidance is reconcile, not an unconditional retry button),
      and `completed-exit-only` labeled as unverified.
    - **Interaction quality** — Enter submits, Shift+Enter inserts a newline, IME composition never
      submits, Escape closes member detail and restores focus, tabs are keyboard-navigable with
      `aria-selected`, status is never color-alone, live-region announcements, results survive refresh.
      DESIGN.md tokens; verified at 390 px and 1440 px with no horizontal overflow.
- Out:
    - Deleting the old Board routes, retiring `spur team`, or migrating config (G64 — the new module
      lands alongside the old routes until Robin picks the cutover window).
    - Backend delivery/receipt mechanics (G61) and strategy/capacity/lease runtime (G62).
    - Cross-project dashboards or a fleet-wide control surface.
    - A new design-system dependency; reuse DESIGN.md and existing Board components.

## Acceptance Criteria

```gherkin
Feature: Projects board module and global input wiring

  @core
  Scenario: R1 — Projects opens the selected project with Conversation, Agents, and Work
    Given a registered project is selected in the switcher
    When the operator opens Projects
    Then the header shows worktree, strategy, orchestrator availability, and capacity
    And Conversation, Agents, and Work are reachable by keyboard

  @core
  Scenario: R2 — A submission becomes a durable request before acknowledgement
    Given the operator types into the global input on any Board route
    When the request is submitted
    Then the server persists it against the submitting project and returns a receipt
    And the composer clears only the submitted revision, preserving any newer edit

  @core
  Scenario: R3 — A failed submission never loses the draft
    Given acknowledgement fails
    When the operator resubmits the same payload
    Then the same request identity is reused with no duplicate request
    And an edited payload creates a new request

  @core
  Scenario: R4 — Project identity survives navigation
    Given a request submitted in one project
    When the operator switches projects before the result arrives
    Then the result appears in the originating project only
    And the other project's conversation and drafts are untouched

  @core
  Scenario: R5 — Every non-nominal state is named and actionable
    Given any of orchestrator-missing, orchestrator-offline, rest-held, executor-unavailable, failed-delivery, or outcome-unknown
    When the operator reads the receipt
    Then each state is distinctly labeled with its next action
    And a persisted-but-unconsumed request says so rather than showing progress

  @core
  Scenario: R6 — A run exit is never shown as a verified result
    Given a run that exited zero without workflow verification
    When its result renders
    Then it is labeled unverified and does not present the task as complete

  @core
  Scenario: R7 — Keyboard, IME, and accessibility hold
    Given the composer has focus with an IME active
    When Enter ends the composition
    Then nothing is submitted
    And Shift+Enter inserts a newline, Escape restores focus to its opener, and status uses icon plus text rather than color alone
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0840 | Projects module shell with header and project-path identity | todo |
| 0841 | Conversation view with per-project drafts and reference capture | todo |
| 0842 | Agents view: fleet roster and member detail | todo |
| 0843 | Work view reusing task and feature surfaces with reference chips | todo |
| 0844 | Global input durable submission with receipt and result states | todo |
| 0845 | Keyboard, IME, accessibility, and responsive verification for Projects | todo |
<!-- END AUTO-GENERATED -->

## Notes

Reviewable prototype for this module already exists and should be the implementation reference:
`docs/prototypes/g6-projects/index.html` with 19 happy-dom regression tests
(`apps/web/tests/prototypes/g6-projects.test.ts`, 200 assertions) and Chrome evidence at 390/1440 px —
see [projects prototype report](../reports/g6-projects-prototype.md) for the full scenario matrix
(R2-1…R2-7, R3-1…R3-8, KB-1…KB-4, ST-1, LB-1). Robin approved the Conversation/Agents/Work structure
on 2026-09-11 and asked to review the concrete prototype before the detailed interactions are built.

Depends on G61 (durable receipts and result correlation) and G62 (strategy, capacity, orchestrator
availability shown in the header). The prototype's fixtures simulate both; wiring them to the real
runtime is this feature's work.

Retained production transports the module reuses rather than replaces: `/api/messages*`,
`/api/team/*` process/terminal/stream, `/api/projects*`. Existing Board routes stay usable until G64.

### Open decisions (Robin)

- Review the prototype before the detailed interactions are implemented (carried from G6).
- Whether Projects ships behind a nav flag alongside Workspace/Inbox/Teams, or replaces the nav entry
  in the same release as G64's route retirement.

## History
