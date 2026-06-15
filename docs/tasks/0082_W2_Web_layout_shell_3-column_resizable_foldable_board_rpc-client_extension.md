---
name: "W2: Web layout shell — 3-column resizable/foldable board + rpc-client extension"
description: "W2: Web layout shell — 3-column resizable/foldable board + rpc-client extension"
status: Backlog
created_at: 2026-06-15T16:57:15.299Z
updated_at: 2026-06-15T16:57:15.299Z
folder: docs/tasks
type: task
feature-id: W2
priority: P1
estimated_hours: 9
tags: ["server-side-adjustment","wave-W0","group-W"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0082. "W2: Web layout shell — 3-column resizable/foldable board + rpc-client extension"

### Background

The classic board/IDE 3-column shell that serves as the module hub: left sidebar (module nav), main workspace (active module view), right panel (context). Left+right resizable (drag handle) + foldable, persisted to localStorage. Also the web data layer: extend the existing rpc-client.ts with a timeout fetch wrapper + an oRPC tracing/error interceptor — NO APIClient, NO facade (Q3 revised); OpenAPILink stays the SOLE transport; single { api } export. This task is the layout + data half of W2; the module-registry + routing half is the next task. Anchors: design §3.2 (data layer), §3.3 (layout tree).


### Requirements

R1: BoardLayout root: 3-column CSS grid (grid-template-columns: var(--sidebar-w) 1fr var(--rightpanel-w); 100vh; overflow hidden). R2: LeftSidebar + RightPanel resizable via a thin ResizeHandle (onPointerDown/Move/Up updates the CSS var; mouseup persists). R3: Foldable — data-sidebar-collapsed / data-rightpanel-collapsed toggle collapsed widths (sidebar 48px icon bar, right panel 0). R4: layout-state.ts persists { sidebarWidth, rightPanelWidth, sidebarCollapsed, rightPanelCollapsed } to localStorage (key spur-board-layout); safe parse with defaults. R5: Responsive: >=lg full 3-col; md sidebar->icon bar; <md single column (sidebar slide-in drawer, right panel bottom sheet) — structural hooks here, full polish in W4. R6: rpc-client.ts extension (design §3.2 — corrected oRPC API): withTimeout(ms) fetch wrapper passed as OpenAPILink fetch (custom 5-arg signature — wrap Request directly); onError interceptor on adapterInterceptors (from @orpc/shared); typed ApiClient export; KEEP ContractRouterClient import from @orpc/contract (NOT @orpc/client — repo pins 1.14.x); remove the createApiClient factory; single export const api. R7: Modules import { api } from lib/rpc-client, NEVER @orpc/* directly (invariant #2). R8: NO TanStack Query (module-level React hooks). R9: Tests: layout persists+restores from localStorage; collapse toggles; withTimeout aborts on timeout; onError interceptor catches. Coverage per project standard. GATED on W1.


### Q&A



### Design

Authority: design §3.2 (data layer — extend rpc-client), §3.3 (layout component tree + CSS grid +
persistence + responsive). Invariant #2 (one transport). Q3 (no APIClient/facade).

**This task = the LAYOUT shell + DATA layer half of W2.** The module-registry + routing + sidebar nav
half is the next task (0083). Split because W2 as one task exceeds 24h.

**Layout component tree (design §3.3):**
```
BoardLayout (3-column CSS grid, root)
├── LeftSidebar   (module nav — resizable, foldable)
├── MainWorkspace (active module view — React Router <Outlet/>; the Outlet wiring lands in 0083)
└── RightPanel    (context panel — resizable, foldable)
```
This task builds `BoardLayout`, `LeftSidebar` (shell — nav items in 0083), `MainWorkspace` (shell),
`RightPanel`, `ResizeHandle`, and `layout-state.ts`. The `<Outlet/>` + nav items come in 0083 with
routing.

**CSS grid (design §3.3):**
```css
.board-layout { display:grid; grid-template-columns: var(--sidebar-w) 1fr var(--rightpanel-w);
  grid-template-rows:100vh; height:100vh; overflow:hidden; }
:root { --sidebar-w:240px; --rightpanel-w:320px; }
.board-layout[data-sidebar-collapsed="true"] { --sidebar-w:48px; }
.board-layout[data-rightpanel-collapsed="true"] { --rightpanel-w:0px; }
```

**ResizeHandle (design §3.3):** thin `<div class="resize-handle">` between columns; `onPointerDown/Move/Up`
updates the CSS var live; on `pointerup` persists to localStorage. ~40 lines.

**Persistence (design §3.3):** `apps/web/src/lib/layout-state.ts` — `loadLayoutState()` (safe JSON parse
with defaults `{sidebarWidth:240, rightPanelWidth:320, sidebarCollapsed:false, rightPanelCollapsed:true}`),
`saveLayoutState(state)` to localStorage key `spur-board-layout`.

**Responsive (design §3.3 — structural hooks; full polish in W4/0085):**
| Breakpoint | Layout |
|---|---|
| >=lg (1024) | full 3-col |
| md (768–1023) | sidebar -> icon bar; workspace + right panel |
| <md (<768) | single column; sidebar = slide-in drawer; right panel = bottom sheet |
This task lays the breakpoint structure; W4 finishes the drawer/bottom-sheet polish + dark mode.

**Data layer — rpc-client.ts extension (design §3.2 — CORRECTED oRPC API, verified against
@orpc/client@1.14.4 + @orpc/shared@1.14.4):**
- KEEP `ContractRouterClient` import from `@orpc/contract` (the existing file does — NOT @orpc/client;
  repo pins 1.14.x). `createORPCClient` + `ClientContext` from `@orpc/client`; `OpenAPILink` from
  `@orpc/openapi-client/fetch`; `JsonifiedClient` from `@orpc/openapi-client`; `onError` from
  `@orpc/shared`.
- `withTimeout(ms=10_000)` fetch wrapper: `OpenAPILink`'s `fetch` option has a CUSTOM 5-arg signature
  `(request, init, options, path, input) => Promise<Response>` (NOT `typeof fetch`) — wrap a `Request`
  directly with an `AbortController` timeout.
- Tracing/error interceptor: `adapterInterceptors: [ onError((error, options) => { /* log + error-boundary
  emit; options carries path/input */ }) ]` (and optional `onSuccess`/`onStart` for OTel spans).
- Typed `ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>`; single
  `export const api: ApiClient = createORPCClient(link)`. REMOVE the `createApiClient` factory (only used
  to make the singleton). ~30 lines net. `resolveApiUrl` unchanged.
- Modules import `{ api }` from `lib/rpc-client`, NEVER `@orpc/*` directly (invariant #2).

**NO TanStack Query** (Q3) — module-level React hooks handle caching/polling.

**Out of scope:** WebModule interface/registry, React Router config, sidebar NAV ITEMS, the Outlet wiring
(all 0083); design tokens + dark mode + responsive polish (W4/0085); the Task Kanban module (W3/0084).


### Solution



### Plan

- [ ] `apps/web/src/components/BoardLayout.tsx`: 3-column CSS grid root with `--sidebar-w`/`--rightpanel-w` vars + `data-*-collapsed` attributes.
- [ ] `LeftSidebar.tsx`, `MainWorkspace.tsx`, `RightPanel.tsx` shells (nav items + `<Outlet/>` wired in 0083).
- [ ] `ResizeHandle.tsx`: `onPointerDown/Move/Up` updates the CSS var live; `pointerup` persists.
- [ ] `apps/web/src/lib/layout-state.ts`: `loadLayoutState()` (safe parse + defaults) / `saveLayoutState()` to localStorage key `spur-board-layout`.
- [ ] Collapse toggles for left/right (icon-bar / hidden); wire to `data-*-collapsed` + persistence.
- [ ] Responsive breakpoint structure (>=lg full / md icon-bar / <md single-column) — structural hooks; drawer/bottom-sheet polish in W4.
- [ ] `apps/web/src/lib/rpc-client.ts` extension (design §3.2): `withTimeout(ms)` wrapping a Request (5-arg fetch option); `adapterInterceptors:[onError(...)]`; typed `ApiClient`; single `export const api`; remove `createApiClient`; KEEP `ContractRouterClient` from `@orpc/contract`.
- [ ] Tests (React Testing Library): layout persists + restores from localStorage; collapse toggles change column width; `withTimeout` aborts on timeout; `onError` interceptor fires on a failed request. Modules import `{ api }` only (lint/grep: no `@orpc/*` in modules).
- [ ] Gate: `bun run lint` + `test` + `build`; coverage per project standard.
- [ ] GATE CHECK: W1 (0080) stack landed. Note: 0083 adds the WebModule registry + routing + nav items + Outlet.


### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


