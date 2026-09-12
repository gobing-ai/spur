---
schema_version: 1
name: Work view reusing task and feature surfaces with reference chips
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.545Z
updated_at: "2026-09-12T06:03:31.975Z"
feature_id: G63
priority: P3
tags:
  - g6-program

dependencies: ["0840", "0841"]
---

## 0843. Work view reusing task and feature surfaces with reference chips

### Background

Task and feature views already exist as Board modules (`apps/web/src/modules/task-kanban`,
`apps/web/src/modules/features`). The Projects module must reuse them rather than fork a third task
surface — the design's Work view is "existing task and feature views, project-scoped"
(`docs/plans/2026-09-11-project-agent-fleet-brainstorm.md` § "Projects Board information
architecture").

The new capability is the bridge to Conversation: referencing a task or feature into a request as
structured data, which is what makes the request unambiguous to the orchestrator.

**Premise corrected during refinement (2026-09-11), two ways.**

*Scoping is already true.* One Board server instance serves exactly one project (task 0840
Background), and the task and feature endpoints read that server's own corpus. Everything these
components already fetch **is** the served project's work, so "project-scoped" needs no filter — only
an asserted invariant. Building a filter would add code that reads as a guarantee while guaranteeing
nothing.

*The embeddable wrapper is the wrong seam.* `TaskKanbanView`
(`apps/web/src/modules/task-kanban/index.tsx`) is exported headless for embedding, but it binds the
board to `useTaskParams`, whose `selectTask` navigates to `/board/tasks/<wbs>`
(`apps/web/src/modules/task-kanban/useTaskParams.tsx:44-51`) — out of the Projects module on every
card click. `KanbanBoard` already takes `onSelectTask` as a required prop
(`apps/web/src/modules/task-kanban/KanbanBoard.tsx:41-52`), so the identical rendering path is reused
one level down with a project-local handler.

### Requirements

- **R1** — Work embeds the existing task and feature board components; no new task-rendering code path
  and no fork of either module.
- **R2** — A task or feature can be referenced into the conversation as a structured reference chip,
  captured at selection time rather than parsed out of the composer's text.
- **R3** — Work adds **no** project filter: one server instance serves one project, so the embedded
  views are already project-scoped, and the invariant is asserted rather than re-implemented.
- **R4** — The `tasks` and `features` modules, their routes, and their files are unchanged and keep
  working outside the Projects module.

### Acceptance Criteria

```gherkin
Feature: Work view reusing task and feature surfaces

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
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-12T05:51:23.777Z

- **Which component does Work embed? — CLOSED: `KanbanBoard`, not `TaskKanbanView`.**
  `TaskKanbanView` binds the board to `useTaskParams`, whose `selectTask` navigates to
  `/board/tasks/<wbs>` (`apps/web/src/modules/task-kanban/useTaskParams.tsx:44-51`) and would leave
  the Projects module on every card click. `KanbanBoard` already exposes `onSelectTask` as a required
  prop (`KanbanBoard.tsx:41-52`), so the same rendering path is reused with a project-local handler
  and neither component changes.
- **Does Work need a project filter? — CLOSED: no, and adding one would be misleading.** Verified in
  the tree: one server instance serves one project (task 0840), and the task and feature endpoints
  read that server's own corpus, so everything these components fetch is already the served project's.
  The task's original R3 implied a filter; the refinement replaced it with an asserted invariant.
- **Is the Tasks/Features section a URL segment? — CLOSED: no, component state.** The tab is already
  in the URL; a second navigation source for a two-value control with no deep-link requirement in the
  AC is complexity without a consumer.
- **Where does the draft live so Work can reach it? — CLOSED: `ConversationDraftContext` on
  `ProjectsShell`.** Work and Conversation are sibling tab panels and only the active one mounts, so a
  draft owned by `ConversationView` would be unmounted exactly when Work needs to add to it. Recorded
  in task 0841's Design under "Draft provider placement".
- **Does selecting a task open its detail in Work? — CLOSED: no, it captures a reference.** A second
  detail surface inside Work would duplicate `TaskDetail` and the right-panel seam `BoardLayout` owns;
  the task's own module route stays the place to read it in full (R4).
- **A headless `FeaturesView` — CLOSED: not created.** `FeaturesShell` is the existing surface and the
  one the `features` module itself mounts; a second variant would be the "third rendering path" R1
  forbids, one level up.

#### Q&A entry — 2026-09-12T05:52:23.089Z

- **Which component does Work embed? — CLOSED: `KanbanBoard`, not `TaskKanbanView`.**
  `TaskKanbanView` binds the board to `useTaskParams`, whose `selectTask` navigates to
  `/board/tasks/<wbs>` (`apps/web/src/modules/task-kanban/useTaskParams.tsx:44-51`) and would leave
  the Projects module on every card click. `KanbanBoard` already exposes `onSelectTask` as a required
  prop (`KanbanBoard.tsx:41-52`), so the same rendering path is reused with a project-local handler
  and neither component changes.
- **Does Work need a project filter? — CLOSED: no, and adding one would be misleading.** Verified in
  the tree: one server instance serves one project (task 0840), and the task and feature endpoints
  read that server's own corpus, so everything these components fetch is already the served project's.
  The task's original R3 implied a filter; the refinement replaced it with an asserted invariant.
- **Is the Tasks/Features section a URL segment? — CLOSED: no, component state.** The tab is already
  in the URL; a second navigation source for a two-value control with no deep-link requirement in the
  AC is complexity without a consumer.
- **Where does the draft live so Work can reach it? — CLOSED: `ConversationDraftContext` on
  `BoardLayout`.** Work and Conversation are sibling tab panels and only the active one mounts, so a
  draft owned by `ConversationView` would be unmounted exactly when Work needs to add to it. Recorded
  in task 0841's Design under "Draft provider placement".
- **Does selecting a task open its detail in Work? — CLOSED: no, it captures a reference.** A second
  detail surface inside Work would duplicate `TaskDetail` and the right-panel seam `BoardLayout` owns;
  the task's own module route stays the place to read it in full (R4).
- **A headless `FeaturesView` — CLOSED: not created.** `FeaturesShell` is the existing surface and the
  one the `features` module itself mounts; a second variant would be the "third rendering path" R1
  forbids, one level up.

### Design

**WHAT.** A `Work` tab with two sections — Tasks and Features — that mount the **existing** board
components, plus a "reference into the conversation" action on each that pushes a structured
`ConversationRef` into the shared composer draft.

**WHY the Kanban board and not `TaskKanbanView`.** `TaskKanbanView`
(`apps/web/src/modules/task-kanban/index.tsx`) is a six-line wrapper that binds `KanbanBoard` to
`useTaskParams`, whose `selectTask` navigates to `/board/tasks/<wbs>`
(`useTaskParams.tsx:44-51`) — i.e. **out of the Projects module**. `KanbanBoard` already takes
`onSelectTask` as a required prop (`KanbanBoard.tsx:41-52`), so passing a project-local handler reuses
the identical rendering path without navigating away and without adding a prop to, or forking, either
component. That is what R1's "no new task-rendering code path" means concretely.

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/web/src/modules/projects/WorkView.tsx` (new) | section switch + reference actions |
| `apps/web/src/modules/projects/tabs.ts` | register the `work` tab |
| — | **no change** to `task-kanban` or `features`; both are imported as they are |

**Frozen names.**

```ts
// WorkView.tsx
export type WorkSectionId = 'tasks' | 'features';
export const DEFAULT_WORK_SECTION: WorkSectionId = 'tasks';
```

Imports, verbatim and unmodified:

- `KanbanBoard` — default export of `apps/web/src/modules/task-kanban/KanbanBoard.tsx`.
- `FeaturesShell` — default export of `apps/web/src/modules/features/FeaturesShell.tsx`, the same
  component the `features` module already mounts (`modules/features/index.tsx:17`).
- `useConversationDraft` and `ConversationRef` from task 0841.
- `useProjectTab` from task 0840.

**Reference capture (R2).** Selecting a task in the embedded board calls

```ts
addRef({ kind: 'task', wbs });
selectTab('conversation');
```

and the feature section does the same with `{ kind: 'feature', id }`. `addRef` deduplicates, so
referencing the same task twice yields one chip. The reference is a structured value from the moment
of capture — nothing is written into the composer's text, and nothing is parsed back out of it.

The draft lives in `ConversationDraftContext`, provided by `BoardLayout` rather than by
`ConversationView` or `ProjectsShell`, precisely because Work and Conversation are sibling panels and
only the active one is mounted — and because `GlobalAgentBar` sits outside the module entirely (task
0841, "Draft provider placement"). Without that, adding a reference from Work would write into an
unmounted component's state.

**Project scoping (R3) — premise corrected during refinement.** The task was written as though the
embedded views needed a project filter. They do not: one server instance serves exactly one project
(task 0840 Background), and `/api/task*` and `/api/feature*` read that server's own corpus. Every task
and feature these components already fetch **is** the served project's. R3's real content is therefore
an invariant to assert, not a filter to build: the Work view passes **no** project parameter, adds no
project-derived filter, and the shared `ProjectContext.path` is used only to assert agreement — never
to narrow a query. A filter here would be dead code that reads as a guarantee.

**Section state.** The active section is component state, not URL state. The tab identity already
lives in the URL (`/board/projects/work`, task 0840); a second URL segment for Tasks-vs-Features would
mean two sources of navigation truth in one module for a control with two values and no deep-link
requirement in the AC.

**Detail rendering.** Selecting a task captures a reference; it does not open `TaskDetail` inside the
Work panel. The task's own module route remains the place to read a task in full (R4), reachable from
the reference chip. Rendering a second detail surface inside Work would duplicate `TaskDetail`'s panel
contract and the right-panel seam `BoardLayout` owns.

**Test attributes.** `data-work-section="<id>"`, `data-g6="use-task"`, `data-g6="task-chip"` — the last
two match the prototype's selectors so 0845's ported assertions need no rename.

**Anti-patterns — do not implement.**

- Do not fork, copy, or re-implement the Kanban board, a card, a column, or the feature tree.
- Do not modify `TaskKanbanView`, `TasksShell`, `FeaturesShell`, or the `task-kanban` / `features`
  module definitions; both modules and their routes keep working unchanged (R4).
- Do not pass `useTaskParams().selectTask` into the embedded board — it navigates out of the module.
- Do not add a project filter, a project query parameter, or a project-derived `TaskListFilters` field.
- Do not write references into the composer's text, and do not recover them by parsing it.
- Do not open a task or feature detail panel inside Work.
- Do not put the Tasks/Features section in the URL.
- Do not create a headless `FeaturesView` variant; the existing shell is the surface.

**Handoff.** 0844 submits the captured refs through task 0841's `encodeRequestEnvelope`. 0845 verifies
that the Work→Conversation reference path is keyboard-reachable and that the chips render as icon plus
text.

### Plan

1. **(R1)** Add `WorkView.tsx` with `WorkSectionId` / `DEFAULT_WORK_SECTION` and a two-button section
   switch. *Test:* both sections render; the default is `tasks`.
2. **(R1)** Mount `KanbanBoard` in the Tasks section with a local `onSelectTask`.
   *Test:* clicking a card does **not** change `location.pathname`, proving the embed does not
   navigate out of `/board/projects/work`.
3. **(R1)** Mount `FeaturesShell` in the Features section unmodified.
   *Test:* the features surface renders inside the Work panel with no props passed.
4. **(R2)** Wire `onSelectTask` to `addRef({ kind: 'task', wbs })` followed by
   `selectTab('conversation')`; do the same for a feature selection.
   *Test:* selecting a task adds exactly one chip to the draft and switches the active tab;
   selecting the same task twice still yields one chip.
5. **(R3)** Assert the no-filter invariant: the embedded board receives no project parameter and the
   Work view issues no project-scoped query. *Test:* a fetch spy records the same task request the
   standalone `tasks` module makes, byte-for-byte.
6. **(R4)** Verify the untouched routes. *Test:* `/board/tasks` and `/board/features` still resolve to
   their own modules and render, and `git diff --stat` shows no change under
   `apps/web/src/modules/task-kanban/` or `apps/web/src/modules/features/`.
7. **(R1)** Register the `work` tab in `tabs.ts`. *Test:* `/board/projects/work` renders the Work
   panel.
8. Run `cd apps/web && bun test`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Projects Board information architecture"
- Code: `apps/web/src/modules/task-kanban`, `apps/web/src/modules/features`

### History
