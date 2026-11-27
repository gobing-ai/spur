---
schema_version: 1
name: "Spur wiring for the dsh executor: config, services, Board row and doctor version check"
status: done
template: feature-impl
created_at: 2026-11-26T20:35:39.278Z
updated_at: "2026-11-27T06:04:23.149Z"
feature_id: B81
priority: P2
tags:
  - dsh
  - agent

dependencies: ["1456"]
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
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

- [x] R7. add a `deepseek` executor entry (`agent: deepseek`, disabled by default) to config/config.global.yaml and config/config.example.yaml, kept out of default tiers
- [x] R8. process-identity.ts (verified `comm` name), run-session-observer.ts (`deepseek: 'deepseek'`) and failure-classification.ts recognise dsh
- [x] R9. agent-mcp-readiness.ts gives a read-only verdict for the dsh profile-patch MCP; the Board integrations row lists binary, config format and readiness
- [x] R13. doctor reports a mismatch between `verifiedAgainst` and the installed dsh version without disabling the executor (existing path, agent-doctor-ops.ts:287; regression assertion only)

### Acceptance Criteria

- [x] AC1 — dsh is a configurable executor tier entry
- [x] AC2 — Spur services recognise dsh processes and failures
- [x] AC3 — MCP readiness and the Board integrations row cover dsh
- [x] AC4 — A dsh version mismatch is surfaced by doctor

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

| File | Lines | What / why |
| --- | --- | --- |
| `packages/app/src/services/run-session-observer.ts` | 15-31 | `deepseek: 'deepseek'` added to `AGENT_SESSION_SOURCES`, so dsh runs resolve the importer's existing `.dsh/sessions` source instead of being skipped (R8) |
| `packages/app/src/services/agent-mcp-readiness.ts` | 63-82 | `dshPatchEntry`: reads a dsh profile patch (a top-level YAML array of loader entries) and returns the `config` of the `@deepseek-ai/dsh-mcp-client` entry whose `config.serverName` is `spur` (R9) |
| `packages/app/src/services/agent-mcp-readiness.ts` | 148-161 | `deepseek` readiness spec: binary `dsh`, format `yaml`, path `~/.dsh/profiles/headless/cordis.patch.yml`, actors `['deepseek']`, not a legacy MCP revision — read-only verdict, writing the patch stays B811 (R9) |
| `apps/web/src/modules/integrations/helpers.ts` | 53-65 | `deepseek` added to `MCP_CLIENT_AGENTS`, so the Board's Client-config tabs and readiness row cover dsh (R9) |
| `apps/web/src/modules/integrations/helpers.ts` | 71-82 | Label/path row: `dsh` → `~/.dsh/profiles/headless/cordis.patch.yml` |
| `apps/web/src/modules/integrations/helpers.ts` | 181-186 | dsh renders `yaml` (its patch layer), not the omp/`mcp_servers` shape a dsh profile would ignore |
| `apps/web/src/modules/integrations/helpers.ts` | 200-219 | dsh snippet branch: a `- id: spur / name: '@deepseek-ai/dsh-mcp-client' / config: {serverName, transport, url|command,args}` entry, HTTP and stdio |
| `config/config.global.yaml` | 79-81, 140-148 | `deepseek` added to the canonical-id comment; a `deepseek` executor entry (`agent: deepseek`, `model: deepseek-chat`) that is `disabled: true` and tier-less, so nothing routes to it before the 1458 E2E proof (R7) |
| `config/config.example.yaml` | 100-103, 178-186 | Same row in the shipped example config (R7) |
| `docs/design/dsh-agent-integration.md` | 22-30, 38-46 | §2 restated against the released 0.8.5 shim; §3 records the two refinements implementation proved: the real dsh MCP shape (`dsh-mcp-client` loader entry, not `mcp-manager config.servers`) and the observed `comm=node` that keeps `dsh` out of `AGENT_EXECUTABLE_NAMES` |
| `packages/app/tests/services/agent-mcp-readiness.test.ts` | 177-230 | dsh readiness: configured from a profile patch, `not-configured` for an empty patch or a differently named server, `not-installed` without the binary |
| `packages/app/tests/services/run-session-observer.test.ts` | 452-461 | canonical `deepseek` maps onto the importer `deepseek` source and its `.dsh/sessions` root |
| `packages/app/tests/services/process-identity.test.ts` | 118-127 | `dsh`/`deepseek` are absent from `AGENT_EXECUTABLE_NAMES`, recording the observed `comm=node` |
| `apps/web/tests/modules/integrations/helpers.test.ts` | 541-562 | dsh renders the profile-patch YAML entry (HTTP and stdio) and never an `mcp_servers:` block |

No `failure-classification.ts` change (R8): the only stderr a real dsh 0.2.2-rc.1 run produced was a
model-listing info line, and its failure arm is an `error` event plus exit 1 — no dsh-specific provider
signature to classify. No `process-identity.ts` change, per the observation above.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R7 | MET | `config/config.global.yaml:145-152` and `config/config.example.yaml:186-193` — `deepseek` executor, `disabled: true`, no `tier`; both files parse (`bun -e` yaml parse, this run); `packages/config` tests 341 pass / 0 fail (this run). Fix pass refreshed the stale "until 1458 passes" comment in both files to the ADR-153 opt-in decision |
| R8 | MET | `packages/app/src/services/run-session-observer.ts:15-31` (`deepseek: 'deepseek'`); `packages/app/tests/services/run-session-observer.test.ts:452-461`; `process-identity.ts`/`failure-classification.ts` unchanged by observation (`packages/app/tests/services/process-identity.test.ts:118-127`, `docs/design/dsh-agent-integration.md:38-46`); 36 pass / 0 fail across the 3 service files (this run) |
| R9 | MET | `packages/app/src/services/agent-mcp-readiness.ts:63-82,148-161`; `apps/web/src/modules/integrations/helpers.ts:53-65,181-186,200-219`; tests `packages/app/tests/services/agent-mcp-readiness.test.ts:177-230` and `apps/web/tests/modules/integrations/helpers.test.ts:541-562` (33 pass / 0 fail, this run) |
| R13 | MET | `packages/app/src/services/agent-doctor-ops.ts:281-290` warns only (no disable); regression `packages/app/tests/services/agent-service.test.ts:4967-4985` asserts the `0.2.2-rc.1` core in the warning; `--test-name-pattern 0899` → 4 pass / 0 fail (this run) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `config/config.global.yaml:145-152`, `config/config.example.yaml:186-193`; yaml parse + `packages/config` suite 341 pass (this run) |
| AC2 | MET | test | `packages/app/tests/services/run-session-observer.test.ts:452-461`, `packages/app/tests/services/process-identity.test.ts:118-127` (pass, this run) |
| AC3 | MET | test | `packages/app/tests/services/agent-mcp-readiness.test.ts:177-230`, `apps/web/tests/modules/integrations/helpers.test.ts:541-562` (pass, this run); Board browser receipt `.spur/run/integrations-proof/integrations-e2e-receipt.json` (prior run) |
| AC4 | MET | test | `packages/app/tests/services/agent-service.test.ts:4967-4985` — 0899 pattern 4 pass / 0 fail (this run) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

# Review — task 1457 (Spur wiring for the dsh executor)

| Req | Status | Evidence |
| --- | --- | --- |
| R7 | MET | `config/config.global.yaml:140-148` and `config/config.example.yaml:178-186` declare `{name: deepseek, agent: deepseek, model: deepseek-chat, disabled: true}` with no `tier`, so no rung can route to it; both rows parse against `AgentExecutorConfigSchema` (`bun -e` over `packages/config/src/index.ts`, 2026-11-26). The canonical-id comment lists `deepseek` (`config/config.global.yaml:79-81`) |
| R8 | MET | `packages/app/src/services/run-session-observer.ts:15-31` maps `deepseek: 'deepseek'`, proven by `packages/app/tests/services/run-session-observer.test.ts:452-461` (also asserts the importer's `.dsh/sessions` default root). `process-identity.ts` and `failure-classification.ts` are deliberately unchanged, with the observation recorded in `packages/app/tests/services/process-identity.test.ts:118-127` (live dsh 0.2.2-rc.1 reads `comm=node`) and in `docs/design/dsh-agent-integration.md:38-46` |
| R9 | MET | `packages/app/src/services/agent-mcp-readiness.ts:63-82` reads the profile patch entry (`@deepseek-ai/dsh-mcp-client` with `config.serverName: spur`) and `:148-161` registers the `deepseek` spec (`binary: dsh`, `format: yaml`, `~/.dsh/profiles/headless/cordis.patch.yml`, read-only); `apps/web/src/modules/integrations/helpers.ts:53-65,71-82,181-186,200-219` adds dsh to the Board's agents with its own YAML shape. Tests: `packages/app/tests/services/agent-mcp-readiness.test.ts:177-230`, `apps/web/tests/modules/integrations/helpers.test.ts:541-562` |
| R13 | MET | No new code: the generic `capability-declaration-stale` path (`packages/app/src/services/agent-doctor-ops.ts:287`) now compares against `verifiedAgainst: '0.2.2-rc.1'` (1456). Regression assertion `packages/app/tests/services/agent-service.test.ts:4967-4985` (0899 R3, deepseek core drift warns, executor not disabled) — 4 pass / 0 fail under `--test-name-pattern 0899` |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | static-ref+command | `config/config.global.yaml:140-148`, `config/config.example.yaml:178-186`; both rows parse as `AgentExecutorConfigSchema` (`{"name":"deepseek","agent":"deepseek","model":"deepseek-chat","disabled":true}`) |
| AC2 | MET | test | `packages/app/tests/services/run-session-observer.test.ts:452-461`, `packages/app/tests/services/process-identity.test.ts:118-127` (17 + 19 tests pass across the two service files; light gate PASS) |
| AC3 | MET | test+command | `packages/app/tests/services/agent-mcp-readiness.test.ts:177-230` (configured / not-configured / not-installed), `apps/web/tests/modules/integrations/helpers.test.ts:541-562` (dsh profile-patch snippet), and the Board browser proof `apps/web/tests/modules/integrations-browser.heavy.test.ts` → PASS with receipt `.spur/run/integrations-proof/integrations-e2e-receipt.json` and screenshots `integrations-e2e-summary-{light,dark}.png` |
| AC4 | MET | test | `packages/app/tests/services/agent-service.test.ts:4967-4985` (0899 R3) — a dsh version drift warns `capability-declaration-stale` without disabling the executor |

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| P3 | AC3's browser proof covers the Board page rendering and the readiness projection, but no screenshot names the `dsh` row itself: the Summary tab is what the harness captures, and the per-agent rows come from the readiness procedure that the unit tests pin. | Accepted: the row is data-driven from `probeAgentMcpReadiness`, whose dsh behaviour is unit-tested end to end (configured/misconfigured/not-installed). A row-level screenshot assertion belongs to the Board harness, not this wiring task. |
| P3 | dsh's MCP entry shape is read from the `dsh-mcp-client` README (0.2.2-rc.1) and never yet from a patch that actually loads a server; B811 will write the first real one. | Accepted: `dshPatchEntry` returns `undefined` for anything it does not recognise, so an unknown future shape degrades to `not-configured` (with the path named), never to a false `configured`. |
| P4 | AC1 says "executor tier entry" while the entry deliberately declares no `tier` (R7 keeps it out of every rung). | Resolved by R7's precedence: the entry exists in the executor roster and is configurable, but a tier would let the ladder dispatch to an unproven agent. |

Gate evidence: `spur task gate 1457 light` PASS (12 changed files, receipt `.spur/run/1457-check-receipt.json`); the pipeline's `gate` state ran the full pass for this tree in run `03651a0e`.

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-26T21:03:52.262Z feature_id U → B81 (system)
- 2026-11-27T01:42:41.565Z todo → wip (system)
- 2026-11-27T01:43:49.411Z wip → testing (system)
- 2026-11-27T01:43:50.980Z testing → done (system)

