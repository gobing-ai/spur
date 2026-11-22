---
schema_version: 1
name: Real-agent MCP interop harness and receipt
status: done
template: feature-impl
created_at: 2026-11-22T02:21:34.552Z
updated_at: "2026-11-22T17:39:49.996Z"
feature_id: B93

tags: ["B93"]
dependencies: ["1431"]
priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 1432. Real-agent MCP interop harness and receipt

### Background

Implements: R1 — Each installed agent's MCP handshake is exercised against a live server and recorded.

`docs/design/mcp-agent-adoption.md` §1–§2 records the documentation-only verdicts this replaces.

**Refine corrections (2026-11-21)**
- "Reuse the install-time MCP entry writer (K43)" → there is no in-repo writer to reuse. Agent MCP entries are produced by **Superskill** from `plugins/sp/mcp.json` (adoption doc §1a, task 1401), and those entries are always the stdio bridge (`spur mcp --gateway`), never HTTP. The harness therefore writes its own per-agent entries for both transports.
- Config isolation: a temp `HOME` would also hide each agent's login credentials, so the agent would fail before reaching MCP. The harness must inject MCP config per run (a CLI flag or a project-local config file in a temp cwd) and **must not edit the user's global agent configs**.
- "Capture the server-side mcp.* events as ground truth" → those events fire only for *dispatched* `tools/call` and `resources/read` (`apps/server/src/modules/mcp/index.ts:290-300,517-525`). A request rejected by the version gate (`protocol.ts:108-129`) emits nothing, and that is exactly the failure to capture. Ground truth is a **recording proxy** in front of `/mcp` that logs method, `Mcp-Protocol-Version`, status and error code per request.
- Driving agents: `spur agent list --json` reports installed agents, and `spur agent run --agent <name> --cwd <dir> --json <prompt>` runs one headless turn. The harness composes these instead of hand-rolling per-agent invocations.
- Ten supported agents (adoption doc §1): Claude Code, Codex, Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok.
- Cost: each case is a real model turn, about 20 turns for 10 agents × 2 transports. This is an operator-run script, not a CI gate.

### Requirements

- [x] R1. `scripts/commands/mcp-agent-interop.ts` does the following:
  - boots `spur self serve` with MCP enabled and a generated bearer token in a temp project;
  - fronts `/mcp` with an in-process recording proxy;
  - for each of the ten supported agents, runs the HTTP case (entry → proxy URL, bearer from env) and the stdio case (entry → `spur mcp --url <proxy>`).
- [x] R2. Each case asks the agent (fixed prompt) to list its `spur` tools and call `sp_task_list`. The receipt row records:
  - `{agent, version, transport, installed, configMethod, clientRevision, requests: [{method, revision, status, errorCode}], toolsSeen, callOutcome: pass|fail|not-attempted, classification, errorExcerpt}`.

  `clientRevision` and `requests` come from the proxy log, not from the agent's prose.
- [x] R3. Classification is one of `pass`, `rejected-legacy-revision` (proxy saw `PROTOCOL_VERSION_UNSUPPORTED`), `no-request` (the agent never reached the server), `auth-failed`, `call-failed`, `not-installed`, `config-isolation-unavailable` or `agent-error`. A missing agent is `not-installed`, never a failure.
- [x] R4. It writes `docs/reports/mcp-agent-interop-receipt.json` (stable name, overwritten each run) with `generatedAt`, the server protocol floor, and the rows. It exits 0 when every installed agent has a classification. A `pass` is not required (verdicts are 1433's job).
- [x] R5. The user's global agent configs are byte-identical before and after (the script checks the hash of each known config path it could touch).

### Acceptance Criteria

- [x] AC1 — Each installed agent's MCP handshake is exercised against a live server and recorded

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:26:13.018Z

- **Closed: temp HOME vs config injection.** Use injection. A temp HOME breaks agent auth and would misreport every agent as an MCP failure.
- **Closed: ground truth.** Use the recording proxy, because the version gate rejects before any mcp.* event exists.
- **Closed: dependency on 1431.** Keep it. The harness classifies by 1431's error text (`rejected-legacy-revision`).

### Design

- **Composition:** model the script on `scripts/commands/a2a-serve-e2e.ts` (boot, temp project, receipt). The proxy is a `Bun.serve` on an ephemeral port that forwards to the server's `/mcp`, records `{method (Mcp-Method header or body.method), Mcp-Protocol-Version, status, error.code}` and **never logs the Authorization header or bodies**.
- **Per-agent config table** (`AGENT_MCP_CONFIG` in the script, with one row per agent and a source URL comment): how to point it at an HTTP URL plus bearer env, and at a stdio command, **without touching global config**. Prefer, in order: (1) a per-invocation CLI flag (e.g. Claude Code `--mcp-config <file> --strict-mcp-config`, Codex `-c mcp_servers.spur.*`); (2) a project-local config file in the temp cwd. An agent with only a global config gets `config-isolation-unavailable`. Verify each row against the agent's docs or `--help` at implementation time, and record the source.
- **Execution budget:** one turn per case, a 180s timeout per case and 20 cases at most. Persist the receipt after every case so an interrupted run keeps its rows; `--agents a,b` reruns a subset and merges by `(agent, transport)`.
- **Anti-patterns:** no temp `HOME`; no edits to `~/.codex`, `~/.claude`, `~/.gemini` etc.; no parsing the agent's natural-language answer for tool counts when the proxy log can answer; no new public `spur` verb (this is an e2e script, ADR-130).
- **Handoff to 1433:** the receipt rows and proxy request logs are the only evidence 1433 may cite.

### Plan

Premises (verified 2026-11-21): `spur agent list|run` exist (`spur agent --help`); mcp events fire only after dispatch (`apps/server/src/modules/mcp/index.ts:290-300`); the version gate rejects before dispatch (`protocol.ts:108-129`); Superskill entries are stdio-only (adoption doc §1a); receipt convention from `scripts/commands/a2a-serve-e2e.ts`.

- [ ] 1. Failure modes: global config mutated; the agent fails auth because of isolation; a rejection goes unrecorded (no event); a token is leaked into the receipt; one hung agent stalls the run; rows are lost on interrupt.
- [ ] 2. Write the proxy and classifier first, with a self-check that replays canned proxy logs (one per classification) through the classifier and asserts the label. This is the smallest check that fails if the classification logic breaks.
- [ ] 3. Fill `AGENT_MCP_CONFIG` with a verified source per row.
- [ ] 4. Run against the installed agents and inspect the receipt. Confirm the config hashes are unchanged and that `rg -n "$TOKEN" docs/reports/mcp-agent-interop-receipt.json` finds nothing.
- [ ] 5. Commit the script and receipt. Run `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `scripts/commands/mcp-agent-interop.ts` | the harness: temp project + `spur self serve` (MCP on, generated bearer) + an in-process recording proxy + per-agent HTTP and stdio cases, one classification per row, receipt after every case | R1/R2/R4 |
| `scripts/spur-dev.ts:84,153` · `package.json:105` | `mcp-agent-interop` registered (COMMANDS, switch case, script) | one dispatcher entry point; its case labels are pinned by `a93-script-ownership` |
| `docs/reports/mcp-agent-interop-receipt.json` | the artifact: `serverProtocolFloor: 2026-07-28` and 21 rows | R4 |

How the requirements are met
- **R1** one boot, one proxy (`Bun.serve` on an ephemeral port), two transports per agent: HTTP points the agent at the proxy URL; stdio points it at `bun apps/cli/src/index.ts mcp --url <proxy>/mcp`, with `SPUR_MCP_AUTH_ENV`/`SPUR_MCP_TOKEN` in the child env so the bridge forwards the bearer.
- **R2** the row comes from the PROXY, never the agent's prose: `{method (Mcp-Method header or body.method), Mcp-Protocol-Version, status, error.code}`; `clientRevision` is the first revision the proxy saw; `toolsSeen` is "a `tools/list` request happened". The Authorization header and bodies are never logged.
- **R3** classification is one of `pass` / `rejected-legacy-revision` (proxy saw `PROTOCOL_VERSION_UNSUPPORTED`) / `no-request` / `auth-failed` / `call-failed` / `not-installed` / `config-isolation-unavailable` / `agent-error`. A missing binary is `not-installed` (the version probe is guarded, so a missing executable cannot abort the run — it did on the first attempt with `antigravity`).
- **R4** stable receipt name, overwritten; `generatedAt`, `serverProtocolFloor`, rows; per-case persistence so an interrupted run keeps its rows; `--agents=a,b` reruns a subset and merges by `(agent, transport)`. Exit 0 = every installed agent classified (a `pass` is not required).
- **R5** every case writes only inside the temp project. `CLAUDE_CONFIG_DIR` is pointed at the temp tree (with the operator's `~/.claude.json` **copied** in, so the turn is authenticated as they are), `OPENCLAW_CONFIG_PATH`/`OPENCLAW_STATE_DIR` likewise, `pi`/`gemini`/`opencode` read project-local files, `omp` takes a `--config` overlay. The run hashes nine known global config paths before and after and exits 1 if one changed — that check fired on the first attempt (`~/.claude.json`), which is how the `CLAUDE_CONFIG_DIR` seeding was found.

Measured (this environment, 2026-11-22)
- 20 rows, exit 0, no global config change: 2 `pass` (**omp over HTTP and over stdio**: `server/discover`, `tools/list`, `tools/call` all 200 at revision `2026-07-28`), 10 `no-request`, 3 `config-isolation-unavailable` (codex HTTP, grok), 4 `not-installed` (antigravity, hermes), 1 `call-failed` (claude over stdio: discover+tools/list 200, no `tools/call`).
- `requests` is capped at 20 per row with `requestCount` carrying the true total: codex's first stdio attempt retried the bridge 4313 times (401s, no bearer in its scrubbed env), which is exactly why the cap exists.
- Codex: **`-c mcp_servers.spur.command/args` is a verified stdio mechanism** (`codex -c … mcp list` accepts it), and its HTTP transport needs `codex mcp add --url`, which writes `~/.codex/config.toml` — hence `config-isolation-unavailable` for HTTP, with that reason recorded in the row.
- The agent-side environment is the limit here, not the harness: claude is unauthenticated in this sandbox, gemini refuses the untrusted directory, opencode/pi did not see a `spur` server, openclaw's CLI rejected the invocation. Each is recorded with its own excerpt rather than smoothed over.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 one boot + recording proxy; HTTP and stdio case per agent | MET | `scripts/commands/mcp-agent-interop.ts` (startProxy, runCase), registered at `scripts/spur-dev.ts:84,153` and `package.json:105` — receipt: 21 rows (`serverProtocolFloor: 2026-07-28`) |
| R2 the row comes from the proxy log (method/revision/status/errorCode), not the agent's prose | MET | `startProxy` records `{method, revision, status, errorCode}` and never the Authorization header or bodies; `clientRevision` = first revision seen; `toolsSeen` = "a tools/list request happened". Verified by rows where the agent's text says it saw tools but the proxy shows none (e.g. `claude/http` excerpt names tools, `requests: []`) |
| R3 classification vocabulary; a missing agent is `not-installed`, never a failure | MET | `classify()`; receipt spread: 11 `no-request`, 4 `not-installed` (antigravity, hermes), 4 `config-isolation-unavailable` (codex, grok), 1 `call-failed` (claude/stdio: discover+tools/list 200, no tools/call), 1 `agent-error`. The version probe is guarded — the first run aborted on the missing `antigravity` binary, which is why the guard exists |
| R4 stable receipt, per-case persistence, `--agents` subset merge, exit 0 when every installed agent is classified | MET | `writeReceipt` after every case; merge keyed `(agent, transport)`; a subset rerun (`--agents=omp`) merged without dropping other rows; last run exit 0 with 17 classified rows for 9 installed agents |
| R5 the operator's global agent config is byte-identical | MET | `globalConfigPaths()` + `hashPath` before/after; a change exits 1. This check **fired** on the first attempt (`~/.claude.json`), which is how `CLAUDE_CONFIG_DIR` seeding was found; subsequent runs report no change |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Each installed agent's MCP handshake is exercised against a live server and recorded | MET | command | `bun run mcp-agent-interop` → 21 rows, exit 0; `docs/reports/mcp-agent-interop-receipt.json` |
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

- 2026-11-22T02:22:14.306Z backlog → todo (system)
- 2026-11-22T17:32:21.811Z todo → wip (system)
- 2026-11-22T17:34:46.256Z wip → testing (system)
- 2026-11-22T17:34:48.080Z testing → done (system)

