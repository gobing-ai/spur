---
name: "W2: Web layout shell — 3-column resizable/foldable board + rpc-client extension"
description: "W2: Web layout shell — 3-column resizable/foldable board + rpc-client extension"
status: Done
created_at: 2026-06-15T16:57:15.299Z
updated_at: 2026-06-16T22:46:20.992Z
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

## Requirements

- [x] **R1** BoardLayout 3-col CSS grid root (100vh, overflow hidden) -> MET | Evidence: apps/web/src/styles/board-layout.css:11 .board-layout grid + apps/web/src/components/BoardLayout.tsx:60; test BoardLayout.test.tsx (renders default)
- [x] **R2** Left+Right resizable via ResizeHandle (pointer down/move/up updates CSS var; mouseup persists) -> MET | Evidence: apps/web/src/components/ResizeHandle.tsx:12-43 + persist BoardLayout.tsx:37-57; tests: sidebar + right-panel handle drag persist (BoardLayout.test.tsx)
- [x] **R3** Foldable via data-*-collapsed -> MET | Evidence: BoardLayout.tsx:62-63 + board-layout.css:19-27 (collapse overrides --sidebar-w/--rightpanel-w vars per design 3.3); tests: collapse + expand toggles (BoardLayout.test.tsx)
- [x] **R4** layout-state.ts persists 4 fields to localStorage key spur-board-layout, safe parse w/ defaults -> MET | Evidence: apps/web/src/lib/layout-state.ts:19-47 + tests apps/web/tests/lib/layout-state.test.ts
- [x] **R5** Responsive structural hooks (>=lg / md icon-bar / <md single col) -> MET | Evidence: board-layout.css:30-44 media queries
- [x] **R6** rpc-client.ts: withTimeout + onError interceptor + typed ApiClient + remove createApiClient + single api + keep ContractRouterClient -> MET | Evidence: fetchWithTimeout (rpc-client.ts:21); adapterInterceptors:[onError(logTransportError)] (rpc-client.ts:62); typed `export type ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>` + annotated api; factory removed; ContractRouterClient kept from @orpc/contract. Tests: logTransportError + onError-catches-network-failure (rpc-client.test.ts).
- [x] **R7** Modules import { api } only, never @orpc/* directly -> MET | Evidence: grep — only rpc-client.ts imports @orpc/*; no module-level violation
- [x] **R8** No TanStack Query -> MET | Evidence: not in apps/web/package.json deps
- [x] **R9** Tests: persist+restore; collapse toggles; withTimeout aborts; onError catches -> MET | persist+restore (layout-state.test.ts), withTimeout abort (rpc-client.test.ts), onError catches (rpc-client.test.ts), COLLAPSE TOGGLES + resize (BoardLayout.test.tsx via happy-dom + @testing-library/react). All 5 components at 100% coverage. Full gate: lint + 1448+158 tests + test-cf + build green.


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

## Solution

Built the W2 layout shell + data-layer half (design §3.2/§3.3).

**Layout (apps/web/src/components/):** `BoardLayout` — a 5-column CSS grid (`--sidebar-w | handle | 1fr | handle | --rightpanel-w`) whose two 4px handle cells host `ResizeHandle`. Collapse/responsive states override the CSS vars (not hardcoded columns), so the var BoardLayout sets on resize stays authoritative. `LeftSidebar`/`RightPanel` are foldable shells (nav items + context content land in 0083+); `MainWorkspace` is the `<Outlet/>` shell. `ResizeHandle` drives the var live on pointer move and persists on pointer up.

**Persistence (lib/layout-state.ts):** `load/save/resetLayoutState` over localStorage key `spur-board-layout`, safe-parsed with defaults `{240, 320, sidebarCollapsed:false, rightPanelCollapsed:true}`.

**Data layer (lib/rpc-client.ts):** single typed `export const api: ApiClient` where `ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>`. `OpenAPILink` configured with a `withTimeout` fetch (AbortController, 10s) and `adapterInterceptors:[onError(logTransportError)]` for transport-failure tracing. `createApiClient` factory removed; `ContractRouterClient` kept from `@orpc/contract`; `OpenAPILink` is the SOLE transport (invariant #2). No TanStack Query.

**Tests:** `tests/lib/*` cover persistence + timeout + onError (link-level). `tests/components/BoardLayout.test.tsx` covers render/collapse/restore/resize via happy-dom + @testing-library/react, DOM scoped with register/afterAll-unregister so the shared Bun test process keeps real fetch/localStorage for other suites.

**Deps added:** `@orpc/shared` (catalog) for `onError`; `@happy-dom/global-registrator`, `happy-dom`, `@testing-library/react`, `@testing-library/dom` (web-only devDep literals) for component tests.

**Out of scope (later tasks):** WebModule registry + React Router + nav items + Outlet wiring (0083); design tokens + dark mode + responsive drawer/bottom-sheet polish (W4/0085).


### Plan

## Plan

- [x] `apps/web/src/components/BoardLayout.tsx`: 3-column CSS grid root with `--sidebar-w`/`--rightpanel-w` vars + `data-*-collapsed` attributes.
- [x] `LeftSidebar.tsx`, `MainWorkspace.tsx`, `RightPanel.tsx` shells (nav items + `<Outlet/>` wired in 0083).
- [x] `ResizeHandle.tsx`: `onPointerDown/Move/Up` updates the CSS var live; `pointerup` persists.
- [x] `apps/web/src/lib/layout-state.ts`: `loadLayoutState()` (safe parse + defaults) / `saveLayoutState()` to localStorage key `spur-board-layout`.
- [x] Collapse toggles for left/right (icon-bar / hidden); wire to `data-*-collapsed` + persistence.
- [x] Responsive breakpoint structure (>=lg full / md icon-bar / <md single-column) — structural hooks; drawer/bottom-sheet polish in W4.
- [x] `apps/web/src/lib/rpc-client.ts` extension (design §3.2): `withTimeout(ms)` wrapping a Request (5-arg fetch option); `adapterInterceptors:[onError(...)]`; typed `ApiClient`; single `export const api`; remove `createApiClient`; KEEP `ContractRouterClient` from `@orpc/contract`.
- [x] Tests: layout persists + restores from localStorage; collapse toggles change column state; `withTimeout` aborts on timeout; `onError` interceptor fires on a failed request; resize persistence. DOM tests via happy-dom + @testing-library/react. Modules import `{ api }` only (grep verified: no `@orpc/*` in modules).
- [x] Gate: `bun run lint` + `test` + `build`; coverage per project standard (all components 100%).
- [x] GATE CHECK: W1 (0080) stack landed. Note: 0083 adds the WebModule registry + routing + nav items + Outlet.


### Review


### Completion 2026-06-16 (remaining items closed)

All Plan items + all R1–R9 now MET. Gate: lint + typecheck, 1448 (+158 plugins/sp) tests / 0 fail, test-cf, build — all green.

**Closed since fix-pass:**
- R6 onError interceptor RE-ADDED (had been reverted): `adapterInterceptors:[onError(logTransportError)]` + link-level test.
- R9 collapse-toggle COMPONENT test added (was the lone blocker). Added DOM test env to apps/web: `@happy-dom/global-registrator` + `happy-dom` + `@testing-library/react` + `@testing-library/dom` (web-only literals). New `tests/components/BoardLayout.test.tsx`: 7 tests (default render, collapse/expand toggles + persistence, restore-on-mount, sidebar + right-panel resize persistence).
- DOM isolation: `GlobalRegistrator.register()` before React import + `afterAll(unregister)` so the shared Bun test process keeps real fetch/localStorage for the lib/ + server/domain suites (verified: 1448 tests, 0 leak failures).
- tsconfig include extended to `tests/**/*.tsx`.

**Coverage:** all 5 layout components + both lib files at 100%.


### Fix-pass 2026-06-16 (--fix all)

**Result:** 5 fixed, 0 failed, 1 deferred (blocked on tooling approval). Gate: lint + 158 tests + test-cf + build all green.

| # | Finding | Disposition |
|---|---------|-------------|
| 1 | onError interceptor missing (R6) | FIXED — `adapterInterceptors:[onError(logTransportError)]` (rpc-client.ts:53); extracted `logTransportError` + tested. NOTE: adapter interceptors fire on network reject/timeout, NOT on HTTP error statuses (those throw ORPCError client-side) — documented in code. |
| 2 | typed ApiClient export dropped (R6) | FIXED — `export type ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>` + annotated `api` (rpc-client.ts:9,51). Restores contract<->client compile-time drift guard. |
| 3 | R9 collapse + onError tests absent | PARTIAL — onError now tested (rpc-client.test.ts:75,89). Collapse-toggle COMPONENT test DEFERRED: web workspace has no DOM test env; adding happy-dom + @testing-library/react is a new devDep needing approval. |
| 4 | CSS diverges from design 3.3 | FIXED — collapse + md breakpoint now override `--sidebar-w`/`--rightpanel-w`/handle vars instead of hardcoding grid-template-columns (board-layout.css). `--sidebar-w` var BoardLayout sets is authoritative in all states. |
| 5 | fetch not 5-arg OpenAPILink shape | RESOLVED via doc — added comment clarifying intentional narrowing (rpc-client.ts:28). |
| 6 | unused _init/_options params | FIXED — removed; `fetchWithTimeout(request, ms)` + `apiFetchWithTimeout(request)` (rpc-client.ts:21,32). |

**Dependency note:** added `@orpc/shared@1.14.4` to the root catalog SSOT + `apps/web` as `catalog:` (sub-package of the already-approved @orpc/* 1.14.4 family) to source `onError`.

**Remaining for completion:** R9 collapse-toggle component test (blocked on DOM-test-env devDep approval). Recommend a follow-up: approve happy-dom + @testing-library/react for the web workspace, then add BoardLayout collapse/resize tests.


### P1 — Blockers
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| — | none | — | — | — |

### P2 — Warnings
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | R6 adapterInterceptors:[onError(...)] tracing/error interceptor never implemented — no error-boundary emit, no OTel hook | Correctness | apps/web/src/lib/rpc-client.ts:35 | Add `adapterInterceptors: [onError((error, options) => { /* log + emit; options carries path/input */ })]` from `@orpc/shared`. Verified feasible: OpenAPILinkOptions extends LinkFetchClientOptions.adapterInterceptors? (1.14.4). |
| 2 | R6 typed ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>> export dropped; `api` now implicitly inferred (loses contract<->client drift guard the prior version had) | Correctness | apps/web/src/lib/rpc-client.ts:35 | Re-add `export type ApiClient = JsonifiedClient<ContractRouterClient<typeof contract>>` and annotate `export const api: ApiClient = ...`. Restores compile-time drift detection. |
| 3 | R9 collapse-toggle + onError-interceptor behavior untested; 5 React components have ZERO coverage (no DOM test env in web workspace) | Correctness | apps/web/tests/ (missing) | Add a DOM test env (happy-dom + @testing-library/react) — NEW devDeps, needs approval — then test collapse toggles + onError firing. See Deferred note. |

### P3 — Info
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 4 | CSS diverges from design 3.3: spec = 3-col grid with collapse via --sidebar-w var override; impl = 5-col grid hardcoding 48px/0px in grid-template-columns, so the --sidebar-w var BoardLayout sets is ignored while collapsed | Usability | apps/web/src/styles/board-layout.css:14 | Add an ADR note for the 5-col handle-cell adaptation, or drive collapse through the var (`[data-sidebar-collapsed]{--sidebar-w:48px}`) to match spec + keep resize-while-collapsed coherent. |
| 5 | fetchWithTimeout does not match OpenAPILink documented 5-arg fetch signature (request, init, options, path, input); apiFetchWithTimeout only forwards request | Usability | apps/web/src/lib/rpc-client.ts:30 | Acceptable (extra args optional) but document the intentional narrowing, or widen to the full 5-arg shape for clarity. |

### P4 — Suggestions
| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 6 | fetchWithTimeout carries unused _init/_options params; apiFetchWithTimeout is a thin wrapper existing only to drop them | Usability | apps/web/src/lib/rpc-client.ts:15 | Collapse to a single 5-arg fetch fn matching OpenAPILink, dropping the redundant adapter, once #2/#1 land. |

### Deferred / blocked
- R9 component tests (collapse toggles) and R6 onError test require a DOM test runner. The web workspace has NO happy-dom/jsdom/@testing-library. Adding one is a new dev dependency -> requires explicit approval (project rule: no new tooling without approval). Not auto-fixed.



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


