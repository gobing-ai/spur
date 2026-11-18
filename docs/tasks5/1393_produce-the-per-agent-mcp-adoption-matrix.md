---
schema_version: 1
name: Produce the per-agent MCP adoption matrix
status: wip
template: feature-impl
created_at: 2026-11-18T05:29:33.333Z
updated_at: "2026-11-18T19:54:26.431Z"
feature_id: B92
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3.5

dependencies: ["1383"]
---

## 1393. Produce the per-agent MCP adoption matrix

### Background

MCP-first guidance (1394) is only safe for agents whose MCP client can reach Spur's server. That server accepts only stateless `POST /mcp` with `Mcp-Protocol-Version` ≥ `2026-07-28`. It rejects legacy versions and stateful sessions outright (`docs/design/embedded-mcp-server.md` §3). The `spur mcp` stdio bridge (§5) forwards NDJSON lines verbatim and only forces the version header.

**Refine corrections (2026-11-17)**
- "verify stateless MCP 2.0+ support" (one yes/no column) → there are two ways in: Streamable HTTP directly, or stdio through `spur mcp`. The bridge does not translate the legacy `initialize`/`notifications/initialized` handshake, so a stdio client still has to speak the 2026-07-28 method set (`server/discover`, …). → The matrix records the HTTP and stdio columns and the protocol level separately.
- "ten agents" were never named in the task → the list is from AGENTS.md: Claude Code, Codex, Gemini CLI, pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok.
- "a design satellite" with no path → `docs/design/mcp-agent-adoption.md` plus an index row in `docs/04_DESIGN.md` (T3).
- The matrix is evidence that ages → each row carries a checked-on date and the agent version observed.

### Requirements

- [ ] R1. For each of the ten agents, record:
  - Streamable HTTP MCP client (yes / no / UNVERIFIED);
  - stdio MCP client (same values);
  - highest MCP protocol revision supported, and whether a stateless 2026-07-28 server works with no session;
  - bearer-header configuration support;
  - the agent version and date checked;
  - one official source URL per claim, or `UNVERIFIED`.
- [ ] R2. Derive a verdict per agent: `mcp-http`, `mcp-stdio-bridge` or `cli-only`. 1394's fallback wording uses these verdicts.
- [ ] R3. Write `docs/design/mcp-agent-adoption.md` with the matrix, the sources and a re-check note, and add a `docs/04_DESIGN.md` index row.
- [ ] R4. Where an agent claims 2026-07-28 support, verify it with one `server/discover` round-trip against a local `spur serve` (HTTP, or stdio via `spur mcp`), if that agent is installed locally. Mark it `observed` versus `documented`.

### Acceptance Criteria

- [ ] AC1 — Adoption matrix records verified MCP support per agent (req: R1, R2, R3, R4)

Test layer: document review against cited sources, plus local `server/discover` round-trips where possible.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:59:43.332Z

- **One column or several?** Several (HTTP, stdio, protocol level). The bridge's lack of legacy translation makes stdio support alone insufficient.
- **Add legacy-handshake translation to the bridge so more agents qualify?** Not here. Stateless-only is an ADR-152 decision, and any change belongs to a new feature, raised only if the matrix shows a material gap.

### Design

**WHAT.** A source-driven research record. No product code.

**WHY.** 1394 must not tell an agent to use `sp_*` tools it cannot reach. The verdict column is the single input 1394 reads.

**WHERE.** `docs/design/mcp-agent-adoption.md` (new) and `docs/04_DESIGN.md` (index row).

**Anti-patterns.**
- Don't cite blogs or memory when official docs or changelogs exist.
- Don't infer HTTP support from stdio support.
- Don't mark `observed` without a local round-trip.

### Plan

- [ ] Step 1 (R1): for each agent, read its official MCP docs and changelog (via `sp:source-driven-development`) and fill the row with URLs.
- [ ] Step 2 (R4): run a `server/discover` round-trip for the agents installed locally.
- [ ] Step 3 (R2/R3): derive the verdicts, write the satellite and add the 04 index row.
- [ ] Step 4: run `sp:doc-evolve`'s contract check on the new satellite.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T19:54:26.431Z todo → wip (system)

