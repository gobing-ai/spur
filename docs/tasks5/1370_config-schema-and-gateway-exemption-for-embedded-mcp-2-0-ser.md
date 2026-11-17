---
schema_version: 1
name: Config schema and gateway exemption for embedded MCP 2.0+ server
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.326Z
updated_at: "2026-11-17T19:09:12.097Z"
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

Feature B9 embeds a stateless MCP 2.0+ (`2026-07-28`+) server inside `spur serve` (parallel to `a2aModule`). Configuration and gateway CSRF/routing rules must gate it cleanly before mounting routes.

**Refine corrections (2026-11-17)**
- `apps/server/src/context.ts` → `apps/server/src/server-config.ts` (`ServerBootConfig` and `serverBootstrapConfig` live in `server-config.ts`, lines 22 and 59–61; `context.ts` only re-exports/uses `ServerBootConfig`) → updated Solution and Design target path to `apps/server/src/server-config.ts`.

### Requirements

- [ ] R1. Add `server.mcp` (`enabled: boolean` default `false`, `authEnv: string | null`) to `@gobing-ai/spur-config` Zod schema.
- [ ] R2. Exempt bearer-authenticated `/<prefix>/mcp` requests from browser-origin CSRF checks in `gatewayGuard` (`packages/app/src/services/project-gateway.ts`), while preserving host allowlist checks.

### Acceptance Criteria

- [ ] AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1)
- [ ] AC2 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R2)

### Q&A

- **Decision (closed):** `server.mcp` mirrors `server.a2a` (`enabled` default `false`, `authEnv` required when enabled) and `gatewayGuard` exempts `/<prefix>/mcp` from browser CSRF checks while retaining host allowlisting.

### Design

**WHAT / WHY / WHERE**
- Add `server.mcp` config and gateway bearer-auth CSRF exemption, mirroring `server.a2a` (`packages/config/src/index.ts`, `apps/server/src/server-config.ts`, `packages/app/src/services/project-gateway.ts`).

**Frozen Names**
- Env vars (`SPUR_ENV_VARS`): `mcpEnabled: 'SPUR_MCP_ENABLED'`, `mcpAuthEnv: 'SPUR_MCP_AUTH_ENV'`
- Config schema (`server.mcp`): `{ enabled: boolean (default false), authEnv?: string }` with `superRefine` requiring `authEnv` when `enabled === true`
- Boot config (`ServerBootConfig.mcp` in `apps/server/src/server-config.ts`): `{ enabled: boolean; authEnv: string | null }`
- Gateway guard (`gatewayGuard` in `packages/app/src/services/project-gateway.ts:131`): exempt `segments[1] === 'mcp'` (same as `segments[1] === 'a2a'`) from browser-origin CSRF checks while keeping `isAllowedHost` enforced.

**Anti-patterns**
- Do not exempt `/mcp` from `isAllowedHost` host-allowlist checks.
- Do not default `server.mcp.enabled` to `true` or allow `enabled: true` without `authEnv`.

**Dependencies & Handoff**
- Upstream dependencies: none.
- Leaves for `1371`, `1372`, `1373`, `1374`: `server.mcp` config schema, `ServerBootConfig.mcp`, and `/<prefix>/mcp` gateway pass-through.

### Plan

- Add `server.mcp` schema defaults in `packages/config`.
- Update `gatewayGuard` in `packages/app/src/services/project-gateway.ts` for `/<prefix>/mcp`.
- Add unit tests in `packages/config` and `packages/app/tests/services/project-gateway-edge.test.ts`.

### Solution

**Target Files**
- [packages/config/src/index.ts](file:///Users/robin/xprojects/spur-new/packages/config/src/index.ts) — Add `SPUR_MCP_ENABLED` / `SPUR_MCP_AUTH_ENV`, `server.mcp` schema, and `superRefine` rule.
- [apps/server/src/server-config.ts](file:///Users/robin/xprojects/spur-new/apps/server/src/server-config.ts) — Add `mcp?: { enabled: boolean; authEnv: string | null }` to `ServerBootConfig` and `serverBootstrapConfig()`.
- [packages/app/src/services/project-gateway.ts](file:///Users/robin/xprojects/spur-new/packages/app/src/services/project-gateway.ts#L130-L132) — Exempt `segments[1] === 'mcp'` in `gatewayGuard`.

**Verification**
- Config unit tests in `packages/config/tests/` for `server.mcp` defaults, env overrides, and `authEnv` validation.
- Gateway edge tests in `packages/app/tests/services/project-gateway-edge.test.ts` for `/<prefix>/mcp` CSRF exemption and host-guard enforcement.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

