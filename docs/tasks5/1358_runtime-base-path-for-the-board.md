---
schema_version: 1
name: Runtime base path for the Board
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.305Z
updated_at: "2026-11-17T00:29:28.400Z"
feature_id: K4
priority: P1
tags:
  - web
  - board
  - server
estimate_hours: 10

dependencies: ["1360"]
---

## 1358. Runtime base path for the Board

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §5–6, risks B2–B8, B16). The Board is a static Astro build that assumes the origin root. Under the gateway it is served at `/<prefix>/`, and the gateway (task 1360) rebases the HTML and injects `<meta name="spur-base" content="/<prefix>/">`. This task makes the client side follow that base and proves the whole Board works under a prefix and at the root. Covers R6.

### Requirements

- [ ] R6. Under `/<prefix>/` every API call, router route, raw link, Markdown link, SSE stream, lazy chunk/preload, module asset and static asset resolves under the base; at `/` (direct per-port, dev mode, memory-router tests) behavior is unchanged; native Board modules get `basePath`/`withBase`/`resolveApiUrl` from the module kit.

### Acceptance Criteria

- [ ] AC1 — Board works under a prefix and at the root (req: R6)

Verification: heavy browser E2E `apps/web/tests/board-base-path.heavy.test.ts` (run via `bun run test:heavy`): build with `buildBoardToTemp()` (`apps/web/tests/test-helpers/board-build.ts`), serve it with `serveBoard()` (`apps/web/tests/test-helpers/board-server.ts:94`, extended with an SSE stub for the planning-events path and a module asset tree) as the upstream, put `createGatewayHandler` (1359/1360, from `@gobing-ai/spur-app`) in front of it on its own `Bun.serve`, drive Chrome through `apps/web/tests/test-helpers/cdp.ts` to `/<prefix>/board`, a deep link (refresh), a lazy route (task detail), the search page, a Markdown link, a module asset and an SSE subscription; repeat at `/` on the serve port. Assert zero requests whose path does not start with `/<prefix>/` (excluding external URLs). Artifact: the JSON network log written under the test temp dir and attached to `## Testing`.

### Q&A

- Chunk URLs: `vite.experimental.renderBuiltUrl` returning `{ relative: true }` for non-HTML hosts was spiked on Astro 6.4.2/Vite 7.3.7 (build exit 0, the absolute preload helper `function(e){return"/"+e}` disappears, same chunk set). If it regresses, fall back to `build.cssCodeSplit: false` + `build.modulePreload: false`; do **not** rewrite JS bytes at the gateway.
- HTML URLs stay root-absolute in the build; rebasing them is the gateway's job (task 1360). This task never rewrites HTML.
- Base source is the `spur-base` meta only (no global JS var, no cookie) so direct per-port access needs no server change.
- Module kit bumps 1.0.0 → 1.1.0 (additive exports, minor).
- The E2E needs `@gobing-ai/spur-app` as a `workspace:*` **devDependency** of `apps/web` (internal workspace, test-only; no external dependency). `serveBoard` gains an optional `sse` stub rather than a new helper.

### Design

New `apps/web/src/lib/base-path.ts`:

```ts
/** '/<prefix>/' from <meta name="spur-base">, else '/'. Always leading+trailing slash. Memoized per document. */
export function basePath(): string;
/** '/x' → basePath() + 'x'. Unchanged: absolute URLs (scheme), protocol-relative '//', '#…', '?…', relative paths. */
export function withBase(path: string): string;
```

Change map (file:line from the 2026-11-16 audit):

| Site | Change |
| --- | --- |
| `apps/web/astro.config.mjs` `vite` | add `experimental: { renderBuiltUrl(filename, { hostType }) { return hostType === 'html' ? undefined : { relative: true }; } }` with a WHY comment (B2) |
| `apps/web/src/lib/rpc-client.ts:34` `resolveApiUrl` | `new URL(withBase('/api'), origin)`; EventSource callers (`GlobalAgentBar.tsx:318`, `planning-events.ts:22`, `InboxView.tsx:20`, `SystemEventsTab.tsx:116`, `process-stream.ts:76`) already go through it — verify, do not touch |
| `apps/web/src/router.tsx:106` | `createBrowserRouter(createBoardRoutes(registry), { basename: basePath().replace(/\/$/, '') \|\| '/' })` |
| `FeatureDetail.tsx:486` | replace `window.location.assign(`/board/tasks/${wbs}`)` with `navigate(`/board/tasks/${wbs}`)` |
| `search/index.tsx:34,36,128` | `<a href="/board/…">` → router `Link to="/board/…"` |
| `TaskRunEvidenceLink.tsx:8` | `Link` (or `withBase`) for `/board/observability?…` |
| `MarkdownBody.tsx` | add `components.a` that rewrites `href` starting with `/` (not `//`) through the router (`Link`) or `withBase`; external links unchanged |
| module loading (`compose.ts:61` `import(url)`, style `<link>` creation) | wrap entry/style URLs that start with `/` in `withBase()`; server `isModuleAssetPath` (`apps/server/src/modules/board/index.ts:23`) and catalog `assetUrl` (`packages/app/src/services/board-catalog-service.ts:275`) unchanged |
| `apps/web/src/components/module-kit/index.ts` + `exports.ts` `MODULE_KIT_EXPORTS` | export `basePath`, `withBase`, `resolveApiUrl`; `BOARD_UI_KIT_VERSION` → `1.1.0` |
| `docs/design/downstream-board-modules.md`, `docs/design/board-module-ui-kit.md` | document: native modules must build URLs with `withBase`/`resolveApiUrl`, never `'/api'` literals |

Grep gate before done: `rg -n "['\"\`]/(api|board|modules)/" apps/web/src --glob '!**/*.test.*'` returns only router-relative `to=`/`navigate(` paths or `withBase(` calls.

Invariants: dev server and memory-router tests have no meta → `/`; no change to `apps/server`.
Rejected: Astro `base` config (build-time constant, breaks per-port root access and needs one build per prefix).

### Plan

1. Failure cases first — write the heavy E2E and unit checks that fail today:
   - API call under prefix hits `/api/...` (root) instead of `/<prefix>/api/...`.
   - deep-link refresh of `/<prefix>/board/tasks/<wbs>` renders 404 route (no basename).
   - lazy route's CSS/modulepreload requested at `/_astro/...` (preload helper).
   - search result / evidence link / Markdown `/board/...` link navigates to origin root.
   - module entry `import('/modules/<id>/…')` escapes.
   - `withBase` must leave `https://x/y`, `//cdn/x`, `#a`, `?q` untouched; `basePath()` with no meta is `/`.
2. Add `base-path.ts`, then the change map top-down; `renderBuiltUrl` first and rebuild to confirm `rg 'return"/"\+' dist/web/_astro` is empty.
3. Module kit export + version + docs.
4. Run `(cd apps/web && bun test)`, `bun run test:heavy` (includes the new base-path E2E), `bun run build`, `bun run spur-check`.
5. Record the network-log artifact path in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R6; ADR-151; `docs/design/project-gateway.md` §5, §6 (B2–B8, B16).
- Depends on 1360 (gateway HTML rebasing + meta) for the E2E proof.
- Existing harness: `apps/web/tests/test-helpers/board-build.ts`, `apps/web/tests/test-helpers/cdp.ts`, `apps/web/tests/modules/composed-board-browser.heavy.test.ts` (pattern to copy).

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

