---
schema_version: 1
name: Make the installed MCP entry discover and call project tools
status: done
template: issue
created_at: 2026-11-20T22:53:13.759Z
updated_at: "2026-11-20T23:16:16.644Z"

done_forced: "false"
done_reason: unforced close
---

## 1417. Make the installed MCP entry discover and call project tools

### Background

Captured from the creation title: "Make the installed MCP entry discover and call project tools".

### Requirements

- [x] R1. A CLI-started gateway forwards with the configured project credential and keeps gateway authentication separate.
- [x] R2. Legacy stdio clients initialize, list, and call tools through the bridge, while stateless HTTP replies retain their shape.
- [x] R3. Verify generated config with a native coding-agent client and document the install and protocol behavior.

### Acceptance Criteria

- [x] AC1 — A live gateway authorizes the client with one token and calls a project with a distinct token (req: R1)
- [x] AC2 — The generated stdio entry runs the legacy lifecycle and lists and calls published tools (req: R2, R3)
- [x] AC3 — The install guide describes the verified setup and current client limitations (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- Reproduce the missing gateway credential and legacy lifecycle on the real CLI surface.
- Pass the existing project credential setting through and translate the legacy stdio tool lifecycle at the bridge.
- Verify the installed entry with a real agent client and update the owning docs.

### Root Cause

The CLI gateway branch omits projectTokenEnv when starting the gateway. The stdio bridge forwards the legacy initialize method directly to the stateless-only endpoint, which rejects it.

### Solution

- CLI serve passes the configured project auth variable separately from the gateway bearer. Both gateway and bridge read the same optional gateway port.
- The stdio bridge probes the authenticated HTTP endpoint before acknowledging the legacy tool lifecycle and wraps raw tool return values for legacy clients. The stateless HTTP response stays unchanged.
- Superskill generates Codex's gateway-environment allowlist from the plugin manifest. Claude Code loads the same MCP entry through the native plugin manifest.
- The agent-facing install guide documents installation, live discovery, and the two credentials.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/tests/commands/mcp-gateway.test.ts:85` proves that the real gateway CLI accepts its own bearer, then forwards a distinct project bearer. A fixture project accepted both built-in and namespaced calls. |
| R2 | MET | `apps/cli/tests/commands/mcp-gateway.test.ts:85` verifies raw HTTP and legacy stdio results through the same gateway. The legacy initialized notification produces no reply. |
| R3 | MET | `docs/install.md` describes install and verification. The isolated native Codex 0.171.0 app-server listed eleven tools through the Superskill-generated config. Claude Code 2.1.221 reported the native plugin server connected. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Live CLI gateway and upstream HTTP fixture assert distinct credentials and raw response. |
| AC2 | MET | test | The same integration test covers initialize, list and call. The native Codex app-server discovered `acme_release_check` and the ten built-ins. |
| AC3 | MET | command | `sh -n` passed for every shell block in `docs/install.md`. The native fixture ran the documented gateway and catalog commands. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `docs/install.md`, `docs/design/mcp-agent-adoption.md`, and ADR-152.
- Repeatable CLI proof: `cd apps/cli && bun test tests/commands/mcp-gateway.test.ts`.
- Native-client proof: `python3 .spur/run/1417-native-mcp.py --bundle` after bundling. The receipt is `.spur/run/1417-native-mcp.log`.

### History

- 2026-11-20T22:54:26.382Z todo → wip (system)
- 2026-11-20T23:01:23.118Z wip → testing (system)
- 2026-11-20T23:16:16.638Z testing → done (system)
