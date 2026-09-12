---
schema_version: 1
name: Projects module shell with header and project-path identity
status: todo
template: feature-impl
created_at: 2026-09-12T04:54:51.540Z
updated_at: "2026-09-12T06:00:35.041Z"
feature_id: G63
priority: P2
tags:
  - g6-program

---

## 0840. Projects module shell with header and project-path identity

### Background

The Board has no Projects module. `apps/web/src/modules/` holds `workspace`, `inbox`, `teams`,
`features`, `task-kanban`, `history`, `observability`. Modules are **discovered**, not registered:
`apps/web/src/modules/discover.ts` eagerly globs each direct child directory of
`apps/web/src/modules/` for a named `module` export, `registry.ts` validates unique `id` and `route`,
and `router.tsx:16-26` adds `/board/<route>` plus a `<route>/*` wildcard for every discovered module.
A new directory therefore needs **zero** wiring changes.

Workspace requires a project-local team and renders an empty state without one
(`apps/web/src/modules/workspace/WorkspaceShell.tsx:30-46`), which is exactly the concept overlap this
program removes.

**Premise corrected during refinement (2026-09-11).** The task was written as though the Board could
hold several projects at once and the switcher picked between them client-side. It cannot: **one
server instance serves exactly one project.** `GET /api/project`
(`apps/server/src/modules/health/index.ts:50`) returns `{ name: basename(ctx.cwd) }` and nothing else,
and `ProjectSwitcher.handleSelect` (`apps/web/src/components/ProjectSwitcher.tsx`) switches projects by
**navigating to another port** — `window.location.href = http://localhost:${project.port}/board`,
starting the target server first via `POST /api/projects/start` when it is not live. So
"the switcher-selected project" is always "the project this server serves", and the module never
chooses between projects; it renders the one it is served by. R4's identity work is consequently not a
selector — it is making the served project's **canonical path** reach the client at all, which
`/api/project` does not do today.

The path matters because `ProjectRegistry` allocates ports and can hand a previously used port to a
different project. Any client-persisted, project-scoped state (drafts in 0841, receipts in 0844) keyed
on origin alone would resurface under the wrong project after a port reuse. The canonical path is the
only key that cannot collide — the prototype covers this as LB-1
(`docs/reports/g6-projects-prototype.md`).

### Requirements

- **R1** — A `projects` module discovered by the Board module registry, opening the **served** project
  directly (one server instance serves one project; the switcher navigates between servers).
- **R2** — A compact header showing project/worktree, active strategy, orchestrator availability
  (missing versus offline), and fleet capacity.
- **R3** — Conversation, Agents, and Work are reachable as keyboard-navigable tabs with
  `aria-selected`; deep links (`/board/projects/agents`) resolve to a tab.
- **R4** — The served project's **canonical worktree path** reaches the client and is the identity key
  for every project-scoped surface; the display label is never the key, so two identically named
  projects stay unambiguous and a reused port cannot resurface another project's state.
- **R5** — A project with zero fleet members, no bound orchestrator, or an unreadable worktree still
  opens and names what is missing rather than rendering an empty shell.
- **R6** — Ships alongside Workspace/Inbox/Teams; no route is removed and no module order is
  renumbered here (G64 owns retirement).
- **R7** — DESIGN.md tokens and existing `@/ui` primitives only; no new design-system dependency.

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

#### Q&A entry — 2026-09-12T05:46:00.912Z

- **Is the Board multi-project? — CLOSED: no, one server serves one project.** Verified in the tree:
  `/api/project` returns only `basename(ctx.cwd)` (`apps/server/src/modules/health/index.ts:50`) and
  `ProjectSwitcher.handleSelect` navigates to another port rather than selecting client-side. The
  task's original "switcher-selected project" wording implied client-side selection; Background and R1
  were corrected in this refinement rather than leaving a frozen design on a false premise.
- **How does the module get registered? — CLOSED: by existing in the directory.** `discover.ts` globs
  `apps/web/src/modules/*/index.{ts,tsx}` at build time and `router.tsx` derives both
  `/board/projects` and `/board/projects/*` from the registry. No wiring file changes; the Design's
  anti-patterns forbid editing them.
- **One endpoint or two for the header? — CLOSED: `path` on `/api/project`, runtime facts on a new
  `GET /api/project/fleet`.** `/api/project` backs the sidebar title and must stay a cheap read;
  fleet resolution touches the filesystem and two tables. Adding `path` costs one normalizer call, so
  it stays inline.
- **Module `order` value — CLOSED: 45.** Sits above Workspace (50), Inbox (60), and Teams (70) without
  renumbering them, so G64 can delete those three entries without a second sidebar reshuffle.
- **Where does the port-reuse guard live? — CLOSED: stated here, enforced by consumers.** The shell
  owns `path`'s arrival in the client; 0841 (drafts) and 0844 (receipts) own discarding state whose
  stored `path` differs from the served one. Browser origin isolation already prevents live
  cross-project leakage; a reused port is the only hazard, and it is a path comparison.
- **Strategy mutation from the header — DEFERRED, owner: Robin.** G63's scope is read-only
  presentation; `StrategyRuntime.setStrategy` exists (task 0838) but no G63 requirement asks for a
  Board control. Re-open only if Robin asks for strategy switching in the Board rather than via
  `spur projects`.

#### Q&A entry — 2026-09-12T05:52:16.303Z

- **Is the Board multi-project? — CLOSED: no, one server serves one project.** Verified in the tree:
  `/api/project` returns only `basename(ctx.cwd)` (`apps/server/src/modules/health/index.ts:50`) and
  `ProjectSwitcher.handleSelect` navigates to another port rather than selecting client-side. The
  task's original "switcher-selected project" wording implied client-side selection; Background and R1
  were corrected in this refinement rather than leaving a frozen design on a false premise.
- **How does the module get registered? — CLOSED: by existing in the directory.** `discover.ts` globs
  `apps/web/src/modules/*/index.{ts,tsx}` at build time and `router.tsx` derives both
  `/board/projects` and `/board/projects/*` from the registry. No wiring file changes; the Design's
  anti-patterns forbid editing them.
- **One endpoint or two for the header? — CLOSED: `path` on `/api/project`, runtime facts on a new
  `GET /api/project/fleet`.** `/api/project` backs the sidebar title and must stay a cheap read;
  fleet resolution touches the filesystem and two tables. Adding `path` costs one normalizer call, so
  it stays inline.
- **Where is `ProjectContext` provided? — CLOSED: `BoardLayout`, above the module.** `GlobalAgentBar`
  is mounted at `BoardLayout.tsx:161` on every Board route and needs `path` for task 0844's R7;
  a provider inside `ProjectsShell` would be invisible to it. `LeftSidebar` already proves the fact is
  Board-wide by fetching `/api/project` globally today.
- **Module `order` value — CLOSED: 45.** Sits above Workspace (50), Inbox (60), and Teams (70) without
  renumbering them, so G64 can delete those three entries without a second sidebar reshuffle.
- **Where does the port-reuse guard live? — CLOSED: stated here, enforced by consumers.** The shell
  owns `path`'s arrival in the client; 0841 (drafts) and 0844 (receipts) own discarding state whose
  stored `path` differs from the served one. Browser origin isolation already prevents live
  cross-project leakage; a reused port is the only hazard, and it is a path comparison.
- **Strategy mutation from the header — DEFERRED, owner: Robin.** G63's scope is read-only
  presentation; `StrategyRuntime.setStrategy` exists (task 0838) but no G63 requirement asks for a
  Board control. Re-open only if Robin asks for strategy switching in the Board rather than via
  `spur projects`.

### Design

**WHAT.** One new module directory, `apps/web/src/modules/projects/`, plus two small server-side
additions: the canonical `path` on the existing `/api/project`, and a new read-only
`GET /api/project/fleet` that carries the header's three runtime facts (strategy, orchestrator
availability, capacity).

**WHY a directory and nothing else on the client.** `discover.ts` globs `./*/index.{ts,tsx}` and
`router.tsx` derives routes from `modules`, so creating the directory registers the module, mounts
`/board/projects`, and mounts `/board/projects/*` for tab deep links. Editing `registry.ts`,
`router.tsx`, `config.ts`, or `LeftSidebar` would be redundant work that also makes the module
inconsistent with the other seven.

**WHY a second endpoint rather than widening `/api/project`.** `/api/project` is polled by
`LeftSidebar.useProjectName` (`apps/web/src/components/LeftSidebar.tsx:23-40`) purely for the sidebar
title; it must stay a cheap constant-time read. Resolving the fleet touches the filesystem
(`<projectPath>/.spur/fleet.json`) and the database (`project_claims`, `project_strategy`). Adding
`path` to `/api/project` costs one `normalizeProjectPath` call, so that goes inline; the runtime facts
get their own route.

**WHERE.**

| Layer | Change |
| --- | --- |
| `apps/server/src/modules/health/index.ts:50` | `/api/project` returns `{ name, path }` |
| `apps/server/src/modules/health/index.ts` (new route) | `GET /api/project/fleet` → `ProjectFleetSnapshot` |
| `apps/web/src/modules/projects/index.tsx` (new) | `module: WebModule` export |
| `apps/web/src/modules/projects/ProjectsShell.tsx` (new) | header + tablist + tabpanel |
| `apps/web/src/modules/projects/tabs.ts` (new) | `PROJECT_TABS`, `ProjectTabId` |
| `apps/web/src/modules/projects/useProjectContext.tsx` (new) | fetches both routes; supplies `path` |
| `apps/web/src/components/BoardLayout.tsx:141-161` | mount `ProjectProvider` around `<Outlet/>` **and** `<GlobalAgentBar/>` |
| `apps/web/src/modules/projects/useProjectTab.ts` (new) | URL ⇄ active tab |
| `docs/04_DESIGN.md` + owning satellite | record the two HTTP surface additions (T3) |

**Frozen names — client.**

```ts
// index.tsx
export const module: WebModule = {
    id: 'projects', name: 'Projects', icon: '📁', route: 'projects',
    component: ProjectsShell, sidebarLabel: 'Projects',
    description: 'Conversation, agents, and work for this project', order: 45,
};

// tabs.ts
export type ProjectTabId = 'conversation' | 'agents' | 'work';
export interface ProjectTab { id: ProjectTabId; label: string; component: ComponentType; }
export const PROJECT_TABS: readonly ProjectTab[];
export const DEFAULT_PROJECT_TAB: ProjectTabId = 'conversation';

// useProjectContext.tsx
export interface ProjectContextValue {
    path: string | null;          // canonical worktree path; null while loading or on failure
    name: string;                 // display label only, never a key
    fleet: ProjectFleetSnapshot | null;
    state: 'loading' | 'ready' | 'unresolvable';
}
export const ProjectContext: React.Context<ProjectContextValue>;
export function useProjectContext(): ProjectContextValue;

// useProjectTab.ts
export function useProjectTab(): { activeTab: ProjectTabId; selectTab: (id: ProjectTabId) => void };
```

**Provider placement — `BoardLayout`, not `ProjectsShell`.** The served project's path is a
Board-wide fact, not a Projects-module fact: `LeftSidebar` already fetches `/api/project` on every
route (`apps/web/src/components/LeftSidebar.tsx:23-40`), and `GlobalAgentBar` is mounted outside the
module at `BoardLayout.tsx:161` and must reach `path` from every route (task 0844 R7). `ProjectProvider`
therefore wraps both `<Outlet/>` and `<GlobalAgentBar/>` in `BoardLayout`, and one fetch serves the
whole board. `LeftSidebar.useProjectName` is deliberately **left as it is** — rewiring the sidebar
title is not this feature's scope and its `FALLBACK_TITLE` behavior is already correct.

`order: 45` places Projects between `task-kanban` (40) and `workspace` (50), so it appears above the
three surfaces it will replace **without** renumbering any of them (R6).

**Frozen names — transport.**

```ts
interface ProjectFleetSnapshot {
    path: string;                                  // canonical worktree path, echoed for verification
    strategy: { name: StrategyName; version: number } | null;   // null when G62 0838 is not yet landed
    orchestrator: OrchestratorBinding;             // G62 0836, verbatim
    members: ResolvedFleetMember[];                // G62 0835, verbatim; rendered by task 0842
    capacity: { total: number; enabled: number; writeCapable: number; missing: string[] };
}
```

`members` is carried here rather than added by 0842 so the endpoint's shape is frozen once. The header
uses only `capacity`; the Agents roster (0842) renders `members`. `ResolvedFleetMember` is task 0835's
type verbatim — `{ instanceId, role?, executor, enabled, writeCapable, capabilityState }` — and is
**not** re-declared in `apps/web`; the web-side interface mirrors its field names exactly.

`OrchestratorBinding` / `OrchestratorState` (`'bound-online' | 'bound-offline' | 'missing' |
'unresolvable'`) and `StrategyName` are reused **verbatim** from G62 tasks 0836 and 0838 — 0836's
handoff note assigns their rendering to this task. `ResolvedFleetMember` is reused verbatim from task 0835. `capacity` is derived from the same
`FleetService.resolve(projectPath)` result: `total = members.length`,
`enabled = members.filter(m => m.enabled).length`,
`writeCapable = members.filter(m => m.writeCapable).length`, `missing = resolved.missing`.

**Identity (R4).** `path` is `normalizeProjectPath(ctx.cwd)`
(`packages/app/src/services/project-registry.ts:11`) — the **same** normalizer `/api/projects` already
uses to compute `current` (`health/index.ts:55-79`), so the module's key and the switcher's
current-project marker can never disagree. `useProjectContext` exposes `path`; every project-scoped
consumer keys on it. A consumer that has persisted state under a different `path` discards that state
rather than rendering it — this is the port-reuse guard, and it is stated here because the shell is
where `path` first enters the client.

**Header states (R5), first match wins.**

1. `/api/project` fails or returns no `path` → `state: 'unresolvable'`; the header names
   "project path unavailable" and tabs still mount.
2. `orchestrator.state` is rendered by its own name: `missing` ("no orchestrator bound"),
   `bound-offline` ("bound but not responding"), `unresolvable`, `bound-online`.
3. `capacity.total === 0` → "no fleet declared" with the expected file path
   `<project>/.spur/fleet.json`.
4. `capacity.missing.length > 0` → the named unresolved members are listed, not summed away.
5. `strategy === null` → "strategy unavailable"; never rendered as `rest`, which is a real state.

Tabs mount in every one of these states. The module never renders a bare empty shell.

**Tab contract (R3).** Mirrors `WorkspaceShell.tsx:65-95` exactly: `role="tablist"` with
`aria-label="Projects tabs"`, each button `role="tab" aria-selected={selected}`
`aria-controls={`projects-tab-panel-${id}`} id={`projects-tab-${id}`}`, and the panel
`role="tabpanel" id={`projects-tab-panel-${id}`} aria-labelledby={`projects-tab-${id}`}`. Active tab
comes from the URL, not component state: `useProjectTab` reads the path segment after `projects`
(`/board/projects/agents` → `agents`), falls back to `DEFAULT_PROJECT_TAB` for an absent or unknown
segment, and `selectTab` navigates with `{ replace: true }` preserving the query string — the same
pattern `useTaskParams` uses (`apps/web/src/modules/task-kanban/useTaskParams.tsx:44-51`). The
`<route>/*` wildcard already in `router.tsx:22-25` makes the deep link resolve without a router change.

**Test attributes.** `data-projects-shell`, `data-projects-header`, `data-projects-tab`,
`data-projects-state="<header state>"`. Follows the `data-workspace-*` convention; 0845 asserts on them.

**Anti-patterns — do not implement.**

- Do not add a second project selector inside the module. `ProjectSwitcher` in `LeftSidebar` is the
  only one, and it works by navigating to another server.
- Do not make the Board multi-project: no client-side project list in the module, no fetch against
  another project's port, no cross-project aggregation.
- Do not register the module by editing `registry.ts`, `router.tsx`, or `modules/config.ts`. The only
  permitted `BoardLayout` edit is mounting `ProjectProvider`.
- Do not provide `ProjectContext` from inside `ProjectsShell`; `GlobalAgentBar` renders outside the
  module and would see no provider.
- Do not remove, hide, or renumber the Workspace, Inbox, or Teams modules — G64 owns retirement, and a
  renumber here would silently reorder the sidebar twice.
- Do not key any state on the project **name** or on the browser origin.
- Do not import `FleetService`, `StrategyRuntime`, or any `packages/app` service into `apps/web`; the
  web app reaches them only through the server (ADR-021 thin transports).
- Do not write strategy from the header. This task is read-only; `StrategyRuntime.setStrategy` is not
  surfaced by G63.
- Do not add a design-system dependency. Use `@/ui` primitives and the tokens already in live use:
  `spur-bg`, `spur-surface`, `spur-surface-3`, `spur-border`, `spur-text`, `spur-text-muted`,
  `spur-accent`.
- Do not block tab rendering on the fleet fetch; a slow or failed `/api/project/fleet` degrades the
  header only.

**Handoff.** 0841 consumes `path` from `useProjectContext` to key drafts and the thread; 0842 consumes
the same snapshot plus `/api/team/*` for the roster; 0843 mounts `KanbanBoard` (whose `onSelectTask` prop keeps
selection inside the module) and `FeaturesShell` into the Work tab; 0844 reads `path` when minting a submission; 0845 asserts the
tab a11y contract and the `data-projects-*` attributes frozen above.

**Dependency posture.** G62 tasks 0835/0836/0838 supply `FleetService`, `resolveOrchestrator`, and
`StrategyRuntime`. If this task is implemented before they land, `GET /api/project/fleet` returns
`strategy: null` and `orchestrator: { state: 'unresolvable' }` — states the header already renders by
name — and the endpoint is completed, not rewritten, when the services exist. No stub types are
duplicated into `apps/web`.

### Plan

1. **(R4)** Extend `GET /api/project` in `apps/server/src/modules/health/index.ts:50` to return
   `{ name, path }`, with `path = normalizeProjectPath(ctx.cwd)` and `path: null` when there is no
   context. Leave `name` byte-identical so `LeftSidebar.useProjectName` is untouched.
   *Test:* server test asserting `path` is the normalized cwd and equals the `path` that
   `/api/projects` reports for the `current` entry.
2. **(R2, R5)** Add `GET /api/project/fleet` in the same module returning `ProjectFleetSnapshot`,
   composed from `FleetService.resolve`, `FleetService.resolveOrchestrator`, and
   `StrategyRuntime.getStrategy`. Degrade to `strategy: null` /
   `orchestrator: { state: 'unresolvable' }` instead of throwing when a service is unavailable.
   *Test:* three cases — full snapshot, zero-member fleet, unresolved services — each returning 200
   with a named state, never a 500.
3. **(R1)** Create `apps/web/src/modules/projects/index.tsx` exporting the frozen `module` object and
   `ProjectsShell`. *Test:* registry test asserting `getModule('projects')` resolves and that `id` and
   `route` collide with nothing (`createRegistry` already throws on collision).
4. **(R3)** Add `tabs.ts` with `PROJECT_TABS` / `DEFAULT_PROJECT_TAB` and `useProjectTab.ts` reading
   the segment after `projects`. *Test:* `/board/projects` → `conversation`; `/board/projects/agents`
   → `agents`; `/board/projects/bogus` → `conversation`; `selectTab` preserves the query string.
5. **(R4)** Add `useProjectContext.tsx`: fetch both routes through `resolveApiUrl`/`fetchWithTimeout`,
   expose `{ path, name, fleet, state }`, and provide `ProjectContext`. Mount `ProjectProvider` in
   `BoardLayout` around both `<Outlet/>` and `<GlobalAgentBar/>`. *Test:* a failed `/api/project`
   yields `state: 'unresolvable'` with `path: null`; a non-Projects route (`/board/tasks`) still
   resolves `path` through the context, proving the provider is above the module.
6. **(R2, R5, R7)** Build `ProjectsShell`: header rendering the five states in the frozen precedence
   order, then the tablist and tabpanel copied from `WorkspaceShell.tsx:65-95`, using only the listed
   tokens. *Test:* each of the five header states renders its named text and the tabs remain mounted;
   a snapshot of `data-projects-state` per fixture.
7. **(R6)** Verify Workspace, Inbox, and Teams still resolve and that module `order` values 10–70 are
   unchanged. *Test:* registry ordering assertion listing all eight modules.
8. **(T3)** Record the two HTTP additions in `docs/04_DESIGN.md` and its owning satellite in the same
   commit as the surface change.
9. Run `cd apps/web && bun test` for the module tests, then the repository gate
   `bun run spur-check`.

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
