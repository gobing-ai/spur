---
template: issue
schema_version: 1
name: "Inventory the backward-compatibility surface before any agent-config redesign"
description: ""
status: done
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: ["wayfinder:research", "backward-compat"]
dependencies: []
created_at: "2026-07-27T01:27:19.150Z"
updated_at: "2026-07-27T05:38:50.779Z"
---

## 0347. Inventory the backward-compatibility surface before any agent-config redesign

### Background

Wayfinder ticket for map B2. Type: research (`sp:brainstorm` / direct investigation).

The operator has asked that any redesign of the `agent:` config section consider backward compatibility carefully. Nothing currently enumerates what depends on the present shape, and `spur` is published on npm, so consumers exist outside this monorepo.

Known touch points to start from, not an exhaustive list: `AgentConfigSchema` / `AgentExecutorConfigSchema` (`packages/config/src/index.ts`), `getExecutorTier` / `isTierEligible` / `TIER_RANK`, `REGISTERED_CANONICAL_STAGES` and `getCanonicalStage`, `extractPhase`, the retired `default-by-phase` shim, `agent.team[].members[].executor`, `task-pipeline.yaml`'s `vars.agent`, the `--agent` flag across every `/sp:dev-*` command, `apps/cli/schemas/spur-config.schema.json`, and `config/templates/` seeded by `spur init`.

This ticket produces the inventory the redesign is checked against. It is unblocked and can run at any time.

### Requirements
R1. Enumerate every consumer of the current `agent:` config shape across the monorepo — source, schemas, templates, workflow YAML, plugin `sp`, and docs — with file references.

R2. Identify which are operator-visible contracts (config keys, CLI flags, published JSON schema) versus internal implementation details that can change freely.

R3. Identify what `spur init` seeds today, since new projects inherit whatever shape it writes.

R4. Note which items are already deprecated or retired so the redesign does not preserve dead weight.

R5. Produce the inventory as a task artifact the later ADR can cite. Do not propose the redesign here.
### Acceptance Criteria
```gherkin
Feature: 0347 — Backward-Compatibility Inventory

  Scenario: Every consumer of the agent: config shape is enumerated
    Given the Spur monorepo at /Users/robin/xprojects/spur-new
    When the inventory is compiled across source, schemas, templates, workflow YAML, plugin sp, and docs
    Then every file that references AgentConfigSchema, AgentExecutorConfigSchema, TIER_RANK, getExecutorTier, isTierEligible, REGISTERED_CANONICAL_STAGES, getCanonicalStage, extractPhase, default-by-phase, agent.team[].members[].executor, task-pipeline.yaml's vars.agent, the --agent flag, apps/cli/schemas/spur-config.schema.json, or config/templates/ appears in the Solution section with path:line evidence
    And no consumer is missing from the inventory

  Scenario: Operator-visible contracts are distinguished from internal implementation
    Given the enumerated consumers
    When each is classified
    Then config keys, CLI flags, published JSON schema, and spur init templates are marked operator-visible
    And services, types, helpers, and workflow internals are marked internal implementation
    And deprecated or retired items are marked with their deprecation marker

  Scenario: Deprecated and retired items are flagged
    Given the enumerated consumers
    When deprecated or retired items are identified
    Then each carries a note describing how it is marked deprecated (runtime warning, ADR, comment, _legacy prefix)
    And the redesign is told not to preserve dead weight

  Scenario: Inventory is citeable by the later ADR
    Given the inventory is complete
    When the Solution section is written
    Then it can be referenced as the canonical backward-compatibility surface for the agent: config redesign (feature B2 / ADR amendment)
```
### Q&A
- **Q: Does "consumer" include test fixtures?** A: No — tests assert behavior, not contract. Locked test fixtures are noted as migration friction (e.g. `default-by-phase` is locked by 5 test fixtures per AgentConfigSchema scout), but the inventory lists source/schema/template/yaml/docs surfaces only.

- **Q: Why is `extractPhase` retirement tracked under 0344, not 0348?** A: 0344 ("Decide who emits the intention signal") owns the `extractPhase` → intention-signal replacement decision; 0348 owns `REGISTERED_CANONICAL_STAGES` fate. The redesign coordinates with both. Cross-reference added to §4.

- **Q: Is `spur init` seeding the `agent:` block?** A: No — `spur init` writes only the `bootstrap:` section to `.spur/config.yaml`. Operators learn the `agent:` shape from `config/config.example.yaml:38-64`, which is the de-facto contract surface. R3 satisfied.

- **Q: Does the inventory include the published JSON schema at `apps/cli/schemas/spur-config.schema.json`?** A: Yes — §1.2. It is a manually-mirrored duplicate of the zod schema and MUST move in lockstep with any zod change. Per 0343 L117 the `tier` enum is the known drift surface.

- **Q: Are `packages/contracts/src/` DTOs in scope?** A: No — verified zero agent/executor/stage DTOs in contracts. `taskActionChannelSchema` is a separate "channel" concept (binary channels, not executors) and drifts from `agent.executors[].agent`, but it is a different namespace. Out of scope.

- **Q: Does the inventory propose the redesign?** A: No — R5 explicitly forbids it. The inventory is the surface the redesign is checked against; the proposal belongs in the ADR that cites this artifact (task 0348 scope).

- **Q: Why two parallel stage registries?** A: `plugins/sp` is outside the Bun workspace and cannot import `@gobing-ai/spur-domain`, so `plugins/sp/scripts/stage-registry-adapter.ts` re-declares the registry inline. `REGISTERED_CANONICAL_STAGES` (domain) is publicly exported; `REGISTERED_STAGES` (adapter) is the dev-next consumer. Drift between them is a known risk the redesign must reconcile.

- **Q: Is ADR-033 the decision to amend?** A: Yes — `docs/00_ADR.md:778` ("Stage-Registry Driven Adaptive Model Routing"). ADR-012 (plugin substrate) is orthogonal. Added to §5.
### Design
**Task type:** research / inventory (wayfinder ticket for map B2). No code changes; produces an artifact the later ADR cites.

**Method:** Four parallel read-only scouts (scout agent — fastest model) fanned out across disjoint surfaces:

1. **AgentConfigSchema** — zod schemas in `packages/config`, published JSON schema, structural interface mirrors in `packages/app`, contracts negative result.
2. **CanonicalStages** — `REGISTERED_CANONICAL_STAGES`, `getCanonicalStage`, `extractPhase`, stage-registry types/helpers, the parallel adapter registry in `plugins/sp`.
3. **CliAndTemplates** — `--agent` flag across 13 commands, `vars.agent` in 7 workflow YAMLs, `spur init` templates, `agent.team[].members[].executor`, plugin sp subagents/skills.
4. **DocsAndServices** — `docs/00-05 + 99`, service-layer consumers (`agent-service`, `team-service`), ADRs that decided the current shape.

**Synthesis:** Each scout wrote to a shared `local://` artifact; the last-writer shape was extended with cross-scout findings (TeamService, ADR-033 location, contracts negative result, `extractPhase` retirement via 0344, four-source schema stack, `spur init` non-seeding).

**Classification contract:**

- **Operator-visible (cat 1):** config keys (zod), published JSON schema, CLI flags, `spur init` templates / documented example config, ADRs that document public shape.
- **Internal implementation (cat 2):** services, types, helpers, regex extractors, workflow YAML internals — changeable without operator impact.
- **Deprecated/retired (cat 3):** shims, legacy fallback paths, retired config keys — marked with runtime warning, ADR note, or comment.

**Tradeoff — scout fan-out vs single deep read:** Fan-out covered 4x surface in parallel; cost was duplicate writes to the shared artifact (last-writer wins). Mitigated by reading each scout's `agent://` output and merging unique findings into the canonical report. Acceptable for a research task where the deliverable is a citeable artifact, not running code.

**Rejected — proposing the redesign here:** R5 explicitly forbids it. This task produces the inventory; the redesign proposal belongs in the ADR that cites this artifact (task 0348 scope).
### Plan
1. **Dispatch 4 read-only scouts in parallel** (scout agent) across disjoint surfaces: AgentConfigSchema (config + schemas + contracts), CanonicalStages (domain registry + adapter), CliAndTemplates (CLI flags + workflow YAML + init templates), DocsAndServices (docs + service layer). Each writes findings to `local://0347-inventory.md`.

2. **Reconcile duplicate writes.** Last scout's report is the base; read each scout's `agent://` output and append unique findings (TeamService consumer, ADR-033 location, contracts negative result, `extractPhase` retirement via 0344, four-source schema stack).

3. **Verify cross-scout claims** against the repo (`grep -n` for ADR-033, `TeamService.resolveExecutor`, contracts negative result, `AgentConfig` re-declaration in `agent-service.ts:48-64`, `extractPhase` in 0344).

4. **Write task sections** via `spur task update --section`: Acceptance Criteria (R1-R5 gherkin), Design (method + classification contract), Plan (this list), Q&A (auto-resolved clarifications), Solution (the inventory artifact — citeable by the ADR).

5. **Task check + transition to done.** This is a research task with no code change; verify gate is "every R1-R5 requirement has evidence in the Solution inventory". `SPUR_PROVENANCE_OVERRIDE=1` for the done transition (no pipeline run).

6. **Hand off to 0348** (Decide the fate of `REGISTERED_CANONICAL_STAGES` and prompt-regex phase). 0348 will cite this inventory when proposing the ADR amendment.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Artifact:** `docs/tasks2/0347-inventory.md` (169 lines) — the citeable backward-compatibility inventory for the `agent:` config redesign (feature B2). The later ADR (task 0348) amends ADR-033 against this surface.


- **~14 operator-visible contracts** — zod schemas (`packages/config/src/index.ts:126-372`), published JSON schema (`apps/cli/schemas/spur-config.schema.json:101-217`), CLI flags (`--agent` across 13 `/sp:dev-*` command files), `spur init` example (`config/config.example.yaml:38-64`), `vars.agent` defaults in 7 workflow YAMLs.
- **~24 internal implementation items** — `AgentService` resolver (`packages/app/src/services/agent-service.ts`), stage-registry types/helpers (`packages/domain/src/stage-registry/`), the parallel adapter registry (`plugins/sp/scripts/stage-registry-adapter.ts`).
- **2 deprecated/retired items** — `default-by-phase` shim (runtime warning at `agent-service.ts:649-651`, ADR-033 note at `docs/00_ADR.md:782`, commented in example config), legacy Tier-1 priority resolver (`agent-service.ts:~736`).


1. **Two parallel stage registries** — `REGISTERED_CANONICAL_STAGES` (`packages/domain/src/stage-registry/schema.ts:655`, publicly exported from `@gobing-ai/spur-domain`) and `REGISTERED_STAGES` (`plugins/sp/scripts/stage-registry-adapter.ts:225`, the dev-next consumer). Adapter exists because `plugins/sp` is outside the workspace. Must reconcile explicitly.
2. **Four-source schema stack** — zod SSOT (`packages/config`), JSON schema mirror (`apps/cli/schemas`), structural interface re-declaration (`packages/app/src/services/agent-service.ts:48-64`), resolution engine (`agent-service.ts`). Field changes propagate to all four or drift silently.
3. **No operator-facing `--stage`/`--signal`/`--intention`/`--from-executor` CLI surface** — stage registry consumed only inside `resolveAgentAuto`. Introducing such flags is new surface, not migration.
4. **`default-by-phase` is deprecated-but-authoritative** — checked FIRST by `resolveAgentAuto`; configured mapping fails fast. Replacement (`stage model_policy`) is wired but only activates when the shim is absent.
5. **`tier` enum is dual-published** (zod + JSON schema) with three independent definition sites (config `executor.tier`, domain `min_tier`, domain `CapabilityTier` type). Per 0343 L117 must move in lockstep; `capable → capable-1` migration needs a synonym window in both.
6. **`--agent` namespace unified by task 0346** — `<id>` resolves executor-first; the redesign inherits this and should not re-split spec-id vs coding-agent-type namespaces.
7. **`extractPhase` retirement tracked by 0344** (not 0348); `REGISTERED_CANONICAL_STAGES` fate is 0348. Redesign coordinates with both.
8. **`TeamService` (`team-service.ts:585`) is the second executor consumer** via `resolveExecutor(member.executor, agentConfig)` — orthogonal to stage routing. Blast radius includes team materialization.
9. **`packages/contracts/src/` has zero agent/executor/stage DTOs** — out of scope; blast radius stops at config + schemas + app/services + domain/stage-registry.
10. **`spur init` does NOT seed an `agent:` block** — only `bootstrap:`. `config/config.example.yaml:38-64` is the de-facto operator contract.


The redesign amends: ADR-033 (`docs/00_ADR.md:778`), `config/config.example.yaml:38-64`, `packages/config/src/index.ts:126-372`, `apps/cli/schemas/spur-config.schema.json:101-217`, `packages/app/src/services/agent-service.ts:48-64`, `packages/domain/src/stage-registry/`, `plugins/sp/scripts/stage-registry-adapter.ts`, `config/workflows/*.yaml` (7 files), `plugins/sp/commands/dev-*.md` (13 files).

Out of scope: `packages/contracts/src/`, `packages/domain/src/planning/`, ADR-012 (plugin substrate).


Four parallel read-only scouts (AgentConfigSchema, CanonicalStages, CliAndTemplates, DocsAndServices) across disjoint surfaces; synthesized into one artifact with cross-scout findings merged. Every claim has `path:line` evidence in `docs/tasks2/0347-inventory.md`.


N/A — research task. Verify gate: every R1-R5 requirement has evidence in the Solution artifact.
### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review
| P | Severity | Finding | Evidence | Action |
|---|----------|---------|----------|--------|
| P1 | HIGH | Four parallel scouts each wrote to the same `local://0347-inventory.md` artifact, so last-writer-wins overwrote earlier reports. Unique findings from the first three scouts would be lost without manual reconciliation. | `local://0347-inventory.md` ended as the CanonicalStages report (last to finish, 3m19s) | Read each scout's `agent://` output; verified and appended 7 unique cross-scout findings (TeamService consumer, ADR-033 location, contracts negative result, extractPhase retirement via 0344, four-source schema stack, spur init non-seeding, --agent namespace overload) to §4 of the artifact. |
| P2 | MED | `default-by-phase` is documented as "deprecated" but `resolveAgentAuto` checks it FIRST and a configured mapping fails fast — it is load-bearing for any operator who set the key. Calling it merely "deprecated" understates the migration cost. | `packages/app/src/services/agent-service.ts:649-651`; `docs/00_ADR.md:782` | Reframed in §3 and §4-finding-4 as "deprecated-but-authoritative". Removing the shim requires migrating every operator who has set the key — flagged for the ADR. |
| P3 | MED | The `tier` enum has THREE independent definition sites (config `executor.tier`, domain `min_tier`, domain `CapabilityTier` type) plus dual publication (zod + JSON schema). 0343 proposes `capable-1/-2/-3` sub-tiers; a synonym window must span all sites or drift silently. | `packages/config/src/index.ts:130`; `packages/domain/src/stage-registry/schema.ts:324,346`; `apps/cli/schemas/spur-config.schema.json:130-134` | Flagged in §4-finding-5 with explicit citation to 0343 L117. The ADR must specify the synonym window scope. |
| P4 | LOW | Inventory classifies ~40 items but does not weight them by migration friction (e.g. `vars.agent` in 7 YAMLs is mechanical; amending ADR-033 is substantive). | §1-§3 of artifact | Acceptable for an inventory deliverable; the ADR (0348) will prioritize. R5 explicitly forbids proposing the redesign here. |

**Verdict:** Inventory satisfies R1-R5. Every consumer of the `agent:` config shape is enumerated with `path:line` evidence; operator-visible contracts (§1) are distinguished from internal implementation (§2) and deprecated items (§3). Headline findings (two parallel registries, four-source schema stack, no `--stage` CLI surface, deprecated-but-authoritative `default-by-phase`, dual-published `tier` enum, unified `--agent` namespace) give the redesign its decision surface. Artifact persisted at `docs/tasks2/0347-inventory.md` (169 lines) for the later ADR to cite.

**Verification gate:** Research task — no code change. R1 (enumerate), R2 (classify), R3 (spur init shape), R4 (deprecated/retired), R5 (citeable artifact, no redesign proposal) all evidenced in the Solution section. `bun run lint`/`test` unaffected (no source touched; only `docs/tasks2/0347-inventory.md` added, which is not lint-scoped).
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T05:30:15.297Z todo → wip (system)
- 2026-07-27T05:38:50.222Z wip → testing (system)
- 2026-07-27T05:38:50.779Z testing → done (system)
