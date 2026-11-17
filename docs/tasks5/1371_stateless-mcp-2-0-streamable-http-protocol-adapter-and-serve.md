---
schema_version: 1
name: Stateless MCP 2.0+ Streamable HTTP protocol adapter and server/discover
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.329Z
updated_at: "2026-11-17T19:03:08.530Z"
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

Build a focused protocol adapter in `apps/server/src/modules/mcp/protocol.ts` (or `@gobing-ai/spur-app`) targeting only the `2026-07-28`+ stateless spec with zero session store.

### Plan

- Implement `Mcp-Protocol-Version` validation rejecting `< 2026-07-28`.
- Implement `server/discover`, `tools/list`, `tools/call`, `resources/list`, `resources/read` dispatch.
- Add unit tests for valid 2026-07-28+ calls, SSE streaming responses, and legacy version rejection.

### Solution

#### Dependencies
- Depends on `1370` (config schema `server.mcp`).

#### Target Files
- `apps/server/src/modules/mcp/protocol.ts` (new) — Stateless MCP 2.0+ (`2026-07-28`+) Streamable HTTP adapter:
  - Validate `Mcp-Protocol-Version` (default/accept `2026-07-28` or newer; reject `< 2026-07-28` such as `2024-11-05`, `2025-03-26`, `2025-11-25` with a clear `400`/`426` JSON-RPC error).
  - Support `Mcp-Method` / `Mcp-Name` header hints and JSON-RPC body dispatch for `server/discover`, `tools/list`, `tools/call`, `resources/list`, `resources/read`.
  - Support both `application/json` and request-scoped `text/event-stream` (SSE) responses on `POST /mcp`, with zero `initialize` handshake and zero server-side session state.

#### Verification
- Unit tests in `apps/server/tests/modules/mcp-protocol.test.ts` covering `server/discover`, tool/resource dispatch, SSE streaming response, and rejection of legacy protocol versions.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

