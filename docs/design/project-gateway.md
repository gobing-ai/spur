---
kind: design
title: "Project gateway — one port, path prefixes, LaunchAgent (feature K4)"
created_at: 2026-11-16
updated_at: 2026-11-20
related: [K4, K1]
tags: [system, K4, server, web, cli]
doc: design/project-gateway
owns: SURFACE + mechanism for prefix-routed local projects on one gateway port and its macOS LaunchAgent
authority: derived (ADR-151 wins on conflict)
---

# Project gateway — system design (feature K4)

## 1. Problem

Each local `spur self serve` binds its own port, allocated from 3000–3999 and rewritten to `0` on stop
(`packages/app/src/services/project-registry.ts:400`). A Cloudflare tunnel ingress rule names a fixed
port, so every restart can break remote access, and the live registry already shows two local
entries claiming 3007. Serves are tied to terminals; nothing restarts them at login.

## 2. Decision (ADR-151)

| Topic | Decision | Rejected |
| --- | --- | --- |
| Shape | A **gateway**: one long-lived process on one fixed port reverse-proxies `/<prefix>/*` to each local project's own `spur self serve` on an internal loopback port | One multi-tenant `spur self serve` (DB, fleet supervisor, job worker, scheduler, quota consumer and owner lock are process-scoped in `apps/server/src/serve.ts`; XL rewrite, one failure domain) |
| Routing key | Path prefix per local entry (requested form) | Host-based `<slug>.localhost` / wildcard tunnel hostname — no base-path work, but wildcard DNS and tunnel config; fallback only if §5 regresses |
| Adaptation | The **gateway** adapts requests and responses (host guard, CSRF, `Host`/`Origin` rewrite, HTML/`Location` rebasing). Project serves stay byte-for-byte unchanged and see a plain loopback request | Serve trusts `X-Forwarded-*` from loopback peers and injects the base itself (N serves to change, version skew between gateway and older serves, header-trust surface) |
| Remote entries | Untouched: `host` + `port`, never proxied | Proxying remote hosts through the gateway |
| Daemon | macOS **user LaunchAgent** whose only job is keeping the gateway always on | Root LaunchDaemon (no user HOME/keychain/agent CLIs on PATH); systemd/Windows (deferred) |
| Access control | Out of scope — configured at the Cloudflare tunnel | Spur-side auth |
| Registry | ADR-037 contract reused; `prefix` is the only new field | A second registry or daemon-owned state |

Size: **L, 7 tasks** (1357–1363). Critical path: Board base path (§5) and gateway (§4).

## 3. Registry contract

```ts
projectEntrySchema = z.object({
    name, path, host?,          // unchanged
    port: number,               // unchanged: 0 = stopped, >0 = listening (internal loopback port for local entries)
    prefix?: string,            // NEW, local entries only
});
```

- `resolveProjectPrefix(entry): string | null` → `entry.prefix ?? '/' + slugify(entry.name)`; `null`
  for remote entries (`!isLocalHost(entry.host)`).
- Valid prefix: `^/[a-z0-9][a-z0-9-]{0,62}$`. Reserved first segments: `api`, `board`, `modules`,
  `_astro`, `openapi.json`, `health`. Unique among local entries (case-insensitive).
- A *derived* collision (two local entries that slugify alike, no explicit prefix) is not a load
  error: `projects list` and the gateway report it with the remedy
  `spur projects add <path> --prefix /<other>`, and the gateway refuses to route either colliding
  entry rather than guess.
- No migration: existing files load unchanged. `spur projects add` gains `--prefix` (local only;
  refused with a remote `--host`).

## 4. Gateway

### 4.1 Surface (operator consent required per AGENTS.md)

| Command | Change |
| --- | --- |
| `spur self serve --gateway [--port <n>] [--host <name>]` | New flag on the existing `self serve`; no new noun or verb |
| `spur self install --daemon [--port <n>] [--json]` · `spur self uninstall [--daemon]` · `spur self status` | Flat verbs, no `daemon` sub-noun; the `spur self daemon <action>` alias was removed on 2026-11-18 (task 1387) |
| `spur projects add --prefix <slug>` | New flag |

Config (`packages/config/src/index.ts` `server` section): `server.gateway.port` (default **3000**,
set with `SPUR_GATEWAY_PORT` for both the gateway and MCP bridge),
`server.gateway.allowedHosts: string[]` (tunnel hostnames, default `[]`) and, since task 1382,
`server.gateway.mcp: { enabled: boolean (default false), authEnv?: string }` mapped from
`SPUR_GATEWAY_MCP_ENABLED` / `SPUR_GATEWAY_MCP_AUTH_ENV`. `enabled` without `authEnv` fails the
config load with the same message shape as `server.mcp`. `allocatePort()` skips the gateway port;
spawned serves already bind `127.0.0.1` (`project-start.ts:450-460`).

### 4.1a Gateway-hosted MCP entry (task 1382, feature K41)

The gateway answers **its own** MCP endpoint at the root, so an MCP client needs one URL no matter
how many projects are registered.

| Aspect | Contract |
| --- | --- |
| Route | `POST /mcp` at the gateway root, matched **before** prefix routing. Disabled ⇒ `404`; never a proxy attempt at a project prefix |
| Auth | the shared `bearerGuard` (1375) with realm `spur-gateway-mcp` and the gateway's **own** token variable — a gateway credential never implies a project credential. Missing/wrong token ⇒ 401; unset variable ⇒ 500 fail-closed |
| CSRF | root `/mcp` is exempt from the same-origin check (bearer-authenticated, like `/<prefix>/mcp`); the host allowlist still applies |
| Reserved | `mcp` joined `RESERVED_PREFIX_SEGMENTS`, so a project can never be prefixed `/mcp` and silently shadow the endpoint |
| Composition | `apps/server/src/gateway.ts` builds the handler from `{ enabled, authEnv, env }` and injects it as `GatewayDeps.mcp`; `packages/app` stays transport-free |
| `server/discover` | additive `projects: [{ name, prefix, namespace }]` for local entries and `diagnostics: [{ name, reason: 'remote-not-proxied (ADR-151)', remedy: 'run the project locally and spur projects add <path>' }]` |

### 4.1b Tool aggregation and call routing (task 1383)

`tools/list` and `tools/call` are served from one route table built inside the gateway handler on
every request — no cache, and **listing never starts a project**.

| Aspect | Contract |
| --- | --- |
| `tools/list` | the `sp_*` built-ins exactly once, each input schema extended with a required `project` selector. Workflow tools use the same inventory and argument schemas as the project endpoint. |
| Resolution | a built-in routes by its `project` argument (stripped before forwarding); a workflow tool routes by the namespace that owns it |
| Upstream call | the gateway starts the project through the shared `ensureUpstream` (de-duplicated) and POSTs `tools/call` to the project's loopback `/mcp` route with the project's bearer token and `MIN_MCP_PROTOCOL_VERSION`. It uses the same loopback family selection as the proxy and returns the upstream `result` unchanged. |
| Namespace collision | a namespace claimed by 2+ local projects is reported in discover `diagnostics` (`namespace-collision`), its tools are withheld from `tools/list`, and a call to one is refused naming both projects |
| Refusals | unknown or ambiguous `project`, missing project token, and upstream HTTP errors produce a tool error. JSON-RPC refusals preserve the project's error details and redact its token. |
| Resources | `resources/list` is `[]` at the gateway root, by scope |

The gateway forwards one shared project token. The CLI passes `server.mcp.authEnv`
(`SPUR_MCP_AUTH_ENV`) as `projectTokenEnv`, and project servers started by the gateway inherit those
settings. Gateway clients use the separate gateway credential. See the
[install guide](../install.md#2-connect-the-coding-agent) for the environment and live probes.
Offline discovery uses the gateway's `SPUR_MCP_NAMESPACE` when set, otherwise each project's plugin
manifest. Use distinct manifests for multi-project discovery. A separately launched project must
use the same namespace setting as the gateway would use to discover it.

### 4.2 Request flow

1. **Host guard** — reuse `allowedHostnames()` / `isAllowedHost()` / `rejectHost()`
   (`apps/server/src/middleware/host-guard.ts`) with `localhost`, `--host`, and
   `server.gateway.allowedHosts`; else 421.
2. **CSRF** — the same rule as the serve (`apps/server/src/middleware/pipeline.ts:68`, `hono/csrf`)
   evaluated against the public origin by **host**: the `Origin` must parse as `http(s)://` and its
   host must equal the (already allowlisted) request `Host`. Scheme is not compared because the tunnel
   terminates TLS — the browser sends `https://…` while the loopback listener's `req.url` is `http://…`.
   Same `/<prefix>/a2a/*` and `/<prefix>/mcp/*` exemptions (bearer-authenticated); refusal is 403 before any upstream contact.
3. `GET /` → gateway index (name, prefix, running) linking to `/<prefix>/board`, plus the
   server-rendered system-info popover (1442): the gateway MCP state and credential presence
   (variable NAME + set/unset), the same routing counters `/api/health` reports, each local
   project's gateway MCP namespace (`unassigned` when it claims none) and the display-safe discovery
   diagnostics (reason + remedy only). The project cards, namespaces and diagnostics share one
   registry read. Counters are sampled at render time from the current process (ADR-151).
   With MCP off the popover shows the off state and performs no discovery read. A discovery failure shows an explicit
   "Discovery unavailable" row and keeps the cards, counters and removal action usable.
   `GET /api/health`
   → `{ ok, gateway: true, port, projects: [{name, prefix, running}], counters }` (read by
   `spur self status` and its machine-scoped `gateway` section). `counters` is additive (1385):
   `{ since, requests, status4xx, status5xx, upstreamRestarts }`, counted in memory since handler
   creation at the response boundary — every final status including guard refusals and 502s, and
   `upstreamRestarts` keyed by prefix because registry names are not unique. A health read reports
   the count taken before its own increment; a restart resets every counter. `isGatewayAnswering`
   and `probeGatewayPort` read only `gateway`, so they are unaffected. Nothing is persisted: durable
   history stays in each project's event log (1384).
4. `/<prefix>` (no slash) → 308 to `/<prefix>/`. `/<prefix>/<rest>` → resolve the local entry by
   prefix; unknown → 404 naming the known prefixes.
5. **Ensure upstream** — `startRegisteredProject(...)` adopts the entry the *prefix* belongs to,
   keyed by normalized path **and host**, never path alone (`project-start.ts:362`; it already adopts
   live and owner-claimed serves). A second entry for the same path on another host must not supply
   the port for a local prefix — that mismatch is a real observed failure: remote `192.168.87.27:3003`
   adopted for `/knowledge-kit` while the local serve listened on 3007. Concurrent first requests
   share one in-flight promise per entry identity; the promise is dropped on settle so a later
   failure retries.
6. **Proxy** — dial the adopted port on **both loopback families**, `127.0.0.1` first and `::1` on a
   connection error, because a serve started outside the registry binds `localhost` → `::1` on
   macOS while a registry-spawned serve binds `127.0.0.1` (`project-start.ts:466`). Reachability
   follows the same both-families rule `isPortLive` already implements
   (`project-process.ts:226-238`). The gateway tries the last successful family first. A connection
   refusal tries the other family so a restarted project can change its listener.
   `fetch('<family>:<port>/<rest>?<query>', { method, headers, body,
   signal, redirect: 'manual', duplex: 'half' })` with:
   - `Host` set to `<family>:<port>`; `Origin` (when present) rewritten to
     `http://<family>:<port>` so the serve's own `csrf()` sees same-origin;
   - hop-by-hop headers stripped (`connection`, `keep-alive`, `transfer-encoding`, `upgrade`,
     `proxy-*`, `te`, `trailer`);
   - the serve runs `compress()` (`pipeline.ts:85`) and Bun `fetch` decodes the body, so the
     response drops `content-encoding` and `content-length` (forwarding them corrupts the body);
   - response bodies streamed (SSE passes incrementally; client abort aborts the upstream fetch via
     `req.signal`). No WebSocket exists in `apps/server` or `apps/web`, so none is proxied.
7. **Response adaptation**
   - `Location` starting with `/` (not `//`) → prefixed.
   - `content-type: text/html` → body read as text and rebased (§5.1), `content-length` dropped.
   - `site.webmanifest` → `start_url`, `scope` and icon `src` prefixed.
   - everything else streams untouched.
8. Upstream connection refused on **both** families after adoption → one fresh
   `startRegisteredProject` attempt, then 502 naming the project, every dialed `family:port` and its
   log path. A down upstream must stay distinguishable from a cross-entry mix-up: the message names
   the entry identity (name + host) that owned the prefix.

The gateway owns no project database, fleet or scheduler; it holds only the registry read path and
the start path, and never writes `port` except through `startRegisteredProject`.

### 4.3 Structured gateway events (task 1384, feature K42)

The handler takes `GatewayDeps.onEvent?: (event) => void` and emits one event per occurrence;
the handler itself stays IO-free (ADR-151). `apps/cli/src/commands/serve.ts` composes
`createJsonlEventSink` (`packages/app/src/services/gateway-event-log.ts`) as the sink, writing
JSONL to `~/Library/Logs/spur/gateway.events.jsonl` on darwin (next to the launchd logs) and
`~/.config/spur/logs/gateway.events.jsonl` elsewhere. Cap 5 MiB (`GATEWAY_EVENT_LOG_MAX_BYTES`);
when the next line would cross the cap the active file rotates to `<path>.1`, overwriting the
earlier `.1`. Sink failures report once on stderr ("event log write failed") and then drop
further writes — the event log never fails a gateway request. Writes are serialized per sink so
the stat→rotate→append chain cannot starve rotation.

| `kind` | When | Extra fields |
| --- | --- | --- |
| `upstream.ensure` | Start of upstream for a routed prefix (the request-level `ensureUpstream` wrapper only — the retry's own start belongs to the restart occurrence) | `outcome` `ok`/`failed`, `ms`, `name`, `prefix`, `reason` (failed) |
| `upstream.restart` | Adopted port died between adoption and request; one fresh start is attempted | `name`, `prefix` |
| `proxy.unreachable` | 502: dial refused on both families after ensure + retry | `name`, `dialed`, `reason` |
| `route.collision` | 409: two project entries share the routed prefix | `prefix`, `names` |
| `guard.host` | 421 host-guard refusal, before any upstream contact | `path`, `status` |
| `guard.csrf` | 403 cross-origin refusal, before any upstream contact | `path`, `status` |

Every event carries `ts` (ISO-8601). Request data is limited to the URL **pathname** — the event
log never records request headers, query strings or bodies, so credentials and secrets cannot
leak into a diagnostic file.

## 5. Board base path (critical path)

Verified on Astro 6.4.2 / Vite 7.3.7 / react-router 7.11.0 against `dist/web` (2026-11-16).

### 5.1 Static assets — build config + gateway HTML rebasing

- **JS chunks** import each other relatively (`from"./x.js"`) except Vite's preload helper
  (`function(e){return"/"+e}`), which would 404 lazy-chunk CSS/modulepreload under a prefix.
  **Landed as designed (1358):** the shipped build emits `"./chunk.js"` references and no absolute
  preload helper (`rg 'return"/"\+' dist/web/_astro` is empty), so the `cssCodeSplit:false` +
  `modulePreload:false` fallback was not needed.
  Fix in `apps/web/astro.config.mjs` `vite`:
  `experimental: { renderBuiltUrl(f, { hostType }) { return hostType === 'html' ? undefined : { relative: true }; } }`.
  Spike: build exit 0, absolute helper gone, preloads resolve via `new URL(dep, import.meta.url)`;
  same 76-file chunk set. Astro only sets its own `renderBuiltUrl` when `build.assetsPrefix` is set
  (`astro/dist/core/create-vite.js:237-246`), so the user value applies. Fallback if it regresses:
  `build.cssCodeSplit: false` + `build.modulePreload: false`.
- **HTML** keeps root-absolute URLs (favicon/manifest links, `/_astro/*.css`, the import map from
  `apps/web/scripts/board-runtime.ts:172`, astro-island `component-url`/`renderer-url`). The gateway
  rewrites, in `text/html` only: attribute values `="/` and `='/` (not `//`) → `="/<prefix>/`, and
  string values starting with `"/` inside `<script type="importmap">` JSON; then injects
  `<meta name="spur-base" content="/<prefix>/">` after `<head>`. This covers both the static
  `index.html` and the SPA `notFound` fallback (`apps/server/src/bootstrap.ts:66-102`) that serves deep
  links. Direct per-port access has no meta → base `/`.

### 5.2 Runtime base — `apps/web/src/components/base-path.ts` (re-exported from `src/lib/base-path.ts`)

The implementation lives under `src/components` because the module-kit barrel publishes it and
`emit-board-types` only mirrors declarations inside that root; `src/lib/base-path.ts` re-exports it
for application imports (1358).

```ts
export function basePath(): string;          // meta[name=spur-base] content, normalized to '/…/'; '/' when absent
export function withBase(path: string): string; // '/x' → base + 'x'; absolute URLs, '//', and non-'/' paths unchanged
```

| Site | Change |
| --- | --- |
| `apps/web/src/lib/rpc-client.ts:34` `resolveApiUrl` | `new URL(withBase('/api'), origin)`; every `EventSource` already uses it |
| `apps/web/src/router.tsx:106` | `createBrowserRouter(routes, { basename: basePath().replace(/\/$/, '') \|\| '/' })` |
| `FeatureDetail.tsx:486` `window.location.assign` | `navigate('/board/tasks/…')` |
| `search/index.tsx:34,36,128`, `TaskRunEvidenceLink.tsx:8` | router `Link` / `withBase` |
| `MarkdownBody.tsx` | `a` override rebasing hrefs starting with `/` (not `//`) |
| module entry/style URLs (`board-catalog-service.ts:275` `/modules/<id>/…`, loaded in `compose.ts:61`) | `withBase()` client-side; server unchanged (gateway strips prefix) |
| module kit (`components/module-kit/index.ts`, `exports.ts` `MODULE_KIT_EXPORTS`) | export `basePath`, `withBase`, `resolveApiUrl`; `BOARD_UI_KIT_VERSION` 1.0.0 → 1.1.0 |

Dev mode (`astro dev` + Hono dev server) and memory-router tests have no meta → base `/`, unchanged.

### 5.3 Proof

A heavy browser E2E (CDP helper `apps/web/tests/test-helpers/cdp.ts`, build from
`board-build.ts`) opens the same build under `/<prefix>/` via the gateway and at `/` on the
per-project port, visits Board routes, a lazy route, a module asset and an SSE stream, and asserts
zero requests to origin-root paths. The network log is the artifact.

## 6. Board risk register

| # | Sev | Risk | Fix | Task |
| --- | --- | --- | --- | --- |
| B1 | P1 | Built HTML is root-absolute (links, import map, island URLs) | Gateway HTML rebasing + `spur-base` meta, static and SPA fallback (§5.1) | 1360 |
| B2 | P1 | Vite preload helper `"/"+e` breaks lazy routes (`vite:preloadError`) | `renderBuiltUrl` relative (§5.1), spike-verified | 1358 |
| B3 | P1 | API client builds `/api` from origin root | `withBase('/api')` in `resolveApiUrl` | 1358 |
| B4 | P1 | Router has no basename | `basename` from `basePath()` | 1358 |
| B5 | P2 | Raw navigation bypasses router (`location.assign`, `<a href="/board…">`) | `navigate` / `Link` / `withBase` | 1358 |
| B6 | P2 | Markdown links `/board/...` in task/feature bodies escape the prefix | `MarkdownBody` `a` override | 1358 |
| B7 | P2 | Downstream module entry/style `/modules/<id>/…` | `withBase()` at load | 1358 |
| B8 | P2 | Third-party native modules hard-code `fetch('/api/…')` | Module-kit exports + kit 1.1.0 + docs (`downstream-board-modules.md`, `board-module-ui-kit.md`) | 1358 |
| B9 | P1 | One origin ⇒ `localStorage` shared: drafts (`spur.board.projects.draft.v1`), layout (`spur-board-layout-v3`), `spur:detail-width`, `spur:new-task-panel-width`, `spur:database:columns:v1:*` leak across projects | `scopedKey(k)` = `k` at base `/`, `${k}@${basePath()}` otherwise; `spur-theme` stays global | 1361 |
| B10 | P1 | HTTP/1.1 caps 6 connections per origin; each tab opens ≥2 EventSources (`GlobalAgentBar.tsx:318` + shared planning stream; `InboxView.tsx:20`, `SystemEventsTab.tsx:116` open their own) ⇒ 3+ local tabs stall | Route those through `subscribePlanningEvents` (`planning-events.ts:64`) ⇒ 1 stream/tab + open terminals; document the local ceiling (tunnel h2 multiplexes) | 1361 |
| B11 | P3 | `site.webmanifest` `start_url: "/"` and icon paths | Gateway manifest rebasing (§4.2 step 7) | 1360 |
| B12 | P3 | Serve redirects `/` → `/api/health` when no web dist | Gateway `Location` rebasing | 1360 |
| B13 | P2 | Switcher builds `http://host:port/board` (`ProjectSwitcher.tsx:39,293,311`) | Local → `/<prefix>/board` when `basePath() !== '/'`; `/api/projects` adds `prefix`, `url` | 1361 |
| B14 | P3 | Same origin ⇒ one project's module JS can call another's `/<p>/api` | Accepted: local operator trust; access control at the CF tunnel (ADR-151) | — |
| B15 | — | Dev mode and memory-router tests | Unaffected (base `/`) | — |
| B16 | P1 | No end-to-end proof of zero root escapes | Heavy browser E2E with network log (§5.3): `apps/web/tests/board-base-path.heavy.test.ts` asserts every request carries the prefix | 1358 |

**Shipped deviations (2026-11-17).** Everything in the register landed on its owning task. Three
details moved during implementation:

- B10's two-tab browser proof was replaced by deterministic checks: per-base `scopedKey` isolation
  tests plus a static guard that only `lib/planning-events.ts` opens a planning `EventSource`
  (driving a real draft needs a live API the browser fixture does not serve).
- Gateway health probes target `localhost`, not `127.0.0.1`: the gateway binds `server.host`
  (`localhost` → `::1` on macOS), and an IPv4-only probe reported a healthy daemon as down — found by
  the manual launchd proof in 1362.
- The 3000-band free-port probe is IPv4-only, so it can hand a serve a port another process holds on
  `::1` only; the spawn then fails through the owner-claim refusal and `spur projects start` reports
  the daemon log. Left as-is (pre-existing `allocatePort` behavior, outside K4's scope).

## 7. LaunchAgent lifecycle

Requirement: the gateway is always on. Surface: `spur self install --daemon`, `spur self uninstall`, `spur self status`
(macOS only; other platforms exit 1 naming the platform).

- Label `ai.gobing.spur.gateway`; plist `~/Library/LaunchAgents/ai.gobing.spur.gateway.plist`.
- `ProgramArguments`: absolute resolved spur executable (`resolveSpurArgv()`) +
  `self serve --gateway --port <n> --no-open`.
- `EnvironmentVariables.PATH` captured from the installing shell (agent CLIs must resolve under
  launchd's minimal PATH).
- `RunAtLoad: true`, `KeepAlive: true`, `ThrottleInterval: 10`, `StandardOutPath` /
  `StandardErrorPath` = `~/Library/Logs/spur/gateway.{out,err}.log`.
- **`AbandonProcessGroup: true`** — project serves spawned by the gateway survive a gateway restart
  (launchd otherwise kills the job's process group, terminating running agents); the restarted
  gateway re-adopts them through the registry. Stopping a project stays `spur projects stop`.
- install: fixed port held by a non-gateway listener → exit 1 naming the port, nothing written;
  render → atomic write → `launchctl bootstrap gui/<uid> <plist>`; loaded with identical bytes →
  `unchanged`; differing bytes → `bootout` then `bootstrap`; bootstrap failure → plist removed.
- uninstall: `launchctl bootout gui/<uid>/<label>` (absent is success) → remove plist.
- status: `launchctl print gui/<uid>/<label>` (loaded, pid, last exit) + `GET /api/health`.
- Verification: rendering and command construction through an injected `ProcessExecutor`; one manual
  `launchctl` proof recorded as task evidence (CI/sandbox cannot bootstrap launchd jobs).

## 8. Switcher and CLI

- `directBoardUrl()` (`ProjectSwitcher.tsx:39`): local → `/<prefix>/board` on the current origin when
  `basePath() !== '/'`, else today's per-port URL; remote → unchanged.
- `/api/projects` (`apps/server/src/modules/health/index.ts:428`) adds `prefix` (null for remote) and
  `url`; `spur projects list` shows `PREFIX` as its own field and `URL` (gateway URL for local
  entries when `server.gateway.port` answers, else per-port). A stopped entry prints the prefix
  route instead of an unroutable `http://localhost:0/board`.
- Misconfiguration is surfaced, never silent: `findPrefixCollisions()` already reports derived
  collisions in `spur projects list`; the Board renders the same finding (colliding prefix, both
  entry names, duplicate-path entries) from `/api/projects` so an operator sees why a route fails
  instead of reading a bare 502.
- CLI agent server resolution (`apps/cli/src/commands/agent/shared.ts:111`) keeps the internal
  loopback port — unchanged.

## 9. Module boundaries

| Concern | Owner |
| --- | --- |
| `prefix` schema, slug/reserved/unique validation | `packages/config/src/projects.ts` + `ProjectRegistry` |
| Gateway routing, start coalescing, proxy, HTML/Location rebasing | `packages/app/src/services/project-gateway.ts` (pure `Request → Response` handler); `apps/server` Bun listener; `apps/cli/src/commands/serve.ts` `--gateway` |
| Board `basePath()` / `withBase()` / `scopedKey()` | `apps/web/src/lib/base-path.ts` |
| LaunchAgent render/install/status | `packages/app/src/services/gateway-daemon.ts` over `ProcessExecutor`; `apps/cli/src/commands/self/daemon.ts` |

## 10. Registry hygiene

`spur projects clean` purges an entry only when its directory is gone
(`apps/cli/src/commands/projects.ts:116`). An ephemeral project root that still exists — a test
fixture under `/private/tmp` or a `TMPDIR` e2e folder — therefore survives every sweep and keeps
occupying a switcher row and a prefix.

The staleness surface reports instead of guessing:

- **Suspect classification, not deletion.** An entry is *suspect* when a local entry's path is
  ephemeral (`/tmp`, `/private/tmp`, `/var/folders`, `$TMPDIR`) or when its path is registered more
  than once (compared as a canonical real path, so `/private/var/...` and `/var/...` match). Both
  reasons are path facts — `findRegistrySuspects()` never treats a liveness artifact as staleness,
  and a remote entry is never judged by this machine's tmp roots. `spur projects clean` reports the
  class and the reason; nothing is removed implicitly.
- **Explicit removal only.** `--remove-suspects` removes exactly the flagged entries, one at a time,
  through `ProjectRegistry.remove` under the existing lock; every other entry keeps its prefix and
  port untouched.
- **Board parity.** The projects module shows the same suspect list from `/api/projects`, so the CLI
  and the Board never disagree about which rows are stale.
