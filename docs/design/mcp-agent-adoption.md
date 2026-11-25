# MCP agent adoption matrix (B92 / B93)

Transport verdicts come from the real-agent interoperability receipt. A classification describes this environment and client version; `cli-only` means no completed MCP tool call was observed, not that the agent can never support MCP.

- **Checked:** 2026-11-22; receipt `generatedAt` `2026-11-22T18:47:43.429Z`.
- **Server policy:** Spur accepts stateless HTTP revisions at or above `2026-07-28`. Legacy clients use `spur mcp`; [ADR-152](../00_ADR.md) owns this Spur policy.
- **Evidence:** ten agents × two transports. Each row has its own `observedAt`; subset reruns retain earlier observations instead of pretending they were rerun.
- **Config integrity:** the final native guard checked ten global config paths and found no change. Earlier eight-path runs plus the additional native-path audit also found no change.

## 1. Matrix

`clientRevision` is observed on the proxy wire: the initialize body revision when present, otherwise the version header. For stdio, that header is the **bridge upstream revision**, not evidence that the original client speaks the stateless revision.

| Agent | HTTP client | stdio client | Highest revision claimed (observed wire) | Stateless HTTP works | Tools seen (HTTP / stdio) | Receipt outcomes (HTTP / stdio) | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | observed | observed | HTTP: `2025-11-25`; bridge upstream: `2026-07-28` | rejected-legacy-revision | — / 10 | `rejected-legacy-revision` / `call-failed` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Codex CLI | observed | observed | HTTP: `2025-06-18`; bridge upstream: `2026-07-28` | rejected-legacy-revision | — / 10 | `rejected-legacy-revision` / `pass` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Gemini CLI | not observed | not observed | not observed | no-request | — / — | `no-request` / `no-request` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| pi | observed | observed | HTTP: `2025-11-25`; bridge upstream: `2026-07-28` | rejected-legacy-revision | 10 / 10 | `rejected-legacy-revision` / `pass` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| omp | observed | observed | HTTP: `2026-07-28`; bridge upstream: `2026-07-28` | pass | 10 / 10 | `pass` / `pass` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| OpenCode | not observed | not observed | not observed | no-request | — / — | `no-request` / `no-request` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Antigravity | not installed | not installed | not observed | not-installed | — / — | `not-installed` / `not-installed` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| OpenClaw | not observed | not observed | not observed | no-request | — / — | `no-request` / `no-request` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Hermes | not installed | not installed | not observed | not-installed | — / — | `not-installed` / `not-installed` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Grok | not observed | not observed | not observed | no-request | — / — | `no-request` / `no-request` | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |

## 1a. Install route (task 1401)

The plugin ships `plugins/sp/mcp.json` with a single server, `spur` → `spur mcp --gateway`.
Superskill translates that entry for targets with an MCP config adapter. The bridge resolves
`http://localhost:<server.gateway.port>/mcp` and takes the bearer from the variable named by
`server.mcp.authEnv` (one token for the gateway and every project, K44), so **no token ever lands in an agent config file** — it is read from the
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

Rule: `mcp-http` iff HTTP is `pass`; otherwise `mcp-stdio-bridge` iff stdio is `pass`; otherwise `cli-only`. Missing binaries are listed as unobserved. A successful HTTP status alone is insufficient: the proxy requires a successful catalog and `sp_task_list` response, without a JSON-RPC or tool error. A legacy-initialize rejection prevents a later fallback request from promoting the native HTTP verdict.

| Agent | Verdict | Evidence |
| --- | --- | --- |
| Claude Code | cli-only | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Codex CLI | mcp-stdio-bridge | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Gemini CLI | cli-only | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| pi | mcp-stdio-bridge | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| omp | mcp-http | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| OpenCode | cli-only | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Antigravity | not-installed (unobserved) | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| OpenClaw | cli-only | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Hermes | not-installed (unobserved) | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |
| Grok | cli-only | [receipt](../reports/mcp-agent-interop-receipt.json), `2026-11-22T18:47:43.429Z` |

**Guidance:** omp can use direct HTTP. Codex and pi use the stdio bridge (`spur mcp`, or the installed plugin’s gateway entry). Other installed agents use the CLI fallback for now, for example `spur task list --json`. The generic consumers link here and keep their tool-available → MCP, otherwise → CLI rule; no consumer should infer HTTP support from installation alone.

## 3. Recorded causes and limits

- **Codex:** 0.171.0 supports isolated HTTP TOML overrides. The previous configuration failure merged HTTP into an existing stdio entry; it was a harness defect. The corrected native client sends header-less `initialize` with revision `2025-06-18`; the proxy records `400 PROTOCOL_VERSION_UNSUPPORTED`. Its native app-server API lists ten tools and calls `sp_task_list` through the bridge, so the working path is proved by requests, not configuration alone.
- **Claude Code and pi HTTP:** the receipt records legacy-initialize rejection. pi completes the stdio call. Claude discovers ten tools but does not complete the required call in this run, so it is not promoted.
- **Gemini:** the account/client eligibility error occurs before a request reaches the proxy. **OpenCode:** insufficient model-provider balance prevents the attempt from reaching MCP. **OpenClaw:** the corrected local invocation and stdio config reach a missing-provider-authentication error. No account credentials were copied or changed to hide those outcomes.
- **Grok:** project-scoped TOML is supported and was injected for both transports. The headless run exposes no Spur tools and sends no request to the recording proxy. This observation supports CLI fallback here; it is not a claim that Grok lacks MCP support.
- **Antigravity and Hermes:** their configured binary names are absent. They remain `not-installed (unobserved)`; the harness does not install them.
- Codex is exercised through its installed native app-server catalog/tool-call API in an ephemeral read-only thread; other installed clients receive the fixed prompt. The server and recording proxy are real in both cases. Proxy requests contain only method/revision/status/error metadata, tool name/count, and success state; authorization headers and bodies are not persisted.

## 4. Re-check

Run `bun run mcp-agent-interop` from this checkout to refresh all cases, or `bun run mcp-agent-interop --agents=codex` for a scoped repair. This is an operator proof, not a CI test: other clients can make billable model turns, with a 120-second case budget. Codex’s deterministic native-client case needs no model selection.

The stable receipt is overwritten after each case. `completed` and `globalConfigIntegrity.unchanged` must both be true before using a finished run. Regenerate this matrix from receipt fields after a change; never substitute documentation claims for an observed transport verdict.
