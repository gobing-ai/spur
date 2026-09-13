---
schema_version: 1
name: Work view reusing task and feature surfaces with reference chips
status: done
template: feature-impl
created_at: 2026-09-12T04:54:51.545Z
updated_at: "2026-09-13T00:18:20.570Z"
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
- **R2** — A task shown in Work can be referenced into the conversation as a structured reference
  chip, captured at selection time rather than parsed out of the composer's text. Feature references
  already reach the composer through 0841's `addRef` contract; `FeaturesShell` exposes no selection
  seam and R4 forbids adding one, so Work ships no feature-side capture affordance (Q&A below).
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
  `BoardLayout`.** Work and Conversation are sibling tab panels and only the active one mounts, so a
  draft owned by `ConversationView` would be unmounted exactly when Work needs to add to it. Recorded
  in task 0841's Design under "Draft provider placement".
- **Can a feature shown in Work be referenced into the conversation? — CLOSED: not from Work.** `FeaturesShell` exposes no selection seam and R4 forbids adding one (modules unchanged, still working standalone). Feature references enter the draft through the composer's `addRef({kind:'feature', id})` contract shipped in 0841. This closes the deviation between the original R2 wording ("a task or feature") and the frozen module-boundary constraint; recorded during the 0843 review fix disposition (2026-09-12).

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

Reused, not forked (R1): one new component, `apps/web/src/modules/projects/WorkView.tsx`,
mounts the existing surfaces. The section switch is component state (the tab already lives in
the URL), with `aria-pressed` toggle buttons carrying `data-work-section="<id>"` —
deliberately not a nested tablist.

- `WorkView.tsx:41` — `referenceTask(wbs)` = `addRef({kind:'task', wbs})` +
  `selectTab('conversation')` (R2): structured from the moment of selection, deduplicated by
  `addRef`, never routed through composer text or a parser.
- `WorkView.tsx:71` — Tasks section embeds `KanbanBoard onSelectTask={referenceTask}` under the
  `data-g6="use-task"` host; the raw board (not `TaskKanbanView`, whose `selectTask` would
  navigate to `/board/tasks/<wbs>`) is the point: selection never leaves the module (R1).
- `WorkView.tsx:76` — Features section mounts `FeaturesShell` with no props. The shell exposes
  no selection seam and modifying it is out of bounds (R4), so a feature reference has no
  Work-side capture affordance; `addRef` already accepts `{kind:'feature', id}` (0841) for the
  seam 0844's submission path will exercise. Recorded honestly here rather than papered over.
- `tabs.tsx:21` — the frozen `work` tab (id/label/order untouched) now mounts `WorkView` in
  place of the 0840 placeholder.
- `ConversationView.tsx:179` — the task-kind reference chip carries `data-g6="task-chip"` (the
  prototype selector 0845 asserts); feature chips are distinguished by their existing
  `data-draft-ref="feature"`.
- No project filter anywhere (R3): the embed passes no folder/filters/props that the bare embed
  does not; the invariant is asserted byte-for-byte at the api seam in tests (below).

Fix disposition (host, 2026-09-12): Finding 1 (P2) resolved by requirements amendment, not code — R2 refined to task-capture-only (R-numbers stable, gherkin unchanged); CLOSED Q&A entry added documenting the feature-capture deviation (R4 forbids the FeaturesShell seam; composer addRef from 0841 is the feature-ref path). Finding 2 (P4) resolved: stale Q&A copy corrected to `BoardLayout`. Code untouched; digest unaffected (docs/tasks* excluded from fingerprint). The WorkView.tsx "(task Q&A)" citation is now backed by the added Q&A entry.

### Testing

`cd apps/web && bunx tsc --noEmit` rc 0.

- New `apps/web/tests/modules/projects/WorkView.test.tsx` — 6 tests over the real
  `ProjectsShell` (tab bar + panel contract) with the process-global `buildFullRpcMock` /
  `mockDndKit` helpers: default section (R1, `data-work-section` pressed states),
  Features-switch renders unmodified `FeaturesShell` inside `#projects-tab-panel-work`,
  card click captures `{kind:'task',wbs:'0001'}` + switches to Conversation + never
  `/board/tasks` + `data-g6="task-chip"` + draft text stays empty (R2), re-visit dedupe
  yields exactly one chip (R2), the embedded board's task-list request sequence is
  `deepEqual` to the bare embed's and every call's only key is `folder` (R3 — byte-for-byte
  at the api seam, which the oRPC link serializes to identical wire bytes), and
  `discoverModules` still routes `tasks`/`features` to their own modules (R4).
- `tabs.test.ts` extended (+1 test): the `work` tab component identity is `WorkView` with the
  frozen id/label/order asserted.
- Full suite: `cd apps/web && bun test` — 866 pass / 0 fail across 63 files (was 859 before
  0843's 7).
- R4 no-touch: no edit issued to `apps/web/src/modules/task-kanban/` or
  `apps/web/src/modules/features/`; the modules register unchanged and are imported as-is.

Fresh verification (2026-09-12): verdict PASS (4 R, 2 AC, as amended) — `.spur/run/0843-verify-answer.txt`; review PARTIAL → host requirements amendment (R2 task-capture-only + CLOSED Q&A deviation entry) → re-review PASS (addendum at Review). Gate rc=0 (866 web pass / 0 fail, `.spur/run/0843-test-gate.status`); projects suite 87/0; web tsc clean. Proof digest at bind: `sha256:3af72b7be0bbfa250cc22b91c5a2b10ae36efdeb03bbefbe3f1d7175bb69f915`.


### Review

#### Review Report — 0843 (Phase 7, batch 20260912T205800Z-G63BATCH, branch wayfind/g63-projects-board)

**Scope:** `apps/web/src/modules/projects/{WorkView.tsx,tabs.tsx,ConversationView.tsx}` + `tests/modules/projects/{WorkView.test.tsx,tabs.test.ts}` + `config/rules/typescript/no-leaky-module-mocks.yaml`; R4 diff-scope check over `apps/web/src/modules/{task-kanban,features}/`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PARTIAL

Fresh evidence (this review, not inherited): `WorkView.test.tsx`+`tabs.test.ts` 10 pass / 0 fail; `bunx tsc --noEmit` rc 0; full `cd apps/web && bun test` 866 pass / 0 fail across 63 files (matches `.spur/run/0843-test-gate.status` rc=0, and re-proves the new mock exclude leaks nothing file-order-dependent).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P2 (major) | functional | R2's feature half has no capture path: `addRef({kind:'feature'})` has zero production callers (grep: WorkView's task branch is the only caller), FeaturesShell exposes no selection seam, and R4 forbids adding one — yet the Design still promises "the feature section does the same with `{kind:'feature', id}`" and R2 reads "A task **or feature**". The deviation is recorded honestly in Solution but was never closed in the authoritative Q&A (the WorkView.tsx comment cites "(task Q&A)" for a decision the Q&A does not contain). Needs disposition: refinement amendment to R2, or a follow-up task for feature capture — not a code change in 0843. | `docs/tasks4/0843_work-view-reusing-task-and-feature-surfaces-with-reference-c.md` (Design §Reference capture vs Solution bullet 3); `apps/web/src/modules/projects/WorkView.tsx:31` |
| 2 | P4 (advisory) | functional | Stale duplicate Q&A: the first Q&A copy says `ConversationDraftContext` is provided "on `ProjectsShell`" while the second copy, the Design, task 0841, and the shipped code all say `BoardLayout` (which is what mounted). Dedupe the copies so the authoritative record stops contradicting itself. | `docs/tasks4/0843_work-view-reusing-task-and-feature-surfaces-with-reference-c.md` (Q&A entry 1 vs 2); `apps/web/src/components/BoardLayout.tsx:127-128` |

**Disposition:** #1 — P2 (major), blocks PASS, owned by task author/refinement (record decision, amend R2 or file follow-up); does not invalidate 0843's shipped code. #2 — P4 (advisory), accept-or-fix in a docs-only pass.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Reuse doctrine holds: `WorkView.tsx:9,71` embeds `KanbanBoard` (default export, imported unmodified) with only `onSelectTask`; `WorkView.tsx:76` mounts `FeaturesShell` with zero props; no card/column/tree code exists in the projects module (fork would show as new rendering code — none); `tabs.tsx:21` registers the frozen `work` tab. Tests: default-section + Features-switch cases assert `data-g6="use-task"` and `[data-features-shell]` inside `#projects-tab-panel-work`. No drift beyond the declared R-set: the embed passes strictly fewer props than `TaskKanbanView` (`index.tsx:30-32` passes `filters` too), matching the bare Workspace embed. |
| R2 | PARTIAL | Task half MET with strong evidence: `WorkView.tsx:41-44` — `addRef({kind:'task',wbs})` then `selectTab('conversation')`; structured from selection, dedupe via `drafts.tsx:132-139` (`sameRef`); test asserts chip + empty textarea + stored record `{kind:'task',wbs:'0001'}` revision 1, and re-visit dedupe yields exactly one chip. Feature half: NO capture affordance anywhere (finding #1); the AC scenarios (task-only) are MET, R2's literal wording is not. |
| R3 | MET | `WorkView.tsx:71` passes no folder/filters/project props — nothing the bare embed doesn't receive; no project-derived query anywhere in the module. Test R3: embedded board's request sequence `deepEqual` to the bare embed's, and every call's only key is `folder`. |
| R4 | MET | `git status` clean under `apps/web/src/modules/task-kanban/` and `apps/web/src/modules/features/` (only new untracked `modules/projects/` + batch-shared files elsewhere); R4 test asserts `discoverModules` still routes `tasks`/`features` to their own modules, neither to ProjectsShell/WorkView. |

##### Concerns from review assignment

- **Reuse doctrine (1):** holds — see R1. The board's `useLocation` auto-popup effect (`KanbanBoard.tsx:141-144`) is inert under `/board/projects/*` (no `tasks` path segment), so no behavioral drift.
- **no-leaky-module-mocks exclude (2):** justified and minimal — same arrangement as the three existing task-kanban entries (first-party `mock.module` of the oRPC `api` Proxy, which `spyOn` cannot intercept per the rule's own caveat, with `beforeEach restoreMock()`); severity stays `warning`; fresh full-suite run shows no leak.
- **Ref capture path (3):** goes through 0841's drafts addRef path only — `useConversationDraft` → `ConversationDraftProvider` functional update → guarded `saveDraft`; no parallel store (grep confirms sole production caller).
- **Component-state sections (4):** closed in the Q&A ("no, component state" — both copies, identical); implemented as `useState` at `WorkView.tsx:29` with `aria-pressed` toggles; not re-litigated.
- **`data-g6="task-chip"` (5):** present and consistent — `ConversationView.tsx:179`, applied only to task-kind chips; feature chips keep `data-draft-ref="feature"`; asserted in the R2 test; no deeper a11y work pulled in from 0845's scope.
- **Carried items:** parseDraftRecord spread P3, silent non-ok, and MemberTerminal POST residuals are 0844-owned — not re-reported. Frozen contracts (tabs ids, path identity, functional updates, wire projection, AgentsView read-only) verified untouched by this surface.

**Next:** disposition finding #1 (refinement amendment to R2 or follow-up task for feature-ref capture); optional docs pass for finding #2.

#### Review Addendum — re-review after host requirements amendment (2026-09-13)

**Scope:** amendment-only re-review of the two prior findings; no code touched
(`git status` clean under `apps/web/src/modules/{task-kanban,features}/`; docs/tasks*
excluded from the fingerprint, so the digest is unaffected).
**Dimensions:** functional (amendment consistency), correctness (gate re-run)
**Verdict:** PASS

Fresh evidence (this session): `cd apps/web && bun test tests/modules/projects/` — 87 pass / 0
fail across 11 files; `bunx tsc --noEmit` rc 0.

##### Findings resolution (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | functional | Prior finding #1 (P2) RESOLVED by requirements amendment, not code: R2 now reads task-capture-only with the deviation stated inline ("Feature references already reach the composer through 0841's `addRef` contract; `FeaturesShell` exposes no selection seam and R4 forbids adding one"); the authoritative Q&A now carries the CLOSED decision ("not from Work", composer `addRef({kind:'feature', id})` is the path), so the `WorkView.tsx:32` "(task Q&A)" citation is backed. Residual: the duplicate Q&A copy (entry 2) predates the amendment and lacks the new feature-capture bullet — it contradicts nothing (copy 1 is a superset), it is a redundant stale copy. | `docs/tasks4/0843_…md` (R2 + Q&A entry 1 vs duplicate entry 2) |
| 2 | P4 (advisory) | functional | Prior finding #2 (P4) RESOLVED: Q&A copy 1 now says `ConversationDraftContext` on `BoardLayout`, agreeing with copy 2, the Design, 0841, and the shipped placement (`BoardLayout.tsx:128`). | `docs/tasks4/0843_…md` (Q&A entry 1, draft-placement bullet) |

##### Amendment internal consistency (all seams agree)

| Seam | Says | Agreement |
|------|------|-----------|
| R2 text | task-capture-only; feature refs via 0841 composer `addRef`; no Work-side capture affordance | baseline |
| Q&A CLOSED entry | "Can a feature shown in Work be referenced? — CLOSED: not from Work", cites R4 constraint + 0841 path, timestamps the 0843 review disposition | match |
| Design satellite §0843 (`docs/design/project-switcher.md:218-246`, mirrored `docs/04_DESIGN.md:396-404`) | identical: task capture only, "no Work-side capture affordance", feature refs via composer contract | match |
| `WorkView.tsx` header comment (`WorkView.tsx:25-33`) | identical story, cites "(task Q&A)" — now backed by the added entry | match |
| Gherkin scenarios | task-only, untouched — no feature scenario to contradict the amendment | match |

No R renumbering: R1–R4 retain their identities and order; only R2's wording was refined.
Fix disposition recorded above Testing (host, 2026-09-12) covering both prior findings.

**Next:** optional docs-only dedupe of the stale duplicate Q&A copy (P4); nothing blocks the gate.

### References

- Parent feature: [G63 — Projects board module and global input wiring](../features/G63_projects-board-module-and-global-input-wiring.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Projects Board information architecture"
- Code: `apps/web/src/modules/task-kanban`, `apps/web/src/modules/features`

### History

- 2026-09-12T23:48:47.021Z todo → wip (system)
- 2026-09-13T00:04:50.330Z wip → testing (system)
- 2026-09-13T00:18:20.570Z testing → done (system)

