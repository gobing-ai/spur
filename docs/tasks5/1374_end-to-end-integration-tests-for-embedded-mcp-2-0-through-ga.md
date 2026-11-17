---
schema_version: 1
name: End-to-end integration tests for embedded MCP 2.0+ through gateway
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.330Z
updated_at: "2026-11-17T19:03:10.441Z"
feature_id: B9
priority: P2
tags:
  - mcp
  - e2e
  - testing
estimate_hours: 2

dependencies: ["1370", "1371", "1372", "1373"]
---

## 1374. End-to-end integration tests for embedded MCP 2.0+ through gateway

### Background

Verify the full path from gateway `/<prefix>/mcp` to `spur serve` `mcpModule` and `spur mcp` under realistic conditions.

### Requirements

- [ ] R1. Add E2E tests exercising `POST /<prefix>/mcp` through `createGatewayHandler` for `server/discover`, `task_show`, `spur://` resources, bearer auth, and legacy version rejection.

### Acceptance Criteria

- [ ] AC1 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R1)
- [ ] AC2 — Stateless MCP 2.0+ Streamable HTTP rejects legacy protocol versions (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Model after `a2a-serve-e2e` / `project-gateway.test.ts` using in-process `Bun.serve` upstreams and `createGatewayHandler`.

### Plan

- Add E2E test suite under `apps/server/tests/` or `packages/app/tests/`.
- Verify `bun run spur-check` passes cleanly.

### Solution

#### Dependencies
- Depends on `1370`, `1371`, `1372`, and `1373`.

#### Target Files
- `packages/app/tests/services/mcp-gateway-e2e.test.ts` or `apps/server/tests/mcp-e2e.test.ts` (new) — End-to-end integration test spinning up `createGatewayHandler` + `spur serve` Hono app with `mcpModule` enabled:
  - Verify `POST /<prefix>/mcp` (`server/discover`, `task_show`, `spur://` resource read) succeeds with Bearer auth and `Mcp-Protocol-Version: 2026-07-28`.
  - Verify unauthenticated requests return `401` and legacy pre-2.0 protocol versions are rejected.
  - Verify `spur mcp` stdio bridge works end-to-end against the gateway URL.

#### Verification
- Run `bun run spur-check` (lint, typecheck, unit & E2E tests) and verify all pass.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

