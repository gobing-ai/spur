---
schema_version: 1
name: Make agent guidance MCP-first with CLI fallback
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:33.333Z
updated_at: "2026-11-18T05:59:44.560Z"
feature_id: B92
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 3

dependencies: ["1392", "1393"]
---

## 1394. Make agent guidance MCP-first with CLI fallback

### Background

No skill or routing file mentions MCP today: `rg -i mcp` over AGENTS.md and the `sp:spur-cli` and `sp:spur-dev` SKILL.md files finds nothing. 32 guidance files hold 144 CLI write/check mentions (`spur task update|create`, `spur feature check`, `spur rule run`).

**Refine corrections (2026-11-17)**
- "name sp_ tools first for MCP-capable agents" implies per-agent text → skills are single-source and installed to every agent unchanged by Superskill. Per-agent branching would need per-platform content, which the feature puts out of scope. → The guidance is a runtime rule: if `sp_*` tools appear in your tool list, use them; otherwise use the CLI verb. The adoption matrix (1393) is linked as background, not baked into each agent's text.
- Rewriting all 144 mentions → not needed. The CLI stays the verb SSOT and the fallback. → One MCP-first rule, stated once in `sp:spur-cli` SKILL.md, the `sp:spur-dev` cross-cutting contract and the AGENTS.md routing table, plus one verb→tool map.
- The verb→tool map can drift from `TOOL_DESCRIPTORS` → add a parity test asserting that the map's tool names equal the server descriptor names.

### Requirements

- [ ] R1. Add `plugins/sp/skills/spur-cli/references/mcp-tools.md`. It maps each of the ten `sp_*` tools to its CLI verb and lists the CLI-only operations (forced done, rule files, auto-fix, ready-prep, batch-create).
- [ ] R2. Add an MCP-first rule to `sp:spur-cli` SKILL.md and to `sp:spur-dev` `references/cross-cutting.md`, linking `mcp-tools.md` and `docs/design/mcp-agent-adoption.md`. The rule: when `sp_*` tools are present, use them for the mapped reads and writes; otherwise use the CLI verb unchanged.
- [ ] R3. Add a matching rule to the AGENTS.md "Harness tool routing" table, and add the same row to `config/templates/AGENTS.md`.
- [ ] R4. A plugin test asserts that the tool names in `mcp-tools.md` equal the server descriptor names from `apps/server/src/modules/mcp/index.ts` (read as text, so the plugin stays standalone).
- [ ] R5. `cli-surface-parity`, `help-docs-parity`, `bootstrap-budget` and `bun run plugin-smoke` pass.

### Acceptance Criteria

- [ ] AC1 — Agent guidance prefers MCP with CLI fallback (req: R1, R2, R3, R4, R5)

Test layer: plugin parity suites over the real files.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T05:59:44.559Z

- **Per-agent guidance?** No. The runtime rule is driven by tool presence, which keeps skills single-source.
- **Rewrite existing CLI examples?** No. The CLI remains the SSOT and fallback, and the map is the single bridge.

### Design

**WHAT.** One reference file, three short rule insertions and one parity test. The existing CLI examples stay in place.

**WHY.** Agents discover tools at runtime, so the presence of `sp_*` tools is the only reliable capability signal on a single-source skill. The 1393 matrix tells operators which agents will see them.

**WHERE.**
- `plugins/sp/skills/spur-cli/references/mcp-tools.md` (new)
- `plugins/sp/skills/spur-cli/SKILL.md`
- `plugins/sp/skills/spur-dev/references/cross-cutting.md`
- AGENTS.md
- `config/templates/AGENTS.md`
- `plugins/sp/tests/mcp-tool-map-parity.test.ts` (new)

**Anti-patterns.**
- Don't add per-agent branches.
- Don't delete CLI guidance.
- Don't grow SKILL.md past the bootstrap budget (`plugins/sp/tests/bootstrap-budget.test.ts`); detail goes in the reference.

### Plan

- [ ] Step 1 (test first, R4): write `mcp-tool-map-parity.test.ts`. It fails until the map exists.
- [ ] Step 2 (R1): write `mcp-tools.md`.
- [ ] Step 3 (R2/R3): insert the rules and template rows.
- [ ] Step 4 (R5): `(cd plugins/sp && bun test tests/mcp-tool-map-parity.test.ts tests/cli-surface-parity.test.ts tests/help-docs-parity.test.ts tests/bootstrap-budget.test.ts)`, `bun run plugin-smoke`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
