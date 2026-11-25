---
schema_version: 1
name: "Integrations MCP polish: config diagnostics, gateway inheritance, multi-agent Client config TabView, and per-agent readiness pins"
status: done
template: feature-impl
created_at: 2026-11-25T18:12:12.528Z
updated_at: "2026-11-25T18:47:06.350Z"
feature_id: A82

tags: ["integrations", "A82", "mcp"]
ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 10
done_forced: "false"
done_reason: unforced close
---

## 1449. Integrations MCP polish: config diagnostics, gateway inheritance, multi-agent Client config TabView, and per-agent readiness pins

### Background

Follow-up to the A82 Integrations Board module (`docs/design/integrations-module.md`) addressing operator-observed gaps when configuring MCP/A2A in `~/.config/spur/config.yaml` and using `/board/integrations`.

Direct small fixes already applied in the working tree (not repeated here):
- `packages/app/src/services/gateway-daemon.ts`: bake `SPUR_GATEWAY_PORT` into the LaunchAgent plist.
- `apps/cli/src/commands/mcp.ts`: pass `spurConfig` into `resolveMcpUrl`.
- `apps/server/src/server-config.ts` and `apps/server/src/modules/integrations/handlers.ts`: carry `bootConfig.gateway.port` into `gatewayPort()` and `resolveProjectGatewayUrl()`.
- `config/config.global.yaml`, `docs/design/embedded-mcp-server.md`, and `docs/design/project-gateway.md`: clarify `server.mcp` vs `server.gateway.mcp` and `allowUnauthenticated`.

Remaining work scoped to this task:
1. **Startup config diagnostics & forwarded-host gateway port fallback:** Surface `loadSpurConfig` errors loudly instead of silent `null`, fall back to the loopback `x-forwarded-host` port when unconfigured, and warn in the Board when `gateway.mcp.enabled` is true while project `mcp.enabled` is false.
2. **Ergonomic `server.gateway.mcp` inheritance:** Reduce boilerplate between `server.mcp` and `server.gateway.mcp` without breaking existing single-project `server.mcp` configs or ADR-151 K41 credential isolation.
3. **Multi-agent `Client config` TabView & auth guidance:** Replace the single HTTP JSON snippet in `McpTab.tsx` with verified native config tabs per supported coding agent, transport selection (`spur mcp` stdio bridges vs direct HTTP `>= 2026-07-28`), always-resolved URLs, and clear `authEnv` / `allowUnauthenticated` guidance.
4. **Read-only per-agent MCP readiness pins:** Surface per-agent readiness in `/board/integrations` from binary presence, native config inspection, and passive `usage.byActor` (`X-Spur-Actor`) traffic.

**Refine corrections (2026-11-25)**

- Claim: `apps/cli/src/commands/self/serve.ts` (`--gateway`) calls `loadSpurConfig` without `EMBEDDED_SPUR_SCHEMAS` → Verified reality: `apps/cli/src/index.ts:60-66,86` injects `loadProjectConfigOrNull` which passes `EMBEDDED_SPUR_SCHEMAS` but silently swallows errors into `null`; `apps/server/src/serve.ts:810` and the un-injected fallback in `apps/cli/src/commands/self/serve.ts:93` lack `EMBEDDED_SPUR_SCHEMAS` → Resolution: thread `embeddedSchemas` into `StartServerOptions` and capture/log `configDiagnostic` on both paths instead of silent `null`.
- Claim: `gatewayPort()` can fall back to `x-forwarded-host` after checking `bootConfig.gateway.port` → Verified reality: `configSchema` defaults `server.gateway.port` to `3000`, so `bootConfig.gateway.port` is always `3000` even when unconfigured, and `IntegrationsSources.gateway()` (`packages/app/src/services/integrations-service.ts:76`) does not currently receive `forwardedHost` → Resolution: add `explicit?: boolean` to `ServerBootConfig.gateway` and thread `forwardedHost` into `IntegrationsSources.gateway(since, forwardedHost)` with explicit precedence.
- Claim: `server.gateway.mcp.enabled` unconditionally inherits `server.mcp.enabled` when omitted → Verified reality: existing callers/tests (`packages/config/tests/config.test.ts:100-106`, `apps/server/tests/server-config.test.ts:30-49`) enable `server.mcp` with `SPUR_MCP_AUTH_ENV` only; unconditional inheritance would fail `configSchema.superRefine` on missing `server.gateway.mcp.authEnv` → Resolution: inherit `allowUnauthenticated` unconditionally when omitted, and inherit `enabled: true` only when `gateway.mcp.enabled` is omitted AND gateway auth is satisfied (`gateway.mcp.authEnv` is set or effective `allowUnauthenticated === true`).
- Claim: `McpTab` can omit `Authorization` when `allowUnauthenticated` is active without a token → Verified reality: `integrationsAuthSchema` (`packages/contracts/src/integrations.ts:38-41`) only has `{ envName, tokenPresent }`, and `handlers.ts:56` sets `tokenPresent: true` when `allowUnauthenticated` is true, making set-token vs unauthenticated indistinguishable on the wire → Resolution: add optional `allowUnauthenticated?: boolean` to `integrationsAuthSchema` and pass actual `tokenPresent` + `allowUnauthenticated` from server/gateway handlers while keeping `surfaceState()` returning `'on'` when either holds.
- Claim: `apps/server/src/worker.ts` serves `integrations.status` and needs a Worker stub for R4 → Verified reality: `apps/server/src/worker-app.ts:62-69` returns `503` for all `/api/*` routes other than health/project and never mounts `integrations` → Resolution: expose R4 as a separate read-only oRPC procedure `GET /api/integrations/agent-readiness` (`integrations.agentReadiness`) backed by a Node-only `packages/app` service (CF-safe core untouched), tolerantly fetched by `useIntegrations` so older/remote servers degrade cleanly to `{ available: false }`.
- Claim: Optional zero-token `spur mcp` bridge spawn button in R4 → Verified reality: `docs/design/integrations-module.md` §2 keeps Integrations strictly read-only with no process-spawning RPCs → Resolution: deferred out of scope in Q&A; keep R4 strictly read-only (binary check + native config parse + passive `usage.byActor`).

### Requirements

- [x] R1. Thread `EMBEDDED_SPUR_SCHEMAS` into `startServer` (`apps/server/src/serve.ts`) via `StartServerOptions` and capture non-fatal `loadSpurConfig` errors into `ServerBootConfig.configDiagnostic` (logged at startup and exposed as optional `configDiagnostic` on `integrations.status`) across both project serve and `--gateway`; track `ServerBootConfig.gateway.explicit` and thread `forwardedHost` into `IntegrationsSources.gateway(since, forwardedHost)` so `gatewayPort()` falls back to the loopback `x-forwarded-host` port when no env/YAML port is explicitly configured; and render an inline warning in `SummaryTab` and `McpTab` when `gateway.mcp.enabled` is true while project `mcp.enabled` is false.
- [x] R2. Update `packages/config/src/index.ts` (`serverProtocolConfigSchema`, `configSchema`, `buildConfigFromEnv`) and `apps/cli/schemas/spur-config.schema.json` so `server.gateway.mcp` inherits `allowUnauthenticated` from `server.mcp` when omitted and inherits `enabled: true` from `server.mcp` when `server.gateway.mcp.enabled` (and `SPUR_GATEWAY_MCP_ENABLED`) is omitted and gateway auth is satisfied (`gateway.mcp.authEnv` is set or effective `allowUnauthenticated` is true), while preserving explicit `true`/`false` overrides and keeping `server.gateway.mcp.authEnv` independent per ADR-151 K41.
- [x] R3. Extend `integrationsAuthSchema` (`packages/contracts/src/integrations.ts`) and server/gateway auth projections with optional `allowUnauthenticated`, and replace the single JSON `Client config` card in `apps/web/src/modules/integrations/McpTab.tsx` and `helpers.ts` with a `ModuleTabs`-based multi-agent TabView covering `claude`, `codex` (TOML with `env_vars` allowlist), `gemini`, `pi`, `omp` (YAML), `opencode`, `grok` (TOML), `openclaw`, and `generic` (HTTP JSON), a transport selector (`gateway-stdio`, `project-stdio`, `direct-http` with MCP >= 2026-07-28 compatibility note), always-resolved server URLs (never literal `<server>`), and inline auth/env-var guidance (never literal `<ENV_NAME>`, omitting `Authorization` when `allowUnauthenticated` is active with `tokenPresent` false, and showing copyable `export` instructions when a required token is unset).
- [x] R4. Add a read-only oRPC procedure `GET /api/integrations/agent-readiness` (`integrations.agentReadiness` in `packages/contracts/src/integrations.ts`) backed by a new `packages/app` service `probeAgentMcpReadiness()` (never mutating files or spawning LLM/bridge processes) that combines binary availability (`.spur/run/agent-doctor.json` cache or PATH lookup), read-only inspection of each supported agent's native MCP config files, and passive `usage.byActor` (`X-Spur-Actor`) telemetry, and render per-agent readiness pins (`active`, `configured`, `misconfigured`, `not-configured`, `not-installed`) with tooltips and remedies in `McpTab.tsx`.

**Out of scope / Non-goals**
- Writing, repairing, or generating agent config files from the Board (owned by Superskill per `AGENTS.md`).
- Spawning live LLM turns or `spur mcp` subprocess probes from the Board (deferred; read-only module contract per `docs/design/integrations-module.md` §2).
- Automatically hot-reloading `bootConfig` without restarting `spur self serve` or the gateway.
- Adding `antigravity` or `hermes` native config parsers beyond `not-installed` / generic guidance until their MCP config schemas are verified in `docs/design/mcp-agent-adoption.md`.

### Acceptance Criteria

```gherkin
Feature: Integrations MCP polish — diagnostics, gateway inheritance, multi-agent client config, and readiness pins

  Scenario: AC1 — Config diagnostics, loopback x-forwarded-host gateway port fallback, and gateway/project MCP warning (req: R1)
    Given a served project whose config load failed or whose gateway answers on an unconfigured forwarded loopback host port (e.g. localhost:3070)
    When the Board reads integrations.status (verified in apps/server/tests/serve.test.ts, apps/server/tests/modules/integrations/handlers.test.ts, and apps/web/tests/modules/integrations/integrations-module.test.tsx)
    Then configDiagnostic names the config failure instead of silently reporting all surfaces off
    And when no explicit SPUR_GATEWAY_PORT or YAML server.gateway.port is set, the gateway probe resolves the loopback x-forwarded-host port while explicit env/YAML ports still win and non-loopback hosts keep default 3000
    And when gateway.mcp.enabled is true while project mcp.enabled is false, SummaryTab/McpTab displays a warning that gateway tools/call requires server.mcp.enabled on target projects

  Scenario: AC2 — server.gateway.mcp conditional inheritance without breaking single-project MCP configs (req: R2)
    Given a config with server.mcp.enabled: true and server.mcp.allowUnauthenticated: true and no server.gateway.mcp.enabled field
    When buildConfigFromEnv parses the config (verified in packages/config/tests/config.test.ts and apps/server/tests/server-config.test.ts)
    Then server.gateway.mcp.enabled resolves to true and server.gateway.mcp.allowUnauthenticated resolves to true
    And an explicit server.gateway.mcp.enabled: false overrides inheritance
    And an existing single-project config with server.mcp.enabled: true + authEnv only (no gateway authEnv/allowUnauthenticated) leaves gateway.mcp.enabled false without failing config load
    And server.gateway.mcp.authEnv remains independent and is never implicitly copied from server.mcp.authEnv

  Scenario: AC3 — Multi-agent Client config TabView with native formats, live URLs, and auth guidance (req: R3)
    Given the operator opens Integrations > MCP on http://localhost:3070/spur-new/board/integrations
    When inspecting the Client config card across agent tabs and transport modes (verified in apps/web/tests/modules/integrations/helpers.test.ts and integrations-module.test.tsx)
    Then Codex renders valid TOML with [mcp_servers.spur] and env_vars allowlist, omp renders YAML, and JSON-based agents render their verified native structures
    And the endpoint URL uses the resolved gateway/project URL (or current Board origin fallback when off), never literal "<server>"
    And the auth guidance names the configured env var (never literal "<ENV_NAME>"), explains that it names an environment variable rather than a stored secret, omits Authorization when allowUnauthenticated is active with tokenPresent false, and shows copyable export instructions when a required token is unset
    And data-testid="integrations-mcp-project-command" and data-testid="integrations-mcp-snippet" remain intact for integrations-browser.heavy.test.ts

  Scenario: AC4 — Read-only per-agent MCP readiness probe and pins (req: R4)
    Given local coding agents in all five readiness states (active via X-Spur-Actor, configured in native config file, misconfigured transport or missing Codex env_vars, installed without spur entry, or not installed)
    When the probe runs and McpTab renders (verified in packages/app/tests/services/agent-mcp-readiness.test.ts, apps/server/tests/modules/integrations/handlers.test.ts, and apps/web/tests/modules/integrations/integrations-module.test.tsx)
    Then each agent displays its accurate readiness pin (active, configured, misconfigured, not-configured, or not-installed) with detail and remedy
    And no agent config file is modified and no LLM turn or bridge subprocess is spawned
    And GET /api/integrations/agent-readiness never leaks token values, and an unavailable/404 response degrades cleanly in useIntegrations without failing integrations.status
```

### Q&A

- **Q1 (Config load failure policy):** Keep `startServer` non-fatal on non-`BoardModuleConfigError` config errors (preserving boot resilience), but log an actionable warning via `appRt.logger.warn` and surface `configDiagnostic` on `ServerBootConfig` and `integrations.status` rather than silently swallowing. (Closed.)
- **Q2 (`server.gateway.mcp` inheritance vs single-project configs):** Inherit `allowUnauthenticated` unconditionally when omitted on `server.gateway.mcp`; inherit `enabled: true` only when `server.gateway.mcp.enabled` (and `SPUR_GATEWAY_MCP_ENABLED`) is omitted AND gateway auth is satisfied (`gateway.mcp.authEnv` is set or effective `allowUnauthenticated === true`). Never copy `server.mcp.authEnv` into `server.gateway.mcp.authEnv` (ADR-151 K41). (Closed.)
- **Q3 (`allowUnauthenticated` wire signal):** Add optional `allowUnauthenticated?: boolean` to `integrationsAuthSchema` and pass real `tokenPresent` (whether `env[authEnv]` is non-empty) separately from `allowUnauthenticated`, while keeping `surfaceState()` returning `'on'` when `tokenPresent || allowUnauthenticated === true`. (Closed.)
- **Q4 (Readiness probe endpoint & scope):** Expose R4 as a separate read-only oRPC procedure `integrations.agentReadiness` (`GET /api/integrations/agent-readiness`), fetched tolerantly by `useIntegrations` so older servers or unavailable environments degrade cleanly to `{ available: false }` without breaking `integrations.status`. (Closed.)
- **Q5 (Live `spur mcp` subprocess bridge probe button):** Deferred out of scope — keeps Integrations strictly read-only and subprocess-free per `docs/design/integrations-module.md` §2; operators can copy the existing `Discovery probe` or `spur mcp` commands on `McpTab`. (Closed.)

### Design

**R1 — Startup Config Diagnostics & Forwarded-Host Port Fallback**
- **WHAT / WHERE:** Thread `EMBEDDED_SPUR_SCHEMAS` into `StartServerOptions.embeddedSchemas?: ReadonlyMap<string, string>` (`apps/server/src/serve.ts`), passed from `apps/cli/src/commands/self/serve.ts`, so `$schema` resolution never fails inside bundled/compiled `spur`. Capture any non-`BoardModuleConfigError` `loadSpurConfig` failure message into `ServerBootConfig.configDiagnostic?: string` (`apps/server/src/server-config.ts`) and log it via `appRt.logger.warn` in `startServer` (and via `context.output.error` / stderr in `spur self serve --gateway`). Expose `configDiagnostic?: string` on `integrationsStatusSchema` (`packages/contracts/src/integrations.ts`).
- **Gateway port precedence:** Add `explicit?: boolean` to `ServerBootConfig.gateway` (`serverBootstrapConfig` sets `explicit: env[SPUR_ENV_VARS.gatewayPort] !== undefined || spurConfig?.server?.gateway?.port !== undefined`). Thread `forwardedHost` into `IntegrationsSources.gateway(since?: string, forwardedHost?: string | null)` (`packages/app/src/services/integrations-service.ts`). In `gatewayPort(env, bootGateway, forwardedHost)` (`apps/server/src/modules/integrations/handlers.ts`), resolve in strict order:
  1. `SPUR_GATEWAY_PORT` env if finite `> 0`
  2. `bootGateway.port` if `bootGateway?.explicit === true` and finite `> 0`
  3. Loopback port parsed from `forwardedHost` (`localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>` using `isLocalHost`)
  4. Default `3000`
- **Board warnings:** Render a `Diagnostic` warning in `SummaryTab.tsx` when `status.configDiagnostic` is present, and an inline warning in `SummaryTab.tsx` and `McpTab.tsx` when `status.gateway.served && status.gateway.mcp?.enabled && !status.mcp.enabled` (explaining that gateway `tools/call` forwards to each project's loopback `/mcp` and requires `server.mcp.enabled: true`).
- **Anti-patterns:** Never swallow `loadSpurConfig` errors silently; never parse a port from a non-loopback `x-forwarded-host` (e.g., tunnel `:443`).

**R2 — Ergonomic `server.gateway.mcp` Conditional Inheritance**
- **WHAT / WHERE:** Update `buildConfigFromEnv` in `packages/config/src/index.ts` and mirror documentation in `apps/cli/schemas/spur-config.schema.json`, `docs/design/configuration-contracts.md`, and `docs/design/project-gateway.md`.
- **Algorithm:**
  - `mcpEnabled = parseEnvBoolean(env[SPUR_ENV_VARS.mcpEnabled]) ?? fileServer?.mcp?.enabled`
  - `mcpAllowUnauth = fileServer?.mcp?.allowUnauthenticated`
  - `gwAuthEnv = env[SPUR_ENV_VARS.gatewayMcpAuthEnv] ?? fileServer?.gateway?.mcp?.authEnv`
  - `gwAllowUnauth = fileServer?.gateway?.mcp?.allowUnauthenticated ?? mcpAllowUnauth`
  - `explicitGwEnabled = parseEnvBoolean(env[SPUR_ENV_VARS.gatewayMcpEnabled]) ?? fileServer?.gateway?.mcp?.enabled`
  - `gwEnabled = explicitGwEnabled !== undefined ? explicitGwEnabled : (mcpEnabled === true && (gwAuthEnv !== undefined || gwAllowUnauth === true)) ? true : undefined`
- **Anti-patterns:** Never copy `server.mcp.authEnv` into `server.gateway.mcp.authEnv` (ADR-151 K41); never enable `gateway.mcp` unconditionally when only `server.mcp` + `SPUR_MCP_AUTH_ENV` is configured (would break existing single-project configs in `packages/config/tests/config.test.ts` and `apps/server/tests/server-config.test.ts`).

**R3 — Multi-Agent `Client config` TabView & Auth Guidance**
- **Wire change:** Add `allowUnauthenticated: z.boolean().optional()` to `integrationsAuthSchema` (`packages/contracts/src/integrations.ts`). In `apps/server/src/modules/integrations/handlers.ts` and `packages/app/src/services/project-gateway.ts` (`/api/health`), emit actual `tokenPresent` (env non-empty) alongside `allowUnauthenticated` (when true). Update `surfaceState()` in `apps/web/src/modules/integrations/helpers.ts` to return `'on'` when `surface.auth.tokenPresent || surface.auth.allowUnauthenticated === true`.
- **Frozen web helper names (`apps/web/src/modules/integrations/helpers.ts`):**
  - `MCP_CLIENT_AGENTS = ['claude', 'codex', 'gemini', 'pi', 'omp', 'opencode', 'grok', 'openclaw', 'generic'] as const` and `type McpClientAgent`
  - `type McpClientTransport = 'gateway-stdio' | 'project-stdio' | 'http'`
  - `interface McpClientConfigView { agent: McpClientAgent; label: string; format: 'json' | 'toml' | 'yaml'; configPath: string; snippet: string; transportNote: string; authNote: string; exportCommand: string | null }`
  - `renderClientConfig(status: IntegrationsStatus, agent: McpClientAgent, transport: McpClientTransport, fallbackOrigin?: string): McpClientConfigView`
  - Keep `clientSnippet(status)` returning the resolved HTTP JSON snippet (no `<server>` or `<ENV_NAME>` when fallback origin / unauthenticated state applies) and preserve `data-testid="integrations-mcp-snippet"` and `data-testid="integrations-mcp-project-command"` (`integrations-browser.heavy.test.ts:102`).
- **UI & formatting (`apps/web/src/modules/integrations/McpTab.tsx`):**
  - Render agent tabs via `ModuleTabs` (`idPrefix="integrations-mcp-client"`) and a transport toggle (`Gateway stdio bridge (recommended)` / `Project stdio bridge` / `Direct HTTP (MCP 2026-07-28+)`).
  - Use verified native formats from `scripts/commands/mcp-agent-interop.ts`: Codex TOML (`[mcp_servers.spur]` + `env_vars` allowlist), `omp` YAML (`mcp_servers:`), Grok TOML, OpenCode JSON (`$schema`, `mcp.spur`), OpenClaw JSON (`mcp.servers.spur`), Gemini JSON (`httpUrl` for HTTP, `command`/`args` for stdio), Claude Code & `pi` JSON (`mcpServers.spur`, plus `superskill install sp` note for Claude).
  - Resolve URL via `status.mcp.url` / `status.gateway.rootMcpUrl` → `fallbackOrigin + withBase('/mcp')` (never literal `<server>`). Show a surface-off badge if disabled.
  - Explain `authEnv` inline: omit `Authorization` when `allowUnauthenticated === true && !tokenPresent`, explain that `authEnv` names an environment variable (never a stored token), and show `export <VAR>="$(openssl rand -hex 32)"` when `!tokenPresent && !allowUnauthenticated`.
- **Anti-patterns:** Never leak token values; never default legacy-revision agents (`claude`, `codex`, `pi`) to direct HTTP without citing the `docs/design/mcp-agent-adoption.md` protocol-version floor (`2026-07-28`).

**R4 — Read-Only Per-Agent MCP Readiness Probe & Pins**
- **Contract (`packages/contracts/src/integrations.ts`):**
  - `integrationsAgentReadinessStateSchema = z.enum(['active', 'configured', 'misconfigured', 'not-configured', 'not-installed'])`
  - `integrationsAgentReadinessEntrySchema = z.object({ agent: z.string(), label: z.string(), state: integrationsAgentReadinessStateSchema, transport: z.enum(['stdio', 'http']).nullable(), configPath: z.string().nullable(), detail: z.string(), remedy: z.string().nullable(), observedCalls: z.number() })`
  - `integrationsAgentReadinessSchema = z.object({ available: z.boolean(), reason: z.string().optional(), agents: z.array(integrationsAgentReadinessEntrySchema) })`
  - Procedure `integrations.agentReadiness`: `GET /integrations/agent-readiness`.
- **App service (`packages/app/src/services/agent-mcp-readiness.ts`):**
  - Export `probeAgentMcpReadiness(deps)` (Node-only via `packages/app/src/index.ts`, never imported by `packages/config` CF-safe core). Injectable `{ cwd, home, env, fs, resolveBinary, usageActors, surface: { mcpEnabled, gatewayMcpEnabled, gatewayPort, projectUrl } }`.
  - Signals: (1) binary presence via `.spur/run/agent-doctor.json` cache (if valid) or `resolveBinary` (`which`), (2) read-only inspection of native config files (`.mcp.json`, `~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`, `~/.pi/agent/mcp.json`, `.pi/mcp.json`, `~/.omp/agent/config.yml`, `opencode.json`, `~/.config/opencode/opencode.json`, `.grok/config.toml`, `~/.grok/config.toml`, `~/.openclaw/config.json`) using `JSON.parse`, `yaml`, and `Bun.TOML.parse` (no new deps), (3) passive `usageActors` (`X-Spur-Actor`) matched case-insensitively (`claude`/`claude-code`, `codex`, `pi`, `omp`, `gemini`, `opencode`, `grok`, `openclaw`).
  - Pin states: not installed → `not-installed`; installed + no `spur` entry → `not-configured`; issue detected (HTTP transport on legacy-revision agent, Codex missing required `env_vars`, target surface disabled, or wrong port/URL) → `misconfigured`; valid entry + `observedCalls > 0` → `active`; valid entry + `observedCalls === 0` → `configured`.
- **Server & Web wiring:** Handler in `apps/server/src/modules/integrations/handlers.ts` wires `protocolUsageSummary(db, {})` actors, `ctx.cwd`, `homedir()`, `bearerEnv(ctx)`, and `bootConfig`. `useIntegrations.ts` fetches `client.integrations.agentReadiness()` tolerantly (defaulting to `null` / `{ available: false }` on 404/503 or error). `McpTab.tsx` renders each agent's readiness pin badge, diagnostic detail, and remedy alongside the tab strip.
- **Anti-patterns:** Never write/edit agent config files; never spawn agent CLIs or LLM turns; never return token values.

**Primary file targets & concurrency**
- Files: `packages/config/src/index.ts`, `apps/cli/schemas/spur-config.schema.json`, `packages/contracts/src/integrations.ts`, `packages/app/src/services/{integrations-service,agent-mcp-readiness,project-gateway}.ts`, `packages/app/src/index.ts`, `apps/server/src/{serve,server-config}.ts`, `apps/server/src/modules/integrations/handlers.ts`, `apps/cli/src/commands/self/serve.ts`, `apps/web/src/modules/integrations/{helpers,McpTab,SummaryTab,useIntegrations}.ts(x)`, plus corresponding test files and `docs/design/{integrations-module,project-gateway,configuration-contracts}.md`.
- Dependencies & concurrency: No task `dependencies[]` needed (all prior A82 tasks 1421–1425, 1437–1442, 1446 are `done`). Verified `git worktree list` (main only) and `spur task list --status wip --json` (`[]`).

### Plan

1. [ ] **R1 — Startup config diagnostics & forwarded-host port fallback:** Thread `embeddedSchemas` into `StartServerOptions` (`apps/server/src/serve.ts`) and `apps/cli/src/commands/self/serve.ts`; capture `configDiagnostic` + `gateway.explicit` in `ServerBootConfig` (`apps/server/src/server-config.ts`) and `IntegrationsStatus` (`packages/contracts/src/integrations.ts`); thread `forwardedHost` into `IntegrationsSources.gateway` (`packages/app/src/services/integrations-service.ts`) and implement loopback port fallback in `apps/server/src/modules/integrations/handlers.ts`; render `configDiagnostic` and gateway-on/project-off warnings in `SummaryTab.tsx` and `McpTab.tsx`. Verify with `(cd apps/server && bun test tests/serve.test.ts tests/server-config.test.ts tests/modules/integrations/handlers.test.ts)`.
2. [ ] **R2 — Conditional `server.gateway.mcp` inheritance:** Implement `allowUnauthenticated` and auth-satisfied `enabled` inheritance in `packages/config/src/index.ts` and update schema docs in `apps/cli/schemas/spur-config.schema.json`. Verify with `(cd packages/config && bun test tests/config.test.ts)` and `(cd apps/server && bun test tests/server-config.test.ts)`.
3. [ ] **R3 — Multi-agent `Client config` TabView & auth guidance:** Extend `integrationsAuthSchema` (`packages/contracts/src/integrations.ts`) and handlers/gateway health with `allowUnauthenticated`; update `surfaceState()` and add per-agent snippet builders + transport selector + live URL fallback + inline auth guidance in `apps/web/src/modules/integrations/helpers.ts` and `McpTab.tsx` using `ModuleTabs`. Verify with `(cd apps/web && bun test tests/modules/integrations/helpers.test.ts tests/modules/integrations/integrations-module.test.tsx)`.
4. [ ] **R4 — Read-only per-agent readiness probe & pins:** Implement `packages/app/src/services/agent-mcp-readiness.ts` + `integrations.agentReadiness` contract + handler in `apps/server/src/modules/integrations/handlers.ts` + tolerant fetch in `useIntegrations.ts` + readiness pins in `McpTab.tsx`. Verify with `(cd packages/app && bun test tests/services/agent-mcp-readiness.test.ts)`, `(cd apps/server && bun test tests/modules/integrations/handlers.test.ts)`, and `(cd apps/web && bun test tests/modules/integrations/integrations-module.test.tsx)`.
5. [ ] **Docs & full gate:** Update `docs/design/integrations-module.md`, `docs/design/project-gateway.md`, and `docs/design/configuration-contracts.md`; run `bun run spur-check`, `bun run --filter @gobing-ai/spur build:bundle`, and `apps/web/tests/modules/integrations-browser.heavy.test.ts`.

### Solution

R1 — startup config diagnostics, forwarded-host port fallback, Board warnings.

- `apps/server/src/serve.ts`: `StartServerOptions.embeddedSchemas` reaches `loadSpurConfig`, so a
  bundled `spur self serve` resolves `$schema` instead of failing; any non-`BoardModuleConfigError`
  load failure is captured (message kept on `ServerBootConfig.configDiagnostic`, logged via
  `appRt.logger.warn`). The strict fleet RE-LOAD is replaced by the already-loaded value plus
  `isFleetConfigFailure`, which keeps 0858 R4 fatal (a bad `agent.fleet`/`agent.team`/`fleet.json`
  still aborts boot) while every other config error degrades to a named, visible diagnostic.
- `apps/cli/src/commands/self/serve.ts`: passes `EMBEDDED_SPUR_SCHEMAS` into `startServer` and loads
  the gateway's config through the embedded schemas, reporting a failure on stderr instead of
  `.catch(() => null)`.
- `apps/server/src/server-config.ts`: `ServerBootConfig.gateway` gains `explicit` (env or YAML port
  actually configured — the schema default of 3000 is indistinguishable otherwise), the gateway MCP
  switch, and `configDiagnostic`.
- `apps/server/src/modules/integrations/handlers.ts`: `gatewayPort(env, bootGateway, forwardedHost)`
  resolves `SPUR_GATEWAY_PORT` → explicitly configured port → loopback `x-forwarded-host` port →
  3000 (`loopbackPort` refuses a non-loopback host, so a tunnel's `:443` is never read as local).
- `packages/app/src/services/integrations-service.ts`: `IntegrationsSources.gateway(since,
  forwardedHost)`, an optional `diagnostic()` source projected onto `status.configDiagnostic`.
- `apps/web/src/modules/integrations/helpers.ts` + `SummaryTab.tsx` + `McpTab.tsx` + `IntegrationsModule.tsx`:
  `gatewayWithoutProjectMcp()` drives an inline warning on both tabs, and the Summary renders the
  config diagnostic through `Diagnostic`.

R2 — `server.gateway.mcp` conditional inheritance (`packages/config/src/index.ts`).

`buildConfigFromEnv` inherits `allowUnauthenticated` whenever the gateway does not state its own, and
`enabled: true` only when the gateway's own switch is omitted (env and file) AND its own credential is
satisfied (`gateway.mcp.authEnv` set or effective `allowUnauthenticated`). `authEnv` is never copied
(ADR-151 K41), so a single-project config with only `server.mcp.authEnv` keeps the gateway entry off
instead of failing `configSchema.superRefine`. `apps/cli/schemas/spur-config.schema.json` documents
the rule on each property.

R3 — `allowUnauthenticated` on the wire and the per-agent Client config TabView.

- `packages/contracts/src/integrations.ts`: `integrationsAuthSchema.allowUnauthenticated?`.
- `apps/server/src/modules/integrations/handlers.ts` + `apps/server/src/gateway.ts`: the projections
  report the token's REAL presence and the policy separately (they used to fold one into the other).
- `packages/app/src/services/integrations-service.ts`: `authOf` carries the policy through.
- `apps/web/src/modules/integrations/helpers.ts`: `MCP_CLIENT_AGENTS`, `McpClientTransport`
  (`gateway-stdio`/`project-stdio`/`http`), `McpClientConfigView` and `renderClientConfig()` emit each
  agent's verified native format (Codex/Grok TOML, omp YAML, Claude/pi/Gemini/OpenCode/OpenClaw/generic
  JSON), an always-resolved endpoint (status URL → gateway root → Board origin), and auth guidance
  that names the variable, omits `Authorization` under `allowUnauthenticated`, and offers
  `export <VAR>="$(openssl rand -hex 32)"` when the token is unset. `clientSnippet()` now delegates to
  it; `surfaceState()` treats the policy as "on".
- `apps/web/src/modules/integrations/McpTab.tsx`: `ModuleTabs` (`idPrefix="integrations-mcp-client"`)
  plus a transport toggle; `integrations-mcp-snippet` and `integrations-mcp-project-command` are kept
  verbatim for `integrations-browser.heavy.test.ts`.

R4 — read-only per-agent readiness.

- `packages/app/src/services/agent-mcp-readiness.ts`: `probeAgentMcpReadiness(deps)` reads an installed
  binary (`resolveBinary`), the agent's own native config (`JSON.parse` / `Bun.TOML.parse` / `yaml`),
  and `usageActors` traffic, and returns one entry per agent with `state`, `transport`, `configPath`,
  `detail`, `remedy` and `observedCalls`. No writes, no spawned processes, no token values; a
  malformed config degrades to `not-configured` rather than throwing.
- `packages/contracts/src/integrations.ts` + handler: `integrations.agentReadiness`
  (`GET /api/integrations/agent-readiness`), wired with `protocolUsageSummary(db, {}).byActor`,
  `ctx.cwd`, `homedir()`, `Bun.which` and the boot surface switches.
- `apps/web/src/modules/integrations/useIntegrations.ts`: fetched tolerantly in the module's own
  `Promise.all`, so a 404/503 (older or Worker server) degrades to `readiness: null`;
  `McpTab` renders the pins and an unavailable note.
- Docs: `docs/design/integrations-module.md` (§2 bullets, §2.2, the MCP tab row, states),
  `docs/design/project-gateway.md` (port precedence, inheritance), and
  `docs/design/configuration-contracts.md` (the three gateway MCP rows).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 embeddedSchemas + configDiagnostic + explicit gateway port + forwarded-host fallback + Board warnings | MET | `apps/server/src/serve.ts:201`, `apps/server/src/serve.ts:827-851`, `apps/server/src/server-config.ts:42-43`, `apps/server/src/server-config.ts:99`, `apps/server/src/modules/integrations/handlers.ts:92`, `apps/server/src/modules/integrations/handlers.ts:108`, `apps/server/src/modules/integrations/handlers.ts:218`, `apps/web/src/modules/integrations/helpers.ts:493`, `apps/web/src/modules/integrations/SummaryTab.tsx:201`, `apps/web/src/modules/integrations/McpTab.tsx:96`, `apps/cli/src/commands/self/serve.ts:90-107` |
| R2 server.gateway.mcp conditional inheritance (allowUnauthenticated always, enabled only when gateway auth satisfied, authEnv never copied) | MET | `packages/config/src/index.ts:1630-1645`, `packages/config/src/index.ts:1664-1670`, `apps/cli/schemas/spur-config.schema.json:563-577`, `packages/config/tests/config.test.ts:193-245` |
| R3 allowUnauthenticated on the wire + ModuleTabs per-agent Client config with resolved URLs, transport selector, auth guidance, preserved testids | MET | `packages/contracts/src/integrations.ts:45`, `packages/app/src/services/integrations-service.ts:139-146`, `apps/server/src/gateway.ts:97-102`, `apps/web/src/modules/integrations/helpers.ts:30-320`, `apps/web/src/modules/integrations/McpTab.tsx:384-440` |
| R4 probeAgentMcpReadiness + integrations.agentReadiness + tolerant fetch + readiness pins | MET | `packages/app/src/services/agent-mcp-readiness.ts:326`, `packages/contracts/src/integrations.ts:318`, `apps/server/src/modules/integrations/handlers.ts:267`, `apps/web/src/modules/integrations/useIntegrations.ts:105`, `apps/web/src/modules/integrations/McpTab.tsx:457` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 configDiagnostic, loopback forwarded-host fallback, gateway/project warning | MET | test | `apps/server/tests/modules/integrations/handlers.test.ts` (1449 gateway port precedence: loopback fallback, non-loopback ignored, env and explicit YAML wins; diagnostics + allowUnauthenticated wire), `apps/server/tests/serve.test.ts:2974` (diagnostic logged + carried), `apps/server/tests/server-config.test.ts` (explicit flag), `apps/web/tests/modules/integrations/integrations-module.test.tsx` (both warnings + config diagnostic) |
| AC2 inheritance without breaking single-project configs, explicit false wins, authEnv independent | MET | test | `packages/config/tests/config.test.ts:193-245` (5 cases), `apps/server/tests/server-config.test.ts` (inherited mcp block + env override) |
| AC3 native formats per agent, resolved URL, auth guidance, testids intact | MET | test | `apps/web/tests/modules/integrations/helpers.test.ts` (1449 per-agent client config: Codex TOML + env_vars, omp YAML, OpenCode/OpenClaw/Gemini JSON, no `<server>`, export line, unauthenticated header omission), `apps/web/tests/modules/integrations/integrations-module.test.tsx` (tab switch + transport toggle + preserved `integrations-mcp-project-command`) |
| AC4 five readiness states, no writes, no token leak, 404-tolerant fetch | MET | test | `packages/app/tests/services/agent-mcp-readiness.test.ts` (5 cases incl. before/after file fingerprints and a token value absent from the result), `apps/server/tests/modules/integrations/handlers.test.ts` (endpoint shape, no token), `apps/web/tests/modules/integrations/integrations-module.test.tsx` (pins + unavailable degradation) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewed the 28-file change against R1–R4 / AC1–AC4 at `--focus all` (diffstat lane: 1945 insertions, 105 deletions; the task pins a sensitive surface, so the full depth applied). Full tables and per-row evidence are in the review certificate the run captured
(`.spur/run/<run-id>-review-cert.md`); `spur task verdict 1449` derives **PASS** from those rows.

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `apps/server/src/serve.ts:201`, `:827-851` (`embeddedSchemas`, `configDiagnostic`, `isFleetConfigFailure` keeps 0858 R4 fatal), `apps/server/src/server-config.ts:42-99` (`explicit` + gateway MCP switch), `apps/server/src/modules/integrations/handlers.ts:92-118` (port precedence, loopback-only forwarded fallback), `apps/web/src/modules/integrations/helpers.ts:493`, `SummaryTab.tsx:201`, `McpTab.tsx:96` |
| R2 | MET | `packages/config/src/index.ts:1630-1670`, schema docs `apps/cli/schemas/spur-config.schema.json`, tests `packages/config/tests/config.test.ts` |
| R3 | MET | `packages/contracts/src/integrations.ts:45`, `packages/app/src/services/integrations-service.ts:139`, `apps/server/src/gateway.ts:97`, `apps/web/src/modules/integrations/helpers.ts:53-320`, `McpTab.tsx:384-440` |
| R4 | MET | `packages/app/src/services/agent-mcp-readiness.ts:326`, `packages/contracts/src/integrations.ts:318`, `handlers.ts:267`, `useIntegrations.ts:105`, `McpTab.tsx:457` |

Findings (no open P1–P3):

- **P4 advisory** — `McpTab` rebuilds nine short label strings per render to feed `ModuleTabs`
  (`McpTab.tsx:384`). Noise at this size; worth hoisting only if the card gains a cheaper input.
- **P4 advisory** — the gateway stdio bridge stays selectable while the project surface is off; the
  transport note already names that condition, so it is guidance rather than a defect
  (`helpers.ts:250`).

Security: no token value crosses a boundary — the readiness probe reads no environment at all, the
wire carries only `tokenPresent` / `allowUnauthenticated` booleans, and `apps/server/src/worker-app.ts`
never imports `router.ts`, so the new `node:os` + `Bun.which` use stays off the Cloudflare path.
Correctness: the strict fleet-config failure is preserved (an `agent.fleet` / `agent.team` /
`fleet.json` error still aborts boot), and every other config error now degrades to a named
diagnostic instead of a silent env-only boot. Architecture: the module's read-only contract holds —
the probe and the Board write nothing and spawn nothing.

Verdict: PASS

### References

- Feature: [A82 Integrations Board module](../features/A82_integrations-board-module-mcp-and-a2a-surfaces-made-visible-with-protocol-fixes.md)
- Design: [Integrations Board Module](../design/integrations-module.md)
- Design: [Project Gateway](../design/project-gateway.md)
- Design: [Embedded MCP Server](../design/embedded-mcp-server.md)
- Design: [MCP Agent Adoption Matrix](../design/mcp-agent-adoption.md)
- Design: [Configuration Contracts](../design/configuration-contracts.md)
- Interop formats source: `scripts/commands/mcp-agent-interop.ts`
- Install guide: `docs/install.md`
- Concurrency audit (2026-11-25): `git worktree list` shows main worktree only; `spur task list --status wip --json` returned `[]`.

### History

- 2026-11-25T18:23:31.411Z backlog → todo (system)
- 2026-11-25T18:43:33.769Z todo → wip (system)
- 2026-11-25T18:47:04.656Z wip → testing (system)
- 2026-11-25T18:47:06.345Z testing → done (system)

