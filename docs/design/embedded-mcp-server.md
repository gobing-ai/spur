---
kind: design
title: "Embedded MCP 2.0+ server in spur serve"
status: accepted
created_at: 2026-11-17
updated_at: 2026-11-17
related:
  - docs/features/B9_embedded-mcp-2-0-server-in-spur-serve.md
  - docs/design/configuration-contracts.md
  - docs/design/project-gateway.md
  - docs/design/cli-contracts.md
tags: [mcp, server, protocol, agent]
---

# Embedded MCP 2.0+ server in spur serve

Accepted under [ADR-152](../00_ADR.md#adr-152-spur-serve-embeds-a-stateless-mcp-20-server-that-delegates-to-spur-app-services).
Implemented by feature B9, tasks 1370–1374.

## 1. Boundary

`spur serve` exposes one agent-facing MCP endpoint: `POST /mcp`, mounted by `mcpModule`
(`apps/server/src/modules/mcp/`, registered in `apps/server/src/modules/registry.ts`) only when
`server.mcp.enabled` is true — off mounts no route at all, like the A2A listener. The adapter
(`apps/server/src/modules/mcp/protocol.ts`) is transport-only: it parses and serializes, then
dispatches over an injected handler registry that `mcpModule` backs with `@gobing-ai/spur-app`
services. Stdio-only clients connect through the `spur mcp` CLI bridge
(`apps/cli/src/commands/mcp.ts`), which is also transport-only.

## 2. Config

| Key | Env var | Default |
| --- | --- | --- |
| `server.mcp.enabled` | `SPUR_MCP_ENABLED` | `false` |
| `server.mcp.authEnv` | `SPUR_MCP_AUTH_ENV` | — (NAME of the variable holding the bearer token; required when `enabled` is true — enabling without it fails the config load; the value is read at request time, never stored) |

Mirrors `server.a2a` end to end (`packages/config/src/index.ts` schema + `superRefine`;
`ServerBootConfig.mcp` in `apps/server/src/server-config.ts`).

## 3. Protocol contract (stateless MCP 2.0+ only)

- **Version floor.** `Mcp-Protocol-Version` must be a `YYYY-MM-DD` value ≥ `2026-07-28`
  (`MIN_MCP_PROTOCOL_VERSION`). Missing, malformed, or older → `400 PROTOCOL_VERSION_UNSUPPORTED`
  (checked before body parse). Legacy versions (`2024-11-05`, `2025-03-26`, `2025-11-25`) are
  rejected, never negotiated.
- **Stateless transport.** Every request is a self-contained `POST /mcp`. Non-POST →
  `405 STATEFUL_TRANSPORT_UNSUPPORTED` with `Allow: POST`; an `Mcp-Session-Id` header → `400`.
  No session store, no persistent SSE; responses are `application/json`, or one request-scoped
  `text/event-stream` frame when the request's `Accept` asks for it.
- **Method/target addressing.** Method comes from the `Mcp-Method` header or a JSON-RPC 2.0 body
  `method`; target name from `Mcp-Name` (or `params.name` / `params.uri`). Supported methods:
  `server/discover` (negotiated version + capability surface), `tools/list`, `tools/call`,
  `resources/list`, `resources/read`.
- **Auth.** `Authorization: Bearer <token>` where `<token>` is the current value of the environment
  variable `server.mcp.authEnv` names. Missing/wrong → `401` with
  `WWW-Authenticate: Bearer realm="spur-mcp"`; unset token variable at request time fails closed
  (`500`, no challenge).

## 4. Tools and resources

Five tools delegate directly to `@gobing-ai/spur-app` services (no CLI spawn, no second workflow
state machine): `task_show`, `task_list` (`TaskService`), `workflow_status`, `workflow_run`,
`workflow_continue` (`WorkflowService`). Three read-only `spur://` resources:
`spur://tasks/{wbs}`, `spur://features/{id}`, `spur://context/{name}` — single-path-segment
confinement: traversal is refused, an unknown feature id is an error (not empty), an unknown scheme
is refused.

## 5. `spur mcp` stdio bridge

`spur mcp [--cwd <path>] [--url <mcpUrl>]` reads NDJSON from stdin, forwards one `POST` per
non-blank line to the resolved URL, and echoes each JSON response line to stdout (no banner).
Headers always include `Mcp-Protocol-Version: 2026-07-28` and `Content-Type: application/json`;
`Authorization: Bearer` is attached only when the `server.mcp.authEnv` variable is set — unset is a
loud `CommandError`, never a silent unauthenticated call. URL resolution order: `--url` → the
project's gateway prefix (`http://127.0.0.1:<gateway.port><prefix>/mcp`, when the registry entry is
local and the gateway answers) → the registry entry's live port → `server.port`. Config parity with
`spur serve` through the `@gobing-ai/spur-config` env funnel.

## 6. Gateway interaction

`gatewayGuard` exempts `/<prefix>/mcp` from browser-origin CSRF checks alongside `/<prefix>/a2a` —
bearer-authenticated routes a cross-site simple request cannot produce. The host allowlist
(`isAllowedHost` → 421) still runs first for every path including `/mcp`; the exemption never
bypasses it.

## 7. Invariants

- `mcpModule` mounts only on `server.mcp.enabled === true`; default-off.
- Enabled without `authEnv` fails the config load — an enabled endpoint with no token can only
  reject everyone.
- Tool/resource execution delegates to `@gobing-ai/spur-app`; neither the adapter nor the bridge
  spawns the CLI or duplicates the workflow FSM.
- Legacy protocol versions and stateful transports are rejected explicitly, never negotiated.
- `spur mcp` stays a stdio↔HTTP shim: protocol logic lives only in the server adapter
  (`MCP_PROTOCOL_VERSION` in the bridge mirrors `MIN_MCP_PROTOCOL_VERSION`).

## 8. Proof

End-to-end integration tests through the gateway handler: `apps/server/tests/mcp-e2e.test.ts`
(discover, tools/call, resources/read, bearer 401 + challenge, legacy-version rejection, stdio
bridge round-trip). Module and adapter units: `apps/server/tests/modules/mcp-module.test.ts`,
`apps/server/tests/modules/mcp/protocol.test.ts`; bridge units:
`apps/cli/tests/commands/mcp.test.ts`; config and gateway units:
`packages/config/tests/config.test.ts`, `packages/app/tests/services/project-gateway-edge.test.ts`.
