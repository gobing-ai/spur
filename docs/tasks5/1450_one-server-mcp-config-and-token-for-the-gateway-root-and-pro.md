---
schema_version: 1
name: One server.mcp config and token for the gateway root and project MCP endpoints
status: done
template: feature-impl
created_at: 2026-11-25T22:13:28.372Z
updated_at: "2026-11-25T22:44:56.170Z"
feature_id: K44

priority: P2
ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close
---

## 1450. One server.mcp config and token for the gateway root and project MCP endpoints

### Background

Captured from the creation title: "One server.mcp config and token for the gateway root and project MCP endpoints".

### Requirements

- [x] R1. The gateway root /mcp, the gateway's upstream forwarding and spur mcp --gateway all read server.mcp (enabled, authEnv, allowUnauthenticated); one token variable.
- [x] R2. server.gateway.mcp and SPUR_GATEWAY_MCP_ENABLED/SPUR_GATEWAY_MCP_AUTH_ENV are removed from the config schema and resolution; a legacy block is ignored.
- [x] R3. The Integrations contract keeps gateway.mcp only as the running gateway's probed runtime state (from /api/health), never as config; the Board's messages name server.mcp; the Codex snippet allowlists SPUR_MCP_* only.
- [x] R4. plugins/sp/mcp.json, config/config.global.yaml, docs/install.md, the design satellites and ADR-151/152 state one config.

### Acceptance Criteria

```gherkin
Feature: One server.mcp config and token for the gateway root and project MCP endpoints

  Scenario: AC1 — One server.mcp block and one token drive the gateway root /mcp and the bridge (req: R1)
    Given a config with server.mcp enabled, authEnv MCP_TOKEN and no server.gateway.mcp block
    When the gateway starts and spur mcp --gateway resolves its upstream (verified in apps/server/tests/gateway-mcp-routing.test.ts and apps/cli/tests/commands/mcp-gateway.test.ts)
    Then the root /mcp authenticates with the variable server.mcp.authEnv names and forwards the same bearer to each project's /mcp
    And a missing token answers 500 naming server.mcp.authEnv

  Scenario: AC2 — Legacy gateway MCP keys have no effect (req: R2)
    Given a config carrying server.gateway.mcp or SPUR_GATEWAY_MCP_ENABLED / SPUR_GATEWAY_MCP_AUTH_ENV
    When the config loads (verified in packages/config/tests/config.test.ts and apps/server/tests/server-config.test.ts)
    Then server.gateway resolves to port and allowedHosts only and the legacy values appear nowhere in the resolved config

  Scenario: AC3 — The Board names server.mcp and the Codex snippet allowlists SPUR_MCP_* only (req: R3)
    Given the Integrations status of a gateway-served project
    When the MCP tab renders the Codex gateway-stdio snippet and the off-state message (verified in apps/web/tests/modules/integrations/helpers.test.ts)
    Then env_vars lists SPUR_GATEWAY_PORT, SPUR_MCP_ENABLED, SPUR_MCP_AUTH_ENV and the server.mcp token variable, never SPUR_GATEWAY_MCP_*
    And gateway.mcp stays in the contract only as the gateway's probed runtime state

  Scenario: AC4 — Shipped config and docs state one MCP config (req: R4)
    Given plugins/sp/mcp.json, config/config.global.yaml, docs/install.md, the design satellites and ADR-151/152
    When they are searched for server.gateway.mcp and SPUR_GATEWAY_MCP_
    Then no live config or instruction remains, and ADR-151/152 carry a K44 1450 amendment
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **One config, two endpoints.** `server.mcp` (`enabled`, `authEnv`, `allowUnauthenticated`) is read by the gateway root `/mcp`, by the gateway's upstream forwarding to `/<prefix>/mcp`, and by `spur mcp --gateway`. A separate gateway credential protected no boundary: the gateway proxies the project endpoint on the same origin, and every project already reads the same global `server.mcp.authEnv`.
- **Process split kept.** ADR-151's per-project process isolation stays; only the config surface merges.
- **Legacy keys ignored, not rejected.** Zod strips unknown keys, so an old `server.gateway.mcp` block loads silently instead of failing boot; the install guide tells operators to delete it.
- **`gateway.mcp` stays in the Integrations contract** as the running gateway's probed `/api/health` state. That is runtime truth, not config, and is more accurate than deriving it from the project's `mcp`.
- Rejected: keeping the separate gateway credential as an optional override (two knobs for one boundary).

### Plan

1. Tests first: config legacy-key tests, gateway routing with one token, CLI bridge e2e, Board Codex allowlist.
2. Remove `gateway.mcp` and its env vars from `packages/config`; resolve `gateway` to `{port, allowedHosts}`.
3. Gateway (`apps/server/src/gateway.ts`), `self serve` and `spur mcp --gateway` read `server.mcp`.
4. Drop `gatewayMcpEnabled` from the readiness surface; Board messages and Codex env vars name `SPUR_MCP_*`.
5. Update `plugins/sp/mcp.json`, `config/config.global.yaml`, the config JSON schema, `mcp-tools.md`, `docs/install.md`, design satellites and ADR-151/152 amendments.
6. `bun run lint` plus affected workspace tests.

### Solution

- `packages/config/src/index.ts:1313` — `server.gateway` schema is `{port, allowedHosts}`; `gateway.mcp` and `SPUR_GATEWAY_MCP_*` removed.
- `apps/server/src/gateway.ts:77`, `apps/server/src/gateway.ts:103` — one `mcp` option; `projectMcpToken` reads `env[mcp.authEnv]`; unconfigured message names `server.mcp.authEnv` (`apps/server/src/gateway.ts:88`).
- `apps/cli/src/commands/self/serve.ts:130` — gateway receives `server.mcp`.
- `apps/cli/src/commands/mcp.ts:190` — `resolveGatewayMcpUrl` uses `server.mcp` with actionable messages.
- `apps/server/src/server-config.ts`, `apps/server/src/modules/integrations/handlers.ts`, `packages/app/src/services/agent-mcp-readiness.ts` — `gateway.mcp` config and `gatewayMcpEnabled` removed.
- `apps/web/src/modules/integrations/helpers.ts:152`, `apps/web/src/modules/integrations/helpers.ts:300` — Codex env vars and off message name `server.mcp`.
- `plugins/sp/mcp.json`, `config/config.global.yaml`, `apps/cli/schemas/spur-config.schema.json`, `plugins/sp/skills/spur-cli/references/mcp-tools.md`, `docs/install.md` §2.1, `docs/design/{embedded-mcp-server,mcp-agent-adoption,configuration-contracts,project-gateway}.md`, `docs/00_ADR.md:2982`, `docs/00_ADR.md:3018`.
- Supersedes task 1449 AC2 (gateway MCP inheritance): that behaviour no longer exists.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/src/gateway.ts:103` projectMcpToken reads server.mcp.authEnv; `apps/cli/src/commands/self/serve.ts:130`; `apps/cli/src/commands/mcp.ts:190`; tests `apps/server/tests/gateway-mcp-routing.test.ts:231`, `apps/cli/tests/commands/mcp-gateway.test.ts:39` (server 879/0, cli 214/0) |
| R2 | MET | `packages/config/src/index.ts:1313` gateway schema {port, allowedHosts}; `packages/config/tests/config.test.ts:172`, `packages/config/tests/config.test.ts:185` legacy block and env vars ignored (config 338/0) |
| R3 | MET | `apps/web/src/modules/integrations/helpers.ts:152` Codex env vars SPUR_MCP_* only; `apps/web/src/modules/integrations/helpers.ts:300` off message names server.mcp; `apps/web/tests/modules/integrations/helpers.test.ts:240`; gateway.mcp kept as probed runtime state `apps/web/src/modules/integrations/SummaryTab.tsx:96` |
| R4 | MET | `plugins/sp/mcp.json`, `config/config.global.yaml`, `docs/install.md:60`, `docs/design/project-gateway.md:80`, `docs/00_ADR.md:2982`, `docs/00_ADR.md:3018`; rg for SPUR_GATEWAY_MCP_ finds only legacy-removal notes |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/server/tests/gateway-mcp-routing.test.ts:131`, `apps/server/tests/gateway-mcp-routing.test.ts:231`, `apps/cli/tests/commands/mcp-gateway.test.ts:16` |
| AC2 | MET | test | `packages/config/tests/config.test.ts:163`, `packages/config/tests/config.test.ts:185` |
| AC3 | MET | test | `apps/web/tests/modules/integrations/helpers.test.ts:240` |
| AC4 | MET | command | `rg -n "SPUR_GATEWAY_MCP_" plugins config docs/install.md docs/design` returns only removal notes (`docs/install.md:70`, `docs/design/project-gateway.md:80`); ADR amendments `docs/00_ADR.md:2982` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-25T22:32:52.615Z backlog → todo (system)
- 2026-11-25T22:32:52.993Z todo → wip (system)
- 2026-11-25T22:32:53.928Z wip → testing (system)
- 2026-11-25T22:44:56.061Z testing → done (system)

