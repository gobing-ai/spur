# 0347 — Backward-Compatibility Inventory: `agent:` Config Section

Investigation of the Spur monorepo at `/Users/robin/xprojects/spur-new`. Every consumer of the `agent:` config surface, canonical stages, phase extraction, and tier routing — classified for the B2/0347 redesign.

## Summary
- **~14 operator-visible contracts** (zod schemas, JSON schema, CLI flags, `spur init` example, workflow `vars.agent`)
- **~24 internal implementation items** (services, types, helpers, two parallel stage registries)
- **2 deprecated/retired items** (`default-by-phase` shim, legacy Tier-1 priority resolver)

**Headline finding:** There are **two parallel stage registries** — `packages/domain/src/stage-registry/schema.ts` (`REGISTERED_CANONICAL_STAGES`, publicly exported from `@gobing-ai/spur-domain`) and `plugins/sp/scripts/stage-registry-adapter.ts` (`REGISTERED_STAGES`, self-contained, the one actually consumed by `dev-next`). The redesign must reconcile these explicitly. Additionally, **no `--stage`/`--signal`/`--intention`/`--from-executor` CLI flags exist** — the stage registry is consumed only internally by `resolveAgentAuto`, never as operator input.

---

## 1. Operator-Visible Contracts

### 1.1 Config Schemas (zod) — `packages/config/src/index.ts`

| Symbol | File:Line | Notes |
|---|---|---|
| `AgentConfigSchema` | `packages/config/src/index.ts:262-372` | Root zod schema for the `agent:` section. Fields: `default`, `executors`, `default-by-phase`, `team`. Carries `superRefine` for executor-name uniqueness (L269-283) and team member-id uniqueness (L301+). Inferred type `AgentConfig` at L372. **Published shape — breaking change here is operator-visible.** |
| `AgentExecutorConfigSchema` | `packages/config/src/index.ts:126-131` | zod schema for one `agent.executors[]` entry: `{ name, agent, model?, tier? }`. The `tier` enum (L130) `['cheap','standard','capable']` is the capability vocabulary. |
| `AgentExecutorConfig` (type) | `packages/config/src/index.ts:134` | Inferred type re-exported for app-layer consumers. |
| `TeamMemberConfigSchema` | `packages/config/src/index.ts:152-158` | `agent.team[].members[]` shape; bare string OR `{ executor, id?, purpose?, workspace? }`. The `executor` field (L155) is the team-surface selector. |
| `NormalizedTeamMember` / `normalizeMember` | `packages/config/src/index.ts:189-208` | Normalizes bare-string member to `{ executor: "..." }`. Exported helper consumed by team resolution. |
| `resolveExecutor` | `packages/config/src/index.ts:241-252` | Resolves a member `executor` name → `{ agent, model? }`. Executors-first, falls back to raw canonical agent. **Exported public API.** |

### 1.2 Published JSON Schemas — `apps/cli/schemas/spur-config.schema.json`

| Symbol | File:Line | Notes |
|---|---|---|
| `agent.executors` | `apps/cli/schemas/spur-config.schema.json:108-137` | Array of named executor profiles. Description at L110 explicitly names `default` and `default-by-phase` as the referencing keys. |
| `agent.executors[].tier` | `apps/cli/schemas/spur-config.schema.json:130-134` | Enum `["cheap","standard","capable"]`. Description cites ADR-033 and the stage-registry `model_policy min_tier` contract. **Must move in lockstep with the zod enum (per 0343 L117).** |
| `agent.default-by-phase` | `apps/cli/schemas/spur-config.schema.json:138` | Map of phase→executor-selector. Marked authoritative (broken mapping fails fast, no fallback to `default`). |

### 1.3 CLI Flags

| Flag | Surface | File:Line | Notes |
|---|---|---|---|
| `--agent <name\|auto>` | ALL `/sp:dev-*` commands | `plugins/sp/commands/dev-{brainstorm,dogfood,next,parallel,plan,refine,review,run,runall,unit,verify,verifyall}.md` (each L3 + L13 argument-hint) | Universal flag. `<name>` = explicit executor/agent; `auto` = resolve via stage-registry `model_policy`; omit = configured default `omp`. **Pin shape — every command documents it.** |
| `--auto` | paired with `--agent` | same command files | Sets `profile=auto`, bypasses HITL confirmations. |
| Dogfood `--agent` (testee-scoped) | `plugins/sp/commands/dev-dogfood.md:3`; `plugins/sp/skills/dogfood-testing/SKILL.md:52-269` | **Different semantics** — sets the *testee's* agent, not the driver's. Driver always runs in current session. |
| `--agent` forwarding | next-router | `plugins/sp/skills/next-router/SKILL.md:50,72` | Router runs inline; forwards `--agent` into dispatched child only if child documents it. |
| `--stage` / `--signal` / `--intention` / `--from-executor` | (none) | — | **Searched `apps/cli/src/commands/**` and `plugins/sp/**`: NO occurrences.** The stage registry is not exposed as operator CLI input today; "signals" come only from runtime gate results inside `resolveStageModelPolicy`. |

### 1.4 `spur init` Templates / Example Config

| Item | File:Line | Notes |
|---|---|---|
| `agent:` example section | `config/config.example.yaml:38-64` | Documented `default: omp`, commented `executors:` block (L47-59), commented `default-by-phase:` block (L61-64). **This is the seeded example operators copy from.** (No `config/templates/spur-config.yaml` — `config/templates/` holds docs/task/feature/bdd templates only.) |
| `vars.agent: "omp"` default | 7 workflow YAMLs (see §2.3) | The universal pipeline default. Changing the default ripples across all workflows. |

---

## 2. Internal Implementation

### 2.1 Services — `packages/app/src/services/agent-service.ts`

| Symbol | File:Line | Notes |
|---|---|---|
| `AgentService` (class) | `packages/app/src/services/agent-service.ts` | The resolver. Owns all phase→executor→agent routing. |
| `resolveAgentAuto` | `packages/app/src/services/agent-service.ts:629-` | Main `--agent auto` path. R4 shim: checks `default-by-phase` first (with deprecation warn), else resolves canonical `stage_id` and consumes `model_policy`. |
| `resolveStageModelPolicy` | `packages/app/src/services/agent-service.ts:~690-735` | Stage-registry adaptive routing. Uses `getExecutorTier`, `isTierEligible`, `getNextFallback`, `TIER_RANK`. Sorts eligible executors cheapest-first (L719). |
| `resolveExecutorSelector` | `packages/app/src/services/agent-service.ts:755-825` | Three sources: `phase` (default-by-phase), `default` (agent.default), `explicit` (--agent). Implements R3 collision precedence (executor wins over binary). |
| `checkUsable` | `packages/app/src/services/agent-service.ts:811-830` | Liveness gate (installed + version detected). Not auth — fails fast before timeout burn. |
| `getExecutorTier` | `packages/app/src/services/agent-service.ts:1078-1085` | **Module-private.** Infers `CapabilityTier` via regex on `name + model + agent` when `executor.tier` undeclared. Behavior-bearing; cited by 0343 L116,160. |
| `extractPhase` | `packages/app/src/services/agent-service.ts:937-` | **Module-private.** Regex `/^(?:\/skill:|\/|\$)(?:sp[:-]|rd3[:-])([a-z0-9-]+)/` → bare phase (e.g. `dev-run`). Returns `undefined` for non-slash prompts. Safe to refactor internally. |
| `warnDeprecationOnce` | `packages/app/src/services/agent-service.ts:608-` | One-shot deprecation emitter; used only for `default-by-phase` today. |
| `TRACE_SAFE_SLASH_COMMAND` | `packages/app/src/services/agent-service.ts:~922` | Diagnostics regex; includes legacy `rd3` prefix alongside `sp`. |
| `resolveAgentName`, `TIER1_PRIORITY`, `commanderOptionsToFlags` | various | Supporting helpers; not redesign-critical. |

### 2.2 Types & Helpers — `packages/domain/src/stage-registry/`

**Publicly exported** via `packages/domain/src/index.ts:36` (`export * from './stage-registry'`) and the barrel `packages/domain/src/stage-registry/index.ts`. **Any shape change is a published-API change for `@gobing-ai/spur-domain`.**

| Symbol | File:Line | Notes |
|---|---|---|
| `STAGE_REGISTRY_SCHEMA_VERSION` | `packages/domain/src/stage-registry/schema.ts:21` | `{ major: 1, minor: 0 }`. Extension rule documented at L11-19. |
| `stageModelPolicySchema` | `packages/domain/src/stage-registry/schema.ts:321-` | zod schema for `model_policy`: `{ min_tier, fallback[] }`. The fallback chain is the escalation contract. |
| `CapabilityTier` | `packages/domain/src/stage-registry/schema.ts:346` | `'cheap' \| 'standard' \| 'capable'`. **The 3-value vocabulary.** 0343 proposes `capable-1/-2/-3` sub-tiers (migration synonym window). |
| `TIER_RANK` | `packages/domain/src/stage-registry/schema.ts:349-353` | `{ cheap:1, standard:2, capable:3 }`. Used for sort + eligibility comparison. |
| `isTierEligible` | `packages/domain/src/stage-registry/schema.ts:356-358` | `candidateTier >= minTier` predicate. |
| `pickStartingTier` | `packages/domain/src/stage-registry/schema.ts:361-363` | Returns `policy.min_tier`. |
| `getNextFallback` | `packages/domain/src/stage-registry/schema.ts:372-` | Walks the fallback chain given an objective signal + current tier. |
| `ObjectiveEscalationSignal` | `packages/domain/src/stage-registry/schema.ts` (near L372) | Signal vocabulary (`gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted`). |
| `REGISTERED_CANONICAL_STAGES` | `packages/domain/src/stage-registry/schema.ts:655-` | Array of `StageRecord[]` — **10 records** (`refine`, `plan`, `implement`, + 7 more through ~L860). Each carries `model_policy` with `min_tier` + `fallback`. The SSOT for stage definitions. |
| `CANONICAL_STAGE_BY_KEY` | `packages/domain/src/stage-registry/schema.ts` (near L863) | Map keyed by id + aliases. |
| `getCanonicalStage` | `packages/domain/src/stage-registry/schema.ts:863-865` | Lookup by id-or-alias. Consumed by `agent-service.ts` (top imports from `@gobing-ai/spur-domain`). |
| `validator.ts` | `packages/domain/src/stage-registry/validator.ts` | `StageTransition`, `validateStageRegistryGraph`, `RegistryReferenceResolver`. Graph-integrity validation over the registry. |
| `index.ts` (barrel) | `packages/domain/src/stage-registry/index.ts` | Re-exports `./schema` + `./validator`. |

**`packages/domain/src/planning/`** — `schema.ts`, `markdown-document.ts`, `task-skeleton.ts`, `locks.ts`, `rebuild-events.ts`. Re-exported via `domain/src/index.ts:30-34`. **No stage-registry / phase / tier references found** — planning is orthogonal to the agent/tier surface. Not in scope for this redesign.

### 2.3 Workflow YAML — `config/workflows/`

All pipeline YAMLs use `vars.agent: "omp"` as the default executor, threaded into every `agent.run` step as `agent: ${vars.agent}`. **None reference `stage_id`, `--stage`, `min_tier`, or `extractPhase` directly** — workflows are agnostic of the stage registry; the registry lives behind `resolveAgentAuto`.

| File | `vars.agent` line | `agent.run` step lines |
|---|---|---|
| `task-pipeline.yaml` | L39 | L62 (doctor), L86, L111, L127, L155 |
| `feature-dev.yaml` | L33 | L47, L58, L70, L76 |
| `planning-pipeline.yaml` | L44 | L73, L87 |
| `idea-pipeline.yaml` | L48 | L62, L77, L89, L116, L147, L174 |
| `wayfinder-resolution.yaml` | L15 | L54, L84 |
| `wrapup-pipeline.yaml` | L42 | L74, L88, L109 |
| `docs-pipeline.yaml` | L21 | L34 |
| `task-lifecycle.yaml` | (none — no `vars.agent`) | — |
| `feature-lifecycle.yaml` | (none — no `vars.agent`) | — |

### 2.4 Plugin sp

| Item | File:Line | Notes |
|---|---|---|
| **`stage-registry-adapter.ts`** (PARALLEL REGISTRY) | `plugins/sp/scripts/stage-registry-adapter.ts:1-1261` | **Self-contained duplicate** of the domain registry. Header (L1-21) explicitly states "no @gobing-ai/spur-domain dependency (plugins/sp is outside the workspace). Types are defined inline, mirroring the domain schema." Defines its own `StageRecord`, `StageModelPolicy`, `ExecutionVariant`, etc. |
| `REGISTERED_STAGES` (adapter) | `plugins/sp/scripts/stage-registry-adapter.ts:225-450` | The adapter's own stage array. **Independent from `REGISTERED_CANONICAL_STAGES`** — drift risk is real. |
| `STAGE_BY_ID` / `getStage` / `listStages` | `plugins/sp/scripts/stage-registry-adapter.ts:451-480` | Adapter's lookup + `--list-stages` CLI surface. |
| `resolveStage` (TABLE A/B/C) | `plugins/sp/scripts/stage-registry-adapter.ts:843-` | dev-next golden-path resolution. The function actually consumed by `/sp:dev-next`. |
| `parseCliArgs` / `runCli` / `bootMain` | `plugins/sp/scripts/stage-registry-adapter.ts:1102-1261` | Adapter is a runnable script: `bun plugins/sp/scripts/stage-registry-adapter.ts --wbs 0307`. |
| `stage-registry-adapter.test.ts` | `plugins/sp/tests/stage-registry-adapter.test.ts:455-459` | Tests adapter invariants (`min_tier` ∈ 3-value enum, `fallback` is array). |
| `/sp:dev-*` command files | `plugins/sp/commands/dev-*.md` (13 files) | Each carries `--agent <name|auto>` in argument-hint (L3) and usage (L13). |
| Skills referencing `--agent` | `plugins/sp/skills/{brainstorm,code-verification,dogfood-testing,next-router}/SKILL.md` | Document `--agent` semantics, forwarding rules, and the "current agent is not expressible on the pipeline surface" constraint. |

---

## 3. Deprecated / Retired

| Item | File:Line | How marked deprecated | Notes |
|---|---|---|---|
| `agent.default-by-phase` (config key) | schema: `packages/config/src/index.ts:266`; JSON: `apps/cli/schemas/spur-config.schema.json:138`; example: `config/config.example.yaml:61`; type: `packages/app/src/services/agent-service.ts:63` | **Three markings:** (1) runtime `warnDeprecationOnce` at `agent-service.ts:649-651` with message *"default-by-phase is deprecated; use stage model_policy instead"*; (2) ADR-033 at `docs/00_ADR.md:782` — *"Retain `default-by-phase` as a backward-compatibility shim with a one-time deprecation"*; (3) commented-out in `config.example.yaml`. | **Still authoritative when configured** (R4/R5): `resolveAgentAuto` checks it FIRST and a configured mapping fails fast rather than falling back. The shim is load-bearing for any operator who has set it. |
| `resolveAgentPriority` (legacy Tier-1) | `packages/app/src/services/agent-service.ts:~736` | Inline JSDoc comment: *"Legacy static Tier-1 priority resolution (preserved fallback)."* Uses `TIER1_PRIORITY` constant. | The pre-stage-registry resolver. Preserved as a fallback path; not operator-configurable. |

**No `_legacy`-prefixed symbols, no `@deprecated` JSDoc tags, no separate `legacy/` directories found** on this surface. The only retirement markings are the two above.

---

## 4. Findings Relevant to Redesign

- **Two parallel registries must be reconciled.** `packages/domain/src/stage-registry/schema.ts:655` (`REGISTERED_CANONICAL_STAGES`, 10 records, publicly exported) and `plugins/sp/scripts/stage-registry-adapter.ts:225` (`REGISTERED_STAGES`, the dev-next consumer) are independent copies. The adapter exists because `plugins/sp` is outside the workspace and cannot import `@gobing-ai/spur-domain`. **Any redesign of the record shape must update both, or formalize the adapter as the sole source and demote the domain export.**
- **The domain registry is publicly exported.** `packages/domain/src/index.ts:36` does `export * from './stage-registry'`. `REGISTERED_CANONICAL_STAGES`, `getCanonicalStage`, `CapabilityTier`, `TIER_RANK`, `isTierEligible`, `pickStartingTier`, `getNextFallback`, `stageModelPolicySchema` are all part of the published `@gobing-ai/spur-domain` API — shape changes are breaking for any external consumer (0343 L118 flags third-party configs as the open inventory question).
- **`extractPhase` and `getExecutorTier` are module-private in `agent-service.ts`** — safe to refactor, rename, or inline without external impact. `getExecutorTier`'s regex inference is behavior-bearing (0343 L116,160) and tested; preserve or explicitly replace.
- **No operator-facing `--stage`/`--signal`/`--intention`/`--from-executor` CLI surface exists.** The stage registry is consumed only inside `resolveAgentAuto`. Introducing such flags is *new* operator-visible surface, not a migration — the redesign has freedom here.
- **`default-by-phase` is the only operator-configurable phase→executor mapping today**, and it is deprecated-but-authoritative. Its replacement (stage `model_policy`) is already wired but only activates when `default-by-phase` is absent. Removing the shim requires migrating every operator who has set the key.
- **`vars.agent: "omp"` is the universal workflow default** across 7 pipeline YAMLs. It flows opaquely into `agent.run` steps; workflows are stage-registry-agnostic. Changing the default executor ripples here.
- **`tier` enum is dual-published** (zod `packages/config/src/index.ts:130` + JSON `apps/cli/schemas/spur-config.schema.json:130`). Per 0343 L117 they MUST move in lockstep; a `capable` → `capable-1` migration needs a synonym window in both.
- **`agent.team[].members[].executor`** (`packages/config/src/index.ts:155`, `NormalizedTeamMember`) is a *separate* selector surface from `agent.executors` — it routes through `resolveExecutor` (L241), not through stage routing. The redesign should clarify whether team executors participate in tier routing or remain orthogonal.
- **Dogfood `--agent` has different semantics** (testee-scoped, not driver-scoped). Any `--agent` contract change must call out the dogfood divergence explicitly.
- **Planning layer (`packages/domain/src/planning/`) is orthogonal** — no stage/phase/tier references. Out of scope; safe.
- **`AgentConfig` is re-declared (not imported) in `agent-service.ts:48-64`.** Three interface duplicates (`AgentExecutorConfig`, `AgentConfig`) exist as structural types in the app layer to avoid an `app → config` dependency cycle. The four-source schema stack: (1) zod SSOT in `packages/config/src/index.ts:126-372`; (2) manually-mirrored JSON schema at `apps/cli/schemas/spur-config.schema.json:101-217`; (3) structural interface re-declaration in `packages/app/src/services/agent-service.ts:48-64`; (4) the resolution engine in `agent-service.ts`. Any field added/removed must propagate to all four sites or drift silently.
- **`TeamService` (`packages/app/src/services/team-service.ts:585`) is the second executor consumer** via `resolveExecutor(member.executor, agentConfig)` — orthogonal to `AgentService` stage routing. The redesign blast radius includes team materialization (`materializeTeam`), not just `resolveAgentAuto`.
- **`packages/contracts/src/` has ZERO agent/executor/stage DTOs.** The transport-contracts layer is out of scope; the redesign blast radius stops at `packages/config` + `apps/cli/schemas` + `packages/app/services/{agent,team}-service` + `packages/domain/stage-registry`. `taskActionChannelSchema` (a separate "channel" concept in contracts) drifts from `agent.executors[].agent` but is not the same namespace.
- **ADR-033 (`docs/00_ADR.md:778` — "Stage-Registry Driven Adaptive Model Routing") is the live decision the B2 redesign must amend or supersede.** ADR-012 (plugin substrate) is orthogonal — it touches the `AgentShim` harness, not the `agent:` config keys.
- **`extractPhase` retirement is tracked by task 0344** (`docs/tasks2/0344_*`), not 0348. The redesign should coordinate with 0344's decision on who emits the intention signal.
- **`spur init` does NOT seed an `agent:` block in `.spur/config.yaml`** — only the `bootstrap:` section. Operators learn the `agent:` shape from `config/config.example.yaml:38-64` (the documented example), which is the de-facto contract surface.
- **`--agent <id>` is overloaded** between agent-spec id (e.g. `sp:super-coder`) and coding-agent type (e.g. `omp`, `cc`). Task 0346 unified the namespace to executor-first resolution; the redesign inherits this unified namespace and should not re-split it.

## 5. Decision-Amendment Surface

The redesign amends or supersedes:

- **ADR-033** (`docs/00_ADR.md:778`) — stage-registry routing decision
- **`config/config.example.yaml:38-64`** — documented `agent:` example (de-facto operator contract)
- **`packages/config/src/index.ts:126-372`** — zod SSOT
- **`apps/cli/schemas/spur-config.schema.json:101-217`** — published JSON schema mirror
- **`packages/app/src/services/agent-service.ts:48-64`** — structural interface mirror
- **`packages/domain/src/stage-registry/`** — publicly-exported stage registry (published `@gobing-ai/spur-domain` API)
- **`plugins/sp/scripts/stage-registry-adapter.ts`** — parallel adapter registry (the dev-next consumer)
- **`config/workflows/*.yaml`** `vars.agent` defaults (7 files)
- **`plugins/sp/commands/dev-*.md`** — `--agent` flag documentation (13 command files)

Out of scope: `packages/contracts/src/`, `packages/domain/src/planning/`, ADR-012 (plugin substrate).
