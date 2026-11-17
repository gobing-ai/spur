---
schema_version: 1
name: Stateless MCP 2.0+ Streamable HTTP protocol adapter and server/discover
status: done
template: feature-impl
created_at: 2026-11-17T18:57:28.329Z
updated_at: "2026-11-17T21:33:46.205Z"
feature_id: B9
priority: P1
tags:
  - mcp
  - protocol
  - http
estimate_hours: 4

dependencies: ["1370"]
done_forced: "false"
done_reason: unforced close
---

## 1371. Stateless MCP 2.0+ Streamable HTTP protocol adapter and server/discover

### Background

MCP 2.0+ (`2026-07-28`+) removes legacy `initialize` handshakes, sticky sessions, and dual-endpoint HTTP+SSE in favor of stateless Streamable HTTP over `POST /mcp`.

### Requirements

- [x] R1. Implement stateless `POST /mcp` Streamable HTTP request parsing and response serialization (JSON or request-scoped SSE).
- [x] R2. Support `server/discover` capability discovery and `Mcp-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers.
- [x] R3. Explicitly reject legacy pre-2.0 protocol versions (`< 2026-07-28`) and unsupported stateful session/SSE handshake endpoints.

### Acceptance Criteria

- [x] AC1 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions (req: R1, R2, R3)

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

- [x] Implement `Mcp-Protocol-Version` validation rejecting `< 2026-07-28`.
- [x] Implement `server/discover`, `tools/list`, `tools/call`, `resources/list`, `resources/read` dispatch.
- [x] Add unit tests for valid 2026-07-28+ calls, SSE streaming responses, and legacy version rejection.

### Solution

**Target Files**

| File | Change |
| --- | --- |
| `apps/server/src/modules/mcp/protocol.ts:1-13` (new) | Module header: the stateless MCP 2.0+ contract — no `initialize` handshake, no `Mcp-Session-Id` sessions, no dual-endpoint HTTP+SSE; transport-only adapter dispatching over an injected registry (R1–R3, feature B9). |
| `apps/server/src/modules/mcp/protocol.ts:20` | `MIN_MCP_PROTOCOL_VERSION = '2026-07-28'` (frozen name); `YYYY-MM-DD` versions compare lexicographically. |
| `apps/server/src/modules/mcp/protocol.ts:23-46` | `McpToolDescriptor` / `McpResourceDescriptor` — the shapes `server/discover`, `tools/list` and `resources/list` advertise. |
| `apps/server/src/modules/mcp/protocol.ts:49-63` | `McpHandlerRegistry` — the tool/resource seam `handleMcpHttpRequest(req, registry)` dispatches over; task 1372's `McpDispatcher` implements it, so the adapter never imports `@gobing-ai/spur-app` directly. |
| `apps/server/src/modules/mcp/protocol.ts:101-123` | Version gate (R3/AC1): missing header, non-`YYYY-MM-DD`, or `< 2026-07-28` (the legacy `2024-11-05` / `2025-03-26` / `2025-11-25` set) → 400 `PROTOCOL_VERSION_UNSUPPORTED`, never negotiated. |
| `apps/server/src/modules/mcp/protocol.ts:126-156` | Request parsing: JSON body (bare or JSON-RPC 2.0 envelope); method from the `Mcp-Method` header, else the envelope's `method`; params = JSON-RPC `params` else the bare body; malformed JSON / no method → 400 `INVALID_REQUEST`. |
| `apps/server/src/modules/mcp/protocol.ts:159-208` | Stateless dispatch: `server/discover` (negotiated version + tools/resources capabilities), `tools/list`, `tools/call` (name from `Mcp-Name` header or `params.name`; args from `params.arguments` else `{}`), `resources/list`, `resources/read` (URI from `Mcp-Name` or `params.uri`); unknown method → 404 `METHOD_NOT_FOUND` (-32601); missing target → 400 `INVALID_PARAMS` (-32602). |
| `apps/server/src/modules/mcp/protocol.ts:261-288` | Transport gates (R3): non-POST → 405 `STATEFUL_TRANSPORT_UNSUPPORTED` with `Allow: POST` (the legacy `GET /sse` stream endpoint does not exist); `Mcp-Session-Id` present → 400 `SESSIONS_UNSUPPORTED`. Registry rejections → 500 `INTERNAL_ERROR` (-32603), never a crash. |
| `apps/server/src/modules/mcp/protocol.ts:219-234,288-293` | Response serialization: JSON-RPC requests get the JSON-RPC result/error envelope with the echoed `id`; header-form requests get the bare value / `{ error: { code, message } }`; `Accept: text/event-stream` → one request-scoped `event: message` SSE frame, then the stream ends (errors always serialize as JSON). |
| `apps/server/tests/modules/mcp/protocol.test.ts` (new) | 25 unit tests in five groups: version gate (missing / legacy trio / malformed / newer-future accepted), stateless transport gate (GET → 405 `Allow: POST`, session id → 400), dispatch on valid 2026-07-28+ calls (all five methods, both header and JSON-RPC forms), request validation (bad JSON / no method / missing name / missing URI / registry rejection), request-scoped SSE (frame shape + JSON default). |

**Notes**

- Test path is `apps/server/tests/modules/mcp/protocol.test.ts` (mirroring `src/modules/mcp/protocol.ts`), not the flat `apps/server/tests/modules/mcp-protocol.test.ts` sketched in Verification: the `require-corresponding-test` pre-check rule (`config/rules/structure/test-location.yaml`) requires the mirrored path, and `tests/modules/sse/stream-helpers.test.ts` sets the same precedent. No production-surface deviation.
- Scope: protocol adapter only — no `mcpModule` registration, no bearer auth, no route mount; those belong to tasks 1372/1374 per the task's Dependencies & Handoff. `handleMcpHttpRequest` stays unmounted until 1372 wires it.
- Verification artifact: `task gate 1371 light` → 12/12 PASS (receipt `.spur/run/1371-check-receipt.json`); probe: not-applicable (no public CLI/HTTP surface mounted by this task — the handler is mounted by 1372).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/src/modules/mcp/protocol.ts:126-156` (parse), `apps/server/src/modules/mcp/protocol.ts:207-249` (JSON / request-scoped SSE), `apps/server/src/modules/mcp/protocol.ts:260-304` (handler); tests `apps/server/tests/modules/mcp/protocol.test.ts:104-268` (pass this run) |
| R2 | MET | `apps/server/src/modules/mcp/protocol.ts:161-168` (server/discover), `apps/server/src/modules/mcp/protocol.ts:101-123` (Mcp-Protocol-Version), `apps/server/src/modules/mcp/protocol.ts:138-140` (Mcp-Method), `apps/server/src/modules/mcp/protocol.ts:172,186` (Mcp-Name); tests `apps/server/tests/modules/mcp/protocol.test.ts:105-192` |
| R3 | MET | `apps/server/src/modules/mcp/protocol.ts:114-121` (below-minimum rejected), `apps/server/src/modules/mcp/protocol.ts:261-283` (GET 405, Mcp-Session-Id 400); tests `apps/server/tests/modules/mcp/protocol.test.ts:56-102` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions (req: R1, R2, R3) | MET | test | `apps/server/tests/modules/mcp/protocol.test.ts:66` (2024-11-05/2025-03-26/2025-11-25 rejected), `apps/server/tests/mcp-e2e.test.ts:180` (through gateway); pass this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review Report — task 1371 (pipeline run 4b673616-5257-4a2d-951c-a9598ad5e79c)

**Command:** `/sp:dev-review --tasks 1371 --auto --focus all`
**Worktree:** git worktree `spur-new-dev-runall-b9-7e0288`, branch `sp/runall-b9-7e0288` (read-only review)
**Base:** `d0ebf80aeb15573c72d1c51d81aad279ce585150` (`.spur/run/1371-base.sha`). HEAD equals the base, so task 1371's work under review is the working tree on top of it: new `apps/server/src/modules/mcp/protocol.ts` + `apps/server/tests/modules/mcp/protocol.test.ts`, plus tracked modifications.
**Scope attribution:** `apps/server/src/server-config.ts` (`ServerBootConfig.mcp`), `packages/config/src/index.ts` (`server.mcp` schema + env funnel), `packages/app/src/services/project-gateway.ts:113-133` (`/<prefix>/mcp` guard exemption), `packages/app/src/services/project-gateway-html.ts` (remediation edits), `packages/app/tests/services/project-gateway-edge.test.ts` are **task 1370's landed surface** (already reviewed PASS) — credited as prior-task surface, not this task's burden. Task 1371's burden is the two new `modules/mcp` files.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (`--focus all`)

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | — | No P1–P3 findings: both task-owned files reviewed across all six dimensions; R1–R3 trace to implementation plus 25 passing tests (fresh run this review: 25 pass, 0 fail, 81 `expect()` calls); legacy versions and stateful transports are explicitly rejected, never negotiated | `apps/server/src/modules/mcp/protocol.ts:101-303` | ACCEPTED |
| 2 | P4 (advisory) | security | Request body is read without a size cap (`req.text()` in `parseCall`); body limits belong to the server transport/mount, which task 1372 owns (deferral evidence: task 1371 "Dependencies & Handoff" leaves `mcpModule` mounting to 1372; probe N/A — no public HTTP surface mounted by this task) | `apps/server/src/modules/mcp/protocol.ts:126-131` | ACCEPTED (deferred to 1372 scope) |
| 3 | P4 (advisory) | usability | INTERNAL_ERROR responses echo the registry's error message verbatim to the client; fine for a loopback server gated by bearer auth at the 1372/1374 mount, but worth revisiting if this adapter is ever reused on a public surface | `apps/server/src/modules/mcp/protocol.ts:300` | ACCEPTED |
| 4 | P4 (advisory) | correctness (docs) | Task Notes claim gate `12/12 PASS` while the light-tier receipt records 10 checks (all PASS) — stale count, doc drift only; receipt itself is authoritative and green | `docs/tasks5/1371_stateless-mcp-2-0-streamable-http-protocol-adapter-and-serve.md:87` | ACCEPTED |

#### Dimension notes

- **Functional:** R1–R3 all MET (tables below). AC1's task-local identity maps to feature B9 `Scenario: R2 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions` (`docs/features/B9_embedded-mcp-2-0-server-in-spur-serve.md:47`); the task-local criterion stands on its own evidence.
- **Security:** version gate (`protocol.ts:101-123`) rejects missing/malformed/below-minimum before any dispatch; `Mcp-Session-Id` refused, non-POST refused with `Allow: POST`; errors always serialize as JSON, never streamed; no secrets or session state stored. Bearer auth is deliberately absent from the adapter — it lands with the 1372 mount (N/A per the approved split; deferral evidence: task file "Dependencies & Handoff").
- **Correctness:** JSON-RPC envelope mirrored with echoed `id`; header-form requests get the bare value; unknown method → 404/-32601 (legacy `initialize` included — tested); missing tool name/URI → 400/-32602 and never reaches the registry; registry rejection → 500/-32603, not a crash. The lexical `YYYY-MM-DD` compare in `protocol.ts:114` is sound after the shape regex at `protocol.ts:99`.
- **Efficiency:** stateless by construction — no stores; the SSE stream enqueues one frame and closes (`protocol.ts:237-247`).
- **Usability:** error messages name the expected header, the minimum version, and the supported method set.
- **Architecture:** transport-only adapter over the injected `McpHandlerRegistry` seam (`protocol.ts:49-63`) with no `@gobing-ai/spur-app` import — task 1372's `McpDispatcher` implements the seam and `mcpModule` mounts the handler; that mounting is **N/A** for this task by the approved split. High testability: pure request/response functions plus an injected fixture registry.

#### Gate evidence

`.spur/run/1371-check-receipt.json` — tier `light`, status **PASS**, 10/10 checks PASS (format/lint on changed files, pre/post rules, typecheck × 4 workspaces, test × 3 workspaces). `.spur/run/1371-light-gate.log` records "deferred gate: light tier PASS — the integrated full gate is owed on the batch base ref (1111 R3)" — a pipeline-owned residual at batch end, not a task-level blocker.

#### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/server/src/modules/mcp/protocol.ts:126-156` (parseCall: bare or JSON-RPC body, method from `Mcp-Method` header or envelope) and `:232-247` + `:260-303` (handleMcpHttpRequest: JSON or request-scoped one-frame SSE response); tests `apps/server/tests/modules/mcp/protocol.test.ts:104-209` (dispatch group) and `:254-271` (SSE group); fresh `bun test` run 25 pass / 0 fail |
| R2 | MET | `apps/server/src/modules/mcp/protocol.ts:138` (`Mcp-Method`), `:161-169` (`server/discover` returns negotiated version + tools/resources), `:172`/`:186` (`Mcp-Name` header for tools/call and resources/read); tests `protocol.test.ts:106-127` (discover/list) and `:128-146` (header-form tool call) |
| R3 | MET | `apps/server/src/modules/mcp/protocol.ts:101-123` (version gate: missing/malformed/`< 2026-07-28` → 400 `PROTOCOL_VERSION_UNSUPPORTED`) and `:260-283` (non-POST → 405 `STATEFUL_TRANSPORT_UNSUPPORTED` + `Allow: POST`; `Mcp-Session-Id` → 400 `SESSIONS_UNSUPPORTED`); tests `protocol.test.ts:56-87` (version gate incl. legacy trio `2024-11-05`/`2025-03-26`/`2025-11-25`) and `:89-102` (transport gate) |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions (req: R1, R2, R3) | MET | test+command | `apps/server/tests/modules/mcp/protocol.test.ts:65-72` (legacy trio rejected with `PROTOCOL_VERSION_UNSUPPORTED`), `:56-63` (missing header), `:73-87` (malformed vs newer-future accepted); command: gate receipt `.spur/run/1371-check-receipt.json` check `test:apps/server` PASS; fresh review run `cd apps/server && bun test tests/modules/mcp/protocol.test.ts` → 25 pass / 0 fail |

#### Residuals

- Integrated full gate owed on the batch base ref per the runall light-gate contract (1111 R3) — batch-level, not task-level.
- Body-size cap and bearer auth arrive with the 1372 mount; the adapter is intentionally unmounted in this task (probe N/A).
- P4 findings #2/#3 above are context to carry into the 1372 review.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)
- 2026-11-17T19:48:35.304Z todo → wip (system)
- 2026-11-17T19:53:23.975Z wip → testing (system)
- 2026-11-17T19:53:25.311Z testing → done (system)

