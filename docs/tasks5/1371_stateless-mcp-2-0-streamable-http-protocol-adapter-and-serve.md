---
schema_version: 1
name: Stateless MCP 2.0+ Streamable HTTP protocol adapter and server/discover
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.329Z
updated_at: "2026-11-17T19:09:12.695Z"
feature_id: B9
priority: P1
tags:
  - mcp
  - protocol
  - http
estimate_hours: 4

dependencies: ["1370"]
---

## 1371. Stateless MCP 2.0+ Streamable HTTP protocol adapter and server/discover

### Background

MCP 2.0+ (`2026-07-28`+) removes legacy `initialize` handshakes, sticky sessions, and dual-endpoint HTTP+SSE in favor of stateless Streamable HTTP over `POST /mcp`.

### Requirements

- [ ] R1. Implement stateless `POST /mcp` Streamable HTTP request parsing and response serialization (JSON or request-scoped SSE).
- [ ] R2. Support `server/discover` capability discovery and `Mcp-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers.
- [ ] R3. Explicitly reject legacy pre-2.0 protocol versions (`< 2026-07-28`) and unsupported stateful session/SSE handshake endpoints.

### Acceptance Criteria

- [ ] AC1 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions (req: R1, R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT / WHY / WHERE**
- Implement a stateless MCP 2.0+ (`2026-07-28`+) Streamable HTTP protocol adapter in `apps/server/src/modules/mcp/protocol.ts`, eliminating legacy `initialize` handshakes, sticky sessions, and dual-endpoint HTTP+SSE.

**Frozen Names**
- Minimum protocol version constant: `MIN_MCP_PROTOCOL_VERSION = '2026-07-28'`
- HTTP headers: `Mcp-Protocol-Version`, `Mcp-Method`, `Mcp-Name`
- Supported stateless methods: `server/discover`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
- Handler entry: `handleMcpHttpRequest(req, registry)` returning `Response` (`application/json` or request-scoped `text/event-stream`).

**Anti-patterns**
- Do NOT implement or accept legacy MCP protocol versions (`2024-11-05`, `2025-03-26`, `2025-11-25`).
- Do NOT require an `initialize` handshake, `Mcp-Session-Id` sticky session store, or dual-endpoint `GET /sse` + `POST /messages`.

**Dependencies & Handoff**
- Assumes from `1370`: `server.mcp` config gating and `/<prefix>/mcp` gateway routing.
- Leaves for `1372` and `1374`: `handleMcpHttpRequest()` and `McpDispatcher` interface that `mcpModule` mounts on `POST /mcp`.

### Plan

- Implement `Mcp-Protocol-Version` validation rejecting `< 2026-07-28`.
- Implement `server/discover`, `tools/list`, `tools/call`, `resources/list`, `resources/read` dispatch.
- Add unit tests for valid 2026-07-28+ calls, SSE streaming responses, and legacy version rejection.

### Solution

**Target Files**
- `apps/server/src/modules/mcp/protocol.ts` (new) — Stateless MCP 2.0+ (`2026-07-28`+) request parser, header validator, `server/discover` handler, and JSON / request-scoped SSE response serializer.

**Verification**
- Unit tests in `apps/server/tests/modules/mcp-protocol.test.ts` covering `server/discover`, `tools/*`, `resources/*`, request-scoped SSE streaming, and rejection of legacy pre-`2026-07-28` versions.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

