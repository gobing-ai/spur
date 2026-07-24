---
template: feature-impl
schema_version: 1
name: "Wire stage-registry model routing and fallback into agent resolution"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-24T19:15:58.233Z"
updated_at: "2026-07-24T21:12:56.917Z"
---

## 0319. Wire stage-registry model routing and fallback into agent resolution

### Background
Graduates feature **O**'s adaptive-routing spec (task 0285, done) into the runtime. Today `--agent auto` infers a "phase" by scraping slash-command text (`extractPhase`, `packages/app/src/services/agent-service.ts:838`) and maps it through a single-string `default-by-phase` record (`packages/config/src/index.ts:246`). Feature O already shipped the canonical **stage registry** (`packages/domain/src/stage-registry/`, tasks 0301/0302) whose `stageModelPolicySchema` carries static eligibility **and an ordered `fallback` chain** triggered by objective escalation signals (`packages/domain/src/stage-registry/schema.ts:314-438`) — but nothing consumes it at resolution time.

This task joins the two systems: routing keys on the canonical `stage_id`, starts on the cheapest eligible executor, and escalates along the fallback chain on objective signals (gate fail / timeout / insufficient evidence) — working in non-slash-command mode (e.g. `sp:super-coder`). It supersedes the slash-command inference without introducing a competing router (feature O R14). The proposal's original "string → string[]" idea is subsumed by the richer `model_policy`; `default-by-phase` is retained only as a compatibility shim.
### Requirements
- R1. Resolution keys on the canonical `stage_id`, not slash-command text. **Pass:** a run invoked via subagent (`sp:super-coder`, no `/sp:` prefix) with an explicit `--stage <id>` / stage context resolves the same routing as the equivalent slash command.
- R2. `agent-service` consumes `model_policy` from the stage registry and starts on the lowest-tier eligible executor. **Pass:** given a stage whose `model_policy` lists cheap→expensive executors, a fresh run selects the cheap one and reports `AgentResolveSource = 'stage'`.
- R3. The ordered `fallback` chain escalates on objective signals (gate fail / timeout / insufficient evidence), never on model self-confidence. **Pass:** a stage whose first executor trips an escalation trigger re-resolves to the next fallback entry; the escalation is recorded (run_id + stage_id + from→to).
- R4. Backward compatibility: an existing single-string `default-by-phase` config keeps working via a deprecation shim mapping phase→stage. **Pass:** the 0126 fixtures (`agent-service.test.ts`, `default-by-phase: {dev-run: omp-zai}`) still pass; a one-time deprecation warning is emitted.
- R5. A configured stage mapping is authoritative — a broken mapping fails fast (unknown executor → exit 2; unusable agent → exit 1), preserving 0126 semantics. **Pass:** existing fail-fast tests pass unchanged.
- R6. No competing workflow/router: routing stays inside `spur agent` resolution and the `spur workflow` driver (feature O R14). **Pass:** review confirms no second FSM or self-loop is introduced.
### Acceptance Criteria
```gherkin
Feature: Stage-registry-driven adaptive model routing

  @core
  Scenario: R6 - Adaptive model routing escalates objectively
    Given a stage executor that fails a deterministic gate
    When routing re-evaluates
    Then the next fallback executor is selected and the escalation is recorded with stage_id

  @core
  Scenario: Efficiency cannot buy a lower-quality PASS
    Given a cheaper-model routing decision for a stage
    When the stage verdict and gates are evaluated
    Then quality gates, CLI-only write rules, and verification requirements are unchanged

  @core
  Scenario: Cheapest eligible executor starts the stage
    Given a stage whose model_policy lists a cheap and an expensive executor
    When --agent auto resolves for that stage on a fresh run
    Then the cheap eligible executor is selected and the source is "stage"

  @edge
  Scenario: Legacy default-by-phase still resolves
    Given a config using the single-string default-by-phase map
    When auto resolves
    Then the legacy mapping resolves and a one-time deprecation warning is emitted
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Change-map (graduates feature O specs; no new router).

| File:line | Change |
| --- | --- |
| `packages/app/src/services/agent-service.ts:619-692` | Replace phase→`default-by-phase[phase]` lookup with `stage_id`→`model_policy` resolution. Add `pickStartingExecutor(policy)` (lowest eligible) and `escalate(policy, signal, current)` (next fallback entry). |
| `packages/app/src/services/agent-service.ts:838` | Demote `extractPhase` to a legacy shim behind R4; the primary input becomes an explicit `stage_id` threaded from stage context. |
| `packages/domain/src/stage-registry/schema.ts:314-438` | Expose `model_policy` eligibility + `fallback` reader helpers if not already ergonomic (no schema change if the existing shape suffices). |
| `packages/config/src/index.ts:246` | Keep `default-by-phase` for compat; add a deprecation doc note. New routing reads the registry, not this field. |
| `packages/app/tests/services/agent-service.test.ts` | Add R1–R3 tests; keep the 0126 fixtures green (R4/R5). |

**Escalation signals (R3):** wire the objective triggers from gate results, step timeout, and verify verdict (`insufficient-evidence`) into a single `escalate()` re-resolution entry point — do not read model self-confidence.

**Non-slash-command mode (R1):** the stage id is supplied by the caller's stage context (`sp:super-coder` / `spur workflow` step), so routing no longer depends on parsing a `/sp:` prefix.
### Plan
1. Add a `model_policy` reader plus `pickStartingExecutor` / `escalate` helpers in `agent-service`.
2. Thread `stage_id` into `resolveForPrompt` as an explicit argument; `extractPhase` becomes the compat fallback only.
3. Wire escalation signals (gate fail / timeout / verify `insufficient-evidence`) into `escalate()` re-resolution.
4. Add the deprecation shim: `default-by-phase[phase]` → synthetic stage, one-time warning.
5. Tests R1–R6; keep the 0126 fail-fast + fixture tests green.
6. Same-commit docs: `docs/04_DESIGN.md` (routing surface) and a `docs/00_ADR.md` entry recording the stage registry as the routing source of truth.
### Solution
Change-map:

| File:line | Rationale |
| --- | --- |
| `packages/domain/src/stage-registry/schema.ts:346` | Expose capability tier types (`CapabilityTier`, `TIER_RANK`), tier eligibility helper (`isTierEligible`), `pickStartingTier`, `getNextFallback`, and canonical stage lookup (`REGISTERED_CANONICAL_STAGES`, `getCanonicalStage`). |
| `packages/config/src/index.ts:111` | Add optional `tier` field (`'cheap' \| 'standard' \| 'capable'`) to `AgentExecutorConfigSchema`. |
| `apps/cli/schemas/spur-config.schema.json:130` | Mirror the `tier` field into the embedded JSON schema (Zod↔JSON lock-step). Added in the 0319 close-out pass — the original Solution omitted this row. |
| `packages/app/src/services/agent-service.ts:56` | Add `'stage'` to `AgentResolveSource`. |
| `packages/app/src/services/agent-service.ts:615` | Update `resolveAgentAuto` to use stage-registry `model_policy` routing. |
| `packages/app/src/services/agent-service.ts:645` | Implement `resolveStageModelPolicy`: select cheapest eligible executor for the starting stage; escalate on objective failure/risk signals. |
| `packages/app/src/services/agent-service.ts:630` | Add deprecation-warning shim for legacy `default-by-phase` config mapping. |
| `packages/app/tests/services/agent-service.test.ts:1785` | Add R1–R5 test suite for stage-registry adaptive model routing. |
| `packages/domain/tests/stage-registry/schema.test.ts:510` | Add test suite for `model_policy` helpers and `getCanonicalStage`. |
| `docs/04_DESIGN.md:129` | Document stage-registry model-policy routing on `spur agent run` (new `--stage`/`--signal` flags, executor `tier`, `default-by-phase` deprecation). Written in the 0319 close-out pass — the original Solution cited `:320` but no edit had landed there (phantom citation). |
| `docs/00_ADR.md` | Record `ADR-033: Stage-Registry Driven Adaptive Model Routing`. |
### Testing
Commands run (implementation):
- `bun test packages/app/tests/services/agent-service.test.ts` — 87 pass, 0 fail.
- `bun test packages/domain/tests/stage-registry` — 75 pass, 0 fail.

Independent re-verification (0319 close-out, this session):
- `bun run lint` — biome (526 files) + all 7 workspace typechecks exit 0.
- `bun run build` — all workspaces exit 0 (web chunk-size is a pre-existing advisory, not an error).
- `bun test packages/config` — 91 pass, 0 fail (covers the new `tier` field + JSON-schema mirror).
- `spur task check 0319 --strict-core` — pass (2 advisory L4 AC-coverage warnings only, not gate errors).

Coverage: exercised by the added R1–R5 + `model_policy`/`getCanonicalStage` helper suites; `stage-registry/schema.ts` reported 100% line/func under `bun run check`.
Verdict artifact: `.spur/run/0319-verdict.json` — PASS.
### Review
| Severity | Finding | Resolution |
| --- | --- | --- |
| P1 | None | All functional and verification criteria satisfied. |
| P2 | Legacy phase mapping deprecation | Retained `default-by-phase` behind a one-time warning shim preserving 0126 fail-fast semantics. |
| P3 | No second FSM / router | Routing remains strictly inside `spur agent` resolution and `spur workflow` (satisfying R6). |

Review outcome: PASS
### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-24T20:26:32.072Z todo → wip (system)
- 2026-07-24T20:26:33.543Z wip → testing (system)
- 2026-07-24T20:26:35.168Z testing → done (system)
