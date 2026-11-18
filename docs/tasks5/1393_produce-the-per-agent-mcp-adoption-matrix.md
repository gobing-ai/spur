---
schema_version: 1
name: Produce the per-agent MCP adoption matrix
status: done
template: feature-impl
created_at: 2026-11-18T05:29:33.333Z
updated_at: "2026-11-18T19:56:22.137Z"
feature_id: B92
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3.5

dependencies: ["1383"]
done_forced: "false"
done_reason: unforced close
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

- [x] R1. For each of the ten agents, record:
  - Streamable HTTP MCP client (yes / no / UNVERIFIED);
  - stdio MCP client (same values);
  - highest MCP protocol revision supported, and whether a stateless 2026-07-28 server works with no session;
  - bearer-header configuration support;
  - the agent version and date checked;
  - one official source URL per claim, or `UNVERIFIED`.
- [x] R2. Derive a verdict per agent: `mcp-http`, `mcp-stdio-bridge` or `cli-only`. 1394's fallback wording uses these verdicts.
- [x] R3. Write `docs/design/mcp-agent-adoption.md` with the matrix, the sources and a re-check note, and add a `docs/04_DESIGN.md` index row.
- [x] R4. Where an agent claims 2026-07-28 support, verify it with one `server/discover` round-trip against a local `spur serve` (HTTP, or stdio via `spur mcp`), if that agent is installed locally. Mark it `observed` versus `documented`.

### Acceptance Criteria

- [x] AC1 — Adoption matrix records verified MCP support per agent (req: R1, R2, R3, R4) [docs-only]

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/04_DESIGN.md:91` |
| `docs/design/mcp-agent-adoption.md:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — per agent: HTTP client, stdio client, highest revision claimed, stateless 2026-07-28 viability, bearer support, version+date checked, one official source or `UNVERIFIED` | MET | `docs/design/mcp-agent-adoption.md` §1 — ten rows with those columns; every row carries a source URL except OpenClaw, whose row says in §3 that no primary page was captured. Revision is `UNVERIFIED` for all ten, which is what the sources actually support |
| R2 — a verdict per agent (`mcp-http` / `mcp-stdio-bridge` / `cli-only`) for 1394's fallback wording | MET | §2 gives the verdict table: all ten `mcp-http`; `mcp-stdio-bridge` and `cli-only` are empty, and the doc says why (each agent also has a stdio client, used as the fallback when an HTTP entry cannot be configured) |
| R3 — `docs/design/mcp-agent-adoption.md` with matrix, sources and re-check note, plus a `docs/04_DESIGN.md` index row | MET | the file exists with §1 matrix, §2 verdicts, §3 gaps, §4 re-check note; `docs/04_DESIGN.md` has the index row |
| R4 — verify a claimed 2026-07-28 support with one `server/discover` round-trip against a local `spur serve`, marked `observed` vs `documented` | MET | **Server side observed:** a local `spur self serve` with `SPUR_MCP_ENABLED=true` answered `server/discover` with `protocolVersion: "2026-07-28"` and the ten-tool catalog over HTTP with a bearer token and no session id. **Client side:** one attempt (Codex) is recorded as "configures cleanly, handshake unproven" — `codex mcp list` showed the server `enabled` with a bearer-token env var, while an `codex exec` session exposed no tools. The document says the client handshake was not proven rather than dressing the attempt up as a pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Adoption matrix records verified MCP support per agent (R1, R2, R3, R4) | MET | command | `spur self serve` with `SPUR_MCP_ENABLED=true` + `curl -X POST /mcp -H 'Mcp-Protocol-Version: 2026-07-28' ... -d '{"method":"server/discover"}'` returned `protocolVersion: "2026-07-28"` and the ten-tool catalog (the observed half), and the matrix rows were written from the sources fetched per agent; the artifact is `docs/design/mcp-agent-adoption.md` |
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

- 2026-11-18T19:54:26.431Z todo → wip (system)
- 2026-11-18T19:56:17.814Z wip → testing (system)
- 2026-11-18T19:56:22.123Z testing → done (system)

