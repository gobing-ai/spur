---
schema_version: 1
name: Thin spur mcp stdio-to-HTTP bridge for local CLI clients
status: todo
template: feature-impl
created_at: 2026-11-17T18:57:28.330Z
updated_at: "2026-11-17T19:03:10.068Z"
feature_id: B9
priority: P2
tags:
  - mcp
  - cli
  - stdio
estimate_hours: 2

dependencies: ["1370", "1372"]
---

## 1373. Thin spur mcp stdio-to-HTTP bridge for local CLI clients

### Background

Some local coding agents only configure MCP servers over stdio. A thin `spur mcp` bridge lets them talk to the embedded `/mcp` server without duplicating tool/resource handlers.

### Requirements

- [ ] R1. Add `spur mcp` CLI subcommand in `apps/cli/src/commands/` that resolves the project's `/mcp` URL (gateway or direct port) and forwards newline-delimited JSON-RPC from stdin to `POST /mcp`.
- [ ] R2. Forward `Mcp-Protocol-Version: 2026-07-28` and bearer token from `server.mcp.authEnv` when configured.

### Acceptance Criteria

- [ ] AC1 — Thin spur mcp stdio bridge forwards to the embedded /mcp server (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep `spur mcp` strictly a transport shim over stdin/stdout and `fetch` to the embedded `/mcp` endpoint.

### Plan

- Implement `apps/cli/src/commands/mcp.ts` and register in CLI root.
- Add tests with a mock `/mcp` HTTP upstream verifying stdin-to-HTTP forwarding and error handling.

### Solution

#### Dependencies
- Depends on `1370` (`server.mcp` config) and `1372` (embedded `mcpModule` at `/mcp`).

#### Target Files
- `apps/cli/src/commands/mcp.ts` (new) — Thin `spur mcp` command (`--cwd`, `--url`) that resolves the project's `/mcp` endpoint (gateway `/<prefix>/mcp` or direct `spur serve` port), reads newline-delimited JSON-RPC from `stdin`, sends stateless `POST /mcp` with `Mcp-Protocol-Version: 2026-07-28` and the `server.mcp.authEnv` Bearer token, and writes responses to `stdout`.
- [apps/cli/src/index.ts](file:///Users/robin/xprojects/spur-new/apps/cli/src/index.ts) — Register `registerMcpCommand`.

#### Verification
- Unit tests in `apps/cli/tests/commands/mcp.test.ts` using a mock `/mcp` HTTP upstream to verify stdin-to-HTTP forwarding, header injection, and error propagation.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-17T19:00:47.109Z feature_id S → B9 (system)

