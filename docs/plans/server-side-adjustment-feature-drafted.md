---
doc: server-side-adjustment-feature-drafted
owns: WHAT — rough feature list for the server + web re-foundation (pending confirmation)
authority: draft v0.4 (incorporates SSE design from design doc v0.2; S6/W6 SSE features added to deferred list; D1 scoping documented)
version: 0.4.0
owner: Robin Min
updated_at: 2026-06-14
read_before: designing the server/web adjustment
edit_rules: 99 §6.4
---

# Server-Side Adjustment — Rough Feature List (Draft)

**Date:** 2026-06-14 · **Status:** Draft v0.4 (step 1 of 6 — all open questions resolved; board
launcher added; build toolchain confirmed; Cloudflare-default deployment confirmed; APIClient layer
dropped for web; SSE design folded in from design doc. **Config-source amended 2026-06-15:** serve
keys live in the existing `configSchema.server`, not a new `spurConfigSchema.server` block — see the
amendment note in the "Config source" section. Superseded for implementation by
`server-side-adjustment-feature-finalized.md` v1.0 + `server-side-adjustment-design.md` v0.2.)

**Purpose.** Fix the exact deliverable names and their core purpose for each enhancement area.
Design details (mechanism, schemas, module shapes) land in the design doc (step 2); this document
fixes **names** and **what each thing is for**. After confirmation (step 3), the finalized feature
list narrows scope and feeds task decomposition (step 4).

**Operator decisions applied (2026-06-14):** Q1–Q6 resolved (see "Resolved decisions" appendix);
board launcher added to scope as `spur serve` (was X03 in rd3-migration-delivery.md §6); build
toolchain recommendation added (Vite shared, two deployment modes). One build-toolchain question
remains (B1).

**Two enhancement areas:**

| Area | Doc suffix | Summary |
|---|---|---|
| A — Server (Hono API) | `server-` | Make `apps/server` a reliable, robust, reusable, flexible base API server aligned with `apps/cli`'s transport-wrapper role; wire `packages/app` services behind oRPC contracts; leverage ts-libs infrastructure. |
| B — Web (Astro SPA) | `web-` | Re-found `apps/web` on Astro + React + Tailwind + daisyUI with a 3-column layout and a module/plugin mechanism; implement Task Kanban as the first module. |

**Naming conventions (derived from existing patterns):**

- **Server modules:** `<Domain>Module` in `apps/server/src/modules/<domain>/` (mirrors CLI
  `register<Noun>Command`). Each module registers its oRPC router sub-tree + middleware.
- **Contracts:** `<noun>Contract` in `packages/contracts/src/<noun>.ts` (oRPC transport DTOs only;
  ADR-005, domain types never leak).
- **DTOs:** `<Noun>Dto` / `<Noun>ListDto` (transport shapes inferred from Zod schemas in contracts).
- **Web modules:** `<Module>Module` in `apps/web/src/modules/<module>/` — a self-contained view +
  its React components, API client calls, and module manifest entry.

---

## Part A — Server: Hono Base API Server

### Current state

`apps/server` is a health-check stub: one oRPC procedure (`health`), Hono with `secureHeaders()`
only, no middleware pipeline, no service wiring, no graceful shutdown, no module system. It declares
`@gobing-ai/ts-db` but has zero ts-db imports (dead dependency). The bootstrap is already aligned
(ADR-019: `runNodeApplication` for Bun, `runApplication` for Workers), but the server does nothing
with the runtime services except thread them into the Hono context.

### A1. Server foundation: middleware pipeline & request lifecycle

| Feature ID | Feature | What it's for |
|---|---|---|
| S1 | `server-middleware-cors` | CORS middleware (hono/cors) — configurable origins via env, default same-origin for production. |
| S1 | `server-middleware-request-id` | Per-request UUID (hono/request-id or custom) — threaded into logs, error responses, and oRPC context. |
| S1 | `server-middleware-logger` | Structured request/response logging via ts-infra `Logger` — method, path, status, duration, request-id. |
| S1 | `server-middleware-error-handler` | Global error handler: catches unhandled errors, maps to ts-utils `api-response` error envelope, never leaks stack traces in production. |
| S1 | `server-middleware-body-limit` | Request body size limit (configurable) — defense before oRPC handler parses. |
| S1 | `server-middleware-compress` | Response compression (hono/compress) — gzip/deflate for JSON payloads. |

**Purpose:** establish the cross-cutting request lifecycle every API module inherits — no module
should need to duplicate CORS/logging/error handling.

### A2. Server foundation: graceful shutdown & health

| Feature ID | Feature | What it's for |
|---|---|---|
| S1 | `server-graceful-shutdown` | Wire `Bun.serve` shutdown into the ts-infra `ApplicationRuntime.stop()` — drain in-flight requests, close DB adapter, flush logs, set a deadline timeout. Currently `index.ts` starts `Bun.serve` but never stores the server handle for shutdown. |
| S1 | `server-health-enhanced` | Expand `health` contract: add DB connectivity check (`SELECT 1`), uptime, memory usage, active plugin count. Split into `health` (liveness) and `health/ready` (readiness — checks DB + critical services). |

**Purpose:** make the server production-safe: SIGTERM drains connections, health checks distinguish
"alive" from "ready to serve".

### A3. Server foundation: service wiring via ApplicationRuntime

| Feature ID | Feature | What it's for |
|---|---|---|
| S1 | `server-service-context` | Extend the Hono context (`ContextVariableMap`) to carry lazily-initialized `packages/app` services (TaskService, FeatureService, WorkflowAppService, RuleService, etc.), built from the `ApplicationRuntime`'s `db`, `events`, `logger`. Mirrors `apps/cli/src/context.ts` `CliContext` — the server gets a `ServerContext` that oRPC handlers access via `c.get('ctx')`. |
| S1 | `server-db-wiring` | Wire the SQLite `DbAdapter` into the `ApplicationRuntime.services.db` so server handlers get the migrated DB — same pattern as CLI's `createMigratedDb`. Remove the dead `@gobing-ai/ts-db` declaration or make it real. |
| S1 | `server-filesystem-wiring` | Wire `ts-runtime` `FileSystem` (cwd-bound) into the server context — planning-layer services need it for markdown file I/O. |

**Purpose:** close the gap between "bootstrap gives us a runtime" and "handlers can call
packages/app services". Without this, no domain module can function.

### A4. Server foundation: infrastructure wiring (EventBus, JobQueue, Scheduler)

| Feature ID | Feature | What it's for |
|---|---|---|
| S1 | `server-eventbus-wiring` | Wire `ts-infra` `EventBus` into the server context — expose the typed bus to handlers and oRPC procedures. This is the pub/sub seam for SSE (future), PlanningEventMap events, and server-side event-driven workflows. |
| S1 | `server-jobqueue-wiring` | Wire `ts-db` `QueueJobDao` + `ts-infra` `DBJobQueue`/`DBQueueConsumer` into the server — for async work (history import jobs, rule runs, workflow executions triggered via API). Node/Bun entry starts the consumer; Workers entry enqueues only (no long-lived consumer in a stateless Worker). |
| S1 | `server-scheduler-wiring` | Wire `ts-infra` scheduler (Node adapter for Bun, Cloudflare adapter for Workers) — for periodic tasks (health pings, stale lock cleanup, scheduled analytics). Configurable via `bootstrap.scheduler` config. |

**Purpose:** make the system-level infrastructure (EventBus/JobQueue/Scheduler) available to server
modules, not just bootstrapped and ignored. Each is opt-in via config; the server ships with
sensible defaults.

### A5. Server module system: standard for adding new API domains

| Feature ID | Feature | What it's for |
|---|---|---|
| S2 | `server-module-interface` | Define a `ServerModule` interface: `{ name, register(app, ctx), middleware?, contract? }`. Each domain module (task, feature, workflow, etc.) implements this. The server's `createApp` iterates registered modules to mount routes + middleware. Mirrors how `apps/cli` registers `register<Noun>Command(program, context)` functions. |
| S2 | `server-module-registry` | A registry/factory that collects built-in modules and (future) plugin-contributed modules. Built-in modules are fail-fast (a broken built-in aborts startup). This is the extension point for the "standard to add new module" requirement. |
| S2 | `server-openapi-per-module` | Each module contributes its oRPC contract sub-tree; `generateOpenApiSpec` merges them. The OpenAPI document reflects all mounted modules automatically (no manual path maintenance). |

**Purpose:** establish the contract for adding a new API domain. Every future module (task API,
feature API, workflow API, agent API, history API) follows the same pattern. Existing `health` is
migrated to this pattern as the reference module.

### A6. Server domain modules: connect packages/app behind oRPC contracts

Each module wraps a `packages/app` service behind an oRPC contract (defined in
`packages/contracts`). Contracts are transport DTOs only (ADR-005); domain types stay in
`packages/domain`. This is where the server gains real content.

| Feature ID | Module | Service | What it's for |
|---|---|---|---|
| S2 | `server-module-health` (reference) | — | The migrated reference module; proves the module system works. |
| S3 | `server-module-task` | `TaskService` | Task CRUD, list, check, batch-create, resolve — read + write verbs over the planning write path. Write verbs go through `PlanningWriteService` (one lock domain, ADR-021). |
| S3 | `server-module-feature` | `FeatureService` | Feature CRUD, list, check, refresh — same write path contract. |
| S3 (later) | `server-module-workflow` | `WorkflowAppService` | Workflow validate, run, list, trace — wraps the dual-workflow engine. |
| S3 (later) | `server-module-rule` | `RuleService` | Rule run, validate, list, trace — wraps the rule engine. |
| S3 (later) | `server-module-agent` | `AgentService` | Agent run, list, doctor — wraps the AI runner. |
| S3 (later) | `server-module-history` | `HistoryService` | History import, analyze — wraps the JSONL importer. |
| S3 (later) | `server-module-team` | `TeamService` | Message send/inbox/reply, team assign/status — wraps team service. |

**Purpose:** give the server real surface. The task/feature modules are the critical path for the
web board (Part B). Others follow the same pattern and can ship incrementally.

### A7. Server contracts expansion (packages/contracts)

| Feature ID | Feature | What it's for |
|---|---|---|
| S4 | `contracts-task` | `taskContract` — oRPC route definitions for task verbs with Zod input/output schemas. DTOs: `TaskDto`, `TaskListDto`, `TaskCheckResultDto`. Domain types from `packages/domain`, never re-declared. |
| S4 | `contracts-feature` | `featureContract` — same pattern for features. DTOs: `FeatureDto`, `FeatureListDto`, `FeatureCheckResultDto`. |
| S4 | `contracts-planning-event` | `planningEventContract` — SSE event contract for PlanningEventMap events. **Contract + frame DTO ship with S4** (design doc §2.9.2); the server-side SSE handler (S6) and client subscription hook (W6) are deferred. Ships now so the polling hook is authored against eventual SSE types. |
| S4 | `contracts-shared` | Shared pagination/cursor types (from `ts-utils` cursor), shared error response shape (ts-utils api-response envelope). |

**Purpose:** the type seam (ADR-005). Server handlers bind via `implement(contract)`; web client
consumes via `OpenAPILink`. Contract↔handler drift is a compile error. This unblocks the web board.

### A8. Server validation & output rendering standard

| Feature ID | Feature | What it's for |
|---|---|---|
| S4 | `server-output-envelope` | Standardize all JSON responses on `ts-utils` `api-response` envelope (`{ ok, data?, error? }`) — same shape as CLI `--json` output (design §10). oRPC error handler maps thrown errors to this envelope. |
| S4 | `server-input-validation` | Input validation is Zod schemas in oRPC contracts (`.input(schema)`) — the same Zod SSOT from `packages/domain`. No parallel validation layer in the server. |
| S4 | `server-error-mapping` | Map domain errors (PlanningWriteService lock failures, lifecycle guard denials, validation findings) to HTTP status codes + error envelopes. Guard denial = 409 Conflict; validation failure = 422; not found = 404; lock timeout = 503. |

**Purpose:** one output shape, one validation path, one error mapping — no per-module ad-hoc
rendering. Machine consumers parse the envelope; humans get meaningful status codes.

---

## Part B — Web: Astro SPA Board

### Current state

`apps/web` is a single `index.astro` page rendering health status via SSR (Astro `output: 'server'`
+ `@astrojs/cloudflare`). No React, no Tailwind, no daisyUI, no layout system, no client-side
routing, no module/plugin mechanism. The typed oRPC client exists (`src/lib/rpc-client.ts`) but is
used only for the health check.

### B1. Web stack migration

| Feature ID | Feature | What it's for |
|---|---|---|
| W1 | `web-stack-react` | Add `@astrojs/react` integration; configure React 19. Client-side islands for interactive views (Kanban, forms), Astro components for static layout. |
| W1 | `web-stack-tailwind` | Add Tailwind CSS v4 (latest stable) with `@tailwindcss/vite` plugin — the Astro-recommended integration path, no `tailwind.config.js` needed (CSS-first config via `@theme`). |
| W1 | `web-stack-daisyui` | Add daisyUI v5 (Tailwind v4 compatible) as a Tailwind plugin — component library for buttons, cards, modals, badges, tabs. Provides the design system without hand-writing components. |
| W1/W5 | `web-ssr-static` | Switch Astro output from `'server'` to `'static'` — the board is a client-side SPA that talks to the server API; no SSR needed for views. Deploy to Cloudflare Pages (static), Workers Static Assets, or any static host. (Research-validated: Astro 6 `client:only="react"` islands over a static shell.) |

**Purpose:** modern, maintainable UI stack. React for interactivity, Tailwind for styling, daisyUI
for component primitives. Static output = cheap deployment, fast first paint, no server compute for
views.

### B2. Web layout: 3-column resizable board

| Feature ID | Feature | What it's for |
|---|---|---|
| W2 | `web-layout-shell` | The root layout: 3-column grid (left sidebar, main workspace, right panel). Left and right columns are resizable (drag handle) and foldable (collapse to icon bar / hidden). Persists sizes/collapse state to localStorage. |
| W2 | `web-layout-left-sidebar` | Left column: module navigation. When expanded, shows module names + icons as a vertical list; when collapsed, shows icons only (vertical icon bar). Active module highlighted. This is the module/plugin hub entry point. |
| W2 | `web-layout-right-panel` | Right column: context panel for the active module (e.g. task details, filters, activity feed). Foldable. Default collapsed on mobile. |
| W2 | `web-layout-main-workspace` | Center column: renders the active module's main view. The largest, always-visible column. |

**Purpose:** the classic board/IDE layout that serves as the module hub. Every module renders into
the main workspace; left sidebar switches modules; right panel shows context. Resizable + foldable
= flexible for different screen sizes and workflows.

### B3. Web module/plugin mechanism

| Feature ID | Feature | What it's for |
|---|---|---|
| W2 | `web-module-interface` | Define a `WebModule` interface: `{ id, name, icon, component, sidebarLabel?, rightPanelComponent? }`. Each module is a self-contained React view + optional sidebar/right-panel contributions. Registered in a central module registry. |
| W2 | `web-module-registry` | Central registry of available modules. Built-in modules registered at startup. Active module state managed via URL routing (`/board/<module-id>`) + client-side state. The registry is the extension point — adding a module = one registration entry + the module directory. |
| W2 | `web-module-routing` | Client-side routing for module activation via **React Router 7** (confirmed Q4). Each module owns a route segment (`/board/tasks`, `/board/features`, etc.). URL is shareable and bookmarkable. |
| W2 | `web-api-client-layer` | Extend `src/lib/rpc-client.ts` with a `withTimeout(ms)` fetch wrapper + an oRPC tracing/error interceptor (revised Q3: no `APIClient`, no facade). Remains the single `{ api }` import for all modules. `OpenAPILink` is the sole transport. |

**Purpose:** the standard for adding new UI modules. The first module (Task Kanban) proves the
mechanism; future modules (Feature tree, Workflow runs, Agent monitor, History analytics) follow
the same pattern without layout changes.

### B4. Web module: Task Kanban (first module, proves the design)

| Feature ID | Feature | What it's for |
|---|---|---|
| W3 | `web-module-task-kanban` | The Task Kanban view: columns by status (`backlog · todo · wip · testing · blocked · done · cancelled`), cards by task (WBS + name + priority badge). Drag-and-drop between columns triggers `spur task update <wbs> <status>` via the server API. This is the board that replaces the legacy `kanban.md` generated artifact with a live, interactive board. |
| W3 | `web-module-task-card` | Task card component: WBS, name, status badge, priority badge, feature link, assignee. Click opens task detail in right panel. Compact card design (daisyUI card variant). |
| W3 | `web-module-task-detail` | Right-panel task detail: full frontmatter, status transition buttons, section viewer (markdown render). Read-only initially; inline editing is a follow-up. |
| W3 | `web-module-task-filters` | Left-sidebar or top-bar filters: by status, feature, parent WBS, assignee. Filter state in URL query params. |
| W3 | `web-module-task-realtime` | Live updates: poll the task list endpoint on an interval (via `APIClient`) so multiple clients see changes. SSE deferred; board state stays in sync via polling until the planning event stream ships. |

**Purpose:** prove the module system works end-to-end with a real, useful view. The Kanban board is
the daily-driver replacement the rd3-migration design deferred (A17 cutover waits for the board).

### B5. Web design system & theming

| Feature ID | Feature | What it's for |
|---|---|---|
| W4 | `web-design-tokens` | Design tokens via Tailwind `@theme`: color palette (light/dark via daisyUI themes), spacing scale, typography scale. daisyUI provides the component-level design system; tokens customize it for Spur's identity. |
| W4 | `web-dark-mode` | Dark mode toggle (daisyUI theme switching). Persists to localStorage. Respects `prefers-color-scheme` on first load. |
| W4 | `web-responsive` | Responsive breakpoints: full 3-column on desktop (≥lg), collapsible to 1-column + drawer on mobile. Left sidebar becomes a slide-in drawer; right panel becomes a bottom sheet. |

**Purpose:** a board that looks good, supports dark mode (developer preference), and works on
mobile (quick status checks). daisyUI themes avoid hand-designing a component library.

---

## Scope boundaries

### In scope

- Server: middleware pipeline, graceful shutdown, service/infra wiring, module system, health +
  task + feature modules, contracts for task/feature/planning-events.
- Web: stack migration (React + Tailwind + daisyUI), 3-column layout, module system, Task Kanban
  module, theming.
- Both: the standard (module interface) that future modules follow.

### Out of scope (this round — reserved for future tasks)

- **Workspace concept** (git repo + working dir + agent team + inbox as a unit) — shared as context
  for foundation design, but not implemented. The layout and module system must be flexible enough
  to add Workspace as a top-level container without re-foundation.
- **SSE / WebSocket live event stream** — **designed now (design doc §2.9), implementation
  deferred** to wave S6/W6. The `planningEventContract` ships with S4 (contract only); the
  server handler (S6) and client hook (W6) are deferred, gated on module-system stability and D1
  landing for the Cloudflare path. The Kanban module uses polling initially; the polling → SSE
  swap is a localized handler change. Decision: **SSE over WebSocket** (one-way push over HTTP).
- **Server domain modules beyond task/feature** (workflow, rule, agent, history, team) — they follow
  the same module pattern; ship incrementally after task/feature prove the pattern.
- **Web modules beyond Task Kanban** (Feature tree, Workflow runs, Agent monitor, History analytics)
  — same module pattern; ship incrementally.
- **Authentication / authorization** — out of scope for this round. The default Cloudflare
  deployment is single-operator (operator's own Worker); auth is a future concern if the Worker is
  ever shared beyond the operator. Configured via `wrangler` access, not application-layer auth.
- **Board launcher** — **added back into scope** (see "Board launcher" section above). Was reserved
  as X03 in rd3-migration-delivery.md §6; now resolved as `spur serve` (hybrid mode).

### Deferred / held (may resurface in finalized list)

- **Web inline editing** (edit task sections directly in the browser) — read-only first; editing is
  a natural follow-up once the board proves useful.
- **Server rate limiting** — only needed if the Worker is exposed to untrusted clients; the
  single-operator default makes this low priority. Cloudflare's built-in WAF/rate-limiting covers
  the edge if ever needed.
- **Server API versioning** (`/api/v1/`) — no consumers yet; add when breaking changes are
  anticipated.

---

> **Build toolchain question B1 is resolved** — see "Open question for operator (build toolchain) —
> RESOLVED" under the Build & packaging toolchain section below. The unified Vite dev server is
> confirmed.

---

*Companion documents (to be created):*
- `docs/design/server-side-adjustment-design.md` — mechanism, module interface shapes, middleware
  order, context wiring, layout component tree, module manifest format (step 2).
- `docs/design/server-side-adjustment-feature-finalized.md` — confirmed feature list after this
  draft is reviewed (step 3).

---

## Resolved decisions (operator confirmation 2026-06-14)

### Q1 — Module naming: align with existing conventions

**Decision: align with existing `docs/features` encoding.**

Detected feature encoding (`docs/features/*.md`):
- YAML frontmatter: `schema_version: 1`, `id`, `name`, `status`, `priority`, `tags`, `created_at`, `updated_at`.
- `id` is a **single letter** for groups (A, B, C, D, E, F, G, H) or **letter+number** for children (F1, F2, B1, H1, H3).
- Existing groups: A=Foundation, B=Agent execution, C=Rules, D=Workflows, E=History, F=Planning, G=Collaboration, H=Agent integration.
- Body: `# <id>: <name>`, `## Goal`, `## Scope`, `## Acceptance Criteria` (Gherkin or checklist), `## Tasks` (auto-generated WBS table), `## Notes`, `## History`.
- `tags`: `[rd3-migration, wave-N]` for the rd3 batch; `[group]` for top-level group nodes.

**New groups for this work (proposed):**

| ID | Name | Scope | Priority | Tags |
|---|---|---|---|---|
| **S** | Server API | `apps/server` Hono API foundation, middleware, modules, service/infra wiring | P1 | `[server-side-adjustment, wave-S0/S1]` |
| **W** | Web board | `apps/web` Astro SPA, layout, module system, Task Kanban | P1 | `[server-side-adjustment, wave-W0/W1]` |

S and W are the next free single-letter IDs after the existing A–H range. They are independent of the
rd3-migration feature tree (F-series) — separate top-level groups, merged into `docs/features/` when
finalized. **Children:** S1, S2, … (server); W1, W2, … (web).

**Feature ID mapping (maps the draft's feature groups to S/W children):**

| Draft group | Feature ID | Name |
|---|---|---|
| A1–A4 (server foundation) | **S1** | Server foundation: middleware, shutdown, service/infra wiring |
| A5 (module system) | **S2** | Server module system |
| A6 (domain modules) | **S3** | Server domain modules (task + feature critical path) |
| A7–A8 (contracts + output) | **S4** | Server contracts and output standard |
| B1 (stack migration) | **W1** | Web stack migration (React + Tailwind + daisyUI) |
| B2–B3 (layout + module mechanism) | **W2** | Web layout and module system |
| B4 (Task Kanban) | **W3** | Task Kanban module |
| B5 (design system) | **W4** | Web design system and theming |

The `feature ID` column in the tables below uses these S/W IDs. When finalized, each becomes a
`docs/features/<id>_<slug>.md` file.

### Q2 — Web output mode: static SPA (confirmed)

**Decision: static SPA.** `output: 'static'`, all views client-rendered via React islands. Deploy to
Cloudflare Pages (static assets) or any static host. No SSR compute for views. Confirmed by
operator; research validates the approach (Astro 6 `client:only="react"` islands over a static shell).

### Q3 — Data fetching: drop `APIClient`, extend the oRPC client (revised 2026-06-14)

**Decision: do NOT add `ts-infra` `APIClient` to the web tier. Use the existing oRPC
`OpenAPILink` client as the sole transport, extended with two small wrappers for the
cross-cutting concerns `APIClient` would have provided.**

**Why not stack `APIClient` under oRPC:** `APIClient` and `OpenAPILink` solve the same problem
(typed fetch + URL building + response parsing) at the same layer. Stacking them means either
double-fetch (two transports chained) or passing `APIClient.fetchFn` into `OpenAPILink`'s `fetch`
slot — which demotes `APIClient` to a `fetch` wrapper and dead-codes its URL/header/path logic.
Neither is honest. One transport.

The three concerns `APIClient` carries each have a cleaner home in the oRPC stack:

| Concern | Clean home (replaces `APIClient` feature) |
|---|---|
| OTel client spans + metrics | oRPC interceptor on the `OpenAPILink` chain (one `onRequest`/`onResponse` pair) |
| Timeout / abort | A `withTimeout(ms)` fetch wrapper passed as `OpenAPILink`'s `fetch` option (~15 lines) |
| Error event bus | An `onError` hook in the same interceptor, or emit from the React error boundary |

**Layering (revised — names fixed here):**

```
packages/contracts  →  oRPC typed client (types + route shapes)           [existing, stays]
OpenAPILink         →  sole transport: URL, headers, fetch, response      [existing, stays]
lib/rpc-client.ts   →  wire timeout fetch + tracing interceptor into the link; one export  [extended]
```

`apps/web/src/lib/rpc-client.ts` stays the single import point (`export const api`). It gains a
`withTimeout` fetch wrapper and a tracing/error interceptor; no new facade, no `spur-web-api`
indirection. Modules import `{ api }` from `lib/rpc-client`, never `@orpc/*` directly. This is the
"centralize all requests into one place" the operator asked for — achieved with less code.

`APIClient` stays in `ts-infra` for any non-oRPC consumer (CLI calling a remote server with raw
REST); the web board does not touch it.

TanStack Query is **not** added — caching/polling is handled at the module level with React hooks
(lightweight, no extra dep). Revisit if polling volume makes a cache layer worthwhile.

**Impact on W2:** feature `W2 web-api-client-layer` simplifies from "thin facade over APIClient" to
"extend the existing rpc-client with timeout + tracing interceptor." Less surface, fewer deps.

### Q4 — Routing: React Router (confirmed)

**Decision: React Router 7** for client-side routing. The module system's dynamic route register into
a `createBrowserRouter`; each module owns a route segment (`/board/tasks`, `/board/features`). Astro
provides the static shell; React Router handles navigation inside the `client:only="react"` island.

### Q5 — Server module priority: task + feature first (confirmed)

**Decision: task + feature are the critical path** (board dependency). Others (workflow, rule, agent,
history, team) follow the same module pattern and ship incrementally after task/feature prove it.

### Q6 — Contracts: per-module vertical slice (confirmed)

**Decision: per-module.** Each server module ships with its contract + handler + web integration as
one vertical slice. No "all contracts first" batch.

---

## New scope: Board launcher (`spur serve`)

**Status: added back into scope (operator request 2026-06-14). Was reserved as X03 in
rd3-migration-delivery.md §6.**

The rd3-migration delivery explicitly deferred the board launcher name (`spur serve` vs. running
`apps/server` directly) to "that design task's decision" — this is that task. Adding it to scope.

### Recommendation: `spur serve` (unified launcher)

**Recommend `spur serve`** — a CLI verb that launches the server + opens the board in one command.
Pros/cons analysis:

| Option | Pros | Cons |
|---|---|---|
| **`spur serve` (recommended)** | One command for the operator; resolves port, DB path, config from the same `.spur/config.yaml` the CLI uses; can auto-open browser; graceful shutdown via SIGINT handled by the CLI's existing `runNodeApplication` lifecycle; consistent with `spur init`/`spur status`/`spur migrate` UX (one binary, all verbs); the server becomes a library call from the CLI, not a separate process to manage. | Adds a `serve` command to the CLI surface (new verb); CLI must depend on the server package (`apps/server` → CLI dep, or extract server entry to a shared location); slightly more coupling between CLI and server. |
| **Run `apps/server` directly** (`bun run apps/server/src/index.ts`) | Zero new CLI surface; server is fully independent; simpler for development (hot reload via `bun --hot`). | Operator must remember a second command + port; config resolution is duplicated (server reads env, CLI reads `.spur/config.yaml`); no browser auto-open; two processes to manage for graceful shutdown; breaks the "one binary" UX. |
| **Hybrid** (`spur serve` wraps `apps/server`) | Best of both: CLI verb for operators, direct entry for development. Recommended path — `spur serve` calls `createApp()` from `apps/server` and runs `Bun.serve` with CLI-resolved config; `apps/server/src/index.ts` remains as the standalone entry for dev/Docker. | Slight added complexity in maintaining two entry points; must keep them in sync (shared `createApp` makes this safe). |

**Decision (recommended): hybrid.** `spur serve` is the operator-facing verb; `apps/server/src/index.ts`
remains the standalone entry for development and containerized deployment. Both call the same
`createApp(appRt)` from `apps/server/src/bootstrap.ts`. This is the same pattern as `apps/cli` where
`index.ts` is the entry but `main(argv, options)` is the testable/library surface.

### Feature: `spur serve`

| Feature ID | Feature | What it's for |
|---|---|---|
| **S0** | `spur serve` — unified board launcher | CLI verb that resolves config (port, DB path, `.spur/config.yaml`), builds the `ApplicationRuntime`, calls `createApp(appRt)`, starts `Bun.serve`, optionally opens the browser to the board URL, and handles SIGINT for graceful shutdown via the existing `runNodeApplication` lifecycle. The operator's one command to go from terminal to board. |

**Surface addition (04_DESIGN.md sync, same commit when built):**

```
spur serve [--port <n>] [--no-open] [--cwd <path>] [--json]
```

- `--port` overrides `config.server.port` (default 3000).
- `--no-open` skips browser auto-open (default: open).
- `--cwd` overrides working directory (same as other CLI verbs).
- `--json` emits machine-readable startup info (port, URL, pid) for scripting.


### Config source: extend the existing `configSchema.server` (amended 2026-06-15)

> **AMENDMENT (2026-06-15, supersedes the original decision below).** Review found that
> `packages/config` already defines **two** schemas: `spurConfigSchema` (the `.spur/config.yaml`
> project schema — `{ tasks?, features? }`) **and** `configSchema` (the env-config schema, parsed
> by `buildConfigFromEnv`, which already has a `server: { port }` block and is what the current
> `apps/server/src/index.ts` actually reads). Adding a *second* `server:` block to `spurConfigSchema`
> would collide with the existing `configSchema.server` — two `server.port`, no precedence story.
> **Resolution: extend the existing `configSchema.server`** with `host` / `openBrowser` /
> `webDistPath`; leave `spurConfigSchema` untouched. Env (`PORT`/`HOST`) is folded by
> `buildConfigFromEnv`; CLI flags override. See design §4.2 for the final shape. The text below is
> retained for the original rationale (one config home) but the *target schema* is corrected.

**Original decision (rationale retained, target schema superseded above): add a `server:` block to
the existing `.spur/config.yaml`.** One config home — no second file, no parallel load path
(constitution §4.3: one fact, one home). The amendment keeps that principle; it only corrects
*which* schema in `packages/config` carries the keys.

The existing `bootstrap:` block already shares logging/telemetry/database across CLI and server;
a `server:` block for serve-specific keys follows the same pattern.

**Schema addition (zod, in `packages/config`) — extends the EXISTING `configSchema.server`:**

```yaml
# configSchema.server (env-config schema) — host/openBrowser/webDistPath are the new keys
server:
  port: 3000          # PORT env overrides (already wired)
  host: localhost     # HOST env; 0.0.0.0 for LAN access; default localhost (loopback only)
  openBrowser: true   # open board on start (spur serve only)
  webDistPath: null   # null = bundled web build; path = custom build location
```

**Precedence (highest wins):** CLI flag (`--port`/`--host`) → env (`PORT`/`HOST`, folded by
`buildConfigFromEnv`) → schema default (3000 / localhost). CLI flags are resolved in the command
handler and override the parsed `Config` object before `createApp` is called. (No `.spur/config.yaml`
file layer for serve keys in this round — see the amendment note above.)

**Why not a second config surface:** a separate serve config (file or schema) would duplicate the
sharing pattern, introduce a second load path, and raise "which wins?" on every key overlap. Keeping
the serve keys in the one `configSchema.server` (per the 2026-06-15 amendment) keeps all server
operational config in one place.
This becomes **feature S0** in the `docs/features/S_server-api.md` group — the first server feature,
sequenced before S1 (foundation) because the launcher depends on the foundation being wired.

---

## New scope: Build & packaging toolchain

**Status: added by operator request 2026-06-14. Decision needed before design phase.**

### Current state

| App | Build tool | Dev server | Output |
|---|---|---|---|
| `apps/cli` | `bun build --compile` | `bun --hot run` | Single binary (`dist/cli/spur`) |
| `apps/server` | `bun build --compile` | `bun --hot run` | Single binary (`dist/server/spur-server`) |
| `apps/web` | `astro build` (Vite under the hood) | `astro dev` (Vite dev server) | Static files (`dist/web/`) |

The server and web currently have **separate dev servers** with a Vite proxy in `astro.config.mjs`
(proxying `/api` and `/openapi.json` to `localhost:3000`). This works but has friction: two processes
to start, proxy config drift, CORS in dev.

### Web research findings (2026-06-14)

**Sources consulted:** daisyUI docs ([daisyui.com/docs/install/astro](https://daisyui.com/docs/install/astro)),
Tailwind CSS Astro guide ([tailwindcss.com/docs/installation/framework-guides/astro](https://tailwindcss.com/docs/installation/framework-guides/astro)),
`@hono/vite-build` ([npm](https://www.npmjs.com/package/@hono/vite-build)),
`@hono/vite-dev-server` ([npm](https://www.npmjs.com/package/%40hono%2Fvite-dev-server)),
Cloudflare Workers Static Assets ([developers.cloudflare.com/workers/static-assets](https://developers.cloudflare.com/workers/static-assets)),
Cloudflare Pages + Hono ([hono.dev/docs/getting-started/cloudflare-pages](https://hono.dev/docs/getting-started/cloudflare-pages)),
"Building a SPA + API Architecture with Cloudflare Stack in 2026" ([zenn.dev/kimuson/articles/clouflare_spa_api_2026](https://zenn.dev/kimuson/articles/clouflare_spa_api_2026?locale=en)).

**Key findings:**

1. **daisyUI 5 + Tailwind CSS 4 + Astro:** fully compatible. daisyUI 5 is zero-dependency, installs
   as a Tailwind plugin via `@tailwindcss/vite`. CSS-first config via `@theme` — no `tailwind.config.js`
   needed for Tailwind v4. This is the current recommended path (Astro docs + daisyUI docs align).

2. **`@hono/vite-build` + `@hono/vite-dev-server`:** Cloudflare-official Vite plugins for Hono. They
   let a single Vite dev server serve both the Hono API and the frontend. `@hono/vite-dev-server`
   intercepts API requests and routes them to the Hono app in dev; `@hono/vite-build` bundles for
   Cloudflare Workers/Pages/Bun/Deno. This is the "single dev server for API + frontend" option.

3. **Cloudflare Workers Static Assets (2024+):** Workers can now serve static assets directly
   (formerly Pages-only). A single Worker can serve the SPA static files + handle API routes, with
   `not_found_handling = "single-page-application"` for SPA fallback. This enables a **single
   deployment unit** (Worker + assets) instead of separate Pages + Workers projects.

4. **Astro 6 `output: 'static'` + `client:only="react"`:** the static SPA approach is validated.
   Astro generates a static HTML shell; React islands hydrate client-side. No SSR compute.

5. **React Router 7 in Astro:** works via `client:only="react"` island with `createBrowserRouter`.
   The React island owns routing; Astro provides the shell. This is the confirmed approach (Q4).

### Recommendation: Vite as the shared build tool, Cloudflare-default with local fallback

**Decision (confirmed operator 2026-06-14):**

**A. Dev server — unified via `@hono/vite-dev-server` (single process).**

Replace the current "two processes + proxy" dev setup with a single Vite dev server that serves both
the Hono API and the Astro frontend. The Hono app (`apps/server/src/bootstrap.ts`'s `createApp`)
mounts into Vite via `@hono/vite-dev-server`; Astro's Vite config integrates the frontend. One
`bun run dev` command, one port, no proxy, no CORS-in-dev. **(B1 confirmed.)**

**B. Production — two deployment modes; Cloudflare Workers is the default.**

| Mode | Target | How | Use case |
|---|---|---|---|
| **Cloudflare Workers (default)** | Worker + static assets | `@hono/vite-build/cloudflare-workers` bundles the server; Astro builds the web to static files; Workers Static Assets serves both. **One Worker deployment.** `apps/server/src/worker.ts` is the primary entry; `wrangler deploy` ships it. | The default deployment target. Remote/multi-device access, Cloudflare hosting, zero-server ops. |
| **Local Bun binary (fallback)** | Bun binary via `spur serve` | `bun build --compile` for the server; web built by `astro build` (Vite) and served as static assets by the Hono server's `serveStatic` middleware. **One binary, one process.** `apps/server/src/index.ts` is this entry. | Local laptop, air-gapped environments, self-hosted servers, or development without Cloudflare. |

**C. Toolchain summary.**

| Concern | Tool | Rationale |
|---|---|---|
| Frontend build | **Vite** (via Astro) | Already in use; Astro is a Vite-based meta-framework. Handles React, Tailwind v4, daisyUI. |
| Server dev | **Vite** (via `@hono/vite-dev-server`) | Unified dev server; no proxy; Cloudflare-official. |
| Server build (Cloudflare, default) | **`@hono/vite-build/cloudflare-workers`** | Cloudflare-official; bundles for Workers runtime. Primary production target. |
| Server build (local fallback) | **`bun build --compile`** (existing) | Single binary for `spur serve`; no Node runtime needed. Fallback for local/self-hosted. |
| Web build | **`astro build`** (Vite) | Already in use; outputs static files. |
| Static asset serving (Cloudflare, default) | **Workers Static Assets** | Native Cloudflare; SPA fallback via `not_found_handling`. |
| Static asset serving (local fallback) | **Hono `serveStatic`** | The server serves the built web assets in local-binary mode. One port, one process. |
| Package manager | **Bun** (existing) | No change. |
| Monorepo | **Bun workspaces** (existing) | No change; Vite resolves workspace packages natively. |

**D. New feature for this scope:**

| Feature ID | Feature | What it's for |
|---|---|---|
| **S5** | Server static asset serving — serve the built web board from the Hono server in local-first mode via `serveStatic` middleware. In Cloudflare mode, Workers Static Assets handles this. One port for API + board. |
| **W5** | Web build integration — Astro `output: 'static'` build, Vite config aligned with the server dev server, daisyUI/Tailwind v4 setup via `@tailwindcss/vite`. |

**E. Dependency additions (catalog entries when built):**

| Package | Workspace(s) | Purpose |
|---|---|---|
| `@tailwindcss/vite` | web | Tailwind v4 Vite plugin (CSS-first config) |
| `tailwindcss@4` | web | Tailwind core (v4) |
| `daisyui@5` | web | Component library (Tailwind plugin) |
| `@astrojs/react` | web | React integration for Astro |
| `react` / `react-dom` | web | React 19 |
| `react-router` | web | React Router 7 (SPA routing) |
| `@hono/vite-dev-server` | server (dev), root (dev) | Unified dev server |
| `@hono/vite-build` | server (Cloudflare build) | Cloudflare Workers bundling |
| `hono/serve-static` (or `@hono/node-server/serve-static`) | server | Static asset serving (local-first) |

All shared across 2+ workspaces → catalog. Web-only/server-only → literal in that workspace.

### Open question for operator (build toolchain) — RESOLVED

**B1. Unified Vite dev server — confirmed (operator 2026-06-14).** Adopt the unified Vite dev server
via `@hono/vite-dev-server`. The server's `bun run dev` shifts from `bun --hot run src/index.ts`
(standalone Bun.serve) to `vite dev` (Vite serves, delegates API to Hono). This is a dev-only change;
production builds are unaffected. The standalone `apps/server/src/index.ts` entry remains for the
Bun-binary production deployment (S0 `spur serve`) where Vite is not involved.

Rationale: eliminates proxy drift and CORS-in-dev friction; `@hono/vite-dev-server` is
Cloudflare-official and aligned with the Cloudflare deployment mode.

---

## Deployment targets (confirmed 2026-06-14)

**Default: Cloudflare Workers. Fallback: local/self-hosted Bun binary. Both from the same source.**

The server ships **two thin entry wrappers around the same `createApp(appRt)` core** — the same
architecture pattern the server already uses (`bootstrap.ts` exports `createApp`; `worker.ts` and
`index.ts` are thin fetch-entry wrappers). Neither entry contains business logic; they only adapt
the runtime to the host.

| Target | Entry | Runtime | Server host | Static assets host | Deploy command |
|---|---|---|---|---|---|
| **Cloudflare Workers (default)** | `apps/server/src/worker.ts` | Workers isolate; `runApplication` bootstraps once per isolate, cached via `getRuntime` | Worker `fetch` handler → `createApp(appRt).fetch` | Workers Static Assets binding (SPA fallback `not_found_handling = "single-page-application"`) | `wrangler deploy` (from `apps/server`) |
| **Local Bun binary (fallback)** | `apps/server/src/index.ts` + `apps/cli` `serve` command | Node/Bun process via `runNodeApplication` | `Bun.serve({ fetch: createApp(appRt).fetch })` | Hono `serveStatic` middleware on the same port | `spur serve` (or run the binary directly) |

**Shared core — both entries reuse these unchanged:**
- `createApp(appRt)` in `apps/server/src/bootstrap.ts` — Hono app, middleware, oRPC handler mount.
- `serverBootstrapConfig(env)` — logging/telemetry/events config from env.
- `runApplication` (Cloudflare) / `runNodeApplication` (Node/Bun) from `ts-infra` — same lifecycle,
  different platform adapters (logger, DB driver, scheduler).
- `packages/app` services — `TaskService`, `FeatureService`, etc. Platform-agnostic.
- `packages/contracts` — oRPC contracts; same types on both targets.

**Platform adapters (the only divergence):**

| Concern | Cloudflare Workers | Local Bun binary |
|---|---|---|
| Logger | `ts-infra` Cloudflare logger (console-based) | `ts-infra` Node logger (pino/winston, file sink) |
| Database | Durable Object SQLite or external (via `DATABASE_URL`) | Bun SQLite (`bun-sqlite`) at `.spur/spur.db` |
| Scheduler | `scheduler-cloudflare` (Cron Triggers) | Node scheduler (set-interval / cron) |
| Static assets | Workers Static Assets binding | `hono/serve-static` reading from `webDistPath` |
| Process lifecycle | Per-isolate `getRuntime` cache | `runNodeApplication` SIGINT/SIGTERM graceful shutdown |

The `bootstrap:` block in `.spur/config.yaml` already abstracts these via `driver: bun-sqlite` /
`enabled: true|false` keys — the config is portable, the adapter selection happens at runtime based
on the entry. No config-file fork needed.

**Why Cloudflare is default:** zero-server ops, global edge, built-in TLS, Workers Static Assets
removes the need for a separate static host. The operator confirmed this is the intended primary
deployment. The local fallback exists for laptop dev, air-gapped environments, and self-hosted
servers — `spur serve` is the one command for that path.

**Why this is robust:** the business logic (services, contracts, Hono app) is identical across both
targets. A bug fixed or feature added in `packages/app` or `bootstrap.ts` ships to both. The only
target-specific code is the thin entry wrapper and the platform adapter selection — exactly the
seam `ts-infra`'s `runApplication` / `runNodeApplication` split was designed for.

---

## Updated feature summary (S/W groups)

After resolving the 6 questions, adding the launcher (S0) and build toolchain (S5/W5), the full
feature list for the two new `docs/features` groups:

### Group S — Server API (`docs/features/S_server-api.md`)

| ID | Name | Priority | Wave | What it's for |
|---|---|---|---|---|
| **S0** | Board launcher (`spur serve`) | P1 | S0 | Unified CLI verb to launch the local-fallback server + board; resolves `.spur/config.yaml` `server:` block, starts Bun.serve, optional browser open, graceful shutdown. Primary deployment is Cloudflare (`wrangler deploy`); `spur serve` is the local path. |
| **S1** | Server foundation: middleware, shutdown, wiring | P1 | S0 | Middleware pipeline (CORS, request-id, logger, error handler, body limit, compress), graceful shutdown, `ServerContext` service wiring, DB/FileSystem wiring, EventBus/JobQueue/Scheduler wiring. |
| **S2** | Server module system | P1 | S0 | `ServerModule` interface, module registry, per-module OpenAPI — the standard for adding new API domains. |
| **S3** | Server domain modules (task + feature critical path) | P1 | S1 | Task module (TaskService), Feature module (FeatureService) — the board's API dependency. Others (workflow, rule, agent, history, team) follow incrementally. |
| **S4** | Server contracts and output standard | P1 | S1 | `taskContract`, `featureContract`, `planningEventContract` (reserved), shared DTOs, api-response envelope, Zod SSOT validation, HTTP error mapping. Per-module vertical slice with S3. |
| **S5** | Server static asset serving | P1 | S1 | Cloudflare-default: Workers Static Assets binding with SPA fallback. Local-fallback: Hono `serveStatic` from `webDistPath`. One port for API + board on both targets. |
| **S6** | SSE planning event stream (DEFERRED) | P2 | deferred | `/api/events/planning` SSE endpoint — subscribes to `EventBus<PlanningEventMap>`, frames events as SSE, supports `Last-Event-ID` replay from `planning_events` table. **Designed in design doc §2.9; implementation gated on module-system stability and D1 landing.** Until then, returns `501` on the Cloudflare path; runs on local Bun path. |

### Group W — Web board (`docs/features/W_web-board.md`)

| ID | Name | Priority | Wave | What it's for |
|---|---|---|---|---|
| **W1** | Web stack migration | P1 | W0 | Astro `output: 'static'` + `@astrojs/react` + Tailwind v4 (`@tailwindcss/vite`) + daisyUI 5. CSS-first config, React islands. |
| **W2** | Web layout and module system | P1 | W0 | 3-column resizable/foldable shell (left sidebar=module nav, right panel=context, main=workspace). `WebModule` interface + registry + React Router 7 routing. Data layer: extend `rpc-client.ts` with timeout fetch + tracing interceptor (revised Q3: no APIClient). |
| **W3** | Task Kanban module | P1 | W1 | First module: columns by status, drag-to-transition, task cards, detail panel, filters, live polling via the `{ api }` client. Proves the module system end-to-end. |
| **W4** | Web design system and theming | P2 | W1 | Tailwind `@theme` tokens, daisyUI themes, dark mode toggle, responsive breakpoints. |
| **W6** | SSE client subscription (DEFERRED) | P2 | deferred | `usePlanningEvents` hook using `EventSource` on `/api/events/planning`; dual-source merge (poll + SSE) in the Task Kanban reducer; reconnection with `Last-Event-ID`. **Designed in design doc §2.9.4; implementation deferred with S6.** |
| **W5** | Web build integration | P1 | W0 | Vite config aligned with server dev server, build outputs for Cloudflare-default (Workers Static Assets) and local-fallback (static assets served by Hono) modes. |

### Wave sequencing

| Wave | Features | Depends on | Gates |
|---|---|---|---|
| **S0** (server foundation) | S0, S1, S2 | — | Server boots, middleware pipeline works, module system proven with health module. |
| **W0** (web foundation) | W1, W2, W5 | S0 wave (needs API to exist) | Static SPA shell renders, layout works, module system proven with a placeholder module. |
| **S1** (server domain) | S3, S4, S5 | S0 wave (module system) | Task/feature API live, contracts shipped, static assets served. |
| **W1** (web module) | W3, W4 | S1 wave (needs task/feature API) + W0 wave | Task Kanban functional end-to-end. |

S0 and W0 waves can overlap (W0 needs a server to exist but not the domain modules — health endpoint
suffices for the layout/module-system proof). S1 and W1 are sequential after their foundation waves.
S6 and W6 (SSE) are deferred waves — not on the critical path; ship after S1/W1 prove the pattern.

---

## Prerequisites & deferrals (added v0.4, from design doc v0.2)

### `ts-runtime` enhancement — prerequisite to S1

Per the enhance-first rule (design doc §2.1.1), platform divergence lives only behind
`@gobing-ai/ts-runtime`'s `RuntimeFactory` seam. The current factory lacks a DB facility; the
following enhancements ship in `ts-libs` first, then are consumed by Spur:

1. `RuntimeFactory.createDbAdapter(config)` — new factory method returning a `DbAdapter`.
2. `RuntimeCapabilities.hasSqlDatabase` — new capability flag.
3. `nodeBunFactory.createDbAdapter` — Bun SQLite (relocated from Spur bootstrap).
4. `cloudflareWorkersFactory.createDbAdapter` — D1 binding (stub until D1 ships).

S1 does not start until this enhancement is released and consumed by semver bump (or explicit
temporary `bun link`).

### D1 support in `ts-db` — scoped out (deferred)

**Operator decision (2026-06-14):** Cloudflare D1 is the Workers DB. This requires a `ts-db`
`D1DbAdapter` enhancement. **For the simplicity of the current round, D1 is scoped out** (design
doc §2.3.1). Consequences:

- The local Bun path carries full functionality for all in-scope waves (S0–S1, W0–W1).
- The Cloudflare Worker path runs health + OpenAPI only until D1 ships.
- SSE on the Cloudflare path (S6) is gated on D1 (the `Last-Event-ID` replay reads from
  `planning_events`, which needs D1). SSE runs on the local Bun path immediately.
- No Durable Object SQLite, no external-`DATABASE_URL`-on-Workers path. D1 is the single Workers DB.

D1 implementation is tracked as design doc §11 item 7.
