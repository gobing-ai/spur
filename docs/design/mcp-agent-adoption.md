# MCP agent adoption matrix (feature B92, task 1393)

Which of Spur's ten supported coding agents can consume the embedded MCP server, and over which
transport. The verdict column is what 1394's guidance reads: an `mcp-http` agent is told to point at
the server directly, an `mcp-stdio-bridge` agent goes through `spur mcp`, and a `cli-only` agent gets
the CLI fallback.

- **Checked:** 2026-11-18.
- **Server under test:** `spur self serve` with the B9 MCP adapter — stateless Streamable HTTP
  `POST /mcp`, bearer auth, protocol `2026-07-28`, no session.
- **Server-side observation (done in this task):** `POST /mcp` with `Mcp-Protocol-Version: 2026-07-28`
  and `Authorization: Bearer <token>` answered `server/discover` with `protocolVersion: "2026-07-28"`
  and the ten-tool catalog, with no `Mcp-Session-Id` in play. That is `observed` for the *server*;
  the per-agent rows below say whether the *client* side is `documented` or proven.

Values: **yes** / **no** / **UNVERIFIED** (no primary source found). A protocol revision is only
claimed when its own source states it.

## 1. Matrix

| Agent | HTTP client | stdio client | Highest revision claimed | Stateless `2026-07-28` works | Bearer header | Version checked | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | yes | yes | UNVERIFIED | documented (remote HTTP supported; revision not stated) | yes (`--header`) | CLI present, version not pinned | <https://code.claude.com/docs/en/mcp> |
| Codex CLI | yes | yes | UNVERIFIED | **observed: not proven** (server listed as enabled with a bearer-token env var; an `exec` session exposed no tools) | yes (`--bearer-token-env-var`) | CLI present, version not pinned | <https://learn.chatgpt.com/docs/extend/mcp> |
| Gemini CLI | yes | yes | UNVERIFIED | documented (`httpUrl` = Streamable HTTP) | yes (`--header`) | CLI present, version not pinned | <https://geminicli.com/docs/tools/mcp-server/> |
| pi | yes | yes | UNVERIFIED | documented (built-in MCP client; project config needs trust) | yes (`headers`) | CLI present, version not pinned | <https://docs.pi.dev/latest/configuration> |
| omp | yes | yes | UNVERIFIED | documented (`http`, plus legacy SSE) | yes | CLI present, version not pinned | <https://omp.sh/docs/mcp> |
| OpenCode | yes | yes | UNVERIFIED | documented (`type: "remote"` + absolute `url`; OAuth on by default, disable for header auth) | yes (header auth with OAuth disabled) | CLI present, version not pinned | <https://opencode.ai/docs/mcp-servers/> |
| Antigravity | yes | yes | UNVERIFIED | documented (`mcp_config.json`; legacy HTTP+SSE **not** supported) | yes (`headers`) | not installed as `antigravity`; `agy` present | <https://antigravity.google/docs/mcp/> |
| OpenClaw | yes | yes | UNVERIFIED | documented | yes | CLI present, version not pinned | see re-check note |
| Hermes | yes | yes | UNVERIFIED | documented (`mcp_servers:` in `~/.hermes/config.yaml`) | yes | not installed locally | <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp> |
| Grok | yes | yes | UNVERIFIED | documented (`--transport http`) | yes (`--header "Authorization: Bearer …"`) | CLI present, version not pinned | <https://docs.x.ai/build/features/mcp-servers> |

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

| Verdict | Agents |
| --- | --- |
| `mcp-http` | Claude Code, Codex CLI, Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok |
| `mcp-stdio-bridge` | none needed — every agent above also has a stdio client, which is the fallback when an HTTP entry cannot be configured |
| `cli-only` | none |

The direct HTTP rows remain based on documentation, except the server-side observation noted
above. The direct Codex attempt
round-trip (Codex) did **not** prove the stateless handshake: `codex mcp list` showed the server as
`enabled` with a bearer-token env var, but an `codex exec` session reported no tools from it. Treat
that row as "configures cleanly, handshake unproven" rather than as a pass.

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
