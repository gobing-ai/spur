---
schema_version: 1
name: Embedded mcpModule in apps/server with core task, workflow, and context tools
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.329Z
updated_at: "2026-11-17T19:09:13.308Z"
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

**Target Files**
- `apps/server/src/modules/mcp/index.ts` (new) — `mcpModule: ServerModule` with Bearer auth (`server.mcp.authEnv`), tool handlers (`task_show`, `task_list`, `workflow_status`, `workflow_run`, `workflow_continue`), and `spur://` resource handlers delegating to `@gobing-ai/spur-app`.
- [apps/server/src/modules/registry.ts](file:///Users/robin/xprojects/spur-new/apps/server/src/modules/registry.ts) — Register `mcpModule` in `builtins`.

**Verification**
- Module tests in `apps/server/tests/modules/mcp-module.test.ts` verifying default-off behavior, `401` auth enforcement, tool calls, and `spur://` resource reads.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

