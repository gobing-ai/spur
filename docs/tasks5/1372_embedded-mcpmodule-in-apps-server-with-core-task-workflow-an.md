---
schema_version: 1
name: Embedded mcpModule in apps/server with core task, workflow, and context tools
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.329Z
updated_at: "2026-11-17T19:03:09.751Z"
feature_id: B9
priority: P1
tags:
  - mcp
  - server
  - tools
estimate_hours: 4

dependencies: ["1370", "1371"]
---

## 1372. Embedded mcpModule in apps/server with core task, workflow, and context tools

### Background

Exposing Spur's task, workflow, and indexed-context operations in-process inside `spur serve` eliminates repeated CLI startup overhead for coding agents.

### Requirements

- [ ] R1. Create `mcpModule` in `apps/server/src/modules/mcp/index.ts` and register it in `apps/server/src/modules/registry.ts`, gated by `server.mcp.enabled` and `server.mcp.authEnv` bearer auth.
- [ ] R2. Expose `task_show`, `task_list`, `workflow_status`, `workflow_run`, and `workflow_continue` tools delegating directly to `@gobing-ai/spur-app`.
- [ ] R3. Expose `spur://tasks/{wbs}`, `spur://features/{id}`, and `spur://context/{name}` MCP resources.

### Acceptance Criteria

- [ ] AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1)
- [ ] AC2 — Harness tools and resources delegate to @gobing-ai/spur-app (req: R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Follow `a2aModule` (`apps/server/src/modules/a2a/index.ts`) for module registration and bearer-token verification; delegate all mutations/queries to `@gobing-ai/spur-app` without adding a second FSM.

### Plan

- Implement `mcpModule` in `apps/server/src/modules/mcp/` and register in `registry.ts`.
- Wire tool and resource handlers to `@gobing-ai/spur-app`.
- Add module unit tests covering auth 401s, tool execution, and resource reads.

### Solution

#### Dependencies
- Depends on `1370` (config & gateway exemption) and `1371` (MCP 2.0+ stateless protocol adapter).

#### Target Files
- `apps/server/src/modules/mcp/index.ts` (new) — Implement `mcpModule: ServerModule` following `a2aModule` (`apps/server/src/modules/a2a/index.ts`):
  - Mount `POST /mcp` only when `ctx.bootConfig()?.mcp?.enabled === true`.
  - Enforce Bearer token auth against `process.env[authEnv]` (returning `401` with `WWW-Authenticate: Bearer realm="spur-mcp"` when missing/invalid).
  - Wire tools (`task_show`, `task_list`, `workflow_status`, `workflow_run`, `workflow_continue`) and resources (`spur://tasks/{wbs}`, `spur://features/{id}`, `spur://context/{name}`) directly to `@gobing-ai/spur-app` services without creating a second orchestration FSM.
- [apps/server/src/modules/registry.ts](file:///Users/robin/xprojects/spur-new/apps/server/src/modules/registry.ts) — Register `mcpModule` in `builtins`.

#### Verification
- Module tests in `apps/server/tests/modules/mcp-module.test.ts` verifying default-off behavior, 401 auth enforcement, tool calls, and `spur://` resource reads.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

