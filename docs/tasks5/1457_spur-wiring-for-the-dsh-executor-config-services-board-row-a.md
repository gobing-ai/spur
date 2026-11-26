---
schema_version: 1
name: "Spur wiring for the dsh executor: config, services, Board row and doctor version check"
status: todo
template: feature-impl
created_at: 2026-11-26T20:35:39.278Z
updated_at: "2026-11-26T21:29:25.759Z"
feature_id: B81
priority: P2
tags:
  - dsh
  - agent

dependencies: ["1456"]
estimate_hours: 4
---

## 1457. Spur wiring for the dsh executor: config, services, Board row and doctor version check

### Background

Covers R7, R8, R9, R13. Adds a `deepseek` row to each existing per-agent table in Spur, following the grok integration. Design: docs/design/dsh-agent-integration.md §3 and §5.

**Refine corrections (2026-11-26)**

- Agent id `dsh` → the ts-ai-runner canonical id is `deepseek` (`../ts-libs/packages/ai-runner/src/agents/shims.ts:425`), and Spur's agent-service tests already use `agent: 'deepseek'` (`packages/app/tests/services/agent-service.test.ts:4929`) → every Spur row and config entry keys on `deepseek`; the binary name is `dsh`.
- run-session-observer "recognise dsh" → the importer 0.8.4 installed in Spur already has a `deepseek` source over `~/.dsh/sessions` (`node_modules/@gobing-ai/ts-llm-jsonl-importer/dist/types.d.ts:5`; `../ts-libs/packages/llm-jsonl-importer/src/sources.ts:220`) → add `deepseek: 'deepseek'` to `AGENT_SESSION_SOURCES` (`packages/app/src/services/run-session-observer.ts:15`); no importer work.
- R13 "doctor reports the version mismatch" → the generic stale-capability warning already exists (`packages/app/src/services/agent-doctor-ops.ts:287`) and is tested for `deepseek` (`packages/app/tests/services/agent-service.test.ts:4929-4983`) → no new code; R13 is satisfied once 1456 updates `verifiedAgainst`, and a regression assertion confirms it.
- process-identity executable name → `AGENT_EXECUTABLE_NAMES` matches `ps comm` (`packages/app/src/services/process-identity.ts:38`); `dsh` is a Node launcher (`~/.bun/install/global/node_modules/@deepseek-ai/dsh/lib/bin.js`), so `comm` may read `node` → verify `ps -o comm=` against a live dsh process before adding `'dsh'`, and record the observation.
- Board row → the integrations list is `MCP_CLIENT_AGENTS` (`apps/web/src/modules/integrations/helpers.ts:53`), and the MCP readiness row shape is `{id,label,binary,format,paths,entry,actors}` (`packages/app/src/services/agent-mcp-readiness.ts:131`) → dsh's MCP config lives in the profile `cordis.patch.yml` (YAML) under `$DSH_HOME/profiles/<profile>/`.

### Requirements

- [ ] R7. add a `deepseek` executor entry (`agent: deepseek`, disabled by default) to config/config.global.yaml and config/config.example.yaml, kept out of default tiers
- [ ] R8. process-identity.ts (verified `comm` name), run-session-observer.ts (`deepseek: 'deepseek'`) and failure-classification.ts recognise dsh
- [ ] R9. agent-mcp-readiness.ts gives a read-only verdict for the dsh profile-patch MCP; the Board integrations row lists binary, config format and readiness
- [ ] R13. doctor reports a mismatch between `verifiedAgainst` and the installed dsh version without disabling the executor (existing path, agent-doctor-ops.ts:287; regression assertion only)

### Acceptance Criteria

- [ ] AC1 — dsh is a configurable executor tier entry
- [ ] AC2 — Spur services recognise dsh processes and failures
- [ ] AC3 — MCP readiness and the Board integrations row cover dsh
- [ ] AC4 — A dsh version mismatch is surfaced by doctor

Check the Board integrations row in a browser.

### Q&A

#### Q&A entry — 2026-11-26T20:36:33.389Z

- dsh stays out of the default tiers until 1458 passes. Reason: no real-run proof exists yet.
- MCP readiness only reads the dsh profile. Reason: writing the profile patch belongs to Superskill (feature B811).

#### Q&A entry — 2026-11-26T21:29:19.950Z

#### Q&A entry — 2026-11-26 (refine --depth ready)

- Key every row on `deepseek`, not `dsh`. Reason: that is the runner's canonical id, and Spur tests already use it.
- R13 needs no new code. Reason: the generic `capability-declaration-stale` warning covers it (agent-doctor-ops.ts:287).
- Add a process-identity entry only if `ps comm` distinguishes dsh. Reason: a `node` comm would misattribute other Node agents.

### Design

Approach: one `deepseek` row per existing table: `AGENT_EXECUTABLE_NAMES` (`process-identity.ts:38`), `AGENT_SESSION_SOURCES` (`run-session-observer.ts:15`), the provider patterns (`failure-classification.ts`, only for a dsh-specific stderr signature observed in a real run — otherwise none), the readiness list (`agent-mcp-readiness.ts`, format `yaml`, path `~/.dsh/profiles/headless/cordis.patch.yml`, read-only), and `MCP_CLIENT_AGENTS` plus the config-format switch (`apps/web/src/modules/integrations/helpers.ts:53,183`). The doctor mismatch reuses `capability-declaration-stale` (`agent-doctor-ops.ts:287`) unchanged. Reason: the seams exist, so no new abstraction is needed.
Rejected: putting dsh in a default tier before 1458 passes; a dsh-specific doctor path.
Invariants: Spur stores no dsh credential; MCP readiness only reads, and writing the profile patch is B811; the agent id is `deepseek` everywhere.

### Plan

1. Requires 1456: the Spur catalog must carry the ts-ai-runner version with the upgraded `deepseek` shim.
2. Observe `ps -o comm=` for a live `dsh --profile headless` process and record whether it reads `dsh` or `node`.
3. Write tests first in `packages/app/tests/services/` for process identity (only if `comm` is distinguishable), session-source mapping, MCP readiness for `deepseek`, and the stale-capability warning against the new `verifiedAgainst`.
4. Add the `deepseek` rows to `process-identity.ts`, `run-session-observer.ts` and `agent-mcp-readiness.ts`; add a failure-classification pattern only for an observed dsh stderr signature.
5. Add a disabled `deepseek` executor and the supported-executor comment lines to `config/config.global.yaml` and `config/config.example.yaml`, outside the default tiers.
6. Add `deepseek` to `MCP_CLIENT_AGENTS` and the format switch in `apps/web/src/modules/integrations/helpers.ts`, then check the Board row in a browser.
7. Update the design satellite §3 if the implementation diverges, then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T21:03:52.262Z feature_id U → B81 (system)

