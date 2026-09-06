---
schema_version: 1
name: "Global orchestrator agent interface: migrate floating prompt bar to top-level BoardLayout"
status: todo
template: feature-impl
created_at: 2026-09-06T03:28:02.371Z
updated_at: "2026-09-06T03:44:11.427Z"
feature_id: A7
priority: P2
tags: ["web", "agent", "orchestrator"]
dependencies: ["0773"]
---

## 0774. Global orchestrator agent interface: migrate floating prompt bar to top-level BoardLayout

### Background
The floating agent prompt bar lives inside the Features module, so the project-wide orchestrator
surface is reachable only from `/board/features`. This task lifts it to a global
`GlobalAgentBar` mounted by `BoardLayout`, landing feature A7 scenario **R5**.

**Verified ground truth (2026-09-05, current tree):**

| Claim | Verified state |
| --- | --- |
| Component | `apps/web/src/modules/features/FloatingAgentBar.tsx` — 77 lines, no props, no network, self-owned `isOpen`/`prompt`/`notice` state |
| Only mount point | `apps/web/src/modules/features/FeaturesShell.tsx:8` (import) and `:356` (render) |
| Current behavior | Folded by default → `✨` dock at `fixed bottom-6 right-6 z-30`; expanded → `bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-2rem)] max-w-[84rem]` glass bar; Send is a stub that clears the field and shows an honesty notice |
| Test ids in use | `agent-bar-dock`, `agent-bar`, `agent-bar-input` |
| `ActiveModuleContext` | Declared at `BoardLayout.tsx:14`, provided at `:141`. **Zero consumers** — no component reads it today |
| `BoardLayout` active module | Already computed from the route segment (`BoardLayout.tsx:24-30`) as `WebModule \| undefined` |
| Existing tests | `tests/modules/features/components.test.tsx:1194-1247` — four `FloatingAgentBar` cases, the last asserting `FeaturesShell` renders `agent-bar-dock` |

**Two corrections to the parent feature/design doc, folded into the Design below:**

1. **`FloatingActionProgress.tsx` is not part of this migration.** Feature A7's scope line names it
   alongside `FloatingAgentBar` as living in `FeaturesShell`. It does not: it is rendered by
   `FeatureDetail.tsx:996`, is driven by `useFeatureActionProgress(featureId)`, and takes
   `{progress, isDismissed, onDismiss, onReopen}` — it is feature-detail-scoped job telemetry, not a
   global surface. Moving it would require hoisting per-feature job state into `BoardLayout`. **It
   stays where it is.**
2. **Context consumption would be a circular import.** The design doc says `GlobalAgentBar`
   "consumes `ActiveModuleContext` from `BoardLayout`". `BoardLayout` must import `GlobalAgentBar`
   to mount it, so `GlobalAgentBar` importing `ActiveModuleContext` back from `BoardLayout` closes a
   cycle. The active module is passed as a **prop** instead.
### Requirements
- **R1.** `FloatingAgentBar.tsx` moves to `apps/web/src/components/GlobalAgentBar.tsx` as
  `GlobalAgentBar`; no copy is left behind in `src/modules/features/`.
- **R2.** `FeaturesShell.tsx` no longer imports or renders it; `BoardLayout.tsx` mounts
  `GlobalAgentBar` once, so it is present on every `/board/*` route.
- **R3.** `BoardLayout` passes the active module to `GlobalAgentBar` as a prop, and the expanded bar
  shows a visible context pill naming it (e.g. `Context: Observabilities`), falling back to a
  neutral label when no module resolves.
- **R4.** The expanded bar renders module-aware quick-action chips that insert their text into the
  prompt field, plus an orchestrator badge and an execution-drawer toggle whose panel states plainly
  that streaming telemetry is not wired yet.
- **R5.** Positioning and stacking hold on desktop and mobile: the bar and dock stay within the
  viewport, sit above page content, and sit **below** the mobile drawer, its backdrop, and the
  right-panel bottom sheet.
- **R6.** The four existing `FloatingAgentBar` tests move with the component, and the case asserting
  `FeaturesShell` renders `agent-bar-dock` is retargeted to `BoardLayout`.

**Out of scope:** any agent dispatch, RPC call, SSE subscription, or backend endpoint (the bar stays
a UI stub); migrating `FloatingActionProgress` (see Background correction 1); `⌘K` or any global
keyboard shortcut; persisting the bar's open/closed state; layout/spacing polish (task 0775).
### Acceptance Criteria
```gherkin
Feature: Spur Board layout optimization and global orchestrator agent interface

  @core
  Scenario: R5 — Global orchestrator agent interaction panel
    Given the user is on any board module route
    When viewing the board layout
    Then a global floating agent panel is accessible across every module
    And it provides a collapsed spirit-icon dock button and an expandable prompt bar
    And it displays the active module context and reserves interaction slots for orchestrator agent communication
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T03:44:10.667Z

- **Prop, not context.** `BoardLayout` → `GlobalAgentBar` → `import { ActiveModuleContext } from
  './BoardLayout'` is a cycle. Options: (a) move the context to its own module, (b) pass a prop.
  **Decision:** prop — `BoardLayout` already holds `activeModule` in a local, the bar is mounted
  exactly one level down, and a new module for a context with zero consumers is scaffolding.
  `ActiveModuleContext` stays exactly as it is for `RightPanel`'s future use; this task neither
  removes nor extends it.
- **`FloatingActionProgress` does not move.** Verified: it renders from `FeatureDetail.tsx:996`, not
  `FeaturesShell`, and is bound to `useFeatureActionProgress(featureId)`. Feature A7's scope line
  naming it is wrong. **Decision:** leave it in `src/modules/features/`; A7 R5 asks for a global
  *prompt* surface, not global job telemetry.
- **Known overlap with `FloatingActionProgress`.** On a feature-detail route with a running action,
  its panel (`fixed bottom-4 right-4 z-40 w-80`) overlaps the agent dock (`bottom-6 right-6 z-30`,
  48×48). **Decision:** accept it — z-40 correctly wins, the collision is one route deep, and the
  fix (a shared bottom-right stack) is a layout concern that belongs to task 0775 if it is worth
  doing at all. Recorded rather than silently designed around.
- **Where in `BoardLayout` does it mount?** `.board-layout` is a 5-track CSS grid; a sixth flow
  child would open an implicit column. `GlobalAgentBar` is `position: fixed` in both states, so it
  is out of flow either way — but **decision:** mount it as a sibling *after* the `.board-layout`
  div, inside the same fragment, so the grid's child list is untouched and the intent is legible.
- **Stacking order — frozen.** Existing z-values: mobile sidebar drawer / bottom sheet `z-50`, their
  CSS backdrops `z-49`, `BoardLayout`'s React backdrop and `FloatingActionProgress` `z-40`, agent
  bar `z-30`. **Decision:** keep the agent bar at `z-30`. It must not cover the mobile drawer, and
  raising it would. No z-index changes anywhere.
- **Chips insert, they do not send.** A chip click sets the prompt text and focuses the field; it
  never dispatches. Keeps the honesty contract (`Agent dispatch is not wired yet`) intact.
- **Deferred:** `⌘K` / global keyboard trigger (design doc §4.2) — not in AC R5, and a global
  hotkey needs a document-level listener plus conflict review against module shortcuts; revisit when
  dispatch is actually wired. Pulsing activity halo on the dock — there is no activity signal to
  drive it until a backend exists.
### Design
**WHAT.** Relocate the existing 77-line stub to `src/components/GlobalAgentBar.tsx`, mount it once
in `BoardLayout`, and give it one new input — the active module — that drives a context pill and a
chip set. Everything else about the component's behavior is preserved verbatim.

**WHY.** The orchestrator is project-wide; the component was only ever in `modules/features/`
because that is where it was first needed. The migration is a move plus one prop. The judgment in
this task is in what *not* to do: no context wiring (cycle), no `FloatingActionProgress` move
(wrong premise), no z-index changes (would cover the mobile drawer), no dispatch (out of scope).

**WHERE — frozen surfaces.**

| File | Change |
| --- | --- |
| `apps/web/src/components/GlobalAgentBar.tsx` | **new** — moved from `modules/features/FloatingAgentBar.tsx` |
| `apps/web/src/modules/features/FloatingAgentBar.tsx` | **deleted** |
| `apps/web/src/modules/features/FeaturesShell.tsx:8,356` | import + render removed |
| `apps/web/src/components/BoardLayout.tsx` | import + single mount after `.board-layout` |
| `apps/web/tests/components/GlobalAgentBar.test.tsx` | **new** — the four cases moved out of `tests/modules/features/components.test.tsx:1194-1247` |

**Frozen names.**

```ts
// apps/web/src/components/GlobalAgentBar.tsx
interface GlobalAgentBarProps {
    /** Module resolved from the current /board/<route> segment; undefined off a module route. */
    activeModule?: WebModule;
}
export default function GlobalAgentBar({ activeModule }: GlobalAgentBarProps) { … }
```

Preserved verbatim from the current component — changing any of these breaks moved tests:
`data-testid` `agent-bar-dock` / `agent-bar` / `agent-bar-input`; `aria-label`
`Open agent prompt bar` / `Collapse agent prompt bar` / `Agent prompt`; the dock classes
`fixed bottom-6 right-6 z-30`; the bar classes `fixed … z-30 w-[calc(100vw-2rem)] max-w-[84rem]
backdrop-blur-md bg-base-100/80`; the notice text `Agent dispatch is not wired yet …`; folded as the
initial state.

New ids, added by this task and by no other: `data-testid` `agent-bar-context`,
`agent-bar-chips`, `agent-bar-drawer-toggle`, `agent-bar-drawer`.

**Context label.** `activeModule?.sidebarLabel ?? activeModule?.name ?? 'Board'`, rendered as a
`Badge` reading `Context: <label>`. Same precedence the sidebar uses after task 0773, so
`Observabilities`/`Histories` agree across both surfaces.

**Chip map — keyed by module `id`, not label.**

| `activeModule?.id` | Chips |
| --- | --- |
| `features` | `Decompose feature`, `Verify acceptance criteria` |
| `tasks` | `Run task`, `Check readiness`, `Refine requirements` |
| `observability` | `Explain recent failure`, `Audit doctor status` |
| `history` | `Summarize session`, `Find recurring bottlenecks` |
| anything else / `undefined` | none rendered |

Ids are stable (`workspace`, `inbox`, `teams`, `tasks`, …); labels are being renamed in this very
feature, so keying on labels would break silently. A chip click sets the prompt text and focuses the
textarea — no dispatch.

**Execution drawer.** A toggle in the expanded bar's action row flips local `drawerOpen`; the open
drawer is a bordered region under the input holding one `role="status"` line stating that streamed
telemetry and tool calls are not wired yet. Local state only — no store, no subscription, no props.

**Mount.**

```tsx
</div>            {/* .board-layout */}
<GlobalAgentBar activeModule={activeModule} />
<ApiErrorToast />
```

**Anti-patterns — do not implement.**
- Do **not** import `ActiveModuleContext` into `GlobalAgentBar` (circular import), and do not move
  the context into a new module to dodge it.
- Do **not** touch `FloatingActionProgress.tsx`, `FeatureDetail.tsx`, or
  `useFeatureActionProgress.ts`.
- Do **not** change any `z-*` value in `apps/web`, and do not add a portal.
- Do **not** add dispatch, `fetch`, oRPC, or SSE; the Send handler keeps clearing the field and
  showing the stub notice.
- Do **not** persist the bar's open state to `layout-state.ts` — that file is task 0773's surface
  and the bar is deliberately session-local.
- Do **not** render `GlobalAgentBar` inside `.board-layout` or inside a module shell.
- Do **not** rename the preserved test ids, aria-labels, or the notice string while moving the file.

**Handoff.** Task 0775 owns any bottom-right stacking reconciliation between the agent dock and
`FloatingActionProgress`, and all `board-layout.css` work. This task changes no CSS file.
### Plan
1. **R1** — `git mv apps/web/src/modules/features/FloatingAgentBar.tsx
   apps/web/src/components/GlobalAgentBar.tsx`; rename the function to `GlobalAgentBar`; update the
   doc comment to say it is the global orchestrator surface mounted by `BoardLayout`. No behavior
   change in this step.
2. **R2** — remove the import (`FeaturesShell.tsx:8`) and the render (`:356`); add the import and
   the single `<GlobalAgentBar activeModule={activeModule} />` mount in `BoardLayout.tsx`, placed
   after the `.board-layout` div and before `<ApiErrorToast />`.
3. **R3** — add the `GlobalAgentBarProps` interface and the `Context: <label>` badge
   (`data-testid="agent-bar-context"`) in the expanded bar's action row.
4. **R4** — add the id-keyed chip map, the chip row (`data-testid="agent-bar-chips"`, click sets
   prompt + focuses input), and the drawer toggle/panel
   (`agent-bar-drawer-toggle` / `agent-bar-drawer`) with the not-wired-yet status line.
5. **R5** — check the dock and bar against the mobile drawer (`z-50`), its backdrop (`z-49`/`z-40`),
   and the right-panel bottom sheet at `<768px`; confirm the bar stays inside the viewport at 375px
   (`w-[calc(100vw-2rem)]` already handles it) with no z-index edits.
6. **R6** — move `tests/modules/features/components.test.tsx:1194-1247` into
   `tests/components/GlobalAgentBar.test.tsx`, importing from the new path; retarget the fourth case
   (currently *renders alongside the shell empty-state placeholder*) to assert `BoardLayout` renders
   `agent-bar-dock`; assert `FeaturesShell` no longer does.
7. **New tests** — context badge reads the active module's label; the tasks-route chip set renders
   and a chip click populates `agent-bar-input`; an unknown/absent module renders no chips; the
   drawer toggle reveals the not-wired-yet notice.
8. **Verify** — from inside the workspace: `cd apps/web && bun test tests`, then repo-root
   `bun run autofix && bun run spur-check`. Grep for stragglers:
   `rg -n "FloatingAgentBar" apps/web` must return nothing.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/A7_spur-board-layout-optimization-and-global-orchestrator-agent-interface.md` (scenario R5; its scope line naming `FloatingActionProgress.tsx` is corrected in Background)
- Design doc: `docs/design/board-ui-layout-and-global-agent-bar.md` §4 (context-vs-prop and the `FloatingActionProgress` premise are corrected here)
- Depends on: task 0773 — `sidebarLabel` values (`Observabilities`, `Histories`) that the context pill mirrors
- Dependent: task 0775 — bottom-right stacking and layout polish
- Origin of the stub: feature F84 R6 / F841 R3, R7, R8 (the preserved dock/bar geometry and the honesty notice)
- Source surfaces: `apps/web/src/modules/features/FloatingAgentBar.tsx`, `apps/web/src/modules/features/FeaturesShell.tsx`,
  `apps/web/src/components/BoardLayout.tsx`, `apps/web/tests/modules/features/components.test.tsx`
### History
