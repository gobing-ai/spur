---
schema_version: 1
name: Wire one gateway MCP entry per supported agent at install
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:38.011Z
updated_at: "2026-11-18T06:12:28.337Z"
feature_id: K43
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1383", "1393"]
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

- [ ] R1. `spur mcp --gateway` targets `http://localhost:<server.gateway.port>/mcp`, with the bearer taken from the variable named by `server.gateway.mcp.authEnv`. It conflicts with `--url` (usage error). Failures exit nonzero with a remedy:
  - gateway MCP disabled or `authEnv` unset;
  - token variable empty;
  - gateway not answering (`isGatewayAnswering`).
  Token values are never printed.
- [ ] R2. Add `plugins/sp/mcp.json` with exactly one server, `"spur": { "command": "spur", "args": ["mcp", "--gateway"] }`.
- [ ] R3. `superskill install sp --dry-run` against a fixture HOME lists one `spur` MCP entry for each MCP-capable target, and the skipped targets with superskill's reason. A second install leaves exactly one entry. Record the output as the task artifact.
- [ ] R4. Update `docs/design/mcp-agent-adoption.md` (from 1393) with the install route and the per-verdict outcome. Update the `spur mcp` reference in `sp:spur-cli` for `--gateway`.

### Acceptance Criteria

- [ ] AC1 — One gateway MCP entry is configured per supported agent (req: R1, R2, R3, R4)

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

- [ ] Step 1 (test first, R1): bridge tests against a real gateway listener with `server.gateway.mcp` enabled. Cover the round-trip `tools/list`, disabled, unset variable, gateway down, and `--gateway` with `--url`.
- [ ] Step 2: implement `--gateway`.
- [ ] Step 3 (R2/R3): add `plugins/sp/mcp.json`, run `HOME=<fixture> superskill install sp --dry-run` twice, and save the output under `docs/tasks5/artifacts/1401/`. If a target that is MCP-capable per 1393 lacks the entry, file the gap upstream with superskill. Don't add a Spur workaround.
- [ ] Step 4 (R4): docs. Run `bun run plugin-smoke`, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
