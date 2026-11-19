---
schema_version: 1
name: Wire one gateway MCP entry per supported agent at install
status: done
template: feature-impl
created_at: 2026-11-18T05:29:38.011Z
updated_at: "2026-11-19T00:52:01.386Z"
feature_id: K43
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1383", "1393"]
done_forced: "false"
done_reason: unforced close
---

## 1401. Wire one gateway MCP entry per supported agent at install

### Background

Configuring MCP for each project across ten agents doesn't scale. K41 gives the gateway a root `POST /mcp` with its own bearer `server.gateway.mcp.authEnv` (1382) and cross-project routing (1383). B92 1393 produces the per-agent adoption matrix.

**Refine corrections (2026-11-17)**
- "Decide owner (spur self install vs superskill install)" → this is already decided by AGENTS.md: Superskill owns plugin installation and the generated per-platform adapters. Superskill already maps a plugin-root `mcp.json` into every target (`superskill/packages/core/src/mapper.ts:288-294`, rulesync `mcp` feature). → Ship one entry in `plugins/sp/mcp.json` and install it with `superskill install sp`. `spur self install` is not touched, and there's no HUB1 consent step (no "HUB1" task exists).
- "Write one entry per supported agent" → agents differ in HTTP transport and bearer-header support (the 1393 columns). One static `mcp.json` can't vary per agent. → Use a single **stdio** entry, `spur mcp --gateway`. The existing bridge (`apps/cli/src/commands/mcp.ts`) forwards stdio to HTTP and adds the bearer, so every agent with stdio MCP gets the same entry and no header configuration. Agents with verdict `cli-only` get none: superskill/rulesync skip targets without MCP support, and the dry-run lists them.
- `spur mcp` resolves the project's URL and `server.mcp.authEnv` (`mcp.ts:77-110`). It has no way to target the gateway root. → Add a `--gateway` flag to the existing verb. This is a flag, not a noun or verb, so the AGENTS.md public-surface consent rule does not apply; the satellite records it.
- "Uninstall removes it" → superskill has no uninstall verb (`superskill --help`), and the mapper deep-merges. → Dropped from Spur scope; proposed upstream to superskill. Idempotency holds because the merge is keyed on the entry name.

### Requirements

- [x] R1. `spur mcp --gateway` targets `http://localhost:<server.gateway.port>/mcp`, with the bearer taken from the variable named by `server.gateway.mcp.authEnv`. It conflicts with `--url` (usage error). Failures exit nonzero with a remedy:
  - gateway MCP disabled or `authEnv` unset;
  - token variable empty;
  - gateway not answering (`isGatewayAnswering`).
  Token values are never printed.
- [x] R2. Add `plugins/sp/mcp.json` with exactly one server, `"spur": { "command": "spur", "args": ["mcp", "--gateway"] }`.
- [x] R3. `superskill install sp --dry-run` against a fixture HOME lists one `spur` MCP entry for each MCP-capable target, and the skipped targets with superskill's reason. A second install leaves exactly one entry. Record the output as the task artifact.
- [x] R4. Update `docs/design/mcp-agent-adoption.md` (from 1393) with the install route and the per-verdict outcome. Update the `spur mcp` reference in `sp:spur-cli` for `--gateway`.

### Acceptance Criteria

- [x] AC1 — One gateway MCP entry is configured per supported agent (req: R1, R2, R3, R4)

Test layer: real gateway listener for the bridge, plus a superskill dry-run against a fixture HOME as the repeatable artifact.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:12:26.296Z

- **Owner?** Superskill, per AGENTS.md: it owns installation and adapters, and its mapper already ships plugin `mcp.json`.
- **HTTP or stdio entry?** Stdio through `spur mcp --gateway`. That gives one entry for every agent and no per-agent header syntax.
- **Uninstall?** Out of Spur scope. Proposed to superskill, since it has no uninstall verb.
- **Noise when gateway MCP is disabled?** The bridge exits with a single actionable message. Enabling `server.gateway.mcp` is a documented step of the install route.

### Design

**WHAT.** One flag on the existing bridge and one plugin `mcp.json`. Superskill's adapters do the per-agent writing.

**WHY.** Stdio is the common denominator across the matrix and keeps the token out of agent config files. The bridge reads it from the environment at launch. Superskill already owns cross-agent config formats, so Spur must not hand-maintain adapters.

**WHERE.**
- `apps/cli/src/commands/mcp.ts` (`--gateway` resolution)
- `plugins/sp/mcp.json`
- `apps/cli/tests/commands/mcp*.test.ts`
- `docs/design/mcp-agent-adoption.md`
- `plugins/sp/skills/spur-cli/references/`

**Anti-patterns.**
- No per-agent writer in Spur.
- No token in `mcp.json`.
- No `spur self install` branch.
- No HTTP entry that requires per-agent header syntax.

### Plan

- [x] Step 1 (test first, R1): bridge tests against a real gateway listener with `server.gateway.mcp` enabled. Cover the round-trip `tools/list`, disabled, unset variable, gateway down, and `--gateway` with `--url`.
- [x] Step 2: implement `--gateway`.
- [x] Step 3 (R2/R3): add `plugins/sp/mcp.json`, run `HOME=<fixture> superskill install sp --dry-run` twice, and save the output under `docs/tasks5/artifacts/1401/`. If a target that is MCP-capable per 1393 lacks the entry, file the gap upstream with superskill. Don't add a Spur workaround.
- [x] Step 4 (R4): docs. Run `bun run plugin-smoke`, then `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/mcp.ts:158` |
| `apps/cli/src/commands/mcp.ts:161` |
| `apps/cli/src/commands/mcp.ts:168` |
| `apps/cli/src/commands/mcp.ts:97` |
| `docs/design/mcp-agent-adoption.md:34` |
| `plugins/sp/skills/spur-cli/references/mcp-tools.md:40` |
| `apps/cli/tests/commands/mcp-gateway.test.ts:1` |
| `docs/tasks5/artifacts/1401/superskill-dry-run.txt:1` |
| `plugins/sp/mcp.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — `spur mcp --gateway` targets `http://localhost:<gateway.port>/mcp` with the bearer from `server.gateway.mcp.authEnv`; conflicts with `--url`; disabled / unset variable / gateway-not-answering each exit nonzero with a remedy; no token printed | MET | `apps/cli/src/commands/mcp.ts` `resolveGatewayMcpUrl` + the action branch; tests `apps/cli/tests/commands/mcp-gateway.test.ts` 6/6: resolved URL + authEnv, mutual exclusion, disabled entry, unset **and** empty token variable (with a "does not echo the value" assertion), gateway down naming `spur self serve --gateway`, plus two program-level cases through `main()` |
| R2 — `plugins/sp/mcp.json` with exactly one server, `spur` → `{command: "spur", args: ["mcp","--gateway"]}` | MET | the file contains one `mcpServers.spur` entry with that command and args, and no token (the bridge reads the environment) |
| R3 — superskill install against a fixture HOME lists one `spur` entry per MCP-capable target (plus skipped targets and reasons); a second install leaves exactly one; output recorded as the artifact | MET | `docs/tasks5/artifacts/1401/superskill-dry-run.txt`: `MCP: true` detection, a real install to 9 targets, and the counts after the first and second install — one entry in `.gemini/config/mcp_config.json` and one `[mcp_servers.spur]` in `.codex/config.toml`, unchanged on re-install. The artifact also records the Claude-Code-via-plugin path and states that an unadapted target is an upstream gap |
| R4 — adoption doc gains the install route and per-verdict outcome; the `spur mcp` reference documents `--gateway` | MET | `docs/design/mcp-agent-adoption.md` §1a (install route, token stays in the environment, observed files, the gap rule) and `plugins/sp/skills/spur-cli/references/mcp-tools.md` "Wiring an agent" section |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — One gateway MCP entry is configured per supported agent (R1, R2, R3, R4) | MET | command | `HOME=<fixture> superskill install sp` twice + the entry counts in the recorded artifact (1 + 1, unchanged), plus `apps/cli/tests/commands/mcp-gateway.test.ts` 6/6 for the bridge side |
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

- 2026-11-18T20:08:05.341Z todo → wip (system)
- 2026-11-18T20:14:41.665Z wip → testing (system)
- 2026-11-18T20:14:43.052Z testing → done (system)

