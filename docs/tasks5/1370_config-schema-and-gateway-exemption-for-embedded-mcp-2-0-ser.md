---
schema_version: 1
name: Config schema and gateway exemption for embedded MCP 2.0+ server
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.326Z
updated_at: "2026-11-17T19:02:31.201Z"
feature_id: B9
priority: P1
tags:
  - mcp
  - config
  - gateway
estimate_hours: 2

---

## 1370. Config schema and gateway exemption for embedded MCP 2.0+ server

### Background

Feature S embeds a stateless MCP 2.0+ server inside spur serve (parallel to a2aModule). Configuration and gateway CSRF/routing rules must gate it cleanly before mounting routes.

### Requirements

- [ ] R1. Add `server.mcp` (`enabled: boolean` default `false`, `authEnv: string | null`) to `@gobing-ai/spur-config` Zod schema.
- [ ] R2. Exempt bearer-authenticated `/<prefix>/mcp` requests from browser-origin CSRF checks in `gatewayGuard` (`packages/app/src/services/project-gateway.ts`), while preserving host allowlist checks.

### Acceptance Criteria

- [ ] AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1)
- [ ] AC2 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Mirror `server.a2a` in `@gobing-ai/spur-config` and the `/<prefix>/a2a/*` exemption in `gatewayGuard` (`packages/app/src/services/project-gateway.ts`).

### Plan

- Add `server.mcp` schema defaults in `packages/config`.
- Update `gatewayGuard` in `packages/app/src/services/project-gateway.ts` for `/<prefix>/mcp`.
- Add unit tests in `packages/config` and `packages/app/tests/services/project-gateway-edge.test.ts`.

### Solution

#### Target Files
- [packages/config/src/index.ts](file:///Users/robin/xprojects/spur-new/packages/config/src/index.ts) — Add `mcpEnabled: 'SPUR_MCP_ENABLED'` and `mcpAuthEnv: 'SPUR_MCP_AUTH_ENV'` to `SPUR_ENV_VARS`, add `server.mcp` (`{ enabled: boolean (default false), authEnv?: string }`) alongside `server.a2a`, and add a `superRefine` rule requiring `authEnv` when `server.mcp.enabled === true`.
- [apps/server/src/context.ts](file:///Users/robin/xprojects/spur-new/apps/server/src/context.ts) — Thread `mcp?: { enabled: boolean; authEnv?: string }` into `ServerBootConfig` / `serverBootstrapConfig`.
- [packages/app/src/services/project-gateway.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/project-gateway.ts#L130-L132) — Extend `gatewayGuard` so `/<prefix>/mcp` (like `/<prefix>/a2a/*`) is exempt from browser-origin CSRF checks when `Authorization: Bearer ...` is used (host allowlist still enforced).

#### Verification
- Unit tests in `packages/config/tests/` for `server.mcp` defaults, env overrides, and `authEnv` validation.
- Unit tests in `packages/app/tests/services/project-gateway-edge.test.ts` for `/<prefix>/mcp` CSRF exemption and host-guard enforcement.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

