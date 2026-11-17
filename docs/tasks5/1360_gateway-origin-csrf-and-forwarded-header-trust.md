---
schema_version: 1
name: Gateway origin, CSRF and forwarded-header trust
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.306Z
updated_at: "2026-11-17T00:29:18.789Z"
feature_id: K4
priority: P1
tags:
  - gateway
  - security
  - server
estimate_hours: 5

dependencies: ["1359"]
---

## 1360. Gateway origin, CSRF and forwarded-header trust

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §4.2 steps 1–2, 6–7, §5.1, risks B1, B11, B12). The browser talks to the gateway/tunnel origin while each project serve sees `127.0.0.1:<port>`. Instead of teaching every serve to trust forwarded headers, the gateway adapts at the edge: host guard and CSRF against the public origin, `Host`/`Origin` rewritten for the upstream, and HTML/`Location`/manifest rebased under `/<prefix>/` with a `spur-base` meta. Project serves are not modified. Access control is configured at the Cloudflare tunnel and is out of scope. Covers R8.

### Requirements

- [ ] R8. Requests whose Host is not `localhost`, an IP literal, the `--host` name or in `server.gateway.allowedHosts` get 421; non-safe cross-origin requests (Origin ≠ public origin, `/a2a/` exempt) get 403 before upstream contact; accepted requests reach the serve with `Host`/`Origin` rewritten to `http://127.0.0.1:<port>` so the serve's own host guard and `csrf()` pass unchanged; `text/html` responses get root-absolute attribute URLs and import-map entries rebased to `/<prefix>/` plus `<meta name="spur-base" content="/<prefix>/">`; `Location: /x` → `/<prefix>/x`; `site.webmanifest` `start_url`/`scope`/icon `src` rebased.

### Acceptance Criteria

- [ ] AC1 — Gateway serves the tunnel origin and adapts requests for the upstream (req: R8)

Verification: E2E in `apps/server/tests/gateway-edge.test.ts` running the real gateway handler (`createGatewayHandler` from `@gobing-ai/spur-app`) in front of a real `Bun.serve` over `createApp()` (`apps/server/src/bootstrap.ts:30`) with a temp web dist holding a copy of a freshly built `index.html` (follow `apps/server/tests/static-assets.test.ts` for the web-dist setup): (a) `Host: board.example.com` with `allowedHosts: ['board.example.com']` → 200 and HTML containing the meta and zero `="/_astro` / `"/_astro` occurrences outside the prefix; (b) `Host: evil.test` → 421; (c) POST with `Origin: https://board.example.com` → passes serve `csrf()`; (d) POST with `Origin: https://evil.test` → 403 and the upstream receives no request; (e) deep link `/<p>/board/tasks/1` (SPA fallback) is rebased too; (f) upstream 302 `Location: /api/health` → `/<p>/api/health`. Artifact: the rebased HTML snapshot and a request log.

### Q&A

- No serve change and no `X-Forwarded-*` trust (superseded the first plan): upstream sees a plain loopback request. This keeps old serves compatible with a new gateway.
- HTML rewrite is string-level and deliberately narrow: attribute values starting with `/` (not `//`) and string values starting with `"/` inside `<script type="importmap">`. Inline JS is never rewritten — chunk URLs are already relative (1358).
- Only `text/html` bodies are buffered; everything else streams.
- Task title still says "forwarded-header trust" (CLI cannot rename tasks); the design no longer needs it — the scenario title is the contract.

### Design

Files and signatures (all in `packages/app/src/services/project-gateway.ts`, plugging into the `guard`/`adapt` hooks 1359 leaves):

```ts
export interface GatewayEdgeOptions { bindHost: string; allowedHosts: readonly string[] }
export function gatewayGuard(req: Request, opts: GatewayEdgeOptions): Response | null;     // 421 / 403 or null to continue
export function upstreamRequestHeaders(req: Request, upstreamPort: number): Headers;      // Host + Origin rewrite, hop-by-hop strip
export function rebaseHtml(html: string, prefix: string): string;                          // attrs + importmap + meta
export function rebaseLocation(location: string, prefix: string): string;                  // '/x' → '/<p>/x'; '//', absolute unchanged
export function rebaseManifest(json: string, prefix: string): string;
```

- Host guard: reuse `allowedHostnames(bindHost, allowedHosts.map(h => `https://${h}`))` / `isAllowedHost` / `rejectHost` from `apps/server/src/middleware/host-guard.ts`. That module is `apps/server`; move the three pure functions to `packages/app/src/services/host-guard.ts` (or `packages/config`) and re-export from the server path so `serve.ts:65` imports stay valid — no behavior change.
- CSRF: same predicate as `apps/server/src/middleware/pipeline.ts:68` — for methods other than GET/HEAD/OPTIONS, reject when `Origin` is present and ≠ `new URL(req.url).origin`, and when `Origin` is absent but `Content-Type` is a form/text type (hono/csrf semantics); skip for `/<prefix>/a2a/`. `packages/app` has no Hono dependency, so implement the predicate directly (≈10 lines) — the test matrix mirrors hono/csrf's documented behavior and is the contract.
- Origin rewrite only after the guard passes; `Referer` dropped (serve does not need it).
- `rebaseHtml`: regex `(\s(?:href|src|component-url|renderer-url|content|action)=["'])\/(?!\/)` → `$1<prefix>/`; importmap block: parse JSON, prefix string values starting with `/`; inject meta right after `<head>` (or prepend if absent). Idempotent: skip if the meta already exists.
- Response adaptation: by `content-type` prefix `text/html`, by path suffix `site.webmanifest`; `Location` header on any status.

Invariants: no upstream request is made for a refused Host/CSRF; adapted responses drop `content-length`; streaming responses unchanged.
Rejected: serve-side forwarded-header trust (N serves, version skew); `HTMLRewriter` (Bun has it, but regex is enough for our own build output and keeps the handler runtime-agnostic — revisit if HTML grows dynamic).

### Plan

1. Failure cases first (tests before code):
   - unlisted Host → 421, upstream untouched; IP literal Host → allowed.
   - cross-origin POST → 403, upstream untouched; same-origin POST through tunnel Host → serve `csrf()` passes (proves Origin rewrite).
   - `/p/a2a/...` POST without Origin → not blocked by the gateway.
   - HTML: `href="//cdn"`, `href="https://x"`, `href="#a"` unchanged; `href="/favicon.svg"`, import map `"/_astro/x.js"`, `component-url="/_astro/..."` rebased; meta injected once; rebasing twice is a no-op.
   - SPA fallback HTML (deep link) rebased; `Location: /api/health` rebased; `Location: https://x/` unchanged.
   - SSE and JS responses still stream (no buffering regression from 1359).
2. Move host-guard pure functions, then guard, header rewrite, rebase helpers, wire into handler.
3. Run `(cd packages/app && bun test tests/services/project-gateway*.test.ts)`, `(cd apps/server && bun test tests/gateway-edge.test.ts tests/middleware)`, `bun run spur-check`.
4. Attach the rebased HTML snapshot artifact in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R8; ADR-151; `docs/design/project-gateway.md` §4.2, §5.1, §6 (B1, B11, B12).
- `apps/server/src/middleware/host-guard.ts`, `apps/server/src/middleware/pipeline.ts:68-78`, `apps/server/src/bootstrap.ts:66-102` (static + SPA fallback), `apps/web/scripts/board-runtime.ts:172` (import map), `dist/web/index.html`.
- Depends on 1359. Consumed by 1358 (E2E), 1361.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

