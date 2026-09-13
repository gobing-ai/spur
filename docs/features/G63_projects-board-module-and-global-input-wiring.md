---
schema_version: 1
id: "G63"
name: "Projects board module and global input wiring"
status: done
priority: P2
tags: ["g6-program"]
created_at: "2026-09-12T04:42:44.189Z"
updated_at: "2026-09-13T03:31:00.930Z"
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
  Scenario: An empty project still opens
    Given a registered project has no fleet declaration
    When the operator opens Projects
    Then the shell names the absence and the expected fleet.json path with tabs still mounted

  @core
  Scenario: Identical labels stay distinct
    Given two registered projects share a display name
    When both are opened
    Then each is identified by its canonical worktree path, never by name

  @core
  Scenario: R2 — A submission becomes a durable request before acknowledgement
    Given the operator types into the global input on any Board route
    When the request is submitted
    Then the server persists it against the submitting project and returns a receipt
    And the composer clears only the submitted revision, preserving any newer edit

  @core
  Scenario: Drafts stay with their project
    Given a typed draft exists for one project
    When the operator switches to another project and back
    Then each project's composer shows only its own draft, never the other's

  @core
  Scenario: The thread survives a refresh
    Given a request and a response exist in the project inbox
    When the operator reloads the page
    Then the thread is rebuilt from the server inbox reads, not client state

  @core
  Scenario: References are explicit
    Given the operator captures a task or feature reference onto a draft
    When the draft renders
    Then each reference shows as a removable chip and is never parsed from prose

  @core
  Scenario: Corrupt storage degrades safely
    Given the stored draft record is corrupt or shape-mismatched
    When the composer loads
    Then it starts from an empty draft and overwrites the stale record without throwing

  @core
  Scenario: The roster shows the project fleet
    Given the project has declared members and live orchestrator claims
    When the Agents tab opens
    Then every member renders exactly once as the join of declared roster and claimed instance

  @core
  Scenario: Declared and observed are separate
    Given a member's claim state disagrees with its declared role
    When the roster renders
    Then declared and observed facts render as separate labeled elements with no combined status

  @core
  Scenario: Detail opens and returns focus
    Given the operator opens a member's detail terminal
    When the operator presses Escape
    Then the detail closes and focus returns to the opener

  @core
  Scenario: Work reuses the existing views
    Given a project with tasks and features
    When the Work view opens
    Then it renders the existing task and feature surfaces scoped to that project

  @core
  Scenario: A task can be referenced into a request
    Given a task shown in Work
    When the operator references it into the conversation
    Then the composer carries it as a structured reference

  @core
  Scenario: A submission becomes a durable request before acknowledgement
    Given the operator submits the global input
    When the acknowledgement is in flight
    Then the request identity is already durable

  @core
  Scenario: A failed submission never loses the draft
    Given acknowledgement fails
    When the operator resubmits the same payload
    Then the same request identity is reused with no duplicate request

  @core
  Scenario: Project identity survives navigation
    Given a submission from one project
    When the operator navigates away and back
    Then the receipt feed still shows that project's requests only

  @core
  Scenario: Every non-nominal state is named and actionable
    Given a request in any non-nominal receipt state
    When the results feed renders it
    Then the state is named with its one available action

  @core
  Scenario: A run exit is never shown as a verified result
    Given a request whose run exited 0 without verification
    When the results feed renders its outcome
    Then the exit is shown as unverified, never as a verified result

  @core
  Scenario: Keyboard, IME, and accessibility hold
    Given the global input, tabs, and receipt feed
    When the operator drives them with keyboard and IME composition only
    Then every control is reachable, named, and announced

  @core
  Scenario: Layout holds at both widths
    Given the board rendered at 390px and 1440px
    When every view is measured
    Then no view scrolls horizontally and content stays reachable

  @core
  Scenario: State changes are announced
    Given a receipt transition in the global bar
    When the state changes
    Then the live region announces the new state's label and next action

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
on 2026-09-11.

Depends on G61 (durable receipts and result correlation) and G62 (strategy, capacity, orchestrator
availability shown in the header). The prototype's fixtures simulate both; wiring them to the real
runtime is this feature's work.

Retained production transports the module reuses rather than replaces: `/api/messages*`,
`/api/team/*` process/terminal/stream, `/api/projects*`. Existing Board routes stay usable until G64.

### Decisions closed at implement-ready refinement (2026-09-12, Robin may override)

- **Prototype review → gate moved to implementation, not planning.** The prototype was read line by
  line during this refine and is now frozen into the task specs: its STATUS vocabulary
  (`index.html:285-307`) is lifted verbatim into 0844's `RECEIPT_LABELS`, its live-region pattern
  (`index.html:115,135-136`) into 0845, and its scenario matrix into 0845's port table. The prototype
  suite is **kept**, not deleted — 0845 ports scenarios beside it rather than replacing it. Robin's
  visual review remains an operator gate before 0841–0845 merge; it no longer blocks task refinement.
- **Nav flag vs. replacement → ships additively, no flag.** Projects registers as a new module
  alongside Workspace/Inbox/Teams (task 0840 R6); no route is removed and no config knob is added.
  Route retirement and redirects stay with G64 task 0849, which already owns that migration. A flag
  would be a config value that only ever flips once.

### Premise corrections made during this refine

Each was a factual claim in the feature or an earlier task draft that did not survive verification
against the current tree; all are corrected in the tasks, not deferred.

- **Single project per server.** The Board serves one project, so `/api/project` gains the canonical
  `path` rather than a second project selector; `ProjectSwitcher.handleSelect` navigates to another
  server's port (0840).
- **Cross-project draft leakage is impossible** — separate ports are separate origins, so
  `localStorage` cannot leak across projects. The real hazard is **port reuse** by a different
  project, closed by a stored-`path` guard rather than by namespacing keys (0841).
- **`KanbanBoard`, not `TaskKanbanView`, is the Work-view embed seam** — `useTaskParams.selectTask`
  navigates out of the module, while `KanbanBoard`'s `onSelectTask` prop keeps selection inside it (0843).
- **Work needs no project filter** — the corpus endpoints already serve exactly one project (0843).
- **`ProjectProvider` and `ConversationDraftContext` are provided in `BoardLayout`**, not in
  `ProjectsShell`: `GlobalAgentBar` mounts at `BoardLayout.tsx:161`, outside `<Outlet/>` (0840, 0841).
- **`blocked` now has a first-class source.** The prototype records at `index.html:301` that the
  runtime had none. G62's 0838 `DispatchHold` supplies it, joined to the request through 0833's
  `coordination_runs.task_id`; `rest-after-drain` and `executor-unavailable` are the same enum's other
  reasons. No occupancy heuristic is used (0844).
- **A browser GET must not mutate.** 0834's `reconcile()` writes the terminal `attempts-exhausted`
  marking, so 0844 consumes a new pure `classify()` and adds a read-only `GET /api/project/requests`
  instead of widening `TeamService.getInbox`, which would push three joins onto `spur message inbox`
  and change an existing CLI `--json` shape (0844).
- **`capabilityState: 'unknown'` is not unavailable** (`packages/config/src/index.ts:233`) — it
  classifies as `queued-awaiting-orchestrator`, never `executor-unavailable` (0844).
- **happy-dom cannot prove the 390 px overflow requirement** — it has no layout engine, and the
  repo's own responsive test asserts labels rather than geometry. 0845 splits R4 into a structural
  half in happy-dom and a geometric half in an untracked `.spur/run/g63-projects/browser-check.mjs`
  using the operator-local Playwright install, leaving `package.json` and harness-surface governance
  untouched.

## History

- 2026-09-13T03:30:59.981Z backlog → active (system)
- 2026-09-13T03:31:00.466Z active → verifying (system)
- 2026-09-13T03:31:00.930Z verifying → done (system)

