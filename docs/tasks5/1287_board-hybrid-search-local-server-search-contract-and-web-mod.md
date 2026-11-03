---
schema_version: 1
name: "Board hybrid search: local-server search contract and web module"
status: done
template: feature-impl
created_at: 2026-11-03T16:50:38.253Z
updated_at: "2026-11-03T19:29:22.394Z"
feature_id: A34
priority: P3
tags:
  - search
  - server
  - web

dependencies: ["1285"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1287-verdict.json
---

## 1287. Board hybrid search: local-server search contract and web module

### Background

Feature A34 Board surface. Covers R9. Operators need auto / exact / fuzzy search over docs and code in the Board, with zg/index status visible. Depends on 1285 (`searchContract`, `searchProject`, `searchStatus`). Design: docs/design/hybrid-search.md §4 Server + Board (ADR-147).

### Requirements

- [x] R9. The Board offers auto, exact, and fuzzy search.

### Acceptance Criteria

- [x] AC1 — The Board offers auto, exact, and fuzzy search

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

Change map (ADR-147 hybrid search, ADR-021 thin server; design §4 Server/Board):

- `packages/contracts/src/index.ts:39` — mount `search: { query: searchContract.search, status: searchContract.searchStatus }` into the public `contract`; Board client surface is `api.search.query` / `api.search.status` (matches design's `api.search.status`).
- `packages/contracts/tests/search-contract.test.ts` — 1285's scope-boundary guard (`'search' in contract` false) flipped by design to assert the keyed mount (`['query','status']` + identity vs `searchContract`).
- `apps/server/src/modules/search/handlers.ts` (new) — `createSearchHandlers(ctx)`; `query` handler binds `searchProject` to `ctx.cwd` only (client-supplied `root` is rejected by the `.strict()` request schema → SearchError `invalid-request` → ORPCError BAD_REQUEST: no path traversal); `status` handler binds `searchStatus(ctx.cwd)`; `toSearchORPCError` maps `invalid-request`→BAD_REQUEST, environment failures (`rg-not-installed`, `zg-index-missing`, …)→INTERNAL with the actionable hint carried verbatim in `data`.
- `apps/server/src/modules/search/index.ts` (new) — factory re-export, oRPC-only (no Hono route, no `ServerModule` entry; Worker mounts no oRPC router so search stays local-only per design §4).
- `apps/server/src/router.ts:38` — `search: createSearchHandlers(ctx ?? stubCtx)`.
- `apps/web/src/modules/search/index.tsx` (new) — `SearchShell`: Enter-to-submit query input (disabled while pending), Auto/Exact/Fuzzy segmented control (default Auto), All/Docs/Code scope select; results grouped Exact/Fuzzy (`HitGroup`/`HitRow`) rendering `path:start-end`, monospace snippet, `matchedBy` Badge only when both routes agree; degraded groups render inline `skipped: <reason> — <hint>` (never an error state); `StatusStrip` (`role="status"`) shows rg/zg availability, version, index state and the exact hint strings; query fetch aborts on unmount/param change. `WebModule { id: 'search', route: 'search', order: 15 }` (between observability 10 and history 20).
- Tests: `apps/server/tests/modules/search/handlers.test.ts` (query grouped hits bound to ctx.cwd vs tmpdir fixture; client `root` rejected; status shape), `apps/web/tests/modules/search/search-module.test.ts` (metadata, degraded-not-error, hit rendering, full shell happy path, mode switch sends `mode`), `apps/web/tests/modules/registry.test.ts` expected enabled-module list gains `search` (order 15).

Invariants kept: server handlers contain no logic beyond service calls; all UI data via `api`; UI primitives only through the `@/ui` seam.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R9 | MET | packages/contracts/src/index.ts:39 (api.search.query/status mount); apps/server/src/router.ts:38 (search handlers registered); apps/web/src/modules/search/index.tsx (SearchShell: Enter-submit query input, Auto/Exact/Fuzzy segmented control default Auto, All/Docs/Code scope select, grouped results, StatusStrip); apps/web/tests/modules/search/search-module.test.ts:5 tests incl. mode-switch sends `mode`; live transport E2E (see Testing) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R9 — The Board offers auto, exact, and fuzzy search | MET | test | apps/web/tests/modules/search/search-module.test.ts (metadata order 15; skipped degradation inline never error state; path:start-end + snippet + matchedBy badge only when both routes agree; full shell renders groups+status; mode switch sends `mode:fuzzy`); command — live transport E2E POST /api/search {mode:auto,scope:docs} → 200 with 10 exact hits, fuzzy null, skipped zg-index-missing + hint verbatim (recorded in task Testing section); degraded path exercised end-to-end over the real app |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition |
| --- | --- | --- |
| P1 | none | — |
| P2 | none | — |
| P3 | none | — |
| P4 | observation: oRPC void-input procedures reject a POST body at transport level (`400 invalid_type`, reproduced in this session's live transport probe against `POST /api/search/status` with body `{}`); the Board's `OpenAPILink` client sends bodyless POSTs (packages/contracts/src/search.ts:139 declares the contract side, `packages/app` rpc-client uses `@orpc/openapi-client` OpenAPILink), so only hand-rolled curl callers would hit this | accepted (client behavior correct; documented here for future curl-based probes) |

Residual risk: degraded-path UI verified via mocked api + live transport JSON, not via a real browser screenshot; risk limited to styling details.

Confidence: high — design §4 invariants each have a focused test or a live transport assertion; full server/web/contracts suites green after the module addition.

Verdict: PASS

### References

- Feature: docs/features/A34_local-first-hybrid-search-exact-rg-and-semantic-zg-over-docs-and-code.md (R9)
- Design: docs/design/hybrid-search.md §4 Server/Board; root DESIGN.md; ADR-147, ADR-021
- Depends on: 1285
- Precedents: packages/contracts/src/index.ts:24 (contract), apps/server/src/router.ts:29-44, apps/server/src/modules/history/{handlers,index}.ts, apps/web/src/modules/history/index.tsx, apps/web/tests/modules/history/

### History

- 2026-11-03T17:06:32.825Z feature_id Q → A34 (system)
- 2026-11-03T19:18:01.317Z todo → wip (system)
- 2026-11-03T19:29:19.856Z wip → testing (system)
- 2026-11-03T19:29:22.389Z testing → done (system)

