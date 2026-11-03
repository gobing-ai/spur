---
schema_version: 1
name: "Board hybrid search: local-server search contract and web module"
status: todo
template: feature-impl
created_at: 2026-11-03T16:50:38.253Z
updated_at: "2026-11-03T17:16:19.421Z"
feature_id: A34
priority: P3
tags:
  - search
  - server
  - web

dependencies: ["1285"]
---

## 1287. Board hybrid search: local-server search contract and web module

### Background

Feature A34 Board surface. Covers R9. Operators need auto / exact / fuzzy search over docs and code in the Board, with zg/index status visible. Depends on 1285 (`searchContract`, `searchProject`, `searchStatus`). Design: docs/design/hybrid-search.md §4 Server + Board (ADR-147).

### Requirements

- [ ] R9. The Board offers auto, exact, and fuzzy search.

### Acceptance Criteria

- [ ] AC1 — The Board offers auto, exact, and fuzzy search

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-03T17:16:18.909Z

- Q: oRPC contract or Hono route (like the Projects Database tab)? A: oRPC — add `search` to the global `contract`; the Worker mounts no oRPC router, so it stays local-only with no extra code, and the Board gets the typed `api.search.*` client.
- Q: Can the request pass a root? A: no — handlers use `ctx.cwd`; prevents path traversal.
- Q: Sidebar order? A: 15 (between observability 10 and history 20).
- Q: Degraded fuzzy UI? A: inline skipped reason + hint in the fuzzy group, never an error state.

### Design

Server:
- `packages/contracts/src/index.ts`: add `search: { ...searchContract }` to `contract` (import from `./search`).
- Create `apps/server/src/modules/search/handlers.ts`: `const os = implement(contract); export function createSearchHandlers(ctx: ServerContext) { return { query: os.search.query.handler(({ input }) => searchProject(input, ctx.cwd)), status: os.search.status.handler(() => searchStatus(ctx.cwd)) }; }`; map `SearchError` to the module's existing oRPC error convention (see `modules/history/handlers.ts`). `modules/search/index.ts` re-exports the factory (pattern: `modules/history/index.ts:20-21`).
- `apps/server/src/router.ts`: add `search: createSearchHandlers(ctx ?? stubCtx)`.
- No `ServerModule` entry in `modules/registry.ts` is needed (no Hono routes); no change to `worker-app.ts`.

Web:
- Create `apps/web/src/modules/search/index.tsx` exporting `module: WebModule = { id: 'search', name: 'Search', icon: <existing icon set's search glyph>, route: 'search', component, sidebarLabel: 'Search', description: 'Exact and semantic search over docs and code', order: 15 }`.
- Component: query input (Enter submits, disabled while pending); segmented control Auto / Exact / Fuzzy (default Auto); scope select All / Docs / Code; results grouped Exact / Fuzzy with `path:start-end`, snippet in monospace, `matchedBy` badge when both; status strip from `api.search.status()` showing rg/zg availability, index state and the exact hint strings; skipped reason inline.
- Data only via `import { api } from '@/lib/rpc-client'`; UI primitives only through the seam (`ui-import-seam-only`, `no-daisyui-class-leak`); tokens per root `DESIGN.md`. Controls keyboard-reachable with labels.

Rejected: client-side search over fetched docs; root as request field; a Hono route.
Invariants: no logic beyond calling the service (ADR-021); `apps/server/tests/openapi.test.ts` passes with the new `search` tag.

### Plan

1. Failure list first: `apps/server/tests/modules/search/handlers.test.ts` (query happy path with fake deps, invalid input 4xx, status shape, root not overridable); `apps/web/tests/modules/search/search-module.test.ts` (renders groups, renders skipped hint, mode switch sends `mode`).
2. Contract wiring + server handlers + router entry.
3. Web module.
4. `(cd apps/server && bun test tests/modules/search tests/openapi.test.ts)`, `(cd apps/web && bun test tests/modules/search tests/modules/registry.test.ts)`.
5. Browser check (repeatable artifact): `spur self serve` in this repo, open `/board` → Search; screenshot auto query with both groups, exact-only query, and status strip; save under the task's evidence path.
6. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md (R9)
- Design: docs/design/hybrid-search.md §4 Server/Board; root DESIGN.md; ADR-147, ADR-021
- Depends on: 1285
- Precedents: packages/contracts/src/index.ts:24 (contract), apps/server/src/router.ts:29-44, apps/server/src/modules/history/{handlers,index}.ts, apps/web/src/modules/history/index.tsx, apps/web/tests/modules/history/

### History

- 2026-11-03T17:06:32.825Z feature_id Q → A34 (system)

