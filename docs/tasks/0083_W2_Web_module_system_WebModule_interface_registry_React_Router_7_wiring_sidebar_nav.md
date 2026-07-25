---
name: "W2: Web module system — WebModule interface, registry, React Router 7 wiring, sidebar nav"
description: "W2: Web module system — WebModule interface, registry, React Router 7 wiring, sidebar nav"
status: done
created_at: 2026-06-15T16:57:15.320Z
updated_at: 2026-06-16T23:50:46.647Z
folder: docs/tasks
type: task
feature-id: W2
priority: P1
estimated_hours: 8
tags: ["server-side-adjustment","wave-W0","group-W"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0083. "W2: Web module system — WebModule interface, registry, React Router 7 wiring, sidebar nav"

### Background

The standard for adding new UI modules. A WebModule is a self-contained React view + optional sidebar/right-panel contributions, registered in a central registry. Active module via URL routing (React Router 7, Q4 confirmed) — each module owns a route segment (/board/tasks, /board/features); URLs shareable+bookmarkable. Astro provides the static shell; the React island owns all client-side routing via createBrowserRouter. The first module (Task Kanban, W3) proves the mechanism; future modules follow without layout changes. This is the module-registry + routing half of W2 (layout half is the prior task). Anchors: design §3.4.


### Requirements

## Requirements

- [x] **R1** WebModule interface {id,name,icon,route,component,rightPanelComponent?,sidebarLabel?} -> MET | Evidence: apps/web/src/modules/types.ts:4-12
- [x] **R2** registry.ts: builtins / modules / getModule / defaultModule -> MET | Evidence: apps/web/src/modules/registry.ts:8-18 + tests apps/web/tests/modules/registry.test.ts
- [x] **R3** router.tsx: createBrowserRouter /board parent=BoardLayout, children from modules; / -> Navigate /board/<default> -> MET | Evidence: apps/web/src/router.tsx (routes tree + lazy createAppRouter); route-mapping test asserts one child per module
- [x] **R4** index.astro static shell + client:only React island; NO SSR compute -> MET (post-fix) | Evidence: index.astro now renders <BoardApp client:only="react"/> (no router import in frontmatter); BoardApp.tsx builds the router lazily in-browser via createAppRouter; `bun run build` PASSES. See Review #1.
- [x] **R5** LeftSidebar ModuleNavItem per module + active highlight (NavLink) -> MET (post-fix) | Evidence: LeftSidebar.tsx:24-40; test asserts navLinks.length === modules.length AND the active link carries text-spur-accent with the correct href
- [x] **R6** Right panel renders active module's rightPanelComponent via context -> MET | Evidence: BoardLayout.tsx:12,68,84 (ActiveModuleContext + conditional render)
- [x] **R7** Adding a module = one registry entry + dir; placeholder appears in nav+routes -> MET (post-fix) | Evidence: PlaceholderModule is the sole builtin; tests assert it renders in the workspace at /board/board AND appears as a nav item AND maps to a child route
- [x] **R8** Tests: modules produce routes; navigate /board/<id> renders module; sidebar highlights active -> MET (post-fix) | Evidence: router-integration tests in BoardLayout.test.tsx (navigate->render PlaceholderView, / redirect, nav-item-per-module + active highlight, route-tree mapping) + registry unit tests. Full gate green.


### Q&A



### Design

Authority: design §3.4 (web module system + registry + routing + the React island). Q4 (React Router 7).

**This task = the MODULE-REGISTRY + ROUTING + sidebar-NAV half of W2** (the layout shell + data layer is
0082). Together they complete W2.

**WebModule interface (design §3.4):**
```typescript
// apps/web/src/modules/types.ts
export interface WebModule {
  readonly id: string;                          // 'tasks' | 'features' — matches the route segment
  readonly name: string;                        // sidebar display
  readonly icon: string;                        // daisyUI icon class or SVG component
  readonly route: string;                       // segment under /board/ (e.g. 'tasks' -> /board/tasks)
  readonly component: ComponentType;            // main workspace view
  readonly rightPanelComponent?: ComponentType; // right-panel contribution when active
  readonly sidebarLabel?: string;               // defaults to name
}
```

**Registry (design §3.4):**
```typescript
// apps/web/src/modules/registry.ts
const builtins: WebModule[] = [ /* TaskKanbanModule registers here in W3/0084 */ ];
export const modules: ReadonlyArray<WebModule> = builtins;
export function getModule(id: string): WebModule | undefined { return builtins.find(m => m.id === id); }
export const defaultModule = builtins[0];
```
Adding a module = one registry entry + the module directory (the extension point). This task proves it
with a PLACEHOLDER module (W3 swaps in the real Task Kanban).

**Routing — React Router 7 (design §3.4, Q4):**
```typescript
// apps/web/src/router.tsx
import { createBrowserRouter, Navigate } from 'react-router';
const routes = [
  { path: '/board', element: <BoardLayout />, children: modules.map(mod => ({ path: mod.route, element: <mod.component/> })) },
  { path: '/', element: <Navigate to={`/board/${modules[0].id}`} replace /> },
];
export const router = createBrowserRouter(routes);
```
`BoardLayout` (from 0082) renders `<Outlet/>` in `MainWorkspace`; the right-panel `Outlet`/contribution is
rendered by `BoardLayout` via context from the active module's `rightPanelComponent`. Wire the `<Outlet/>`
into `MainWorkspace` (the 0082 shell left it as a slot).

**React island (design §3.4 — Astro `client:only="react"`):**
```astro
---
// apps/web/src/pages/index.astro
import { RouterProvider } from 'react-router';
import { router } from '../router';
---
<html lang="en"><head><meta charset="utf-8"/><title>Spur Board</title></head>
<body><div id="root"><RouterProvider router={router} client:only="react" /></div></body></html>
```
Astro generates a static HTML shell; the React island hydrates + owns ALL client-side routing. No SSR
compute (matches W1 `output:'static'`).

**Sidebar nav (design §3.3/§3.4):** `LeftSidebar` (0082 shell) renders one `ModuleNavItem` per registered
module — icon + label expanded, icons only collapsed; active module highlighted (React Router `NavLink`
active state). Clicking navigates to `/board/<id>`.

**Right-panel contribution:** `BoardLayout` reads the active module's `rightPanelComponent` (via a small
context/hook keyed off the active route) and renders it in `RightPanel`.

**Verify import path:** React Router 7 imports from `react-router` (NOT `react-router-dom` in v7) —
confirm against the installed version (W1 added it).

**Out of scope:** the Task Kanban module content (W3/0084 — registers the real module + its
rightPanelComponent); design tokens/dark mode/responsive polish (W4/0085).


### Solution

## Solution

Built the W2 module-registry + routing + sidebar-nav half (design §3.4).

**Module system (apps/web/src/modules/):** `WebModule` interface (types.ts); `registry.ts` exposes the `builtins` array, read-only `modules`, `getModule(id)`, and `defaultModule`. A `PlaceholderModule` (placeholder.tsx) is the sole builtin — it proves the extension mechanism end-to-end before W3/0084 swaps in the real Task Kanban.

**Routing (React Router 7):** `router.tsx` exposes a pure `routes` tree (`/board` parent = BoardLayout, one child per module; `/` -> Navigate to the default module) and a lazy `createAppRouter()`. The browser router is built only in the browser — `createBrowserRouter` reads `document`, so eager construction crashed Astro's static build. `BoardApp.tsx` is a `client:only="react"` island that builds the router via `useState(createAppRouter)`; `index.astro` renders `<BoardApp client:only="react"/>` with NO router import in frontmatter, so no SSR/build-time compute.

**Wiring:** `BoardLayout` (0082) renders `<Outlet/>` in `MainWorkspace` and the active module's `rightPanelComponent` in `RightPanel` via `ActiveModuleContext`. `LeftSidebar` renders one `NavLink` per registered module (icon+label, icons-only when collapsed) with active highlighting.

**Tests:** `registry.test.ts` (registry unit) + router-integration tests in `BoardLayout.test.tsx` (navigate /board/<id> renders the module under the Outlet, `/` redirect, one nav item per module + active highlight, route-tree mapping). DOM via happy-dom + @testing-library/react with a file-scoped register/unregister shared across both suites.

**Out of scope:** the real Task Kanban module + its rightPanelComponent (W3/0084); design tokens/dark mode/responsive polish (W4/0085).


### Plan

## Plan

- [x] `apps/web/src/modules/types.ts`: `WebModule` interface `{ id, name, icon, route, component, rightPanelComponent?, sidebarLabel? }`.
- [x] `apps/web/src/modules/registry.ts`: `builtins` array, `modules`, `getModule(id)`, `defaultModule`.
- [x] A placeholder WebModule (proves the mechanism end-to-end before W3).
- [x] `apps/web/src/router.tsx`: `routes` tree (`/board` parent = BoardLayout, children from `modules`; `/` -> `Navigate /board/<defaultModule.route>`); lazy `createAppRouter()`. `react-router` v7 import paths confirmed.
- [x] Wire `<Outlet/>` into `MainWorkspace`; `BoardLayout` renders the active module's `rightPanelComponent` in `RightPanel` via context.
- [x] `apps/web/src/pages/index.astro`: static shell + `<BoardApp client:only="react"/>` (client-only island; no SSR compute).
- [x] `LeftSidebar`: `NavLink` per module (icon+label / icons-only collapsed); active highlight; click -> `/board/<route>`.
- [x] Tests: registered modules produce routes; navigating to `/board/<id>` renders the module in the workspace; sidebar highlights active; placeholder appears via one registry entry.
- [x] Gate: `bun run lint` + `test` + `build` all green; `.tsx` excluded from coverage thresholds per project decision.
- [x] GATE CHECK: W1 (0080) + W2-layout (0082) landed. Note: W3 (0084) registers the real Task Kanban module.


### Review


### Fix-pass 2026-06-16 (--fix all)

**Result:** 4 fixed, 0 failed, 0 deferred. Gate: lint + 1457(+158) tests + test-cf + build ALL green (build was the P1 blocker).

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | P1 build blocker: createBrowserRouter ran at build time (`document is not defined`) | FIXED — extracted apps/web/src/components/BoardApp.tsx (client:only island); index.astro now imports BoardApp (no `router` in frontmatter); router.tsx exposes `createAppRouter()` (lazy) + pure `routes`, and `router` is no longer instantiated at module load. createBrowserRouter now runs only in the browser. Build PASSES. |
| 2 | P3: navigate /board/<id> render untested (R8) | FIXED — router-integration test: createMemoryRouter(routes) at /board/board asserts PlaceholderView renders under the Outlet. |
| 3 | P3: NavLink active-highlight untested (R5/R8) | FIXED — asserts the active nav link carries text-spur-accent + correct href; inactive ones do not. |
| 4 | P3: nav/route mapping untested (R7) | FIXED — asserts navLinks.length === modules.length and routes[/board].children maps each module.route. |

**Notes:**
- Router tests merged into apps/web/tests/components/BoardLayout.test.tsx (the single happy-dom-owning file) with a FILE-SCOPED afterAll(unregister) so both suites share one DOM lifecycle. A standalone DOM test file would double-register happy-dom and tear it down before the second suite (verified failure mode).
- `routes` exported as pure data (separate from `createAppRouter`) so DOM-less imports + Astro static build never trigger createBrowserRouter.
- `.tsx` files are excluded from coverage thresholds (bunfig) per the prior decision; component/router behavior is validated by these assertions.


### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | `bun run build` fails: `ReferenceError: document is not defined` at createBrowserRouter during Astro static prerender. index.astro imports `router` in FRONTMATTER (build/server context); router.tsx calls createBrowserRouter at module top-level (needs document). client:only does NOT prevent the build-time module evaluation. Violates R4 (no SSR compute) and breaks the gate. | Correctness | apps/web/src/pages/index.astro:2-3 + apps/web/src/router.tsx:1,20 | Move router construction OUT of the .astro frontmatter into a client-only React island. Create e.g. apps/web/src/components/BoardApp.tsx that imports { router } + RouterProvider and renders <RouterProvider router={router}/>, then in index.astro render <BoardApp client:only="react"/> (NO router import in frontmatter). createBrowserRouter then only runs in the browser. |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 2 | R8 partial: no test asserts that navigating to /board/<id> RENDERS the module component in the workspace (router wiring untested). registry.test.ts covers the registry only; BoardLayout.test.tsx renders BoardLayout in a MemoryRouter but has no <Routes>/module element under the Outlet. | Correctness | apps/web/tests/ (missing) | Add a router-integration test: render a MemoryRouter with the /board route tree (or the real `routes`) at initialEntries ['/board/board'] and assert the PlaceholderView ('Welcome'/'Select a module') renders in MainWorkspace. |
| 3 | R5/R8 partial: NavLink active-highlight (isActive styling) is implemented but not asserted by any test. | Usability | apps/web/src/components/LeftSidebar.tsx:28-34 | Render LeftSidebar inside a MemoryRouter at /board/board and assert the active nav item carries the active class (text-spur-accent) while others do not. |
| 4 | R7 partial: "a placeholder module appears in nav + routes via one registry entry" is asserted only at the registry level (getModule('board')); the nav-rendering + route-mapping assertions are absent. | Correctness | apps/web/tests/modules/registry.test.ts | Add an assertion that LeftSidebar renders one nav item per `modules` entry and router `routes[0].children` maps each module.route. |

### Deferred / blocked
- None blocked on approval. All findings are mechanically fixable in-repo.


### Testing

## Testing

**Status:** all green — `bun test apps/web` 30 pass / 0 fail; full gate 1457 (+158 plugins/sp) / 0 fail.

| Test file | Covers | Cases |
| --------- | ------ | ----- |
| `apps/web/tests/modules/registry.test.ts` | R2 registry: `modules` non-empty, `defaultModule` = first, `getModule` hit/miss, required-field shape | 5 |
| `apps/web/tests/components/BoardLayout.test.tsx` (describe: BoardLayout) | R1/R3 layout shell render, collapse/expand toggles + persistence, restore-on-mount, sidebar + right-panel resize persistence | 7 |
| `apps/web/tests/components/BoardLayout.test.tsx` (describe: router + module wiring) | R5/R7/R8 navigate `/board/<id>` renders module under Outlet; `/` redirect; one NavLink per module + active highlight; route-tree maps one child per module | 4 |

**DOM env:** happy-dom + @testing-library/react, registered once at file top with a **file-scoped** `afterAll(unregister)` so both describe blocks share one DOM lifecycle and the non-DOM `lib/` suites keep the real fetch/localStorage (verified across the 131-file root run — no leakage).

**Coverage:** `.tsx` files excluded from the threshold gate (bunfig `coveragePathIgnorePatterns`); component/router behavior validated by assertions, not line ratio. `registry.ts` (`.ts`) at 100%.

**Build:** `bun run build` PASSES — `createBrowserRouter` runs only in the browser (client-only island + lazy `createAppRouter`), never during Astro static prerender.


### Artifacts

## Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| source | apps/web/src/modules/types.ts | dev-verify | 2026-06-16 |
| source | apps/web/src/modules/registry.ts | dev-verify | 2026-06-16 |
| source | apps/web/src/modules/placeholder.tsx | dev-verify | 2026-06-16 |
| source | apps/web/src/router.tsx | dev-verify | 2026-06-16 |
| source | apps/web/src/components/BoardApp.tsx | dev-verify | 2026-06-16 |
| source | apps/web/src/components/LeftSidebar.tsx | dev-verify | 2026-06-16 |
| source | apps/web/src/pages/index.astro | dev-verify | 2026-06-16 |
| test | apps/web/tests/modules/registry.test.ts | dev-verify | 2026-06-16 |
| test | apps/web/tests/components/BoardLayout.test.tsx | dev-verify | 2026-06-16 |


### References

## References

- Design anchor: `docs/04_DESIGN.md` (web module system + registry + routing + React island) — Q4 (React Router 7).
- Architecture: `docs/03_ARCHITECTURE.md` — `apps/web` boundary (consumes `packages/contracts` types via oRPC client only); invariant #2 (one transport).
- Related task: 0082 (W2 layout shell + data layer — BoardLayout/Outlet slot this task wires into).
- Follow-up: 0084 (W3 — registers the real Task Kanban module, replacing PlaceholderModule).
- React Router 7: `createBrowserRouter` / `createMemoryRouter` / `Navigate` / `NavLink` / `Outlet` imported from `react-router` (v7 — not `react-router-dom`).

