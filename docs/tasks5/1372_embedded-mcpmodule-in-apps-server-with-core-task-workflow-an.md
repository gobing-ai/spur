---
schema_version: 1
name: Embedded mcpModule in apps/server with core task, workflow, and context tools
status: done
template: feature-impl
created_at: 2026-11-17T18:57:28.329Z
updated_at: "2026-11-17T20:15:37.979Z"
feature_id: B9
priority: P1
tags:
  - mcp
  - server
  - tools
estimate_hours: 4

dependencies: ["1370", "1371"]
done_forced: "false"
done_reason: unforced close
---

## 1372. Embedded mcpModule in apps/server with core task, workflow, and context tools

### Background

Exposing Spur's task, workflow, and indexed-context operations in-process inside `spur serve` eliminates repeated CLI startup overhead for coding agents.

### Requirements

- [x] R1. Create `mcpModule` in `apps/server/src/modules/mcp/index.ts` and register it in `apps/server/src/modules/registry.ts`, gated by `server.mcp.enabled` and `server.mcp.authEnv` bearer auth.
- [x] R2. Expose `task_show`, `task_list`, `workflow_status`, `workflow_run`, and `workflow_continue` tools delegating directly to `@gobing-ai/spur-app`.
- [x] R3. Expose `spur://tasks/{wbs}`, `spur://features/{id}`, and `spur://context/{name}` MCP resources.

### Acceptance Criteria

- [x] AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1)
- [x] AC2 — Harness tools and resources delegate to @gobing-ai/spur-app (req: R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHAT / WHY / WHERE**
- Mount `mcpModule: ServerModule` on `spur serve` (`apps/server/src/modules/mcp/index.ts`, registered in `apps/server/src/modules/registry.ts`), exposing Spur's harness tools and `spur://` resources in-process over `@gobing-ai/spur-app`.

**Frozen Names**
- Module export: `mcpModule` in `apps/server/src/modules/mcp/index.ts`
- Route: `POST /mcp` (mounted only when `ctx.bootConfig()?.mcp?.enabled === true`)
- Auth: Bearer token matching `process.env[authEnv]`; missing/invalid returns `401` with `WWW-Authenticate: Bearer realm="spur-mcp"`
- Tools: `task_show`, `task_list`, `workflow_status`, `workflow_run`, `workflow_continue`
- Resources: `spur://tasks/{wbs}`, `spur://features/{id}`, `spur://context/{name}`

**Anti-patterns**
- Do NOT introduce a second workflow state machine or bypass `task-pipeline.yaml` / `spur task` / `spur workflow` service contracts.
- Do NOT mount `/mcp` when `server.mcp.enabled` is `false` or `bootConfig()` is omitted.

**Dependencies & Handoff**
- Assumes from `1370`: `ServerBootConfig.mcp` (`enabled`, `authEnv`).
- Assumes from `1371`: `handleMcpHttpRequest()` stateless MCP 2.0+ adapter.
- Leaves for `1373` and `1374`: live `POST /mcp` endpoint on `spur serve`.

### Plan

- Implement `mcpModule` in `apps/server/src/modules/mcp/` and register in `registry.ts`.
- Wire tool and resource handlers to `@gobing-ai/spur-app`.
- Add module unit tests covering auth 401s, tool execution, and resource reads.

### Solution

**Change map** (R1 mount+auth, R2 tools, R3 resources; AC1/AC2)

- `apps/server/src/modules/mcp/index.ts` (new, 302 lines) — the whole embedded server:
  - `:31` `TOOL_DESCRIPTORS` — 5 frozen tools (R2): `task_show`, `task_list`, `workflow_status`, `workflow_run`, `workflow_continue` with JSON-Schema input.
  - `:89` `RESOURCE_DESCRIPTORS` — 3 `spur://` resources (R3): `spur://tasks/{wbs}`, `spur://features/{id}`, `spur://context/{name}`.
  - `:104` `McpDispatcher implements McpHandlerRegistry` (the 1371 seam) — `listTools`/`callTool`/`listResources`/`readResource` delegate to `ctx.taskService()/workflowService()/featureService()` (`@gobing-ai/spur-app`, AC2). `workflow_continue` falls back to `latestPausedRun()` when no `runId` is passed and errors instead of returning null-as-success; `context` reads are confined to a single `.spur/context/` path segment (traversal-refused).
  - `:178` `createMcpHandler(ctx)` — bearer auth via env var named by `server.mcp.authEnv` (value never stored; constant-time compare; missing variable ⇒ 500 `INTERNAL_ERROR` challenge-free), `401` + `WWW-Authenticate: Bearer realm="spur-mcp"`, then `handleMcpHttpRequest` (1371 adapter).
  - `:254` `mcpModule: ServerModule` — mounts `POST /mcp` only when `bootConfig().mcp.enabled` (default-off; R1/AC1).
- `apps/server/src/modules/registry.ts:12,47` — `mcpModule` appended to `builtins` after `a2aModule`.
- `apps/server/src/middleware/pipeline.ts:80` — `/mcp` CSRF exemption, mirroring the task-1336 `/a2a/` precedent (bearer-only machine-to-machine endpoint; a form-typed simple request would otherwise 403/500 before auth). Probe-proven requirement: with the guard active, every `POST /mcp` shape dies in csrf before the module runs.
- Tests:
  - `apps/server/tests/modules/mcp-module.test.ts` (new) — AC1 mount/default-off/401/403(authEnv unset)/challenge header, AC2 tool delegation via recorder stub services, resources (task/feature/context, unknown feature ⇒ error not null, traversal refusal), direct-handler seam.
  - `apps/server/tests/modules/registry.test.ts:24` — builtins now include `'mcp'`.
  - `apps/server/tests/middleware/pipeline.test.ts` — csrf exemption regression: form-typed `POST /mcp` reaches the route.

**Live probe** (source CLI `serve`, throwaway project root): default-off ⇒ health 200, `POST /mcp` 404; enabled ⇒ no auth 401 + `WWW-Authenticate`, wrong token 401, authed `server/discover` returns the 5 tools + 3 resources, authed `tools/call task_show` reaches the real `TaskService` (clean NOT_FOUND on an empty corpus).

**Deliberately out of scope** (per task): `Mcp-Session-Id` handling, sampling/roots/elicitation, the `spur mcp` CLI verb and live `POST /mcp` endpoint ownership in `docs/04_DESIGN.md` (1373/1374).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `mcpModule` created and registered: `apps/server/src/modules/mcp/index.ts:254-303` (module + `app.post('/mcp')` at `:296`), gated by `server.mcp.enabled` (`mcpSettings` `:223`, early return `:262`) and `server.mcp.authEnv` bearer auth (`authorize` `:273-294`, 401 + `WWW-Authenticate: Bearer realm="spur-mcp"`); registered in `apps/server/src/modules/registry.ts:12,46-47`; default-off/401 tests `apps/server/tests/modules/mcp-module.test.ts:134-185`; registry test `apps/server/tests/modules/registry.test.ts:6-24`; gate `test:apps/server` PASS (`.spur/run/1372-check-receipt.json`) + fresh `bun test` 59 pass; live probe default-off → `POST /mcp` 404 (task Solution record). |
| R2 | MET | Five frozen tools `TOOL_DESCRIPTORS` `apps/server/src/modules/mcp/index.ts:31-87`; `McpDispatcher.callTool` `:116-137` delegates directly to `@gobing-ai/spur-app` services — signatures verified against `packages/app/src/services/task-service.ts:305,575` and `packages/app/src/services/workflow-service.ts:389,520,556-557`; recorder-stub delegation tests `apps/server/tests/modules/mcp-module.test.ts:188-365` (discover 5+3 at `:191`, per-tool call-sequence asserts, refuse-paths at `:228,309,344,354`). |
| R3 | MET | Three `spur://` resources `RESOURCE_DESCRIPTORS` `apps/server/src/modules/mcp/index.ts:89-93`; `readResource` `:151-176` (single-path-segment confinement, traversal refused); tests `apps/server/tests/modules/mcp-module.test.ts:367-446` (task/feature/context reads, unknown feature → error not null `:394`, traversal `:421`, unknown scheme `:436`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1) | MET | test | Mount gating tests `apps/server/tests/modules/mcp-module.test.ts:134-152` (no mcp key → 404, `enabled:false` → 404, `enabled:true` → 200) and bearer-auth tests `:154-185` (missing header 401 + challenge, wrong token 401, non-bearer 401, unset token var → fail-closed 500, challenge-free); fresh command `bun test` 3 files → 59 pass, 0 fail; source `apps/server/src/modules/mcp/index.ts:262,273-294`; light gate `test:apps/server` PASS (`.spur/run/1372-check-receipt.json`, all 10 checks PASS at digest `a3d344ac`). |
| AC2 — Harness tools and resources delegate to @gobing-ai/spur-app (req: R2, R3) | MET | test | Delegation tests `apps/server/tests/modules/mcp-module.test.ts:188-446` (9 tool tests + 6 resource tests asserting exact service-call sequences against recorder stubs) and the direct-handler seam `:447-462`; real delegation surface verified statically: `apps/server/src/modules/mcp/index.ts:104-176` against `packages/app/src/services/task-service.ts:305,575`, `feature-service.ts:342`, `workflow-service.ts:389,520,556-557` (no CLI spawn, no second workflow state machine — anti-pattern respected). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1372
**Scope:** working-tree diff vs base `d0ebf80` (`.spur/run/1372-base.sha`) — task body `apps/server/src/modules/mcp/index.ts` (new), `apps/server/src/modules/registry.ts`, declared scope extension `apps/server/src/middleware/pipeline.ts`; tests `apps/server/tests/modules/mcp-module.test.ts` (new), `apps/server/tests/modules/registry.test.ts`, `apps/server/tests/middleware/pipeline.test.ts`. Sibling prior-task surface (1370 `server.mcp` config schema/`ServerBootConfig.mcp`/gateway CSRF exemption/project-gateway-html, 1371 `protocol.ts` adapter + 25 tests) is linked-sibling surface, reviewed only as consumed seams — not this task's burden.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Profile:** auto (--auto); focus all

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | architecture | Declared scope extension: one-line `/mcp` CSRF exemption sits outside the task body's named change map. Verified on merit: it mirrors the task-1336 `/a2a/` precedent, is genuinely required (hono `csrf` 403s any POST with a form-typed or missing content-type before the route's bearer auth runs — `apps/server/node_modules/hono/dist/middleware/csrf/index.js:46`, empty content-type falls back to `text/plain`), and preserves host allowlisting at both layers (apps/server `isAllowedHost` wraps `app.fetch` at `apps/server/src/serve.ts:1261`; gateway `gatewayGuard` runs the host check before its own `/mcp` exemption at `packages/app/src/services/project-gateway.ts:124,133` — the anti-pattern "do not exempt `/mcp` from host allowlist" is respected). Regression-tested. | `apps/server/src/middleware/pipeline.ts:77-80` | ACCEPTED |
| 2 | P4 (advisory) | security | Comment overstates the probe slightly: "every POST /mcp shape dies in csrf" — `application/json`-typed requests pass csrf and reach bearer auth either way; the blocked class is form-typed/missing content-types (exactly the a2a-CLI-like shapes). Conclusion unchanged: the endpoint's own bearer check is the real gate and a cross-site simple request cannot set `Authorization`. | `apps/server/src/middleware/pipeline.ts:76` | ACCEPTED |
| 3 | P4 (advisory) | security | Bearer token is read once at module mount (closure), so rotation needs a process restart. Exact house parity with the a2a module (`apps/server/src/modules/a2a/index.ts:194`), constant-time compare included; noting, not blocking. | `apps/server/src/modules/mcp/index.ts:257` | ACCEPTED |

No P1–P3 findings.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `mcpModule` created and registered: `apps/server/src/modules/mcp/index.ts:254-303` (module + `app.post('/mcp')` at `:296`), gated by `server.mcp.enabled` (`mcpSettings` `:223`, early return `:262`) and `server.mcp.authEnv` bearer auth (`authorize` `:273-294`, 401 + `WWW-Authenticate: Bearer realm="spur-mcp"`); registered in `apps/server/src/modules/registry.ts:12,46-47`; default-off/401 tests `apps/server/tests/modules/mcp-module.test.ts:134-185`; registry test `apps/server/tests/modules/registry.test.ts:6-24`; gate `test:apps/server` PASS (`.spur/run/1372-check-receipt.json`) + fresh `bun test` 59 pass; live probe default-off → `POST /mcp` 404 (task Solution record). |
| R2 | MET | Five frozen tools `TOOL_DESCRIPTORS` `apps/server/src/modules/mcp/index.ts:31-87`; `McpDispatcher.callTool` `:116-137` delegates directly to `@gobing-ai/spur-app` services — signatures verified against `packages/app/src/services/task-service.ts:305,575` and `packages/app/src/services/workflow-service.ts:389,520,556-557`; recorder-stub delegation tests `apps/server/tests/modules/mcp-module.test.ts:188-365` (discover 5+3 at `:191`, per-tool call-sequence asserts, refuse-paths at `:228,309,344,354`). |
| R3 | MET | Three `spur://` resources `RESOURCE_DESCRIPTORS` `apps/server/src/modules/mcp/index.ts:89-93`; `readResource` `:151-176` (single-path-segment confinement, traversal refused); tests `apps/server/tests/modules/mcp-module.test.ts:367-446` (task/feature/context reads, unknown feature → error not null `:394`, traversal `:421`, unknown scheme `:436`). |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1) | MET | test+command+static-ref | Mount gating tests `apps/server/tests/modules/mcp-module.test.ts:134-152` (no mcp key → 404, `enabled:false` → 404, `enabled:true` → 200) and bearer-auth tests `:154-185` (missing header 401 + challenge, wrong token 401, non-bearer 401, unset token var → fail-closed 500, challenge-free); fresh command `bun test` 3 files → 59 pass, 0 fail; source `apps/server/src/modules/mcp/index.ts:262,273-294`; light gate `test:apps/server` PASS (`.spur/run/1372-check-receipt.json`, all 10 checks PASS at digest `a3d344ac`). |
| AC2 — Harness tools and resources delegate to @gobing-ai/spur-app (req: R2, R3) | MET | test+static-ref | Delegation tests `apps/server/tests/modules/mcp-module.test.ts:188-446` (9 tool tests + 6 resource tests asserting exact service-call sequences against recorder stubs) and the direct-handler seam `:447-462`; real delegation surface verified statically: `apps/server/src/modules/mcp/index.ts:104-176` against `packages/app/src/services/task-service.ts:305,575`, `feature-service.ts:342`, `workflow-service.ts:389,520,556-557` (no CLI spawn, no second workflow state machine — anti-pattern respected). |

##### Verification evidence

- Gate: `.spur/run/1372-check-receipt.json` — tier light, 10/10 checks PASS (format-lint, rules pre/post, typecheck ×4, test ×3) at digest `a3d344ac`; deferred full gate owed on the batch base ref per 1111 R3 (`.spur/run/1372-light-gate.log`).
- Fresh re-run this review: `bun test tests/modules/mcp-module.test.ts tests/modules/registry.test.ts tests/middleware/pipeline.test.ts` in `apps/server` → 59 pass, 0 fail (104 expect calls); `bun run typecheck` in `apps/server` → clean.
- Scope note honored: 1370/1371 sibling surfaces excluded from this verdict; the consumed seams (`handleMcpHttpRequest`, `McpHandlerRegistry`, `ServerBootConfig.mcp`) are exercised through this task's own passing tests.

##### Residual risk

- Full/integrated gate remains owed at the batch base ref (deferred by the light tier, per 1111 R3) — owned by the pipeline, not this task.
- Live `POST /mcp` end-to-end through the gateway is task 1374's surface; this task's live probe is recorded in the task Solution but is not independently re-executed by this review (manual-review evidence, implementer-attested).

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)
- 2026-11-17T20:10:04.801Z todo → wip (system)
- 2026-11-17T20:15:36.695Z wip → testing (system)
- 2026-11-17T20:15:37.975Z testing → done (system)

