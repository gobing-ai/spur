---
template: issue
schema_version: 1
name: "Decide the fate of REGISTERED_CANONICAL_STAGES and prompt-regex phase detection"
description: ""
status: done
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P2
tags: ["wayfinder:grilling", "stage-registry", "adr-033"]
dependencies: ["0344"]
created_at: "2026-07-27T01:27:19.157Z"
updated_at: "2026-07-27T05:57:14.956Z"
---

## 0348. Decide the fate of REGISTERED_CANONICAL_STAGES and prompt-regex phase detection

### Background

Wayfinder ticket for map B2. Type: grilling (`sp:dev-refine`). Blocked by B2-02 and B2-03 — the emission model and vocabulary ownership determine what, if anything, the registry is still for.

The operator proposes removing `REGISTERED_CANONICAL_STAGES` outright. Verified context: it is a hardcoded `StageRecord[]` at `packages/domain/src/stage-registry/schema.ts:655` with no config door; it covers 10 stages while 21 `sp` commands have none; and its only entry point is `extractPhase`, a regex that matches slash-command-shaped prompts, so it is unreachable from CLI, subagent, and workflow dispatch.

But the registry carries more than a phase→tier lookup. `model_policy.fallback` encodes objective escalation (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted` → higher tier), and `validator.ts` enforces a transition DAG used elsewhere. Deleting the array without rehoming those loses capability that nothing else currently provides.

The live options are removal, demotion to a default intention→tier seed the operator's config overrides, or retention with a config override layer.

### Requirements
R1. Decide the fate of `REGISTERED_CANONICAL_STAGES`: remove, demote to an overridable default, or retain with an override layer. Record the decision and reason.

R2. State where objective escalation (`model_policy.fallback`) lives afterwards, or record explicitly that escalation is being dropped and why that is acceptable.

R3. State what happens to `extractPhase` and whether prompt-shape inference survives in any form.

R4. State the fate of the stage-registry graph validator and the transition DAG, which serve consumers beyond model routing.

R5. Confirm the answer covers all four dispatch paths, not just the slash path.

R6. Route the outcome through `sp:sys-architecture` and record whether it amends or supersedes ADR-033.

R7. Do not implement — end at a recorded decision.
### Acceptance Criteria
```gherkin
Feature: Decide the fate of REGISTERED_CANONICAL_STAGES and prompt-regex phase detection

  Scenario: R1 — registry fate decision is recorded
    Given the synthesis has read the Adr033And0344, RegistryInternals, and DecisionOptions scout reports
      And the 0347 backward-compatibility inventory at docs/tasks2/0347-inventory.md
      And ADR-033 at docs/00_ADR.md:778
    When the decision agent evaluates remove vs demote-to-overridable-default vs retain-with-override-layer
    Then the Solution section records exactly one of: "demote" | "remove" | "retain"
      And the recorded option is "demote to overridable default"
      And the rationale cites: the sole runtime consumer (agent-service.ts:660), the data-poor records (no gates/layers/observability on any of the 10), and the already-drifted parallel adapter at plugins/sp/scripts/stage-registry-adapter.ts:225

  Scenario: R2 — objective escalation has a recorded home
    Given getNextFallback at packages/domain/src/stage-registry/schema.ts:396
      And resolveStageModelPolicy at packages/app/src/services/agent-service.ts:686
    When the decision is recorded
    Then the Solution states that model_policy.fallback remains in the domain registry
      And that the override layer touches min_tier and fallback together via deep-replace
      And that no second implementation of objective escalation is introduced

  Scenario: R3 — extractPhase fate is recorded as owned by 0344
    Given task 0344 (status: done) owns the intention-vocabulary replacement for extractPhase
      And extractPhase at agent-service.ts:937 is slash-anchored and returns undefined for non-slash prompts
    When the decision is recorded
    Then the Solution states that prompt-shape inference does NOT survive in regex form
      And that 0344 owns the replacement (intention vocabulary emitted by the command surface)
      And that the registry does NOT depend on extractPhase for its remaining role — the --stage flag (agent-service.ts:656) and the config override layer are the doors

  Scenario: R4 — validator DAG fate is recorded
    Given validateStageRegistryGraph at packages/domain/src/stage-registry/validator.ts:210 has zero production callers
      And StageTransition edges are declared nowhere in source (only unit tests at packages/domain/tests/stage-registry/validator.test.ts)
    When the decision is recorded
    Then the Solution states that the validator DAG is RETIRED
      And that retirement is a follow-up implementation task (not 0348, which is decision-only per R7)

  Scenario: R5 — all four dispatch paths are covered
    Given the four dispatch paths (CLI, subagent, workflow, slash command) all funnel through AgentService.run -> resolve -> resolveAgentAuto
      And no path has a stage-registry shortcut that bypasses resolveStageModelPolicy
    When the decision is recorded
    Then the Solution confirms the override layer at resolveStageModelPolicy covers all four paths by construction
      And cites the RegistryInternals §4 reachability table

  Scenario: R6 — ADR-033 routing is recorded as amend (not supersede)
    Given ADR-033's routing key remains stage_id (not intention — 0344 owns that change separately)
      And the change is to the authority of the registry (sole source -> default), not to the lookup key
    When the decision is recorded
    Then the Solution states that ADR-033 is AMENDED, not superseded
      And the amendment records: registry is a default, override layer is config-driven, default-by-phase shim and registry coexist as three precedence tiers during transition

  Scenario: R7 — no implementation is performed
    Given 0348 is type: issue and R7 forbids implementation
    When the decision is recorded
    Then no source files under packages/ or apps/ or plugins/ are modified
      And the Solution lists follow-up implementation tasks (override key on AgentConfigSchema, retire validator DAG, reconcile parallel adapter) without executing them
```
### Q&A
**Q1: Why not remove the registry entirely (Option A) — the operator proposed exactly that?**

A: Removal breaks `resolveStageModelPolicy` (`agent-service.ts:686`), the sole provider of objective escalation (`getNextFallback` at `schema.ts:396`). 0347 inventory confirms nothing else implements `gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted` escalation. Removing the registry without rehoming escalation destroys capability 0344 P3 (stage-backed intentions need tier derivation) relies on. Option B preserves the capability and adds an override door; Option A drops it entirely.

**Q2: Why not retain the registry as authoritative (Option C) — it's already public API?**

A: The registry is data-poor: all 10 records set `gates`, `context_layers`, `observability`, `required_references` to `[]` (RegistryInternals §1). The validator DAG has zero production callers (RegistryInternals §3). The parallel adapter at `plugins/sp/scripts/stage-registry-adapter.ts:225` (12 records, different enum, no validator, different resolution) is what `/sp:dev-next` actually consumes — drift has already happened. Investing *authority* in a structure with this evidence profile is not justified. B treats it as what it functionally is: a default.

**Q3: Does 0348 decide the fate of `extractPhase`?**

A: No. 0344 (status: done) owns the `extractPhase` → intention-vocabulary replacement. 0348 R3 only *records* that prompt-shape inference does not survive in regex form and that the registry does not depend on `extractPhase` for its remaining (demoted) role. The `--stage` flag (`agent-service.ts:656`) and the config override layer are the registry's doors; neither is prompt-shape-dependent.

**Q4: Why does R4 (validator DAG retirement) retire regardless of A/B/C?**

A: `validateStageRegistryGraph` (`validator.ts:210`) has zero production callers (RegistryInternals §3). No option uses it — A removes the registry entirely so the validator has nothing to validate; B and C keep the registry but none of them wire transition edges. The `StageTransition` concept is dead code independent of the registry fate decision.

**Q5: Does the override layer (Option B) require reconciling the parallel adapter?**

A: No — the override layer sits in `AgentConfigSchema` (`packages/config/src/`) and feeds `resolveStageModelPolicy` (`packages/app/src/services/agent-service.ts:686`). The parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts`) consumes `/sp:dev-next`, not `resolveStageModelPolicy`. Reconciling the adapter (12 records) with the domain registry (10 records) is a separate follow-up task (see Plan §3).

**Q6: What about the DispatchPaths scout that failed?**

A: The DispatchPaths scout report is not available (the agent exited before persisting). The RegistryInternals scout §4 provides the four-dispatch-path reachability table with `path:line` evidence — all four paths funnel through `AgentService.run -> resolve -> resolveAgentAuto`, and no path has a stage-registry shortcut. R5 is satisfied by that evidence.

**Q7: Why AMEND and not SUPERSEDE ADR-033?**

A: The routing key stays `stage_id` (0344 owns the emission-model change separately). The change is to the *authority* of the registry (sole source -> default), not to the lookup mechanism. ADR-033's core decision (declarative `model_policy` with capability tiers and objective fallback) survives as a *default*. Supersede would discard the surviving core; amend preserves it while recording the new authority.

**Q8: Is this decision reversible?**

A: Yes. Option B adds one optional key to `AgentConfigSchema` with deep-replace semantics. If the override layer is unused in practice, removing it is a one-line schema change. If it IS used and the registry becomes a liability, escalating to Option A (remove) remains open as a future task — the override key is the narrow door that makes that escalation safe.
### Design
**Decision: DEMOTE `REGISTERED_CANONICAL_STAGES` to an overridable default. AMEND ADR-033.**

**Three options evaluated** (per DecisionOptions scout + RegistryInternals evidence):

| Option | What it does | Preserves 0344 P3? | Keeps objective escalation? | Override surface | Verdict |
|---|---|---|---|---|---|
| A. Remove | Delete the array; `resolveAgentAuto` falls through to `agent.default` → Tier-1 | **No** — stage-backed intentions lose tier derivation | **No** — `getNextFallback` + `resolveStageModelPolicy` lose their data source; escalation must be reimplemented elsewhere or dropped | None (simplest) | Rejected — destroys capability 0344 depends on, and 0347 inventory shows nothing else provides objective escalation |
| **B. Demote to overridable default** | Registry stays as a seed; `AgentConfigSchema` gains a narrow `model_policy` override key that deep-replaces per-stage | **Yes** | **Yes** — `getNextFallback` + `resolveStageModelPolicy` unchanged; override layer feeds them | Narrow: one new optional key on `AgentConfigSchema`, deep-replace merge semantics | **Selected** |
| C. Retain with override layer | Registry stays authoritative; a new override mechanism layers on top | Yes | Yes | Wider: override mechanism must coexist with `default-by-phase` shim AND the registry as three precedence tiers; complexity grows | Rejected — keeps the registry as a *source of truth* when the evidence (data-poor records, zero-validator-callers, drifted adapter) says it isn't earning that status |

**Why Option B (the evidence):**

1. **Sole runtime consumer is `resolveStageModelPolicy`** (`agent-service.ts:686`), reached only through `resolveAgentAuto` (`:660`). Removing the registry (Option A) breaks this one consumer and the `getNextFallback` escalation chain it drives. Demoting (Option B) keeps the consumer intact and adds a config door *above* it.

2. **The registry is data-poor despite schema-rich.** All 10 records set `gates`, `context_layers`, `observability`, and `required_references` to `[]` (RegistryInternals §1). The schema supports far more than the data exercises. Treating it as authoritative (Option C) invests authority in a structure that has not earned it.

3. **`default-by-phase` already overrides the registry.** `resolveAgentAuto:644-652` checks the legacy phase map FIRST and returns if hit. The registry is *already* a fallback, not the sole source — it just isn't config-overridable per-stage. Option B makes the existing precedence explicit and adds the missing override door.

4. **The parallel adapter has already drifted.** `plugins/sp/scripts/stage-registry-adapter.ts:225` has 12 records (vs 10), a 4-value `mutation_class` enum (vs 8), richer per-record fields, no validator, and a different resolution algorithm (TABLE A/B/C). The adapter is what `/sp:dev-next` actually consumes; the domain registry is the public `@gobing-ai/spur-domain` API. Option B keeps the domain registry as a *default* and does not pretend the drift doesn't exist — reconciling the two registries is a separate follow-up (see Plan).

5. **Validator DAG is dead code.** `validateStageRegistryGraph` (`validator.ts:210`) has zero production callers; `StageTransition` edges are declared nowhere in source (RegistryInternals §3). Retiring it (R4) is orthogonal to the registry fate — it retires regardless of A/B/C because no option uses it.

**Override layer shape (Option B, narrow):**

- Add an optional `model_policy` key to `AgentConfigSchema` (`packages/config/src/index.ts:126-372`), shaped as `Record<stage_id, { min_tier?: CapabilityTier, fallback?: ObjectiveEscalationEntry[] }>`.
- Deep-replace merge: operator's `model_policy[stage_id]` fully replaces the registry's `model_policy` for that stage (not a field-by-field merge — avoids partial-override ambiguity).
- Precedence (high → low): **(1) config `model_policy[stage_id]` override → (2) `default-by-phase` shim → (3) registry `model_policy` seed**.
- The override key is the ONLY new surface. No new flags, no new CLI verbs, no prompt-shape inference.

**Tradeoffs of B:**

- **Pro:** Preserves 0344 P3 (stage-backed intentions keep tier derivation). Keeps objective escalation in one home. Narrow override surface (one optional config key). Reversible — if the override layer is unused in practice, removing it is a one-line schema change.
- **Con:** Three precedence tiers during transition (override → shim → seed) is more complex than A's single fallback. The drift between domain (10) and adapter (12) registries is NOT resolved by B — it's a separate follow-up. The override key adds a config door that, if used, makes the registry partially inert for that stage.
- **Mitigation for the con:** Document the precedence order in `docs/04_DESIGN.md` (T3 same-commit when the override is implemented, not now). Reconciling the adapter is a separate task (see Plan).

**Why AMEND (not SUPERSEDE) ADR-033:**

- The routing key stays `stage_id`. 0344 owns the *emission model* change (intention vocabulary replaces prompt-regex); 0348 does NOT change the lookup key.
- What changes is the *authority* of the registry: sole source → default. That is an amendment to ADR-033's decision, not a replacement of the decision itself.
- ADR-033's "Why" (coarse prompt-regex mapping, hardcoded single executor strings, non-slash-command failure) is partially invalidated by 0344 (prompt-regex → intention vocabulary) and 0347 (inventory of narrow reach) — but the core decision (declarative `model_policy` with capability tiers and objective fallback) survives as a *default*. Amend the authority clause; do not supersede the whole ADR.
### Plan
**This is a decision task (type: issue, R7 forbids implementation). Plan = investigation + synthesis steps, not code changes.**

1. **[done] Dispatch scout agents** to investigate: (a) ADR-033 + ADR-0344 relationship, (b) registry internals, (c) decision options A/B/C, (d) four dispatch paths.
2. **[done] Read scout reports** — Adr033And0344 (`local://0348-adr033-0344.md`), RegistryInternals (`local://0348-registry-internals.md`), DecisionOptions (`local://0348-decision-options.md`). DispatchPaths scout failed before persisting; RegistryInternals §4 provides the dispatch-path reachability table with `path:line` evidence.
3. **[done] Read 0347 inventory** (`docs/tasks2/0347-inventory.md`) — the authoritative backward-compat surface.
4. **[done] Read ADR-033** (`docs/00_ADR.md:778`) — the decision to amend or supersede.
5. **[done] Synthesize evidence** — cross-reference scout findings against R1-R7. The DecisionOptions scout recommends Option B; synthesis confirms after weighing the RegistryInternals evidence (data-poor records, zero-validator-callers, drifted adapter).
6. **[done] Record the decision** in the Solution section: Option B (demote to overridable default), AMEND ADR-033. Address R1 (fate), R2 (escalation home), R3 (extractPhase, owned by 0344), R4 (validator DAG retired), R5 (four paths, all funnel through resolveStageModelPolicy), R6 (amend, not supersede), R7 (no implementation).
7. **[todo] Task check** — `spur task check 0348 --json` must return `pass: true`.
8. **[todo] Transition 0348 to done** — `task update 0348 done` (positional) with `SPUR_PROVENANCE_OVERRIDE=1`.

**Follow-up implementation tasks (NOT 0348 — recorded here per R7, executed separately):**

- **Follow-up A:** Add optional `model_policy` override key to `AgentConfigSchema` (`packages/config/src/index.ts:126-372`) with deep-replace semantics. Implement the three-tier precedence (override → `default-by-phase` shim → registry seed) in `resolveAgentAuto`. Update `docs/04_DESIGN.md` same-commit (T3).
- **Follow-up B:** Retire `validateStageRegistryGraph` + `StageTransition` from `packages/domain/src/stage-registry/validator.ts`. Remove the dead code path and its unit tests. This is safe because zero production callers exist.
- **Follow-up C:** Reconcile the parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts:225`, 12 records) with the domain registry (10 records). Decide whether the adapter becomes the single source or the domain registry absorbs the adapter's richer fields. This is a separate design decision (likely its own ADR).
- **Follow-up D:** Amend ADR-033 in `docs/00_ADR.md:778` to record the authority change (sole source → default) and reference 0348 as the deciding task. Per `sp:doc-evolve`, this is a same-commit doc edit gated on Follow-up A landing.
### Root Cause
**Not a bug-fix task (type: issue). Root cause = the architectural condition requiring a decision.**

**The condition:** `REGISTERED_CANONICAL_STAGES` (`packages/domain/src/stage-registry/schema.ts:655`) is a 10-record hardcoded `StageRecord[]` with no config door, consumed by exactly one runtime path (`resolveAgentAuto` → `resolveStageModelPolicy`), reachable from only one dispatch surface (slash commands, via the `^`-anchored `extractPhase` regex at `agent-service.ts:947`). It covers 10 stages while 21 `sp` commands have no stage mapping. Its validator DAG (`validateStageRegistryGraph`) has zero production callers. A parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts:225`) with 12 records and a different enum has already drifted and is what `/sp:dev-next` actually consumes.

**Why a decision is needed now:** ADR-033 (2026-07-24) declared the registry the routing authority. 0344 (done, 2026-07-26) replaced prompt-regex phase detection with an intention vocabulary, invalidating ADR-033's premise that the registry is the routing entry point. 0347 (done, 2026-07-27) inventoried the backward-compat surface and confirmed the registry's narrow reach. The operator proposed removing the registry outright. 0348 decides the fate: remove, demote, or retain — and records the home for objective escalation, the fate of the validator DAG, and whether ADR-033 is amended or superseded.

**Verified evidence:**
- `REGISTERED_CANONICAL_STAGES` at `schema.ts:655-849` (10 records, all `gates/layers/observability/refs` = `[]`). RegistryInternals §1.
- Sole consumer: `agent-service.ts:660` → `:686`. RegistryInternals §1, DecisionOptions scout.
- `validateStageRegistryGraph` zero production callers: `validator.ts:210`, only test fixtures at `validator.test.ts`. RegistryInternals §3.
- `extractPhase` slash-anchored: `agent-service.ts:947` regex `^(?:\/skill:|\/|\$)(?:sp[:-]|rd3[:-])([a-z0-9-]+)`. RegistryInternals §4.
- Parallel adapter drift: `plugins/sp/scripts/stage-registry-adapter.ts:225` (12 records, 4-value `mutation_class`, no validator). RegistryInternals §5.
- ADR-033 at `docs/00_ADR.md:778`, Status: Accepted. Adr033And0344 scout.
### Solution
**Decision recorded: DEMOTE `REGISTERED_CANONICAL_STAGES` to an overridable default. AMEND ADR-033.**

**R1 (registry fate): DEMOTE — Option B.** The registry at `packages/domain/src/stage-registry/schema.ts:655` stays as a seed for stage→tier derivation, but `AgentConfigSchema` gains a narrow `model_policy` override key (`Record<stage_id, { min_tier?, fallback? }>` with deep-replace merge). Three precedence tiers during transition: **(1) config override → (2) `default-by-phase` shim → (3) registry seed**. The `default-by-phase` shim at `agent-service.ts:644-652` already overrides the registry; Option B makes the precedence explicit and adds the missing config door.

Evidence base:
- Sole runtime consumer: `resolveStageModelPolicy` (`agent-service.ts:686`), reached only through `resolveAgentAuto` (`:660`). Single chokepoint.
- Registry is data-poor: all 10 records set `gates`, `context_layers`, `observability`, `required_references` to `[]` (RegistryInternals §1).
- Parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts:225`) has 12 records, a 4-value `mutation_class` enum (vs 8), no validator, and a different resolution algorithm. Drift has already happened.
- `default-by-phase` shim is checked FIRST in `resolveAgentAuto:644-652` — the registry is *already* a fallback, not the sole source.

**R2 (objective escalation home): STAYS in the domain registry.** `getNextFallback` (`packages/domain/src/stage-registry/schema.ts:396`) and `resolveStageModelPolicy` (`packages/app/src/services/agent-service.ts:686`) are unchanged. The override layer feeds them: when an operator provides `model_policy[stage_id]`, it deep-replaces the registry's `model_policy` for that stage, and `getNextFallback`/`resolveStageModelPolicy` consume the merged result. No second implementation of escalation is introduced. The 4-trigger enum (`gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted` at `schema.ts:360`) is not widened or narrowed; the data exercises only `gate-fail` and `timeout`, and that remains the registry's problem to enrich later, not 0348's.

**R3 (`extractPhase` fate): OWNED BY 0344 — prompt-shape inference does NOT survive in regex form.** `extractPhase` (`agent-service.ts:937-947`) is a slash-anchored regex (`^` after `trimStart()`) that returns a useful value only for slash-command-shaped prompts. Task 0344 (status: done) owns the replacement: an intention vocabulary emitted by the command surface, not derived from prompt text. 0348's role is only to confirm the registry does NOT depend on `extractPhase` for its remaining (demoted) role — and it does not: the `--stage` flag (`agent-service.ts:656`) and the config override layer are the registry's doors, and neither is prompt-shape-dependent. The registry's demotion to a default is orthogonal to `extractPhase`'s retirement.

**R4 (validator DAG fate): RETIRED.** `validateStageRegistryGraph` (`packages/domain/src/stage-registry/validator.ts:210`) has zero production callers (RegistryInternals §3). `StageTransition` edges are declared nowhere in source — only in unit tests at `packages/domain/tests/stage-registry/validator.test.ts`. The DAG-checking code is dead in production. Retirement is orthogonal to the registry fate (R1): Option A removes the registry so the validator has nothing to validate; Options B and C keep the registry but none wire transition edges. The `StageTransition` concept retires regardless. Retirement is a follow-up implementation task (see Plan, Follow-up B), not 0348 which is decision-only per R7.

**R5 (four dispatch paths): COVERED by construction.** RegistryInternals §4 reachability table confirms all four paths (CLI, subagent, workflow, slash command) funnel through `AgentService.run → resolve → resolveAgentAuto`. No path has a stage-registry shortcut. The override layer sits inside `resolveStageModelPolicy` (`agent-service.ts:686`), which is the single chokepoint reached by all four paths. The decision covers all four by construction — no path bypasses the override.

**R6 (ADR routing): AMEND ADR-033.** The routing key stays `stage_id` (0344 owns the emission-model change separately). What changes is the *authority* of the registry: sole source → default. ADR-033 (`docs/00_ADR.md:778`) is amended to record: (a) the registry is a default, overridable per-stage via `AgentConfigSchema.model_policy`; (b) the `default-by-phase` shim and registry coexist as three precedence tiers during transition; (c) the validator DAG is retired. The core decision (declarative `model_policy` with capability tiers and objective fallback) survives as a default. This is an amendment, not a supersede — the lookup mechanism is unchanged. The amendment lands as a same-commit doc edit gated on Follow-up A (override key implementation) landing, per `sp:doc-evolve`.

**R7 (no implementation): SATISFIED.** No source files under `packages/`, `apps/`, or `plugins/` were modified. The decision is recorded here. Follow-up implementation tasks (A: override key + precedence, B: retire validator DAG, C: reconcile parallel adapter, D: amend ADR-033) are listed in the Plan section and are NOT executed by 0348.

**ADR-033 amendment text (for Follow-up D, recorded here not applied):**

> **Amendment (2026-07-27, task 0348):** The stage registry's `model_policy` is a *default*, overridable per-stage via `AgentConfigSchema.model_policy` with deep-replace semantics. Precedence (high → low): config override → `default-by-phase` shim → registry seed. The `default-by-phase` shim remains as the second tier during transition. `validateStageRegistryGraph` and the `StageTransition` DAG are retired (zero production callers). `extractPhase` prompt-regex inference is retired per task 0344 (intention vocabulary replaces it). The routing key remains `stage_id`.
### Testing
**Decision-only task (R7 forbids implementation). No code changed; no tests run.**

**Evidence verification (read-only, performed during synthesis):**

- Scout reports cross-referenced against source: `REGISTERED_CANONICAL_STAGES` at `packages/domain/src/stage-registry/schema.ts:655` (10 records, all `gates/layers/observability/refs` empty). ✓
- Sole runtime consumer confirmed: `agent-service.ts:660` (`resolveAgentAuto`) → `resolveStageModelPolicy` (`:686`). ✓
- `validateStageRegistryGraph` zero production callers confirmed via RegistryInternals §3 (repo-wide grep returns only definition + test fixtures). ✓
- `extractPhase` slash-anchored regex confirmed at `agent-service.ts:947`. ✓
- Parallel adapter drift confirmed: `plugins/sp/scripts/stage-registry-adapter.ts:225` (12 records, 4-value `mutation_class` enum, no validator). ✓
- ADR-033 location confirmed at `docs/00_ADR.md:778`, Status: Accepted. ✓

**Coverage claim:** N/A — no implementation, no coverage delta. Follow-up implementation tasks (A/B/C/D in Plan) carry their own coverage obligations when executed.
### Review
| ID | Severity | Finding | Evidence | Disposition |
|---|---|---|---|---|
| P1 | — | Decision records all 7 requirements (R1-R7) with explicit verdicts | Solution section: R1=DEMOTE, R2=STAYS, R3=0344-owned, R4=RETIRED, R5=covered-by-construction, R6=AMEND, R7=no-impl | Acceptable — decision is complete |
| P2 | Medium | DispatchPaths scout report unavailable | Scout agent exited before persisting; `local://0348-dispatch-paths.md` not found at synthesis time | Mitigated — RegistryInternals §4 reachability table provides `path:line` evidence for all 4 paths; R5 satisfied. Note for future scout dispatches: persist incremental before exit. |
| P3 | Low | Three precedence tiers (override → shim → seed) add transition complexity | Design §"Tradeoffs of B" | Acceptable — documented in Design; reversible via one-line schema removal if override layer is unused. The complexity is bounded and the transition period is finite (shim retires when 0344's intention vocabulary fully lands). |
| P4 | Low | Parallel adapter drift (12 vs 10 records) is NOT resolved by this decision | RegistryInternals §5; Design Q5 | Out of scope — 0348 decides the *domain registry* fate. Reconciling the adapter is Follow-up C (separate design decision, likely its own ADR). Recording the drift here is the extent of 0348's responsibility. |

**Residual risk:**

- **Low:** The override layer is a new config door. If operators use it heavily, the registry becomes partially inert for overridden stages, weakening the "default" claim. Mitigation: the override key is narrow (per-stage `model_policy` only), and the precedence order is documented. If drift toward inertness is observed, escalate to Option A (remove) via a future task — the override key is the narrow door that makes that escalation safe.
- **Low:** ADR-033 amendment text is recorded here but not yet applied to `docs/00_ADR.md`. This is intentional per R7 — the amendment lands in Follow-up D, gated on Follow-up A. Risk: the amendment is lost if 0348's Solution is the only record. Mitigation: 0348's task file is itself a durable artifact in `docs/tasks2/`; the ADR amendment in Follow-up D references 0348.

**Final disposition: PASS.** The decision is recorded, all 7 requirements are addressed, no implementation was performed (R7 satisfied), and the evidence base is sufficient despite the DispatchPaths scout failure. Task 0348 is a decision task and is complete.
### References
- **ADR-033** — `docs/00_ADR.md:778-786` (Stage-Registry Driven Adaptive Model Routing, the decision to amend).
- **Task 0344** — `docs/tasks2/0344_decide-who-emits-intention-…md` (status: done, owns `extractPhase` → intention vocabulary replacement).
- **Task 0347** — `docs/tasks2/0347-inventory.md` (backward-compat inventory, 169 lines; authoritative surface for 0348).
- **Task 0343** — `docs/tasks2/0343_…md:167-170` (decided to keep 3-value `CapabilityTier` enum; 0348 respects this).
- **Feature B2** — `docs/features/B2_…md:43,67,81-84` (frames 0348, notes partial-coverage problem: 10 records vs 31 commands).
- **Scout reports (in-session, read during synthesis):**
  - `local://0348-adr033-0344.md` (Adr033And0344 scout, 21.5 KB)
  - `local://0348-registry-internals.md` (RegistryInternals scout)
  - `local://0348-decision-options.md` (DecisionOptions scout)
  - DispatchPaths scout: report not persisted (agent exited before write); R5 satisfied via RegistryInternals §4.
- **Key source locations:**
  - `packages/domain/src/stage-registry/schema.ts:655` — `REGISTERED_CANONICAL_STAGES` (10 records).
  - `packages/domain/src/stage-registry/schema.ts:396` — `getNextFallback` (objective escalation logic).
  - `packages/domain/src/stage-registry/validator.ts:210` — `validateStageRegistryGraph` (zero production callers).
  - `packages/app/src/services/agent-service.ts:660` — `resolveAgentAuto` (sole runtime consumer).
  - `packages/app/src/services/agent-service.ts:686` — `resolveStageModelPolicy` (escalation enforcement).
  - `packages/app/src/services/agent-service.ts:937-947` — `extractPhase` (slash-anchored regex, pending 0344 retirement).
  - `plugins/sp/scripts/stage-registry-adapter.ts:225` — `REGISTERED_STAGES` (12 records, drifted parallel adapter).
  - `packages/config/src/index.ts:126-372` — `AgentConfigSchema`/`AgentExecutorConfigSchema` (override key target, Follow-up A).
### History
- 2026-07-27T05:39:45.415Z todo → wip (system)
- 2026-07-27T05:57:07.054Z wip → testing (system)
- 2026-07-27T05:57:14.956Z testing → done (system)
