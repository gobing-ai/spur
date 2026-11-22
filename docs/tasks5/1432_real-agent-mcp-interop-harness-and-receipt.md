---
schema_version: 1
name: Real-agent MCP interop harness and receipt
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:34.552Z
updated_at: "2026-11-22T04:26:15.591Z"
feature_id: B93

tags: ["B93"]
dependencies: ["1431"]
priority: P1
estimate_hours: 8
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

- [ ] R1. `scripts/commands/mcp-agent-interop.ts` does the following:
  - boots `spur self serve` with MCP enabled and a generated bearer token in a temp project;
  - fronts `/mcp` with an in-process recording proxy;
  - for each of the ten supported agents, runs the HTTP case (entry → proxy URL, bearer from env) and the stdio case (entry → `spur mcp --url <proxy>`).
- [ ] R2. Each case asks the agent (fixed prompt) to list its `spur` tools and call `sp_task_list`. The receipt row records:
  - `{agent, version, transport, installed, configMethod, clientRevision, requests: [{method, revision, status, errorCode}], toolsSeen, callOutcome: pass|fail|not-attempted, classification, errorExcerpt}`.

  `clientRevision` and `requests` come from the proxy log, not from the agent's prose.
- [ ] R3. Classification is one of `pass`, `rejected-legacy-revision` (proxy saw `PROTOCOL_VERSION_UNSUPPORTED`), `no-request` (the agent never reached the server), `auth-failed`, `call-failed`, `not-installed`, `config-isolation-unavailable` or `agent-error`. A missing agent is `not-installed`, never a failure.
- [ ] R4. It writes `docs/reports/mcp-agent-interop-receipt.json` (stable name, overwritten each run) with `generatedAt`, the server protocol floor, and the rows. It exits 0 when every installed agent has a classification. A `pass` is not required (verdicts are 1433's job).
- [ ] R5. The user's global agent configs are byte-identical before and after (the script checks the hash of each known config path it could touch).

### Acceptance Criteria

- [ ] AC1 — Each installed agent's MCP handshake is exercised against a live server and recorded

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:14.306Z backlog → todo (system)

