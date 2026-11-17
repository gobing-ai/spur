---
schema_version: 1
name: Config schema and gateway exemption for embedded MCP 2.0+ server
status: done
template: feature-impl
created_at: 2026-11-17T18:57:28.326Z
updated_at: "2026-11-17T19:36:46.039Z"
feature_id: B9
priority: P1
tags:
  - mcp
  - config
  - gateway
estimate_hours: 2

done_forced: "false"
done_reason: unforced close
---

## 1370. Config schema and gateway exemption for embedded MCP 2.0+ server

### Background

Feature B9 embeds a stateless MCP 2.0+ (`2026-07-28`+) server inside `spur serve` (parallel to `a2aModule`). Configuration and gateway CSRF/routing rules must gate it cleanly before mounting routes.

**Refine corrections (2026-11-17)**
- `apps/server/src/context.ts` → `apps/server/src/server-config.ts` (`ServerBootConfig` and `serverBootstrapConfig` live in `server-config.ts`, lines 22 and 59–61; `context.ts` only re-exports/uses `ServerBootConfig`) → updated Solution and Design target path to `apps/server/src/server-config.ts`.

### Requirements

- [x] R1. Add `server.mcp` (`enabled: boolean` default `false`, `authEnv: string | null`) to `@gobing-ai/spur-config` Zod schema.
- [x] R2. Exempt bearer-authenticated `/<prefix>/mcp` requests from browser-origin CSRF checks in `gatewayGuard` (`packages/app/src/services/project-gateway.ts`), while preserving host allowlist checks.

### Acceptance Criteria

- [ ] AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1)
- [x] AC2 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R2)

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

| File | Change |
| --- | --- |
| `packages/config/src/index.ts:21-22` | Added `mcpEnabled: 'SPUR_MCP_ENABLED'` / `mcpAuthEnv: 'SPUR_MCP_AUTH_ENV'` to `SPUR_ENV_VARS` (frozen names, R1). |
| `packages/config/src/index.ts:1363-1374` | Added `server.mcp` Zod object mirroring `server.a2a` (`enabled` default `false`, optional `authEnv` min(1)) with its own `.default({ enabled: false })` (R1). |
| `packages/config/src/index.ts:1392` | Extended the `server` object's `.default(...)` with `mcp: { enabled: false }` so an absent section parses. |
| `packages/config/src/index.ts:1399-1411` | Extended the existing `superRefine` with the `authEnv`-required-when-enabled issue at `['mcp','authEnv']` — fail the load, not the first request (R1, Q&A decision). |
| `packages/config/src/index.ts:1453-1456` | `buildConfigFromEnv` now reads `SPUR_MCP_ENABLED` (via `parseEnvBoolean`) and `SPUR_MCP_AUTH_ENV` into `server.mcp`. |
| `apps/server/src/server-config.ts:41-44` | Added `mcp?: { enabled: boolean; authEnv: string | null }` to `ServerBootConfig` (frozen shape, feature B9). |
| `apps/server/src/server-config.ts:68-71` | `serverBootstrapConfig()` now maps `appConfig.server.mcp` into boot config, `authEnv ?? null` like `a2a`. |
| `packages/app/src/services/project-gateway.ts:133` | `gatewayGuard` exempts `segments[1] === 'mcp'` alongside `'a2a'` from browser-origin CSRF checks — bearer-authenticated routes a cross-site simple request cannot produce (R2). Host allowlist (`isAllowedHost`) still runs first for every path, including `/mcp`. |
| `packages/app/src/services/project-gateway.ts:90-92` | Updated `gatewayGuard` doc comment to name the `/<prefix>/mcp/*` exemption. |

**Tests**

| File | Change |
| --- | --- |
| `packages/config/tests/config.test.ts:93-113` | New `config — embedded MCP server (feature B9)` describe: default off, env switch + token-variable name read, enabled-without-`authEnv` fails the load, malformed boolean rejected. |
| `packages/config/tests/config.test.ts:20,45` | Updated the two full-shape scaffold/env expectations for the new `mcp: { enabled: false }` default. |
| `packages/app/tests/services/project-gateway-edge.test.ts:112-129` | New edge tests: `/alpha/mcp/tools/list` form POST is CSRF-exempt; `evil.test` host on `/mcp` still gets 421 (anti-pattern guard: no host-allowlist bypass). |

**Design conformance**

- Mirrors the `server.a2a` contract end to end (schema, env names, boot config, gateway exemption) per the closed Q&A decision.
- Frozen names honored: `SPUR_MCP_ENABLED`, `SPUR_MCP_AUTH_ENV`, `ServerBootConfig.mcp`, `server.mcp`.
- Leaves mcpModule mounting/auth (tasks 1371–1374) untouched — this task only gates config + gateway routing.

**Gate note (pre-existing, out of scope)**

- `task gate 1370 light` rules:pre/rules:post FAIL on `packages/app/src/services/project-gateway-html.ts:873` (`no-direct-fetch`) and `:9,15` (`every-export-has-tsdoc`). That file is not in this task's scope and is unmodified by this pass — the flagged lines are byte-identical on `main`; the rule presets scan it because sibling runall commit `9e2f34dd7` touched the file on this branch. Every check bound to this pass's changed files passes (format-lint:changed, typecheck ×4, test ×3, coverage ×3). Left for the pipeline gate/remediate hop or the owning task.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/config/src/index.ts:21-22` (`SPUR_MCP_ENABLED`/`SPUR_MCP_AUTH_ENV`), `:1365-1374` (`server.mcp` Zod object, default `{ enabled: false }`), `:1392` (server-level default), `:1405-1412` (`superRefine` requires `authEnv` when enabled — fails the load), `:1453-1456` (`buildConfigFromEnv` env funnel); `apps/server/src/server-config.ts:27` (`ServerBootConfig.mcp` frozen shape), `:68-71` (boot mapping, `authEnv ?? null`); tests `packages/config/tests/config.test.ts:93-113` (default off / env read / enabled-without-`authEnv` throws / malformed boolean throws) |
| R2 | MET | `packages/app/src/services/project-gateway.ts:133` (exempt `segments[1] === 'mcp'` alongside `'a2a'`), `:124-126` (host allowlist still first for every path), `:116-117` (doc comment names the `/<prefix>/mcp/*` exemption); tests `packages/app/tests/services/project-gateway-edge.test.ts:112-129` (form POST on `/alpha/mcp/tools/list` CSRF-exempt; `evil.test` host on `/mcp` → 421) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1) | N/A | n/a | Criterion's module-mount clause is owned by sibling tasks 1371–1374 (status `todo`) per the task's approved Dependencies & Handoff `docs/tasks5/1370_config-schema-and-gateway-exemption-for-embedded-mcp-2-0-ser.md:58,94` — out of this task's scope, so not assessable against this diff (grep: no `mcpModule` under `apps/`/`packages/`). This task's delivered config-gate half (req R1) is MET and traced under R1: tests `packages/config/tests/config.test.ts:93-113`; boot mapping `apps/server/src/server-config.ts:68-71` |
| AC2 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R2) | MET | test | Exemption at `packages/app/src/services/project-gateway.ts:133` with host allowlist preserved first (`:124-126`); CSRF-exempt and host-allowlist tests `packages/app/tests/services/project-gateway-edge.test.ts:112-129`; generic prefix proxying unchanged (gateway is a pass-through for prefixed paths) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1370

**Scope:** task 1370 diff (working tree vs base `d0ebf80a`; 7 files: `packages/config/src/index.ts`, `packages/config/tests/config.test.ts`, `apps/server/src/server-config.ts`, `packages/app/src/services/project-gateway.ts`, `packages/app/src/services/project-gateway-edge.test.ts`, `packages/app/src/services/project-gateway-html.ts` (3 gate-remediation edits, in scope), task corpus doc). Changes are uncommitted on `sp/runall-b9-7e0288`; HEAD == base, so the reviewed diff is the working-tree diff.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (`--focus all`)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | functional | AC1's mcpModule-mount clause is not in this diff: no `mcpModule` exists anywhere under `apps/` or `packages/` (grep verified). This is the task's own approved split — Dependencies & Handoff defers mounting/auth to sibling tasks 1371–1374 (all exist, status `todo`). The config gate that conditions the future mount (default off, `authEnv` required at load) is delivered and tested. | `docs/tasks5/1370_config-schema-and-gateway-exemption-for-embedded-mcp-2-0-ser.md:58,94` | ACCEPTED (planned split to 1371–1374) |
| 2 | P4 (advisory) | architecture | `serverBootstrapConfig`'s new `mcp` boot mapping has no direct unit test — it mirrors the pre-existing `a2a` gap (`apps/server/tests/server-config.test.ts` asserts logging/jobqueue/scheduler only, never `a2a`). Shape is enforced by `typecheck:apps/server`; parse behavior is covered by the config schema tests. | `apps/server/src/server-config.ts:68-71` | ACCEPTED (mirrors precedent, non-blocking) |
| 3 | P4 (advisory) | correctness | Gate-remediation edits in `project-gateway-html.ts` reviewed and correct: the two added TSDoc lines document exported interfaces, and `window.fetch` is valid in the embedded landing-page script (browser context; no client seam exists there — comment states why). `rules:pre` + `rules:post` now PASS on this file per the check receipt. | `packages/app/src/services/project-gateway-html.ts:9,16,875-876` | RESOLVED (receipt `.spur/run/1370-check-receipt.json`, checks `rules:pre`/`rules:post` PASS) |

No P1–P3 findings. Security pass: the CSRF exemption is scoped to `segments[1] === 'mcp'` and the host allowlist (`isAllowedHost` → 421) runs first for every path including `/mcp` — the anti-pattern "do not exempt `/mcp` from `isAllowedHost`" is guarded by a test (`evil.test` host → 421). The exemption's trust argument (bearer-auth routes a cross-site simple request cannot produce) matches the existing `a2a` precedent and is documented in the guard's doc comment. Correctness pass: `server.mcp` mirrors `server.a2a` end-to-end (schema default, `superRefine` fail-at-load, `SPUR_ENV_VARS` frozen names `SPUR_MCP_ENABLED`/`SPUR_MCP_AUTH_ENV`, `buildConfigFromEnv` via `parseEnvBoolean` which throws on malformed values — `packages/config/src/index.ts:1430-1439`). Efficiency/usability: no perf-sensitive paths touched; error messages name the fix.

Gate evidence: named checks `format-lint:changed`, `rules:pre`, `rules:post`, `typecheck:apps/cli`, `typecheck:apps/server`, `typecheck:packages/app`, `typecheck:packages/config`, `test:apps/server`, `coverage:apps/server`, `test:packages/app`, `test:packages/config`, `coverage:packages/config` — 12/12 PASS (tier light; receipt `.spur/run/1370-check-receipt.json`, log `.spur/run/1370-light-gate.log`; integrated full gate deferred to the batch base ref per the receipt's own note). Fresh review-side runs: `bun test tests/config.test.ts` in `packages/config` → 15 pass / 0 fail; `bun test tests/services/project-gateway-edge.test.ts` in `packages/app` → pass including both new `/mcp` cases.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/config/src/index.ts:21-22` (`SPUR_MCP_ENABLED`/`SPUR_MCP_AUTH_ENV`), `:1365-1374` (`server.mcp` Zod object, default `{ enabled: false }`), `:1392` (server-level default), `:1405-1412` (`superRefine` requires `authEnv` when enabled — fails the load), `:1453-1456` (`buildConfigFromEnv` env funnel); `apps/server/src/server-config.ts:27` (`ServerBootConfig.mcp` frozen shape), `:68-71` (boot mapping, `authEnv ?? null`); tests `packages/config/tests/config.test.ts:93-113` (default off / env read / enabled-without-`authEnv` throws / malformed boolean throws) |
| R2 | MET | `packages/app/src/services/project-gateway.ts:133` (exempt `segments[1] === 'mcp'` alongside `'a2a'`), `:124-126` (host allowlist still first for every path), `:116-117` (doc comment names the `/<prefix>/mcp/*` exemption); tests `packages/app/tests/services/project-gateway-edge.test.ts:112-129` (form POST on `/alpha/mcp/tools/list` CSRF-exempt; `evil.test` host on `/mcp` → 421) |

##### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — Embedded mcpModule mounts on spur serve only when enabled and enforces bearer auth (req: R1) | N/A | n/a | Criterion's module-mount clause is owned by sibling tasks 1371–1374 (status `todo`) per the task's approved Dependencies & Handoff `docs/tasks5/1370_config-schema-and-gateway-exemption-for-embedded-mcp-2-0-ser.md:58,94` — out of this task's scope, so not assessable against this diff (grep: no `mcpModule` under `apps/`/`packages/`). This task's delivered config-gate half (req R1) is MET and traced under R1: tests `packages/config/tests/config.test.ts:93-113`; boot mapping `apps/server/src/server-config.ts:68-71` |
| AC2 — Gateway proxies /<prefix>/mcp with bearer-auth CSRF exemption (req: R2) | MET | test+static-ref | Exemption at `packages/app/src/services/project-gateway.ts:133` with host allowlist preserved first (`:124-126`); CSRF-exempt and host-allowlist tests `packages/app/tests/services/project-gateway-edge.test.ts:112-129`; generic prefix proxying unchanged (gateway is a pass-through for prefixed paths) |

**Residual risk:** light-tier gate only — the integrated full gate is owed on the batch base ref (receipt's deferred-tier note); the mcpModule mount/bearer path is owned and will be reviewed under tasks 1371/1372.

**Next:** proceed to tasks 1371–1374; no remediation required for 1370.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)
- 2026-11-17T19:25:39.088Z todo → wip (system)
- 2026-11-17T19:36:44.460Z wip → testing (system)
- 2026-11-17T19:36:46.036Z testing → done (system)

