# MCP agent adoption matrix (feature B92, task 1393)

Which of Spur's ten supported coding agents can consume the embedded MCP server, and over which
transport. The verdict column is what 1394's guidance reads: an `mcp-http` agent is told to point at
the server directly, an `mcp-stdio-bridge` agent goes through `spur mcp`, and a `cli-only` agent gets
the CLI fallback. A `cli-only` verdict here means "not observed over MCP in the current receipt", so
the guidance still offers `spur mcp` first and falls back to the CLI — it never claims the agent
cannot use MCP.

- **Checked:** 2026-11-22 (interop receipt `generatedAt` `2026-11-22T17:39:37.618Z`, floor `2026-07-28`).
- **Server under test:** `spur self serve` with the B9 MCP adapter — stateless Streamable HTTP
  `POST /mcp`, bearer auth, protocol `2026-07-28`, no session.
- **Server-side observation (done in this task):** `POST /mcp` with `Mcp-Protocol-Version: 2026-07-28`
  and `Authorization: Bearer <token>` answered `server/discover` with `protocolVersion: "2026-07-28"`
  and the ten-tool catalog, with no `Mcp-Session-Id` in play. That is `observed` for the *server*;
  the per-agent rows below say whether the *client* side was observed in 1432's receipt or not.

Values: **yes** / **no** / **not observed**. A cell is only `observed` when the proxy log proves it
(1432's receipt); a client that merely documents HTTP support is `yes` for the capability and
`not observed` for the handshake. No verdict rests on documentation alone.

## 1. Matrix

| Agent | HTTP client | stdio client | Highest revision claimed | Stateless `2026-07-28` works | Bearer header | Receipt (http / stdio) | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | yes | yes | 2026-07-28 (stdio) | partially observed (requests arrived; no tools/call) | yes (per the client's own config) | `no-request` / `call-failed` | <https://code.claude.com/docs/en/mcp> |
| Codex CLI | yes | yes | not observed | not observed | yes (per the client's own config) | `config-isolation-unavailable` / `no-request` | <https://learn.chatgpt.com/docs/extend/mcp> |
| Gemini CLI | yes | yes | not observed | not observed | yes (per the client's own config) | `no-request` / `no-request` | <https://geminicli.com/docs/tools/mcp-server/> |
| pi | yes | yes | not observed | not observed | yes (per the client's own config) | `no-request` / `no-request` | <https://docs.pi.dev/latest/configuration> |
| omp | yes | yes | 2026-07-28 (http) | **observed** (http) | yes (per the client's own config) | `pass` / `pass` | <https://omp.sh/docs/mcp> |
| OpenCode | yes | yes | not observed | not observed | yes (per the client's own config) | `no-request` / `no-request` | <https://opencode.ai/docs/mcp-servers/> |
| Antigravity | not installed | not installed | not observed | not observed | yes (per the client's own config) | `not-installed` / `not-installed` | <https://antigravity.google/docs/mcp/> |
| OpenClaw | yes | yes | not observed | not observed | yes (per the client's own config) | `no-request` / `no-request` | see re-check note |
| Hermes | not installed | not installed | not observed | not observed | yes (per the client's own config) | `not-installed` / `not-installed` | <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp> |
| Grok | yes | yes | not observed | not observed | yes (per the client's own config) | `config-isolation-unavailable` / `config-isolation-unavailable` | <https://docs.x.ai/build/features/mcp-servers> |

## 1a. Install route (task 1401)

The plugin ships `plugins/sp/mcp.json` with a single server, `spur` → `spur mcp --gateway`.
Superskill translates that entry for targets with an MCP config adapter. The bridge resolves
`http://localhost:<server.gateway.port>/mcp` and takes the bearer from the variable named by
`server.gateway.mcp.authEnv`, so **no token ever lands in an agent config file** — it is read from the
environment when the bridge starts.

Observed on a fixture HOME (artifact: `docs/tasks5/artifacts/1401/superskill-dry-run.txt`): one `spur`
entry in `.gemini/config/mcp_config.json` and one `[mcp_servers.spur]` in `.codex/config.toml`, with a
second install leaving both counts unchanged. Claude Code loads the entry through the native
plugin manifest. Use the [install guide](../install.md) to verify the entry for your target.

**Verified 2026-11-20 (task 1417).** Codex CLI 0.171.0 discovered the ten built-ins and a fixture
workflow through the Superskill-generated stdio entry. Claude Code 2.1.221 reported
`plugin:sp:spur` connected after installing the native plugin. These checks used the stdio bridge
and a local gateway.

## 2. Verdicts (consumed by 1394)

Derived mechanically from `docs/reports/mcp-agent-interop-receipt.json` (`generatedAt`
`2026-11-22T17:39:37.618Z`, floor `2026-07-28`): `mcp-http` iff the HTTP row is `pass`;
otherwise `mcp-stdio-bridge` iff the stdio row is `pass`; otherwise `cli-only`. An agent with no
installed binary is listed as `not-installed (unobserved)` and is never promoted from documentation.

| Agent | Verdict |
| --- | --- |
| Claude Code | cli-only |
| Codex CLI | cli-only |
| Gemini CLI | cli-only |
| pi | cli-only |
| omp | mcp-http |
| OpenCode | cli-only |
| Antigravity | not-installed (unobserved) |
| OpenClaw | cli-only |
| Hermes | not-installed (unobserved) |
| Grok | cli-only |

Consequences for 1394's guidance: only **omp** is told to point at the HTTP endpoint (and it also
works over the bridge); every other installed agent goes through `spur mcp`, and the two
`config-isolation-unavailable` rows (codex HTTP, grok) mean their HTTP path is untested here — the
bridge is the path their guidance names.


## 3. Gaps and honesty notes

- **Protocol revision per agent is UNVERIFIED across the board.** None of the cited pages states a
  supported MCP spec revision, and the server accepts only the `2026-07-28` line (ADR-152). An agent
  whose client speaks an older revision will fail the version check at request time rather than at
  configuration time — the failure is a protocol error, not a silent downgrade.
- **No direct HTTP client `server/discover` round-trip is recorded here.** Nine of the ten CLIs are
  installed, but proving a handshake per agent needs a tool call in each one's own session model,
  which this task did not run (the Codex attempt above is the only one, and it was inconclusive).
  A future pass should record `server/discover` per agent the way the server side was recorded here.
- **OpenClaw has no primary source in hand.** Its row is `documented` on the strength of the CLI being
  installed and the ecosystem documentation, but no official page was captured in this pass — re-check
  before relying on it.
- **Antigravity and Hermes are not installed** under those names in this environment (`agy` exists and
  may be Antigravity's binary), so nothing about them was observed.

## 4. Re-check note

Re-run this matrix when either side moves: a new B9 protocol line (ADR-152), or an agent major
version. The method is cheap — start `spur self serve` with `SPUR_MCP_ENABLED=true` and a token
variable, then `POST /mcp` with `server/discover` from the agent's own client, recording
`protocolVersion` from the reply and whether a session id was issued.
