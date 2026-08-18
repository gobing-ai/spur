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
updated_at: "2026-08-18T04:42:48.093Z"
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
3. **CliAndTemplates** — `--agent` flag across 12 plugin commands + primary CLI (`apps/cli/src/commands/agent.ts`), `vars.agent` in 7 workflow YAMLs, `spur init` templates, `agent.team[].members[].executor`, plugin sp subagents/skills.
4. **DocsAndServices** — `docs/00-05 + 99`, service-layer consumers (`agent-service`, `team-service`), ADRs that decided the current shape.

**Synthesis:** Each scout wrote to a shared `local://` artifact; the last-writer shape was extended with cross-scout findings (TeamService, ADR-033 location, contracts negative result, `extractPhase` retirement via 0344, four-source schema stack, `spur init` non-seeding).

**Classification contract:**

- **Operator-visible (cat 1):** config keys (zod), published JSON schema, CLI flags, `spur init` templates / documented example config, ADRs that document public shape.
- **Internal implementation (cat 2):** services, types, helpers, regex extractors, workflow YAML internals — changeable without operator impact.
- **Deprecated/retired (cat 3):** shims, legacy fallback paths, retired config keys — marked with runtime warning, ADR note, or comment.

**Tradeoff — scout fan-out vs single deep read:** Fan-out covered 4x surface in parallel; cost was duplicate writes to the shared artifact (last-writer wins). Mitigated by reading each scout's `agent://` output and merging unique findings into the canonical report. Acceptable for a research task where the deliverable is a citeable artifact, not running code.

**Rejected — proposing the redesign here:** R5 explicitly forbids it. This task produces the inventory; the redesign proposal belongs in the ADR that cites this artifact (task 0348 scope).
### Plan
1. [x] Dispatch 4 read-only scouts (AgentConfigSchema, CanonicalStages, CliAndTemplates, DocsAndServices).
2. [x] Reconcile scout writes into `docs/tasks2/0347-inventory.md` (cross-scout merge).
3. [x] Verify claims against repo (zod, JSON schema, example yaml, ADR-033, dual registries, TeamService, contracts negative).
4. [x] Write task sections (AC Gherkin, Design, Plan, Q&A, Solution summary).
5. [x] Transition to `done` (research task; no pipeline code change).
6. [x] Verify re-audit (`/sp:dev-verify --force --fix all`): primary CLI surface, 12 vs 13 count, DESIGN/example rows, hollow sections filled.
7. [x] Hand-off surface ready for 0348 (ADR amend cites inventory artifact).
### Root Cause
No defect to fix — research ticket. The risk being mitigated is **unscoped redesign**: the `agent:` config shape is consumed by zod, a published JSON schema, CLI flags, workflow defaults, a dual stage-registry, and plugin docs, with no prior inventory. Without this artifact, an ADR amending ADR-033 would guess the blast radius. Evidence of the hole: Background starting list; post-inventory §5 amendment surface in `docs/tasks2/0347-inventory.md`.
### Solution
**Artifact:** `docs/tasks2/0347-inventory.md` (citeable backward-compatibility inventory for the `agent:` config redesign, feature B2). Later ADR (task 0348) amends ADR-033 against this surface. R5: inventory only — no redesign proposal.

**Summary (post verify fix-pass):**
- **~16 operator-visible contracts** — zod (`packages/config/src/index.ts:126-372`), published JSON schema (`apps/cli/schemas/spur-config.schema.json:101-217`), primary CLI (`apps/cli/src/commands/agent.ts:37`), 12 plugin commands with `--agent`, surface docs (`docs/04_DESIGN.md`), example configs (`config/config.example.yaml:38-64` + `apps/cli/config/config.example.yaml`), `vars.agent` in 7 workflow YAMLs.
- **~24 internal implementation items** — `AgentService` (`packages/app/src/services/agent-service.ts`), stage-registry (`packages/domain/src/stage-registry/`), parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts:225`).
- **2 deprecated/retired items** — `default-by-phase` shim (runtime warning `packages/app/src/services/agent-service.ts:649-651`, ADR-033 `docs/00_ADR.md:782`), legacy Tier-1 priority (`resolveAgentPriority` `:745`).

**Headline findings (see inventory §4):**
1. Two parallel stage registries (domain `REGISTERED_CANONICAL_STAGES` `:655` vs adapter `REGISTERED_STAGES` `:225`).
2. Four-source schema stack (zod / JSON schema / structural interface `:48-64` / resolution engine).
3. No commander-exposed `--stage`/`--signal`/`--from-executor` (service still reads flag keys if present).
4. `default-by-phase` is deprecated-but-authoritative (checked first).
5. `tier` enum dual-published; 0343 sub-tiers need synonym window.
6. `--agent` namespace unified by 0346 (executor-first).
7. `extractPhase` retirement owned by 0344; registry fate by 0348.
8. `TeamService` second executor consumer (`packages/app/src/services/team-service.ts:585`).
9. `packages/contracts/` zero agent/executor DTOs — out of scope.
10. `spur init` seeds only `bootstrap:`; example yaml is de-facto contract.
11. **Primary CLI is `apps/cli/src/commands/agent.ts`, not only plugin command docs** (verify fix-pass).

**Decision-amendment surface:** ADR-033; example yaml; zod + JSON schema; agent-service structural types; domain stage-registry; adapter; 7 workflow YAMLs; agent CLI; DESIGN.md; 12 plugin commands with `--agent`.

**Method:** Four parallel scouts + synthesis; verify re-audit closed gaps (CLI surface, 12 vs 13 count, DESIGN/example copy).

**Coverage claim:** N/A — research/docs inventory; no runtime code path added.

**Flag-namespace note (verify polish):** `spur message` / `agent loop` / `--drain` use `--agent <id>` for **agent-spec** ids — different namespace from `agent.executors` selectors. Out of redesign blast radius; listed in inventory §1.3 to prevent conflation.
### Testing
**Verdict: PASS** (re-audit: `/sp:dev-verify 0347 --force --fix all --focus all --next`)

Research/inventory task (R5: no redesign code). Coverage: N/A (documentation-only inventory; no runtime code path).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Inventory §1–§2 enumerates consumers with path:line. Verify fix-pass added missing primary CLI `apps/cli/src/commands/agent.ts:37`, `docs/04_DESIGN.md`, `apps/cli/config/config.example.yaml`. Spot-check this run: zod `:126`/`:262`, JSON schema `:101-138`, example yaml `:38-64`, ADR-033 `:778`, `REGISTERED_CANONICAL_STAGES` `:655`, adapter `REGISTERED_STAGES` `:225`, `extractPhase` `:937`, TeamService `resolveExecutor` `:585`. |
| R2 | MET | Inventory §1 operator-visible vs §2 internal classification tables. |
| R3 | MET | Inventory §1.4 + finding: `spur init` writes only `bootstrap:` (`apps/cli/src/commands/init.ts:203`); `agent:` learned from example yaml. |
| R4 | MET | Inventory §3: `default-by-phase` + legacy Tier-1 priority with deprecation markers. |
| R5 | MET | Citeable artifact `docs/tasks2/0347-inventory.md` (tracked); Solution forbids redesign proposal. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: Every consumer enumerated | MET | static-ref + command | Inventory tables + this-run `rg` spot-checks; fix-pass closed CLI/docs gaps |
| Scenario: Operator-visible vs internal | MET | static-ref | Inventory §1 vs §2 classification |
| Scenario: Deprecated/retired flagged | MET | static-ref | Inventory §3 + agent-service.ts:649-651 warn |
| Scenario: Inventory citeable by ADR | MET | static-ref | `docs/tasks2/0347-inventory.md` + Solution decision-amendment surface |

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Research method (4 scouts + synthesis) DONE; R5 no-redesign held |
| scope-creep | pass | No production code; only inventory + task corpus |
| evidence-rule-pass | pass | AC scenarios backed by static inventory evidence (research, not runtime tests) |

**Commands this verify**

```
rg -n AgentConfigSchema packages/config/src/index.ts          # :262
rg -n "option('--agent" apps/cli/src/commands/agent.ts        # :37
rg -l "--agent" plugins/sp/commands/*.md | wc -l              # 12
spur task check 0347 --strict-core --json                     # pass, 0 findings (pre-fix hollow Testing)
```

**Fix-pass disclosure (`--fix all`)**
- `docs/tasks2/0347-inventory.md` — CLI surface, 12 vs 13, DESIGN/example copy, line anchors, §6 verify footer.
- Task: Root Cause, Testing, References, History; Solution refreshed.
- Artifact: `.spur/run/0347-verdict.json` (gitignored).

**`--next`:** no-op — task already terminal (`done`).
### Review
| P | Severity | Finding | Evidence | Action |
|---|----------|---------|----------|--------|
| P1 | HIGH | Four parallel scouts each wrote to the same shared inventory artifact (last-writer-wins). | Scout merge history | Reconciled: unique cross-scout findings merged into inventory §4. |
| P2 | MED | `default-by-phase` is deprecated-but-authoritative (checked first, fails fast). | `agent-service.ts:649-651`; ADR-033 | Flagged in inventory §3/§4 for ADR migration cost. |
| P3 | MED | `tier` enum dual-published + three definition sites; 0343 sub-tiers need synonym window. | config + domain + JSON schema | Flagged inventory §4-finding. |
| P3 | MED | Inventory omitted primary CLI `apps/cli/src/commands/agent.ts` and counted 13 plugin commands (actual 12). | verify re-audit `rg` | **Fixed** in inventory §1.3/§4/§6 this verify fix-pass. |
| P4 | LOW | Inventory does not weight items by migration friction. | §1–§3 | Acceptable for inventory; ADR prioritizes. R5 forbids redesign here. |

**SECUA (research artifact):** S/E/C N/A for runtime; U — inventory is citeable; A — four-source schema stack and dual registries correctly elevated as headline findings.

**Verdict:** Inventory satisfies R1–R5 after fix-pass. Artifact: `docs/tasks2/0347-inventory.md`. Status remains `done`.

**Final disposition:** PASS. `--next` no-op (terminal).
### References
- **Inventory artifact (cite this):** `docs/tasks2/0347-inventory.md`
- Feature map: **B2**
- Related tasks: **0343** (tier ordering), **0344** (intention / extractPhase), **0346** (`--agent` executor-aware), **0348** (registry fate / ADR amend)
- ADR-033: `docs/00_ADR.md:778`
- Primary code surfaces: `packages/config/src/index.ts`, `packages/app/src/services/agent-service.ts`, `packages/app/src/services/team-service.ts:585`, `packages/domain/src/stage-registry/`, `plugins/sp/scripts/stage-registry-adapter.ts`, `apps/cli/src/commands/agent.ts`, `apps/cli/schemas/spur-config.schema.json`, `config/config.example.yaml`
- Surface docs: `docs/04_DESIGN.md` (`spur agent run`)
### History
- 2026-07-27T05:30:15.297Z todo → wip (system)
- 2026-07-27T05:38:50.222Z wip → testing (system)
- 2026-07-27T05:38:50.779Z testing → done (system)
- 2026-07-26: `/sp:dev-verify 0347 --force --fix all --focus all --next`. Inventory re-audited; fixed missing primary CLI surface, 13→12 command count, DESIGN/example-config rows, line anchors. Root Cause/Testing/References filled. Verdict PASS. `--next` no-op (already `done`).
- 2026-07-26: Pre-commit residual clear — Plan checklist closed; inventory notes message/`loop` `--agent` agent-spec namespace; B2 Decisions so far links 0347 inventory.
