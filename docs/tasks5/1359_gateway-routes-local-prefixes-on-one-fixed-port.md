---
schema_version: 1
name: Gateway routes local prefixes on one fixed port
status: done
template: feature-impl
created_at: 2026-11-17T00:06:29.306Z
updated_at: "2026-11-17T01:23:24.567Z"
feature_id: K4
priority: P1
tags:
  - gateway
  - server
  - cli
estimate_hours: 10

dependencies: ["1357"]
done_forced: "false"
done_reason: unforced close
---

## 1359. Gateway routes local prefixes on one fixed port

### Background

Feature K4 (ADR-151, `docs/design/project-gateway.md` §4). One gateway process on one fixed port routes `/<prefix>/*` to each local project's own `spur serve` on its internal loopback port, lazily starting or adopting it through `startRegisteredProject`, and streams responses (SSE). Request/response *adaptation* (host guard, CSRF, Host/Origin rewrite, HTML/Location rebasing) is task 1360; this task ships routing, start coalescing, the raw proxy and the `spur self serve --gateway` transport. Covers R3, R4, R5.

### Requirements

- [x] R3. `spur self serve --gateway [--port] [--host]` listens on one fixed port (default `server.gateway.port` = 3000) and proxies `/<prefix>/<rest>` to `http://127.0.0.1:<port>/<rest>` for the matching local entry only; unknown prefix → 404 naming known prefixes; derived-collision prefixes → 409 naming the remedy; `/<prefix>` → 308 `/<prefix>/`; `GET /` index and `GET /api/health` answer at the gateway root.
- [x] R4. A stopped project is started once via `startRegisteredProject` even under concurrent first requests; a live or owner-claimed serve is adopted without a duplicate spawn; start failure → 502 naming the project and its log path; a refused connection after adoption triggers exactly one restart attempt.
- [x] R5. Response bodies stream unbuffered (SSE events arrive incrementally) and client abort aborts the upstream fetch.

### Acceptance Criteria

- [x] AC1 — Gateway routes each local prefix on one fixed port (req: R3)
- [x] AC2 — Gateway lazily starts or adopts a project serve (req: R4)
- [x] AC3 — Server-sent event streams pass through the gateway (req: R5)

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

| File | Lines | What / why |
| --- | --- | --- |
| `packages/app/src/services/project-gateway.ts` | new (1-250) | The gateway's pure request handler: `createGatewayHandler(deps)` routes `/<prefix>/*` to the matching local entry, coalesces concurrent first requests onto one `ensureUpstream`, proxies with the prefix stripped (hop-by-hop stripped, `Host`/`Origin` rewritten, `content-encoding`/`content-length` dropped because Bun's fetch already decoded the serve's `compress()`), streams the body, retries exactly once on a refused connection, and answers `/` (index), `/api/health`, 404 (unknown prefix naming the known ones), 409 (derived collision + remedy) and 308 (`/<prefix>` → `/<prefix>/`). |
| `apps/server/src/gateway.ts` | new (1-55) | `startGateway({port, host, deps})`: the only `Bun.serve` in the gateway, with `idleTimeout: 0` so idle SSE streams survive; `EADDRINUSE` becomes `Gateway port <n> is already in use by another process` (R10's wording, reused by 1362). |
| `apps/cli/src/commands/serve.ts` | 6, 49-50, 60, 66, 84-125 | `--gateway` on the existing `self serve` (the hidden `serve` alias shares the builder): composes registry + `startRegisteredProject` deps, defaults to `server.gateway.port`/`server.host`, `--json` stays a dry probe (`{port, url, gateway: true, running: false}`). Registry reads use `peek()` so routing never heals/purges/probes. |
| `packages/config/src/index.ts` | 1367-1380 | `server.gateway: { port (default 3000), allowedHosts (default []) }` — `allowedHosts` is consumed by task 1360. |
| `packages/app/src/services/project-registry.ts` | 456-480 | `allocatePort(preferredPort?, reserved)` skips reserved ports, so a project serve can never steal the gateway's fixed port. |
| `packages/app/src/services/project-start.ts` | 66-71, 451 | `ProjectStartOptions.reservedPorts` → `allocatePort`, threaded from the gateway composition. |
| `packages/app/src/index.ts`, `apps/server/src/index.ts` | exports | Gateway handler/deps/`startGateway` exposed to the CLI and to 1360/1362. |
| `packages/app/tests/services/project-gateway.test.ts` | new | Handler against real `Bun.serve` stubs: routing, 404 (incl. remote invisibility), 409 + 308, exactly-once start under 10 concurrent requests, 502 with log path, single-retry-then-502, incremental SSE + client-abort propagation, gzip decode, root index + health, `allocatePort` reserved skip. |
| `apps/cli/tests/commands/serve-gateway.test.ts` | new | `--gateway` dry probe and launcher composition (injected `startGateway`). |
| `apps/cli/tests/commands/serve-gateway.heavy.test.ts` | new | Process-level: real gateway + two real `spur serve` processes on one port; per-prefix routing, prefix stripping, and per-prefix 502 after an upstream dies while the other stays up. |

Deliberate split: lazy **start** coalescing is proven with an injected start function in the unit suite; the heavy E2E proves the adoption + routing half, because the 3000-band belongs to whatever the operator already serves on the machine (and `startRegisteredProject` adopts those).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R3 — `spur self serve --gateway` listens on one fixed port (default `server.gateway.port`), proxies `/<prefix>/<rest>` to that local entry's loopback serve with the prefix stripped, 404 names known prefixes, derived collision → 409 with remedy, `/<prefix>` → 308, `GET /` index and `GET /api/health` answer at the root | MET | `packages/app/src/services/project-gateway.ts:70-250`, `apps/server/src/gateway.ts:30-55`, `apps/cli/src/commands/serve.ts:84-125`, `packages/config/src/index.ts:1367-1380`; tests `packages/app/tests/services/project-gateway.test.ts` (routing, 404 incl. remote invisibility, 409+308, index+health), `apps/cli/tests/commands/serve-gateway.heavy.test.ts` (two real serves, one port, prefix stripped) |
| R4 — a stopped project starts once through `startRegisteredProject` even under concurrent first requests; a live/owner-claimed serve is adopted without a duplicate; start failure → 502 naming the project and its log path; a refused connection after adoption triggers exactly one restart attempt | MET | coalescing `project-gateway.ts:76-90`, adopt/start via `startRegisteredProject` in `apps/cli/src/commands/serve.ts:104-112`, 502 bodies `project-gateway.ts:120-130,167-200`; tests "starts a stopped project exactly once under concurrent first requests" (10 requests → 1 call), "502s with the project name and log path", "retries a refused connection exactly once after adoption, then 502s", heavy "only beta's prefix degrades" |
| R5 — response bodies stream unbuffered (SSE arrives incrementally) and a client abort aborts the upstream fetch | MET | `project-gateway.ts:139-152` (body streamed, `signal: req.signal`), `apps/server/src/gateway.ts:44-46` (`idleTimeout: 0`); test "streams SSE incrementally and aborts the upstream when the client aborts" (first event before close; upstream observes abort) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Gateway routes each local prefix on one fixed port (req: R3) | MET | test | `(cd packages/app && bun test tests/services/project-gateway.test.ts)` 10 pass; `(cd apps/cli && bun test tests/commands/serve-gateway.heavy.test.ts)` 1 pass (2.2 s: two serves on 388x/389x-style ports, one gateway port); probe `self serve --gateway --port 3961 --json` → `{port, url, gateway:true, running:false}`; live `/api/health` listed `[{alpha,/alpha,false},{beta,/beta,false}]`, `/nope/board` → 404 naming `/alpha, /beta`, `/alpha` → 308 → `/alpha/` |
| AC2 — Gateway lazily starts or adopts a project serve (req: R4) | MET | test | exactly-once start under 10 concurrent requests, 502 on start failure naming `<path>/.spur/run/serve-spawn.log`, single retry-then-502 on a refused adopted port, heavy adoption without a duplicate spawn |
| AC3 — Server-sent event streams pass through the gateway (req: R5) | MET | test | SSE test: first `data: alpha-1` event read from the gateway response while the upstream is still open; abort propagates to the upstream signal within 300 ms |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Req | Status | Evidence |
| --- | --- | --- |
| R3 | MET | `packages/app/src/services/project-gateway.ts:70-250`; `apps/server/src/gateway.ts:30-55`; `apps/cli/src/commands/serve.ts:84-125`; handler suite 10 pass; heavy E2E proves two serves on one port |
| R4 | MET | coalescing `project-gateway.ts:78-90`; adopt/start `apps/cli/src/commands/serve.ts:104-112`; 502 naming project + `.spur/run/serve-spawn.log`; unit: exactly-once start, single retry then 502 |
| R5 | MET | `project-gateway.ts:139-152` streams `upstream.body` with `signal: req.signal`; `apps/server/src/gateway.ts:44-46` `idleTimeout: 0`; SSE + abort test |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test + command | `(cd packages/app && bun test tests/services/project-gateway.test.ts)` 10 pass; heavy `serve-gateway.heavy.test.ts` 1 pass; live probe: health lists prefixes, `/nope/board` 404, `/alpha` 308 |
| AC2 | MET | test | 10 concurrent first requests → one `ensureUpstream`; start failure 502 names project + log path; refused adopted port → exactly one retry then 502 |
| AC3 | MET | test | first SSE event read before upstream close; client abort reaches the upstream signal |

Findings: no open P1–P3. P4: in-flight cache keys on the raw `entry.path` from `peek()`; `running` reflects the registry claim rather than a live probe.
Rejected defect fixed in review: a retried non-GET request would resend an already-consumed body, so it now fails closed (502) instead of restarting.

Residual risk: client headers (incl. `authorization`) are forwarded to loopback — local-operator trust; 1360 owns host guard/CSRF. No WebSocket proxying.

**Disposition: PASS.**

### References

- Feature K4 R3–R5; ADR-151; `docs/design/project-gateway.md` §4.
- `packages/app/src/services/project-start.ts:362` (`startRegisteredProject`, adopt + owner-claim path at ~431), `project-registry.ts:400`, `packages/config/src/index.ts:1346`, `apps/cli/src/commands/serve.ts:52`, `apps/server/src/serve.ts:1258-1262` (Bun.serve + host guard pattern).
- Depends on 1357 (prefix resolution). Consumed by 1360, 1361, 1362.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)
- 2026-11-17T01:17:27.440Z todo → wip (system)
- 2026-11-17T01:23:23.190Z wip → testing (system)
- 2026-11-17T01:23:24.563Z testing → done (system)

