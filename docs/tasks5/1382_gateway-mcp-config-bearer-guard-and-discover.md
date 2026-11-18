---
schema_version: 1
name: Gateway MCP config, bearer guard and discover
status: done
template: feature-impl
created_at: 2026-11-18T05:29:25.886Z
updated_at: "2026-11-18T22:35:55.511Z"
feature_id: K41
priority: P1
tags:
  - phase-1
  - protocol-surfaces
estimate_hours: 4.5

dependencies: ["1375", "1380"]
done_forced: "false"
done_reason: unforced close
---

## 1382. Gateway MCP config, bearer guard and discover

### Background

The one-port gateway (K4, ADR-151) routes `/<prefix>/*` to each local project's `spur serve`. Its handler is the app-layer `createGatewayHandler` (`packages/app/src/services/project-gateway.ts:335`), composed by `startGateway` (`apps/server/src/gateway.ts:30`) from `apps/cli/src/commands/serve.ts:76-115`. The gateway root has no MCP surface. A root `/mcp` with its own token lets one agent configuration reach every project without one credential silently fronting every project's token.

**Refine corrections (2026-11-17)**
- "Reuse the MCP protocol adapter in `apps/server/src/modules/mcp/protocol.ts`" from the gateway handler → the handler lives in `packages/app`, which must not import `apps/server` (ADR-021) → the gateway gets an optional `mcp` request handler injected through `GatewayDeps`, composed in `apps/server/src/gateway.ts`. The handler calls the adapter and the shared bearer guard there.
- "Add `server.gateway.mcp.*` to the config schema" → the `server.gateway` block (`packages/config/src/index.ts:1379-1384`) has no env mapping in `buildConfigFromEnv` (`:1441-1465`) → add `SPUR_GATEWAY_MCP_ENABLED` and `SPUR_GATEWAY_MCP_AUTH_ENV`, mirroring `SPUR_MCP_*`.
- A root `/mcp` collides with project routing: `mcp` is not in `RESERVED_PREFIX_SEGMENTS` (`packages/config/src/projects.ts:21`), so a project with prefix `/mcp` would shadow it → reserve `mcp`.
- `gatewayGuard` exempts only `/<prefix>/mcp` from CSRF (`project-gateway.ts:132-133`) → add the same exemption for the bearer-authenticated root `/mcp`.
- "server/discover returns … running state" → the stateless gateway has no cheap running-state source (`GatewayDeps` exposes no probe) → dropped. Discover reports namespace and diagnostics only.

### Requirements

- [x] R1. Add `server.gateway.mcp: { enabled: boolean (default false), authEnv?: string }` to the config schema, mapped from `SPUR_GATEWAY_MCP_ENABLED` / `SPUR_GATEWAY_MCP_AUTH_ENV`. `enabled` without `authEnv` fails load with the same message shape as `server.mcp`.
- [x] R2. When enabled, the gateway answers `POST /mcp` at the root through `bearerGuard` (1375) with realm `spur-gateway-mcp`: 401 for a missing or wrong token, 500 fail-closed when the variable is unset. When disabled, `/mcp` is a 404, never a proxy attempt.
- [x] R4. Add `mcp` to `RESERVED_PREFIX_SEGMENTS`, and exempt root `/mcp` from `gatewayGuard`'s CSRF check (the host allowlist still applies).
- [x] R3. `server/discover` at the root returns `projects` (local entries with `name`, `prefix` and resolved `namespace`, or null) and `diagnostics`. The diagnostics name each excluded remote entry with reason `remote-not-proxied (ADR-151)` and the remedy `run the project locally and spur projects add <path>`.

Out of scope: tool aggregation and call routing (1383), running-state reporting, remote proxying, and the env mapping for `server.gateway.port` / `allowedHosts` (a pre-existing gap; see the proposal).

### Acceptance Criteria

- [x] AC1 — Gateway MCP has its own bearer token (req: R1, R2, R4)
- [x] AC2 — Remote entries are excluded with a remedy (req: R3)

Test layer: a real gateway listener with fixture registry entries (no handler mocks).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:45:52.025Z

- **Where does the gateway MCP handler live?** Closed: it is composed in `apps/server` and injected into the app-layer handler.
- **Running state in discover?** Dropped: there is no stateless source. Revisit if K42's health counters (1385) expose it.
- **Per-project configured namespace at the gateway?** Closed: manifest only, because the gateway env is shared across projects.

### Design

**WHAT.**

```ts
// packages/app/src/services/project-gateway.ts
export interface GatewayDeps { …; mcp?: (req: Request) => Promise<Response> }
```

In the handler, a route branch before prefix matching sends `url.pathname === '/mcp'` to `deps.mcp(req)` when present and returns 404 otherwise. In `apps/server/src/gateway.ts`, when `server.gateway.mcp.enabled` is true, `startGateway` builds `deps.mcp`: `bearerGuard({ realm: 'spur-gateway-mcp', authEnv, env, … })`, then `handleMcpHttpRequest(req, gatewayRegistry)`. Here `gatewayRegistry` implements `McpHandlerRegistry`; this task supplies discover data and empty tool and resource lists, which 1383 fills. Namespaces come from `resolveMcpNamespace` (1380) with `configured: undefined`. The gateway's own env cannot describe N projects, so only the plugin manifest counts.

**WHY.** Injection keeps the app layer transport-free and lets the gateway reuse the exact server adapter and guard. Reserving `mcp` prevents a silent shadowing bug. A separate realm and variable keep the gateway credential from implying any project credential.

**WHERE.** `packages/config/src/index.ts`, `packages/config/src/projects.ts`, `packages/app/src/services/project-gateway.ts`, `apps/server/src/gateway.ts`, `apps/cli/src/commands/serve.ts` (pass the config through) and `docs/design/project-gateway.md`.

**Anti-patterns.** Don't import `apps/server` from `packages/app`. Don't reuse `server.mcp.authEnv` for the gateway. Don't start any project during discover.

**Handoff.** 1383 replaces the stub tool and call methods on `gatewayRegistry`. Discover's `projects` list is the routing table 1383 uses.

### Plan

- [ ] Step 1 (test first, R2/R3): in a gateway e2e built like `apps/server/tests/mcp-e2e.test.ts` (real `startGateway`), assert 401 + realm, 500 when unset, 404 when disabled, and discover listing a local fixture project with its namespace and a remote entry in diagnostics.
- [ ] Step 2 (R1): add the config schema, env mapping and a config load-failure test.
- [ ] Step 3 (R4): reserve `mcp`, with a `resolveProjectPrefix` test, and add the guard exemption, with a `gatewayGuard` test.
- [ ] Step 4 (R2/R3): add the injection seam, the composition in `startGateway` and the stub registry.
- [ ] Step 5: update `docs/design/project-gateway.md`, then run the focused tests in `packages/config`, `packages/app` and `apps/server`, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/self/serve.ts:112` |
| `apps/server/src/gateway.ts:1` |
| `apps/server/src/gateway.ts:25` |
| `apps/server/src/gateway.ts:40` |
| `apps/server/src/gateway.ts:60` |
| `apps/server/src/modules/mcp/protocol.ts:172` |
| `apps/server/src/modules/mcp/protocol.ts:180` |
| `apps/server/src/modules/mcp/protocol.ts:60` |
| `docs/design/project-gateway.md:67` |
| `packages/app/src/services/project-gateway.ts:169` |
| `packages/app/src/services/project-gateway.ts:29` |
| `packages/app/src/services/project-gateway.ts:626` |
| `packages/app/tests/services/project-gateway-edge.test.ts:256` |
| `packages/config/src/index.ts:1405` |
| `packages/config/src/index.ts:1416` |
| `packages/config/src/index.ts:1425` |
| `packages/config/src/index.ts:1437` |
| `packages/config/src/index.ts:1498` |
| `packages/config/src/index.ts:24` |
| `packages/config/src/projects.ts:21` |
| `packages/config/tests/config.test.ts:139` |
| `packages/config/tests/config.test.ts:21` |
| `packages/config/tests/config.test.ts:46` |
| `apps/server/tests/gateway-mcp.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `server.gateway.mcp: {enabled, authEnv?}` in the schema, mapped from `SPUR_GATEWAY_MCP_ENABLED` / `SPUR_GATEWAY_MCP_AUTH_ENV`; `enabled` without `authEnv` fails the load like `server.mcp` | MET | `packages/config/src/index.ts` schema (`gateway.mcp`, default off) + `superRefine` issue path `gateway.mcp.authEnv` + env mapping in `buildConfigFromEnv`; tests `packages/config/tests/config.test.ts` (off by default, env mapping, load failure message, and the gateway/project token variables stay distinct) |
| R2 — when enabled, root `POST /mcp` answers through `bearerGuard` (realm `spur-gateway-mcp`): 401 missing/wrong, 500 unset; disabled ⇒ 404, never a proxy | MET | `apps/server/src/gateway.ts` `withGatewayMcp` composes the guard + `handleMcpHttpRequest`; `packages/app/src/services/project-gateway.ts` matches `/mcp` **before** prefix routing and 404s without a handler. Tests `apps/server/tests/gateway-mcp.test.ts` over a real listener: 404 disabled, 401 with `spur-gateway-mcp` challenge, 401 wrong token, 500 `INTERNAL_ERROR` unset; `packages/app/tests/services/project-gateway-edge.test.ts` asserts `ensureUpstream` is never called for `/mcp` |
| R3 — `server/discover` at the root returns `projects` (local entries with `name`/`prefix`/resolved `namespace` or null) and `diagnostics` naming each excluded remote entry with `remote-not-proxied (ADR-151)` + the `spur projects add <path>` remedy | MET | `apps/server/src/modules/mcp/protocol.ts` — additive `discoverExtras()`; `apps/server/src/gateway.ts` builds `projects` via `resolveProjectPrefix` + `resolveMcpNamespace({configured: undefined})` (manifest only, per the closed Q&A) and `diagnostics` for non-local hosts. Test asserts `alpha` (manifest namespace), `beta` (null), `gamma` absent + diagnostic with reason and remedy |
| R4 — `mcp` in `RESERVED_PREFIX_SEGMENTS`; root `/mcp` exempt from `gatewayGuard`'s CSRF check, host allowlist intact | MET | `packages/config/src/projects.ts` reserved list; `packages/app/src/services/project-gateway.ts` guard exempts `segments[0] === 'mcp'` before the CSRF branch. Tests: the reserved-segment suite iterates the constant (so `mcp` is covered by construction) and `packages/app/tests/services/project-gateway-edge.test.ts` asserts a cross-origin POST to `/mcp` passes the CSRF check while an unlisted host still gets 421 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Gateway MCP has its own bearer token (R1, R2, R4) | MET | test | `apps/server/tests/gateway-mcp.test.ts` 5/5 (real `startGateway` listener) + `packages/config/tests/config.test.ts` + `packages/app/tests/services/project-gateway-edge.test.ts` 21/21 |
| AC2 — Remote entries are excluded with a remedy (R3) | MET | test | discover case above: `gamma` absent from `projects`, present in `diagnostics` with the reason and the remedy string |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T19:11:58.081Z todo → wip (system)
- 2026-11-18T19:13:55.598Z wip → testing (system)
- 2026-11-18T19:13:58.248Z testing → done (system)

