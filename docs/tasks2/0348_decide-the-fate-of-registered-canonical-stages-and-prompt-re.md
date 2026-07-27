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
updated_at: "2026-07-27T06:56:48.577Z"
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
      And the rationale cites: the sole stage-routing consumer (agent-service.ts:656-681), the data-poor records (no gates/layers/observability on any of the 10), and the already-drifted parallel adapter at plugins/sp/scripts/stage-registry-adapter.ts:225

  Scenario: R2 — objective escalation has a recorded home
    Given getNextFallback at packages/domain/src/stage-registry/schema.ts:372
      And resolveStageModelPolicy at packages/app/src/services/agent-service.ts:681
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
      And the amendment records: registry is a default seed, per-stage config override deep-replaces seed model_policy inside the stage path, and default-by-phase remains an earlier exit (not a model_policy middle tier)

  Scenario: R7 — no implementation is performed
    Given 0348 is type: issue and R7 forbids implementation
    When the decision is recorded
    Then no source files under packages/ or apps/ or plugins/ are modified
      And the Solution lists follow-up implementation tasks (override key on AgentConfigSchema, retire validator DAG, reconcile parallel adapter) without executing them
```
### Q&A
**Q1: Why not remove the registry entirely (Option A) — the operator proposed exactly that?**

A: Removal breaks `resolveStageModelPolicy` (`agent-service.ts:681`), the sole provider of objective escalation (`getNextFallback` at `schema.ts:372`). 0347 inventory confirms nothing else implements `gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted` escalation. Removing the registry without rehoming escalation destroys capability 0344 P3 (stage-backed intentions need tier derivation) relies on. Option B preserves the capability and adds an override door; Option A drops it entirely.

**Q2: Why not retain the registry as authoritative (Option C) — it's already public API?**

A: The registry is data-poor: all 10 records set `gates`, `context_layers`, `observability`, `required_references` to `[]` (RegistryInternals §1). The validator DAG has zero production callers (RegistryInternals §3). The parallel adapter at `plugins/sp/scripts/stage-registry-adapter.ts:225` (12 records, different enum, no validator, different resolution) is what `/sp:dev-next` actually consumes — drift has already happened. Investing *authority* in a structure with this evidence profile is not justified. B treats it as what it functionally is: a default.

**Q3: Does 0348 decide the fate of `extractPhase`?**

A: No. 0344 (status: done) owns the `extractPhase` → intention-vocabulary replacement. 0348 R3 only *records* that prompt-shape inference does not survive in regex form and that the registry does not depend on `extractPhase` for its remaining (demoted) role. The `--stage` flag (`agent-service.ts:656`) and the config override layer are the registry's doors; neither is prompt-shape-dependent.

**Q4: Why does R4 (validator DAG retirement) retire regardless of A/B/C?**

A: `validateStageRegistryGraph` (`validator.ts:210`) has zero production callers (RegistryInternals §3). No option uses it — A removes the registry entirely so the validator has nothing to validate; B and C keep the registry but none of them wire transition edges. The `StageTransition` concept is dead code independent of the registry fate decision.

**Q5: Does the override layer (Option B) require reconciling the parallel adapter?**

A: No — the override layer sits in `AgentConfigSchema` (`packages/config/src/`) and feeds `resolveStageModelPolicy` (`packages/app/src/services/agent-service.ts:681`). The parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts`) consumes `/sp:dev-next`, not `resolveStageModelPolicy`. Reconciling the adapter (12 records) with the domain registry (10 records) is a separate follow-up task (see Plan §3).

**Q6: What about the DispatchPaths scout that failed?**

A: The DispatchPaths scout report is not available (the agent exited before persisting). The RegistryInternals scout §4 provides the four-dispatch-path reachability table with `path:line` evidence — all four paths funnel through `AgentService.run -> resolve -> resolveAgentAuto`, and no path has a stage-registry shortcut. R5 is satisfied by that evidence.

**Q7: Why AMEND and not SUPERSEDE ADR-033?**

A: The routing key stays `stage_id` (0344 owns the emission-model change separately). The change is to the *authority* of the registry (sole source -> default), not to the lookup mechanism. ADR-033's core decision (declarative `model_policy` with capability tiers and objective fallback) survives as a *default*. Supersede would discard the surviving core; amend preserves it while recording the new authority.

**Q8: Is this decision reversible?**

A: Yes. Option B adds one optional key to `AgentConfigSchema` with deep-replace semantics. If the override layer is unused in practice, removing it is a one-line schema change. If it IS used and the registry becomes a liability, escalating to Option A (remove) remains open as a future task — the override key is the narrow door that makes that escalation safe.
### Design
**Decision: DEMOTE `REGISTERED_CANONICAL_STAGES` to an overridable default. AMEND ADR-033.**

**Three options evaluated:**

| Option | What it does | Preserves stage-backed tier derivation? | Keeps objective escalation? | Verdict |
|---|---|---|---|---|
| A. Remove | Delete array; auto falls through to `agent.default` → Tier-1 | **No** | **No** — loses `getNextFallback` data | Rejected |
| **B. Demote to overridable default** | Registry stays as seed; config gains per-stage `model_policy` deep-replace | **Yes** | **Yes** | **Selected** |
| C. Retain as authority + layer | Registry remains source of truth with overlay | Yes | Yes | Rejected — data-poor records, dead validator, drifted adapter do not earn authority |

**Why B (evidence):**
1. Sole stage-routing consumer: `resolveStageModelPolicy` (`agent-service.ts:681`) via `resolveAgentAuto` stage branch (`:656-665`).
2. Data-poor: 10/10 records empty `gates` / `context_layers` / `observability` / `required_references`.
3. `default-by-phase` already short-circuits stage policy (`:643-652`) — registry is already a fallback for that path.
4. Adapter drift: 12 stages vs 10; mutation enum 4 vs 8 (`stage-registry-adapter.ts:27` vs domain `schema.ts:115-124`).
5. Validator DAG dead (`validator.ts:210`, zero production callers).

**Override shape (Follow-up A, not 0348):**
- Optional `AgentConfigSchema.model_policy`: `Record<stage_id, { min_tier?, fallback? }>`.
- Deep-replace per stage (not field merge).
- Applied **inside** the stage path only (after shim miss).

**Auto-routing precedence (correct model):**
1. Explicit `--agent` → executor/binary (0346) — no stage policy.
2. `default-by-phase` hit → executor selector — no stage policy.
3. Stage path: config override **else** registry seed → `resolveStageModelPolicy` / `getNextFallback` (`schema.ts:372`).
4. `agent.default` → Tier-1 priority.

**Why AMEND not SUPERSEDE ADR-033:** lookup key stays `stage_id`; only authority (sole source → seed) changes. 0344 owns emission-model change separately.

**Rejected:** proposing implementation here (R7). Follow-ups A–D live in Plan.
### Plan
**Decision task (R7 — no implementation in 0348).**

1. [x] Scout ADR-033/0344 relationship, registry internals, options A/B/C, dispatch reachability.
2. [x] Read scout outputs + `docs/tasks2/0347-inventory.md` + ADR-033 (`docs/00_ADR.md:778`).
3. [x] Synthesize Option B (demote) + AMEND ADR-033; address R1–R7 in Solution.
4. [x] `spur task check 0348` pass; status `done`.
5. [x] Verify re-audit (`/sp:dev-verify --force --fix all`): line anchors, precedence model, Testing tables.

**Follow-up implementation (NOT 0348):**
- **A:** `AgentConfigSchema.model_policy` override + merge inside stage path; T3 `docs/04_DESIGN.md`.
- **B:** Retire `validateStageRegistryGraph` + `StageTransition` (+ tests).
- **C:** Reconcile domain registry (10) vs adapter (12) — likely own ADR.
- **D:** Apply ADR-033 amendment text (gated on A).
### Root Cause
**Not a bug-fix task.** Root condition: `REGISTERED_CANONICAL_STAGES` (`schema.ts:655`, 10 records, no config door) is consumed only via `resolveAgentAuto` → `resolveStageModelPolicy` (`agent-service.ts:656-681`), with prompt-shape entry historically via slash-anchored `extractPhase` (`:937-954`). Validator DAG has zero production callers (`validator.ts:210`). Parallel adapter (`stage-registry-adapter.ts:225`, 12 records) already drifted. ADR-033 made the registry routing authority; 0344/0347 undercut that premise. 0348 chooses demote-to-seed + config override (not remove, not retain-as-authority) and amends ADR-033.
### Solution
**Decision recorded: DEMOTE `REGISTERED_CANONICAL_STAGES` to an overridable default. AMEND ADR-033.**

**R1 (registry fate): DEMOTE — Option B.** The registry at `packages/domain/src/stage-registry/schema.ts:655` stays as a **seed** for stage→tier derivation. `AgentConfigSchema` gains a narrow optional `model_policy` override key shaped as `Record<stage_id, { min_tier?, fallback? }>` with **deep-replace** merge (operator entry fully replaces the registry's `model_policy` for that stage).

**Routing precedence (as implemented today + Option B addition), high → low:**

1. **Explicit `--agent`** (0346) — `resolveAgent` → `resolveExecutorSelector`; **bypasses** stage routing entirely.
2. **`default-by-phase` shim** — if a phase is available and mapped (`agent-service.ts:643-652`), resolves that executor selector and **never enters** stage `model_policy`.
3. **Stage path** — `targetStageId` from `--stage` flag (`:656`) or residual phase/alias → `getCanonicalStage` (`:660`) → `resolveStageModelPolicy` (`:681`): use **`config.model_policy[stage_id]` if set, else registry seed**.
4. **Fallthrough** — `agent.default` then Tier-1 priority (`:669-675`).

The `default-by-phase` shim already short-circuits the registry; Option B does **not** reorder that. It only adds a config door **inside** the stage path (override vs seed). Calling these “three equal tiers of model_policy” is wrong — shim is an earlier exit, not a model_policy layer.

Evidence base:
- Sole stage-routing consumer: `resolveStageModelPolicy` (`:681`), reached only via `resolveAgentAuto` stage branch (`:656-665`).
- Registry is data-poor: all 10 records set `gates`, `context_layers`, `observability`, `required_references` to `[]`.
- Parallel adapter (`plugins/sp/scripts/stage-registry-adapter.ts:225`) has **12** records (`handover`, `fixall` extra), 4-value `mutation_class` (`none|corpus|worktree|irreversible`) vs domain’s **8** (`schema.ts:115-124`), no validator, different resolution (TABLE A/B/C).

**R2 (objective escalation home): STAYS in the domain registry.** `getNextFallback` (`packages/domain/src/stage-registry/schema.ts:372`) and `resolveStageModelPolicy` (`agent-service.ts:681`) stay the enforcement path. Override deep-replaces per-stage `model_policy` **before** those functions consume it — no second escalation implementation. Signal vocabulary remains `ObjectiveEscalationSignal` at `schema.ts:366` (`gate-fail`/`timeout`/`insufficient-evidence`/`retry-exhausted`).

**R3 (`extractPhase` fate): OWNED BY 0344 — prompt-shape inference does NOT survive in regex form.** `extractPhase` (`agent-service.ts:937-954`) is slash-anchored after `trimStart()`. Task 0344 (done) owns replacement via intention vocabulary on the command surface. Demoted registry does **not** depend on `extractPhase`: doors are `--stage` (`:656`) and residual phase/alias only when still present; neither requires expanding the regex.

**R4 (validator DAG): RETIRED (follow-up impl, not this ticket).** `validateStageRegistryGraph` (`packages/domain/src/stage-registry/validator.ts:210`) has zero production callers (definition + tests only). `StageTransition` appears only in validator types/tests. Orthogonal to A/B/C; Follow-up B executes retirement.

**R5 (four dispatch paths): COVERED for stage routing when resolution is `auto`.** All of CLI / subagent / workflow / slash that call `AgentService.run` with `--agent auto` (or omit → auto) enter `resolveAgentAuto`. Explicit `--agent` intentionally skips stage policy (0346). No path has a second stage-registry shortcut. The Option B override sits inside `resolveStageModelPolicy` — the single stage-policy chokepoint for auto routing on all four invocation surfaces.

**R6 (ADR routing): AMEND ADR-033** (`docs/00_ADR.md:778`). Routing key stays `stage_id` (0344 owns emission-model change). Authority of registry: sole source → **default seed**. Amendment records: (a) per-stage config override deep-replaces seed `model_policy`; (b) `default-by-phase` remains an earlier exit during transition; (c) validator DAG retired. Core ADR-033 decision (declarative `model_policy` + tiers + objective fallback) survives as the seed. Amendment doc edit is Follow-up D, gated on Follow-up A (T3 / `sp:doc-evolve`).

**R7 (no implementation): SATISFIED.** This ticket does not ship the override key, validator deletion, adapter reconcile, or ADR file edit. Follow-ups (Plan): **A** override key + stage-path merge; **B** retire validator DAG; **C** reconcile parallel adapter; **D** amend ADR-033 text.

**ADR-033 amendment draft (Follow-up D — recorded, not applied):**

> **Amendment (task 0348):** Stage-registry `model_policy` is a *default seed*, overridable per-stage via `AgentConfigSchema.model_policy` (deep-replace). Auto-routing order: explicit `--agent` bypass → `default-by-phase` (if set) → stage path (`config.model_policy[stage]` else registry seed) → `agent.default` / Tier-1. `validateStageRegistryGraph` / `StageTransition` retired (zero production callers). `extractPhase` retirement owned by 0344. Routing key remains `stage_id`.
### Testing
**Verdict: PASS** (re-audit: `/sp:dev-verify 0348 --force --fix all --focus all --next`)

Decision-only (R7). Coverage: N/A (no runtime code path).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Solution: DEMOTE Option B; sole consumer `agent-service.ts:656-681`; data-poor 10/10 empty gates; adapter 12 vs 10 |
| R2 | MET | Escalation stays `getNextFallback` `schema.ts:372` + `resolveStageModelPolicy` `:681`; override feeds them |
| R3 | MET | `extractPhase` `agent-service.ts:937-954` owned by 0344; no regex survival; doors `--stage`/seed |
| R4 | MET | Validator RETIRED as follow-up; `validator.ts:210` zero prod callers (this-run `rg`) |
| R5 | MET | Auto path single chokepoint; explicit `--agent` correctly out of stage policy (0346) |
| R6 | MET | AMEND ADR-033 `:778`; amendment draft in Solution; apply = Follow-up D |
| R7 | MET | No packages/apps/plugins change for this decision; follow-ups listed only |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 registry fate = demote | MET | static-ref | Solution R1 + Design option table |
| R2 escalation home | MET | static-ref | Solution R2; `schema.ts:372` re-read this run |
| R3 extractPhase owned by 0344 | MET | static-ref | Solution R3; 0344 done; regex `:937-954` |
| R4 validator DAG retired | MET | command | `rg validateStageRegistryGraph` → def + tests only |
| R5 four paths | MET | static-ref | Solution R5 clarified: auto→chokepoint; explicit bypass |
| R6 amend ADR-033 | MET | static-ref | Solution R6 + draft amendment |
| R7 no implementation | MET | command | decision corpus only; follow-ups not executed |

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Option B DONE as recorded decision; precedence model **CHANGED** this fix-pass to match code (shim earlier exit, not model_policy middle tier) — documented in Solution |
| scope-creep | pass | Decision + doc hygiene only |
| evidence-rule-pass | pass | Decision AC with static-ref + command evidence |

**Commands this verify**

```
rg -n validateStageRegistryGraph packages apps plugins   # def + tests only
rg -n "function getNextFallback" packages/domain/.../schema.ts  # :372
sed -n '640-690p' packages/app/src/services/agent-service.ts    # precedence
python3 count stages: domain 10, adapter 12; gates:[] ×10
spur task check 0348 --strict-core → pass
```

**Fix-pass disclosure**
- Corrected line anchors (`getNextFallback` 396→372; `resolveStageModelPolicy` 686→681; `extractPhase` 937-954).
- Corrected precedence model (override not above `default-by-phase`).
- Plan 7–8 closed; Testing tables + Verdict line; History.
- `.spur/run/0348-verdict.json` (gitignored).

**`--next`:** no-op — already terminal (`done`).
### Review
| ID | Severity | Finding | Evidence | Disposition |
|---|---|---|---|---|
| P1 | — | R1–R7 recorded with explicit verdicts | Solution | Accept |
| P2 | Medium | DispatchPaths scout missing | RegistryInternals §4 + this-run path re-read | Mitigated |
| P2 | Medium | Precedence listed override **above** `default-by-phase`, but override lives inside stage path after shim exit | `agent-service.ts:643-665` | **Fixed** this verify: documented true order |
| P3 | Low | Stale line anchors (`getNextFallback:396`, policy `:686`) | schema/agent-service this run | **Fixed** |
| P4 | Low | Adapter drift not resolved | 12 vs 10 | Out of scope → Follow-up C |

**SECUA:** Decision-only. Architecture: demote+override is right; dead validator correctly retired as follow-up. Residual: amendment text not yet in `docs/00_ADR.md` (R7 intentional).

**Final disposition: PASS.** `--next` no-op (terminal).
### References
- **ADR-033** — `docs/00_ADR.md:778` (amend, Follow-up D).
- **0344** — intention vocabulary / `extractPhase` retirement (done).
- **0347** — `docs/tasks2/0347-inventory.md` (compat surface).
- **0343** — tier vocabulary (3-value enum retained).
- **Feature B2** — map owner.
- **Code (re-verified 2026-07-26):**
  - `packages/domain/src/stage-registry/schema.ts:655` — `REGISTERED_CANONICAL_STAGES` (10)
  - `packages/domain/src/stage-registry/schema.ts:372` — `getNextFallback`
  - `packages/domain/src/stage-registry/schema.ts:366` — `ObjectiveEscalationSignal`
  - `packages/domain/src/stage-registry/validator.ts:210` — `validateStageRegistryGraph` (no prod callers)
  - `packages/app/src/services/agent-service.ts:643-675` — `resolveAgentAuto` precedence
  - `packages/app/src/services/agent-service.ts:681` — `resolveStageModelPolicy`
  - `packages/app/src/services/agent-service.ts:937-954` — `extractPhase`
  - `plugins/sp/scripts/stage-registry-adapter.ts:225` — `REGISTERED_STAGES` (12)
  - `packages/config/src/index.ts:126-372` — override key target (Follow-up A)
### History
- 2026-07-27T05:39:45.415Z todo → wip (system)
- 2026-07-27T05:57:07.054Z wip → testing (system)
- 2026-07-27T05:57:14.956Z testing → done (system)
- 2026-07-26: `/sp:dev-verify 0348 --force --fix all`. Decision re-audited. Fix-pass: precedence model vs code, line anchors, Testing tables, Plan closeout. Verdict PASS. `--next` no-op.
