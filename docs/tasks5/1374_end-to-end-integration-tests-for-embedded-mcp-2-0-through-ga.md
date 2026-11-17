---
schema_version: 1
name: End-to-end integration tests for embedded MCP 2.0+ through gateway
status: done
template: feature-impl
created_at: 2026-11-17T18:57:28.330Z
updated_at: "2026-11-17T20:58:33.029Z"
feature_id: B9
priority: P2
tags:
  - mcp
  - e2e
  - testing
estimate_hours: 2

dependencies: ["1370", "1371", "1372", "1373"]
done_forced: "false"
done_reason: unforced close
---

## 1374. End-to-end integration tests for embedded MCP 2.0+ through gateway

### Background

Verify the full path from gateway `/<prefix>/mcp` to `spur serve` `mcpModule` and `spur mcp` under realistic conditions.

### Requirements

- [x] R1. Add E2E tests exercising `POST /<prefix>/mcp` through `createGatewayHandler` for `server/discover`, `task_show`, `spur://` resources, bearer auth, and legacy version rejection.

### Acceptance Criteria

- [x] AC1 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R1)
- [x] AC2 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT / WHY / WHERE**
- Add end-to-end integration tests (`apps/server/tests/mcp-e2e.test.ts`) verifying the full path from `createGatewayHandler` (`/<prefix>/mcp`) through `spur serve` (`mcpModule`) and `spur mcp`.

**Frozen Names**
- Test file: `apps/server/tests/mcp-e2e.test.ts`
- Scenarios: `POST /<prefix>/mcp` (`server/discover`, `task_show`, `spur://` resource read), `401` on missing/bad Bearer token, rejection of legacy pre-`2026-07-28` protocol versions, and `spur mcp` stdio bridge round-trip.

**Anti-patterns**
- Do NOT mock `mcpModule` or `gatewayGuard` in the E2E suite—exercise real Hono + `createGatewayHandler` request/response flow.

**Dependencies & Handoff**
- Assumes `1370`, `1371`, `1372`, and `1373` are complete.

### Plan

- [x] Add E2E test suite under `apps/server/tests/` or `packages/app/tests/`. — landed as `apps/server/tests/mcp-e2e.test.ts`.
- [ ] Verify `bun run spur-check` passes cleanly. — deferred to the pipeline's gate/verify stages (implement scope runs no full quality gate); targeted suite + `task gate light` are green.

### Solution

**Change map** (R1/AC1/AC2 — tests only; no production surface changed)

- `apps/server/tests/mcp-e2e.test.ts` (new) — the whole E2E suite; exercises the real chain without mocking `mcpModule` or `gatewayGuard` (anti-pattern):
  - `:35-72` fixture — env → `serverBootstrapConfig` (task 1370) → `createServerContext` (in-memory DB, temp corpus: `docs/tasks/9001_e2e-probe.md`, `.spur/context/learnings.md`) → real `createApp` serve (registry + middleware) on an ephemeral `Bun.serve` upstream, behind a real `startGateway` listener routing the `/e2e` prefix. The token value is set through the env funnel (`setEnvVar`, `:43-46`) because `mcpModule` resolves it via the live `getEnvVars()` record — the same path production `spur serve` uses; a real ServerContext carries no top-level env map to inject through.
  - `:124-130` AC1 — `POST /e2e/mcp` `server/discover` through the gateway returns the frozen tool/resource capability surface.
  - `:132-146` AC1 — bearer-auth CSRF exemption proven both ways: a `text/plain` simple request (the shape `csrf()`/`gatewayGuard` reject on ordinary paths) reaches `/mcp` on both gateway and upstream hops (200), while the same shape to `/e2e/nope` is 403 from the gateway guard.
  - `:148-154` R1 — `tools/call task_show` reads the real temp-corpus task via the in-process TaskService.
  - `:156-167` R1 — `resources/read` returns `spur://tasks/9001` and `spur://context/learnings.md` bodies.
  - `:169-178` R1/AC1 — missing and wrong bearer tokens are 401 with `WWW-Authenticate: Bearer realm="spur-mcp"`.
  - `:180-189` AC2 — legacy pre-`2026-07-28` versions (`2024-11-05`, `2025-03-26`, `2025-11-25`) are 400 `PROTOCOL_VERSION_UNSUPPORTED`; the version gate runs before body parsing, so even JSON-RPC requests get the bare error shape.
  - `:191-212` frozen scenario — real `spur mcp` CLI subprocess (`apps/cli/src/index.ts mcp --url …`) round-trips a JSON-RPC line through the gateway to the embedded endpoint and echoes the answer.

**Deferred**
- Full `bun run spur-check` is the pipeline gate/verify stages' job (implement scope runs no full quality gate); `bun test tests/mcp-e2e.test.ts` (7 pass) and `task gate 1374 light` PASS are the implement-stage evidence.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/tests/mcp-e2e.test.ts:123` (server/discover through gateway), `:148` (tools/call task_show), `:157` (spur:// resources/read), `:169` (missing/wrong bearer 401 + WWW-Authenticate), `:180` (legacy version rejection), `:192` (stdio bridge round-trip) — all through `createGatewayHandler`; fresh run 7 pass / 0 fail / 30 expects / 454 ms (`cd apps/server && bun test tests/mcp-e2e.test.ts`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption | MET | test | `apps/server/tests/mcp-e2e.test.ts:123-133` (proxy 200 with capability surface), `:135-146` (text/plain simple request 200 through both hops; same shape 403 from gateway guard on ordinary path — negative control at `packages/app/src/services/project-gateway.ts:106,119`); gate receipt `test:apps/server` PASS (`.spur/run/1374-check-receipt.json`) |
| AC2 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions | MET | test | `apps/server/tests/mcp-e2e.test.ts:180-190` (2024-11-05/2025-03-26/2025-11-25 → 400 `PROTOCOL_VERSION_UNSUPPORTED`, gate before body parse at `apps/server/src/modules/mcp/protocol.ts:114-119`); gate receipt `test:apps/server` PASS (`.spur/run/1374-check-receipt.json`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1374
**Scope:** task diff (worktree vs base `d0ebf80`, per `.spur/run/1374-base.sha`) — this task's surface is only `apps/server/tests/mcp-e2e.test.ts` (new). Prior sibling surfaces 1370–1373 reviewed PASS individually and are out of scope here.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (`--focus all`, `--auto`)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | Token is injected via process-global `setEnvVar` with cleanup only in `afterAll`; safe today because bun test runs files sequentially and the var name is task-scoped (`SPUR_E2E_MCP_TOKEN`), but a future in-process parallel runner would need file-local isolation | `apps/server/tests/mcp-e2e.test.ts:48,81` | ACCEPTED |
| 2 | P4 (advisory) | correctness | `ensureUpstream` fallback `up.port ?? 0` would dial port 0 if a port-0 bind ever reported an undefined port; the comment documents the invariant and Bun always reports the bound port for port 0 | `apps/server/tests/mcp-e2e.test.ts:72-73` | ACCEPTED |
| 3 | P4 (advisory) | security | The CSRF-exemption negative control (403 on `/e2e/nope`) exercises the gateway hop directly; the upstream-hop rejection is proven only implicitly by the 200 through both hops — acceptable because upstream `csrf()` behavior is unit-covered by sibling 1372's suite | `apps/server/tests/mcp-e2e.test.ts:137-145` | ACCEPTED |

No P1–P3 findings.

##### Anti-pattern & anti-flakiness check (task-specific criteria)

| Check | Result | Evidence |
|-------|--------|----------|
| No mocking of `mcpModule`/`gatewayGuard` | PASS | No `mock.module` in the suite; real `createApp` serve app (`apps/server/tests/mcp-e2e.test.ts:61`) behind real `startGateway` → `createGatewayHandler` (`:64-71`, `apps/server/src/gateway.ts:30-31`); `mockRuntime` (`:54,61`) stubs only the `ApplicationRuntime` logger/host plumbing — the workspace's standard context fixture (`apps/server/tests/middleware/helpers.ts:16`), neither forbidden surface |
| Ports / timeouts / subprocess lifecycle | PASS | Port-0 ephemeral on both hops (`:62,65-66`; bound port resolved at `apps/server/src/gateway.ts:48`); `idleTimeout: 0` (`:62`); subprocess stdin written+ended and both pipes drained concurrently before `proc.exited` (`:194-207`) — no pipe deadlock; no sleeps; 60 s timeout only on the slow stdio test (`:215`), bun's default 5 s bounds the rest; full teardown incl. env cleanup and `rmSync` (`:80-84`); deterministic single-line stdout assertion with stderr diagnosis (`:200-204`) |
| Genuinely exercises the integrated chain | PASS | gateway → bearer (`apps/server/src/modules/mcp/index.ts:291` realm matches assertion `:175`) → protocol adapter gate (`apps/server/src/modules/mcp/protocol.ts:114-119`) → module dispatchers → real `spur-app` services over in-memory DB + temp corpus (`:38-45`); 1373 stdio bridge driven as a real CLI subprocess (`:193-195`, `apps/cli/src/index.ts:113,170`) |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/server/tests/mcp-e2e.test.ts:123` (server/discover through gateway), `:148` (tools/call task_show), `:157` (spur:// resources/read), `:169` (missing/wrong bearer 401 + WWW-Authenticate), `:180` (legacy version rejection), `:192` (stdio bridge round-trip) — all through `createGatewayHandler`; fresh run 7 pass / 0 fail / 30 expects / 454 ms (`cd apps/server && bun test tests/mcp-e2e.test.ts`) |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption | MET | test+command | `apps/server/tests/mcp-e2e.test.ts:123-133` (proxy 200 with capability surface), `:135-146` (text/plain simple request 200 through both hops; same shape 403 from gateway guard on ordinary path — negative control at `packages/app/src/services/project-gateway.ts:106,119`); gate receipt `test:apps/server` PASS (`.spur/run/1374-check-receipt.json`) |
| AC2 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions | MET | test+command | `apps/server/tests/mcp-e2e.test.ts:180-190` (2024-11-05/2025-03-26/2025-11-25 → 400 `PROTOCOL_VERSION_UNSUPPORTED`, gate before body parse at `apps/server/src/modules/mcp/protocol.ts:114-119`); gate receipt `test:apps/server` PASS (`.spur/run/1374-check-receipt.json`) |

Gate evidence: `.spur/run/1374-check-receipt.json` — tier light, all 11 checks PASS at digest `f38a206e`; `.spur/run/1374-light-gate.log` records same-tree reuse and the by-design deferral of the integrated full gate to the batch base ref (1111 R3). Independent fresh suite re-run this review: 7 pass / 0 fail.

Residual (non-blocking): the integrated full repo gate (`spur-check-feature`-class) remains owed at the batch base per the light-gate deferral — pipeline-level wrap residual, not a task defect.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)
- 2026-11-17T20:54:29.648Z todo → wip (system)
- 2026-11-17T20:58:31.798Z wip → testing (system)
- 2026-11-17T20:58:33.024Z testing → done (system)

