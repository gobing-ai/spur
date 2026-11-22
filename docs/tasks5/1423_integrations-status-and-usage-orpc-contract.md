---
schema_version: 1
name: Integrations status and usage oRPC contract
status: done
template: feature-impl
created_at: 2026-11-22T02:10:29.288Z
updated_at: "2026-11-22T07:14:54.896Z"
feature_id: A82
priority: P1
tags: ["integrations", "A82"]

dependencies: ["1421"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 1423. Integrations status and usage oRPC contract

### Background

Implements: R7 — The integrations status contract reports each surface without leaking tokens; R8 — The integrations status contract carries catalogs, members and gateway counters; R9 — Integrations activity reads protocol events from the event history ledger.

Design satellite: docs/design/integrations-module.md §2 and §2.1. Reuses I61 protocolUsageSummary (packages/domain/src/analytics/protocol-usage.ts) and the existing /api/events/history.

**Refine corrections (2026-11-21)**
- "/api/events/history accepts prefixes `mcp.`, `a2a.`, `auth.`" → the catalog prefixes are `mcp`, `a2a` and `auth`, with no dot (`SYSTEM_EVENT_PREFIXES`, `packages/app/src/services/event-names.ts:2157`; checked by evaluating the export). `prefix=mcp.` returns 400 `UNKNOWN_PREFIX` (`apps/server/src/modules/events/index.ts:367`). → R7 is a test-only lock on the dot-less prefixes; no events-module change. The satellite §2.1 is corrected.
- "IntegrationsService composes the MCP descriptor and workflow-tool resolver" → those live in `apps/server` (`TOOL_DESCRIPTORS` :31, `RESOURCE_DESCRIPTORS` :197 not exported, `listTools()` :235), and `packages/app` cannot import `apps/server`. → the service takes the catalog through a port that the server handler fills from the MCP module.
- "tokenPresent through the ts-utils env gateway" → the server already resolves bearer tokens with `bearerEnv(ctx)` plus `requiredToken` (`apps/server/src/middleware/bearer-guard.ts:38,82`), which wraps `getEnvVars()`. → the handler reuses that pair and hands the service a boolean. The token never crosses into `packages/app`.
- "gateway counters: Record<string, number>" → the gateway `/api/health` returns `counters: { since, requests, status4xx, status5xx, upstreamRestarts: Record<string, number> }` (`packages/app/src/services/project-gateway.ts:445,496`). → the DTO uses that typed shape.
- "loopback GET of /api/health" → the gateway listens on `server.gateway.port` (`packages/app/src/services/gateway-daemon.ts:25`; env `SPUR_GATEWAY_PORT`, `packages/config/src/index.ts:24`). Detection is by `x-forwarded-prefix`, the header the gateway sets (`project-gateway.ts:278`). → read `http://localhost:<server.gateway.port>/api/health`.
- No OpenAPI baseline is tracked under `config/`; Plan step 5's "if the repo tracks one" does not apply.

### Requirements

- [x] R1. `integrations.status` is always mounted, whether MCP or A2A is on or off: the contract is in `packages/contracts/src/integrations.ts`, the logic in `packages/app` `IntegrationsService`, and the handler in `apps/server/src/modules/integrations/`.
- [x] R2. For each surface it reports `enabled`, path/URL, the auth env **name** and `tokenPresent`. A serialized response never contains the token value.
- [x] R3. The MCP catalog (tools with `origin: 'built-in' | 'workflow'` plus `annotations` from 1421, and resource templates) comes from the same `listTools()` / resource list that `tools/list` and `resources/list` use.
- [x] R4. A2A inbound members (`member`, `role`, card URL, `writeFenced`) and outbound members (`kind: 'a2a' | 'project'`, `target`) are listed from the fleet declaration.
- [x] R5. Under the gateway (an `x-forwarded-prefix` request header is present) it reports `namespace`, `rootMcpUrl` and the gateway `counters`. A failed read gives `counters: null` plus a `diagnostic`, and the procedure still succeeds. Standalone it reports `served: false`.
- [x] R6. `integrations.usage { since }` returns `protocolUsageSummary(db, { since })` for the window.
- [x] R7. `/api/events/history?prefix=mcp|a2a|auth` returns 200 with only that family (a regression lock; no code change).

Out of scope: a new events endpoint, a new activity table, live SSE counters, per-client identity, and the Board UI (1424).

### Acceptance Criteria

- [x] AC1 — The integrations status contract reports each surface without leaking tokens
- [x] AC2 — The integrations status contract carries catalogs, members and gateway counters
- [x] AC3 — Integrations activity reads protocol events from the event history ledger

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:01:13.013Z

- **Closed: catalog port.** The server passes the catalog in, because the MCP descriptors are a server-module concern and moving them to `packages/app` is a refactor this feature does not need.
- **Closed: counters on failure.** `null` plus `diagnostic`, not `{}`, so the Board can tell "unreadable" from "zero".

### Design

- **Layering (ADR-021).**
  - `packages/contracts/src/integrations.ts` holds the DTOs and two procedures, `integrations.status` and `integrations.usage`, added to the root `contract` in `index.ts`.
  - `packages/app/src/services/integrations-service.ts` holds `IntegrationsService`, constructed with a port `IntegrationsSources { mcp(): Promise<{ enabled; tools; resources; protocolVersion; authEnv; tokenPresent }>; a2a(): Promise<{ enabled; authEnv; tokenPresent }>; gateway(): Promise<GatewayProbe> }` plus the fleet service and `getDb`. The service owns the assembly, the member projection and the usage summary.
  - `apps/server/src/modules/integrations/handlers.ts` uses `implement(contract)`, the pattern of `apps/server/src/modules/search/handlers.ts:6`. It fills the port from the MCP module (exports `RESOURCE_DESCRIPTORS` and a `listTools()` reachable from the context), the a2a settings, and `bearerEnv` + `requiredToken`. Register it in `apps/server/src/modules/registry.ts`, unconditionally.
- **DTO deltas from satellite §2:**
  - `gateway.counters` is `{ since: string; requests: number; status4xx: number; status5xx: number; upstreamRestarts: Record<string, number> } | null`, plus `diagnostic?: string`.
  - `mcp.tools[].annotations` is required, because 1421 makes every tool declare it.
- **Gateway probe:** `fetch('http://localhost:' + cfg.server.gateway.port + '/api/health', { signal: AbortSignal.timeout(2_000) })`. The DTO takes only `counters`. `namespace` = the forwarded prefix without a trailing `/`. `rootMcpUrl` = the `cardOrigin()` origin with the prefix stripped, plus `/mcp`.
- **Frozen names:** `integrations.status`, `integrations.usage`, `IntegrationsService`, `IntegrationsSources`, `IntegrationsStatus`, `IntegrationsUsage`.
- **Anti-patterns:** do not extend `/api/health`; do not import `apps/server` from `packages/app`; do not pass a token value into the service; do not add prefixes to the event catalog.
- **Depends on 1421:** `annotations` on `McpToolDescriptor` and the `role`/`purpose` fields on `memberAddresses`. **Leaves for 1424:** a typed oRPC client surface `integrations.status` and `integrations.usage`, plus events history with `prefix=mcp|a2a|auth`.

### Plan

- [ ] 1. Write failing tests first:
  - `packages/app/tests/services/integrations-service.test.ts`, with a fake `IntegrationsSources` and in-memory SQLite: MCP on with the token set; A2A off; served with counters; served with the probe failing (`counters: null`, diagnostic); standalone. Also usage over seeded `mcp.tool.called`, `a2a.message.received` and `auth.denied` rows.
  - `apps/server/tests/modules/integrations.test.ts`: the procedure is mounted with MCP and A2A off; a token-leak check serializes the response with a known token value set and asserts it is absent; `prefix=mcp`, `a2a` and `auth` each return 200 and `prefix=mcp.` returns 400.
- [ ] 2. (R1, R2) Add the DTOs and procedures in `packages/contracts/src/integrations.ts` and wire them into `contract`.
- [ ] 3. (R2–R6) Add `IntegrationsService` and export it from `packages/app/src/index.ts`.
- [ ] 4. (R1, R3, R5) Add the server module and handler. Export `RESOURCE_DESCRIPTORS` from the MCP module, and register the module in `registry.ts`.
- [ ] 5. Add `integrations` to the `docs/04_DESIGN.md` index row if the surface list names procedures. Then run `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `packages/contracts/src/integrations.ts` | DTOs + `integrationsContract` (`status`, `usage`) | The wire contract lives in contracts (ADR-021); no token field exists in any schema |
| `packages/contracts/src/index.ts:20,55,70` | wired into `contract` + re-exported | One root contract, one client surface |
| `packages/app/src/services/integrations-service.ts` | `IntegrationsService`, `IntegrationsSources`, `IntegrationsStatus/Usage` assembly | The logic half; the server owns the catalog, so it arrives through the port and never as an import |
| `packages/app/src/index.ts:487-497` | exported the service and its port types | Consumers import from the package facade, never a deep path |
| `apps/server/src/modules/mcp/index.ts:200,571-583` | `RESOURCE_DESCRIPTORS` exported; `readMcpCatalog()` added over the existing dispatcher | R3: the status catalog is the SAME `listTools()`/`listResources()` the protocol serves |
| `apps/server/src/modules/integrations/handlers.ts` | `createIntegrationsHandlers` — fills the port (mcp/a2a settings, `bearerEnv` + token presence, gateway probe), calls the service | Thin transport; the token value never enters `packages/app` |
| `apps/server/src/modules/integrations/index.ts` | `integrationsModule` (mount is a no-op; procedures route through the global router) | R1: registered unconditionally, so "off" is answerable |
| `apps/server/src/router.ts:9,47` | `integrations` handler subtree added | oRPC composition point |
| `apps/server/src/modules/registry.ts:11,46` | module registered unconditionally | Same as any other built-in |
| `apps/server/src/bootstrap.ts:41-45` | the inbound `Request` rides the oRPC context | The status read builds caller-visible URLs and reads the gateway's forwarded pair (R5); the transport previously passed no request |
| `packages/app/tests/services/integrations-service.test.ts` | surfaces on/off, catalog origin+annotations, members, token leak, gateway served/standalone/unreadable, usage window | Failing-first behaviour for R2–R6 |
| `apps/server/tests/modules/integrations.test.ts` | both surfaces off, token leak by raw body, gateway block over a real HTTP call, `prefix=mcp|a2a|auth` 200 and `mcp.` 400 | R1/R2/R5/R7 end to end |

Notes
- R7 needed no code: the catalog prefixes are already dot-less; the test is the regression lock the task asked for.
- `writeFenced` is an attestation of the member's RESOLVED executor, so it costs one `fleet.resolve()` and degrades to `false` when the declaration cannot resolve.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/server/tests/modules/integrations/handlers.test.ts:67 and :86 verify the route is mounted with both transports off. |
| R2 | MET | apps/server/tests/modules/integrations/handlers.test.ts:102 checks the serialized response against the configured token. |
| R3 | MET | apps/server/tests/modules/integrations/handlers.test.ts:118 compares the two catalogs. |
| R4 | MET | packages/app/tests/services/integrations-service.test.ts:145 covers fleet member projection. |
| R5 | MET | apps/server/tests/modules/integrations/handlers.test.ts:134 and :159 cover the successful and failed gateway health probe. apps/server/tests/modules/integrations/handlers.test.ts:67 covers standalone. |
| R6 | MET | packages/app/tests/services/integrations-service.test.ts:227 checks the time-bounded protocol ledger fold. |
| R7 | MET | apps/server/tests/modules/integrations/handlers.test.ts:185 tests the dotless catalog families and matching event rows. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R7 — The integrations status contract reports each surface without leaking tokens | MET | test | apps/server/tests/modules/integrations/handlers.test.ts:102 checks the serialized response against the configured token. |
| R8 — The integrations status contract carries catalogs, members and gateway counters | MET | test | apps/server/tests/modules/integrations/handlers.test.ts:118 and :134 plus packages/app/tests/services/integrations-service.test.ts:145 cover source catalog, gateway counters and fleet members. |
| R9 — Integrations activity reads protocol events from the event history ledger | PARTIAL | test | apps/server/tests/modules/integrations/handlers.test.ts:185 proves the Board's dotless query syntax. The test at :202 explicitly expects HTTP 400 for the feature's dotted syntax. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PARTIAL)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P2 | correctness | — | apps/server/tests/modules/integrations/handlers.test.ts:202 expects HTTP 400 for the dotted prefixes in feature R9. Board and task R7 use the dotless API. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)
- 2026-11-22T05:43:42.530Z todo → wip (system)
- 2026-11-22T05:44:06.865Z wip → testing (system)
- 2026-11-22T05:44:08.804Z testing → done (system)

