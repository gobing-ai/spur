---
schema_version: 1
name: Runtime base path for the Board
status: done
template: feature-impl
created_at: 2026-11-17T00:06:29.305Z
updated_at: "2026-11-17T02:44:00.791Z"
feature_id: K4
priority: P1
tags:
  - web
  - board
  - server
estimate_hours: 10

dependencies: ["1360"]
done_forced: "false"
done_reason: unforced close
---

## 1358. Runtime base path for the Board

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §5–6, risks B2–B8, B16). The Board is a static Astro build that assumes the origin root. Under the gateway it is served at `/<prefix>/`, and the gateway (task 1360) rebases the HTML and injects `<meta name="spur-base" content="/<prefix>/">`. This task makes the client side follow that base and proves the whole Board works under a prefix and at the root. Covers R6.

### Requirements

- [x] R6. Under `/<prefix>/` every API call, router route, raw link, Markdown link, SSE stream, lazy chunk/preload, module asset and static asset resolves under the base; at `/` (direct per-port, dev mode, memory-router tests) behavior is unchanged; native Board modules get `basePath`/`withBase`/`resolveApiUrl` from the module kit.

### Acceptance Criteria

- [x] AC1 — Board works under a prefix and at the root (req: R6)

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

| File | Lines | What / why |
| --- | --- | --- |
| `apps/web/src/components/base-path.ts` | new (1-60) | The runtime base contract: `basePath()` (memoized `<meta name="spur-base">` → `'/'` fallback, normalized to leading+trailing slash), `withBase()` (only root-relative `'/x'` is prefixed; absolute, `//host`, `#`, `?`, relative pass through), `resolveApiUrl()` (`/<prefix>/api` or `/api`, `PUBLIC_API_URL` still wins) and `resetBasePathForTesting()`. Lives under `src/components` because the module-kit barrel publishes it and `emit-board-types` only mirrors declarations inside that root; `src/lib/base-path.ts` re-exports it so app code imports stay in `lib`. |
| `apps/web/astro.config.mjs` | 15-22 | `vite.experimental.renderBuiltUrl` → `{ relative: true }` for non-HTML hosts, so chunks and preloads are relative instead of the default root-absolute `"/" + file`. HTML stays root-absolute on purpose — the gateway rebases it (1360). Verified in the build output: `dist/web/_astro/*.js` now reference `./chunk.js`, and the absolute preload helper is gone. |
| `apps/web/src/lib/rpc-client.ts` | 8-13 | `resolveApiUrl` is now the base-path implementation (re-exported here for the existing import path), so every `api`/`EventSource` call under the gateway targets `/<prefix>/api`. |
| `apps/web/src/router.tsx` | 1-5, 105-110 | `createBrowserRouter(..., { basename: basePath().replace(/\/$/, '') \|\| '/' })` — routes mount under the gateway prefix and stay identical at the root. |
| `apps/web/src/modules/features/FeatureDetail.tsx` | 6, 76, 485-489 | `window.location.assign('/board/tasks/…')` → router `navigate(…)`, so the task jump cannot leave the base path. |
| `apps/web/src/modules/search/index.tsx` | 2, 4, 128-130 | Board deep links render through router `Link` instead of a bare `<a href>`. |
| `apps/web/src/modules/task-kanban/MarkdownBody.tsx` | 4, 165-190 | New `a` component override (`renderAnchor`) applies `withBase` to Markdown links so `/board/...` inside a task body resolves under the prefix. |
| `apps/web/src/modules/compose.ts` | 4, 56-72, 78-86 | Native module entry `import()` and stylesheet `<link>` go through `withBase`, so a catalog's `/modules/<id>/…` assets resolve under the gateway while absolute URLs stay untouched. |
| `apps/web/src/components/module-kit/index.ts` + `exports.ts` | 22-28 / 23-25, 34 | Kit publishes `basePath`, `withBase`, `resolveApiUrl` (barrel + `MODULE_KIT_EXPORTS` mirror) and `BOARD_UI_KIT_VERSION` → `1.1.0` (additive minor, ADR-150). |
| `apps/web/tests/lib/base-path.test.ts` | new | `basePath()` with/without meta and normalization, `withBase` pass-through matrix, `resolveApiUrl` under prefix + `PUBLIC_API_URL`, memoization. |
| `apps/web/tests/board-base-path.heavy.test.ts` | new | Real Chromium: production-shaped build served behind the real gateway handler at `/proj/board` — meta `/proj/`, router mounted under it, deep-link refresh renders the Board, API/SSE reach the upstream **stripped** (`/api/events/planning`, `/api/tasks…`), and every request the browser issued carries `/proj/` (zero escapes); second case proves the same build at the origin root with no meta. |
| `apps/web/tests/…` (3 files) | feature-sync, planning-live-views, markdown-safety-pipeline | Wrap the bare `FeatureDetail`/`FeaturesShell` renders in `MemoryRouter` — the panel now navigates through the router (K4), so a routerless render is no longer valid. |
| `apps/web/package.json`, `bun.lock` | — | `@gobing-ai/spur-app` + `@gobing-ai/spur-config` as test-only `workspace:*` devDependencies for the heavy E2E (internal workspace packages, no new external dependency). `bun install` also refreshed a stale lock: the recorded `apps/cli`/`apps/server` versions lagged their manifests. |
| `docs/design/downstream-board-modules.md` §6.9, `docs/design/board-module-ui-kit.md` §6 | new sections | Document the base-path contract, the kit 1.1.0 helpers and the "never hard-code `'/api'`" rule for native modules. |
| `apps/cli/board/kit/module-kit/index.d.ts` | regenerated | The emitted mirror of the kit barrel now carries the three new exports + 1.1.0. |

**Correction after the feature gate (2026-11-17).** The two `workspace:*` devDependencies added to
`apps/web/package.json` for the heavy E2E (`@gobing-ai/spur-app`, `@gobing-ai/spur-config`) were
removed again: they resolve through the root workspace hoisting (`tsc` and the browser E2E both pass
without them), while the manifest change flipped the frozen 1311 migration-ownership decision to
`no-go` ("An upstream package manifest changed") and so broke that artifact's reproducibility for a
dependency edge nothing needed. `bun.lock` is therefore untouched by this task.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R6 — under `/<prefix>/` every API call, router route, raw link, Markdown link, SSE stream, lazy chunk/preload, module asset and static asset resolves under the base; at `/` behavior is unchanged; native modules get `basePath`/`withBase`/`resolveApiUrl` from the module kit | MET | base contract `apps/web/src/components/base-path.ts:1-60`; API `apps/web/src/lib/rpc-client.ts:8-13,24`; router `apps/web/src/router.tsx:105-110`; links `apps/web/src/modules/features/FeatureDetail.tsx:485-489`, `apps/web/src/modules/search/index.tsx:128-130`, `apps/web/src/modules/task-kanban/MarkdownBody.tsx:165-190`; chunks `apps/web/astro.config.mjs:15-22`; module assets `apps/web/src/modules/compose.ts:56-72,78-86`; kit `apps/web/src/components/module-kit/{index,exports}.ts` + regenerated `apps/cli/board/kit/module-kit/index.d.ts` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Board works under a prefix and at the root (req: R6) | MET | test | `apps/web/tests/board-base-path.heavy.test.ts` 2 pass in real Chromium (built board behind the real gateway handler): meta `/proj/`, router mounted at `/proj/board*`, deep-link refresh renders, upstream paths `/api/events/planning` + `/api/tasks…` arrive **stripped**, and every browser request carries `/proj/` (zero escapes); the root case serves the same build with no meta at `/board*`. `(cd apps/web && bun test)` 559 pass, including `tests/components/base-path.test.ts` + `tests/lib/base-path.test.ts`. Build emits `./chunk.js` refs and no absolute preload helper; grep gate over `apps/web/src` shows only router-relative or `withBase`-wrapped URLs |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Req | Status | Evidence |
| --- | --- | --- |
| R6 | MET | `apps/web/src/components/base-path.ts:1-60`; API `apps/web/src/lib/rpc-client.ts:8-13`; router basename `apps/web/src/router.tsx:105-110`; links `FeatureDetail.tsx:485-489`, `search/index.tsx:128-130`, `MarkdownBody.tsx:165-190`; chunks `astro.config.mjs:15-22`; module assets `modules/compose.ts:56-86`; kit exports + 1.1.0 |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test + command | `apps/web/tests/board-base-path.heavy.test.ts` 2 pass in Chromium: prefixed mount with meta `/proj/`, deep-link refresh, stripped upstream paths (`/api/events/planning`, `/api/tasks…`), zero requests outside `/proj/`; root case unchanged. Full web suite 559 pass; build emits relative chunk URLs |

Findings: no open P1–P3. P4: document-level memo of the meta; `renderBuiltUrl` applies to all non-HTML assets (fine while no inline `<style>` assets exist); the batch's `bun install` also repaired pre-existing `bun.lock` version drift (0.4.33 → 0.4.36) unrelated to K4.

Residual risk: HTML rebasing stays the gateway's responsibility (1360) and runtime URLs the client's; the grep gate — not a runtime check — guards against new hard-coded root-absolute URLs.

**Disposition: PASS.**

### References

- Feature K4 R6; ADR-151; `docs/design/project-gateway.md` §5, §6 (B2–B8, B16).
- Depends on 1360 (gateway HTML rebasing + meta) for the E2E proof.
- Existing harness: `apps/web/tests/test-helpers/board-build.ts`, `apps/web/tests/test-helpers/cdp.ts`, `apps/web/tests/modules/composed-board-browser.heavy.test.ts` (pattern to copy).

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)
- 2026-11-17T01:44:34.868Z todo → wip (system)
- 2026-11-17T01:51:13.405Z wip → testing (system)
- 2026-11-17T01:51:14.912Z testing → done (system)

