---
schema_version: 1
name: Gateway routes local prefixes on one fixed port
status: todo
template: feature-impl
created_at: 2026-11-17T00:06:29.306Z
updated_at: "2026-11-17T00:29:10.874Z"
feature_id: K4
priority: P1
tags:
  - gateway
  - server
  - cli
estimate_hours: 10

dependencies: ["1357"]
---

## 1359. Gateway routes local prefixes on one fixed port

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §4). One gateway process on one fixed port routes `/<prefix>/*` to each local project's own `spur serve` on its internal loopback port, lazily starting or adopting it through `startRegisteredProject`, and streams responses (SSE). Request/response *adaptation* (host guard, CSRF, Host/Origin rewrite, HTML/Location rebasing) is task 1360; this task ships routing, start coalescing, the raw proxy and the `spur self serve --gateway` transport. Covers R3, R4, R5.

### Requirements

- [ ] R3. `spur self serve --gateway [--port] [--host]` listens on one fixed port (default `server.gateway.port` = 3000) and proxies `/<prefix>/<rest>` to `http://127.0.0.1:<port>/<rest>` for the matching local entry only; unknown prefix → 404 naming known prefixes; derived-collision prefixes → 409 naming the remedy; `/<prefix>` → 308 `/<prefix>/`; `GET /` index and `GET /api/health` answer at the gateway root.
- [ ] R4. A stopped project is started once via `startRegisteredProject` even under concurrent first requests; a live or owner-claimed serve is adopted without a duplicate spawn; start failure → 502 naming the project and its log path; a refused connection after adoption triggers exactly one restart attempt.
- [ ] R5. Response bodies stream unbuffered (SSE events arrive incrementally) and client abort aborts the upstream fetch.

### Acceptance Criteria

- [ ] AC1 — Gateway routes each local prefix on one fixed port (req: R3)
- [ ] AC2 — Gateway lazily starts or adopts a project serve (req: R4)
- [ ] AC3 — Server-sent event streams pass through the gateway (req: R5)

Verification: E2E `packages/app/tests/services/project-gateway.test.ts` against two real `Bun.serve` stub upstreams (each answering `/api/health` with its own id and an SSE `/api/events` emitting one event per 50 ms) and an injected start function; plus a process-level heavy E2E `apps/cli/tests/commands/serve-gateway.heavy.test.ts` that runs `spur self serve --gateway --port <free>` with `SPUR_PROJECTS_FILE` pointing at two temp local projects and asserts `/<a>/api/health` and `/<b>/api/health` reach different serves. Artifact: JSON transcript of requests/responses and SSE event timestamps (first event < 1 s after open, before stream end).

### Q&A

- Surface (pending operator consent, recorded in ADR-151): a `--gateway` flag on the existing `spur self serve`, not a new `projects gateway` verb. The legacy hidden top-level `spur serve` alias gets the flag for free (same builder).
- The gateway does not run `startServer` (no DB, no fleet, no scheduler). It is a separate `Bun.serve` whose `fetch` is the pure handler.
- Port config lives in the existing `server` config section (`server.gateway.port`, `server.gateway.allowedHosts`); `allowedHosts` is consumed by 1360.
- `allocatePort()` must skip the gateway port so a project serve never steals it while the gateway is down.

### Design

Files and signatures:

- `packages/config/src/index.ts:1346` `server`: add `gateway: z.object({ port: z.coerce.number().int().positive().default(3000), allowedHosts: z.array(z.string().min(1)).default([]) }).default({ port: 3000, allowedHosts: [] })` and the same in the outer `.default({...})`.
- `packages/app/src/services/project-registry.ts:400` `allocatePort(preferredPort?, reserved: ReadonlySet<number> = new Set())`: skip `reserved`; `startRegisteredProject` passes `new Set([gatewayPort])` via a new optional `ProjectStartOptions.reservedPorts`.
- New `packages/app/src/services/project-gateway.ts` (pure, no Bun.serve):

```ts
export interface GatewayDeps {
    listProjects(): Promise<ProjectEntry[]>;                       // ProjectRegistry.list
    ensureUpstream(entry: ProjectEntry): Promise<number>;           // wraps startRegisteredProject → port
    fetchUpstream?: typeof fetch;                                   // test seam
    port: number;                                                   // gateway port (index/health)
}
export function createGatewayHandler(deps: GatewayDeps): (req: Request) => Promise<Response>;
```

  - Routing: split first path segment; `''` → index HTML; `api` + `/api/health` → JSON `{ ok: true, gateway: true, port, projects: [{ name, prefix, running }] }`; else match `resolveProjectPrefix` (1357) over **local** entries; `findPrefixCollisions` members → 409 `Prefix /x is claimed by "a" and "b"; set one with spur projects add <path> --prefix /<other>`.
  - Start coalescing: `Map<normalizedPath, Promise<number>>`; delete on settle (success or failure) so later requests re-probe.
  - Proxy: `fetchUpstream(new URL(rest + search, `http://127.0.0.1:${port}`), { method, headers, body: req.body, signal: req.signal, redirect: 'manual', duplex: 'half' })`; strip hop-by-hop request headers; response: drop hop-by-hop, `content-encoding` and `content-length` (Bun fetch decodes the serve's `compress()` output), return `new Response(upstream.body, { status, headers })` — no buffering.
  - Errors: `ECONNREFUSED` after adopt → drop cache entry, one `ensureUpstream` retry, then 502 text naming project + `<path>/.spur/logs` daemon log; start throw → 502 with the thrown message.
  - Hook point for 1360: `createGatewayHandler` composes `guard(req) → route → proxy → adapt(response, prefix)`; this task ships identity `guard`/`adapt`.
- `apps/server/src/gateway.ts`: `export async function startGateway({ port, host, deps }): Promise<{ stop(): void; url: string }>` — `Bun.serve({ port, hostname: host, idleTimeout: 0, fetch: handler })` (`idleTimeout: 0` so idle SSE is not cut). Bind failure `EADDRINUSE` → throw `Gateway port <n> is already in use by another process` (R10 depends on this message).
- `apps/cli/src/commands/serve.ts:61`: `.option('--gateway', 'Run the one-port project gateway instead of a project server')`; when set, ignore `--cwd`, build deps from `new ProjectRegistry()` + `startRegisteredProject(registry, entry.path, { reservedPorts })`, default port `config.server.gateway.port`, host `config.server.host`; `--json` dry probe reports `{ port, url, gateway: true, running: false }`.

Invariants: gateway never writes the registry except through `startRegisteredProject`; remote entries are invisible to routing; no WebSocket proxying (none exists).
Rejected: `http-proxy`-style dependency (Bun fetch streams natively); running the gateway inside an existing project serve (couples lifetimes).

### Plan

1. Failure cases first (tests before code):
   - unknown prefix → 404 lists known prefixes; remote entry's name as prefix → 404.
   - derived collision → 409 with remedy; `/kk` → 308 `/kk/`.
   - 10 concurrent first requests to a stopped project → `ensureUpstream` called once.
   - start throws → 502 with message; adopted upstream dies → exactly one retry then 502.
   - SSE: first event received before upstream closes; client abort → upstream sees abort within 1 s.
   - upstream gzip response → body bytes intact, no `content-encoding` forwarded.
   - gateway port busy → `startGateway` throws naming the port.
   - `allocatePort` with reserved 3000 never returns 3000.
2. Config field → `allocatePort` reserved → `project-gateway.ts` → `apps/server/src/gateway.ts` → CLI flag.
3. Run `(cd packages/app && bun test tests/services/project-gateway.test.ts)`, `(cd packages/config && bun test)`, `(cd apps/cli && bun test tests/commands/serve*.test.ts)`, `bun run test:heavy`, `bun run spur-check`.
4. Record the transcript artifact in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature K4 R3–R5; ADR-151; `docs/design/project-gateway.md` §4.
- `packages/app/src/services/project-start.ts:362` (`startRegisteredProject`, adopt + owner-claim path at ~431), `project-registry.ts:400`, `packages/config/src/index.ts:1346`, `apps/cli/src/commands/serve.ts:52`, `apps/server/src/serve.ts:1258-1262` (Bun.serve + host guard pattern).
- Depends on 1357 (prefix resolution). Consumed by 1360, 1361, 1362.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)

