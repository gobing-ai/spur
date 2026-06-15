---
name: "W2: Web module system — WebModule interface, registry, React Router 7 wiring, sidebar nav"
description: "W2: Web module system — WebModule interface, registry, React Router 7 wiring, sidebar nav"
status: Backlog
created_at: 2026-06-15T16:57:15.320Z
updated_at: 2026-06-15T16:57:15.320Z
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

R1: WebModule interface in apps/web/src/modules/types.ts: { readonly id; name; icon; route; component: ComponentType; rightPanelComponent?: ComponentType; sidebarLabel? }. R2: registry.ts — builtins array; modules export; getModule(id); defaultModule = builtins[0] (Task Kanban registers here in W3; a placeholder module proves it now). R3: router.tsx — createBrowserRouter with a /board parent route = BoardLayout, children mapped from modules (path mod.route -> element <mod.component/>); / redirects to /board/<defaultModule.id>. R4: index.astro — static shell + <RouterProvider router={router} client:only='react'/>; Astro generates the HTML shell, React island hydrates + owns routing; no SSR compute. R5: LeftSidebar renders one ModuleNavItem per registered module (icon + label; collapsed=icons only); active module highlighted (NavLink active state). R6: Right panel renders the active module's rightPanelComponent when present (via BoardLayout context). R7: Adding a module = one registry entry + the module directory (assert: a placeholder test module appears in nav + routes). R8: Tests: registered modules produce expected routes; navigating to /board/<id> renders the module; sidebar highlights active. Coverage per project standard. GATED on W1 + the W2 layout task (BoardLayout).


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



### Plan

- [ ] `apps/web/src/modules/types.ts`: `WebModule` interface `{ id, name, icon, route, component, rightPanelComponent?, sidebarLabel? }`.
- [ ] `apps/web/src/modules/registry.ts`: `builtins` array (empty / placeholder now; Task Kanban registers in W3), `modules`, `getModule(id)`, `defaultModule`.
- [ ] A placeholder WebModule (proves the mechanism end-to-end before W3).
- [ ] `apps/web/src/router.tsx`: `createBrowserRouter` — `/board` parent = BoardLayout, children from `modules`; `/` -> `Navigate /board/<defaultModule.id>`. Confirm `react-router` (v7) import paths.
- [ ] Wire `<Outlet/>` into `MainWorkspace` (the 0082 shell slot); `BoardLayout` renders the active module's `rightPanelComponent` in `RightPanel` via context.
- [ ] `apps/web/src/pages/index.astro`: static shell + `<RouterProvider router={router} client:only="react"/>`.
- [ ] `LeftSidebar`: `ModuleNavItem` per module (icon+label / icons-only collapsed); active highlight via `NavLink`; click -> `/board/<id>`.
- [ ] Tests: registered modules produce expected routes; navigating to `/board/<id>` renders the module's component in the workspace; sidebar highlights the active module; a placeholder module appears via one registry entry.
- [ ] Gate: `bun run lint` + `test` + `build`; coverage per project standard.
- [ ] GATE CHECK: W1 (0080) + the W2-layout task (0082, BoardLayout) landed. Note: W3 (0084) registers the real Task Kanban module.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


