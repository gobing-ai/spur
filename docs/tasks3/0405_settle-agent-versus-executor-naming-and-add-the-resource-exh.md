---
template: feature-impl
schema_version: 1
name: "Settle agent-versus-executor naming and add the resource-exhaustion trigger"
description: ""
status: done
type: task
profile: standard
feature_id: H9
parent_wbs: null
priority: P1
tags: ["sp-plugin", "cli", "stage-registry", "vocabulary"]
dependencies: []
created_at: "2026-08-01T05:22:55.687Z"
updated_at: "2026-08-01T22:08:07.653Z"
done_forced: "true"
done_reason: Implement step (--mode implement) complete under bug-742. task check PASS; tests green (domain 778/app 1182/adapter 81/schema 53); lint+tsc clean; AC R1-R7 traced.
---

## 0405. Settle agent-versus-executor naming and add the resource-exhaustion trigger

### Background

The vocabulary task, deliberately first: both later tasks write code against these names, and renaming after they land means touching the same files twice.

Two unsettled naming questions. `--agent` describes the thing dispatched; `--executor` describes the role it plays, and the stage registry and tier vocabulary already say "executor" (`getExecutorTier`, `eligible` executor lists in `agent-service.ts:777-783`). The surface is currently split between the two.

Separately the objective trigger vocabulary (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted` in `stageModelPolicySchema`) has no member for resource exhaustion — the operator's actual failure mode. Task 0406 cannot detect-and-escalate what the schema cannot express, so the enum extension lands here.

### Requirements
R1. Decide `--agent` vs `--executor` and record the decision with its reasoning where the vocabulary is defined, not only in a commit message.
R2. Apply the chosen spelling consistently across CLI flags, config keys, stage-registry vocabulary, and documentation.
R3. If the superseded spelling is retained as an alias, document it with a removal horizon. If it is not retained, state the migration for existing configs and invocations.
R4. Add a resource-exhaustion member to the objective escalation trigger vocabulary in `stageModelPolicySchema`, covering rate limits, quota, and token-budget failures.
R5. The new trigger is usable in a `fallback[]` entry exactly like the existing four — no special-casing at the schema level.
R6. Existing stage-registry configs continue to validate unchanged; the enum extension is additive.
R7. Do not implement detection or escalation behavior here — that is task 0406. This task establishes the names and the schema they will use.
### Acceptance Criteria
Covers feature scenarios R3 and R8.

```gherkin
Feature: executor vocabulary and trigger schema

  Scenario: The flag name is settled and applied consistently
    Given the decision between --agent and --executor
    When CLI flags, config keys, stage-registry vocabulary and docs are reviewed
    Then all use the chosen spelling
    And any retained alias is documented with its removal horizon

  Scenario: Resource exhaustion is expressible as a trigger
    Given the objective escalation trigger vocabulary
    When a resource exhaustion failure occurs
    Then a trigger member exists that names it

  Scenario: The new trigger is a first-class fallback entry
    Given a stage model policy using the resource exhaustion trigger
    When the policy is validated
    Then it validates exactly as a policy using any existing trigger

  Scenario: Existing configs keep validating
    Given stage-registry configs written before this change
    When they are validated against the extended schema
    Then they validate unchanged
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### The split may be deliberate layering, not drift — check before renaming

Counting occurrences changes the framing. The operator-facing surface says **agent**: the CLI flag
(13 occurrences in `apps/cli/src`), the config key (`agent:` at `.spur/config.yaml:31`, and
`agent: omp` on each stage). The domain surface says **executor**: 55 occurrences across
`packages/app/src` and `packages/domain/src` — `getExecutorTier`, the eligible-executor list at
`agent-service.ts:777-783`, the tier vocabulary.

That is a coherent split, not obvious drift: the operator picks *an agent* (a concrete tool: omp,
claude, codex); the registry reasons about *an executor* (a role filled by whichever agent meets the
tier). Forcing one word across both layers would flatten a distinction that is currently doing work.

**So R1 is a real decision with three outcomes, not two:** rename to `--executor`, keep `--agent`,
or **keep both deliberately** and document the layer boundary — operator vocabulary at the CLI and
config, domain vocabulary inside the registry. Evaluate the third seriously; the evidence above is
the argument for it. Whichever is chosen, R1 requires the reasoning recorded at the vocabulary
definition site, and the third option requires the boundary stated explicitly, or it decays back
into looking like drift.

If the decision is to keep both, R2's "apply consistently" means *consistent within each layer*, and
the task's cost drops to documentation plus the trigger enum work.

#### Trigger enum extension

Additive by construction: `stageModelPolicySchema.fallback[].trigger` is a `z.enum`, so adding a
member cannot invalidate existing configs (R6). The naming should match the observable condition
rather than the cause — the detector in task 0407 will classify from `stderr` and exit codes, and
rate limits, quota exhaustion, and token-budget overruns present differently per agent while meaning
the same thing to the fallback chain. One member covering the class is right; three members split by
vendor spelling would push classification into config.

Name it for what the policy should do about it, in the style of the existing four
(`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted`) — those name conditions, not
error strings.

#### Why this task is first

Both 0406 and 0407 write code against these names. Renaming after they land means touching the same
files twice — the cohesion rule from task 0404, applied forward.
### Plan
- [x] Inventory every occurrence of both spellings across CLI, config, stage registry and docs.
- [x] Decide, and write the decision plus reasoning at the vocabulary definition site.
- [x] Apply the spelling; add the alias with a removal horizon, or the migration note.
- [x] Extend the trigger enum; confirm additively via existing-config validation tests.
- [x] Confirm no detection or escalation logic changed.
### Solution
Decision (R1/R2/R3): **keep both vocabularies deliberately** — the split is coherent layering, not drift. The operator surface says `agent` (CLI `--agent` flag, the `agent:` config key, and the `agent` field inside each executor naming the canonical coding-agent tool — omp/claude/codex). The domain surface says `executor` (the named profile filling a stage role at a capability tier — `AgentExecutorConfig`, `resolveExecutor`, `getExecutorTier`, `NormalizedTeamMember.executor`). The operator picks an agent (a concrete tool); the registry reasons about an executor (a role). R2's "consistent" means consistent *within each layer*. No alias is retained (R3 N/A) and no migration is required — both spellings are authoritative within their layer. The boundary is recorded explicitly at both vocabulary-definition sites so it does not decay back into looking like drift.

Trigger enum (R4/R5/R6): added `resource-exhaustion` as a fifth member of the objective escalation trigger vocabulary. One member covers the whole class (rate limit, quota, token-budget overrun) because agents surface these differently (HTTP 429, quota strings, token-count overflow) but the fallback response is identical, and splitting by vendor spelling would push classification into config. Named for the condition, matching the existing four. Detection/escalation behavior stays in task 0406/0407 (R7) — this task only establishes the name and the schema seat.

Change map (file:line):
- `packages/domain/src/stage-registry/schema.ts:346-374` — extracted `objectiveEscalationTriggerSchema` (zod enum) + `ObjectiveEscalationSignal` type (now `z.infer` of the schema) above `stageModelPolicySchema`; added `resource-exhaustion`; `stageModelPolicySchema.fallback[].trigger` now references the named schema; recorded both decisions in doc comments at the definition sites.
- `packages/domain/src/stage-registry/schema.ts:41-44` — bumped `STAGE_REGISTRY_SCHEMA_VERSION` minor 0→1 (additive enum member per the 0282 extension rule).
- `packages/config/src/index.ts:284-302` — recorded the agent-vs-executor layering decision in `AgentConfigSchema`'s doc block (the bridge site where both vocabularies meet — an `agent:` section whose `executors[]` each carry an `agent` field).
- `packages/app/src/services/agent-service.ts:52-63` — cross-referenced the decision at the `AgentExecutorConfig` interface (the domain-side definition site), pointing to the config schema as the boundary record.
- `plugins/sp/scripts/stage-registry-adapter.ts:67-79` — extended the self-contained mirror type to add `resource-exhaustion` via a named `ObjectiveEscalationTrigger` union, with a comment naming the domain schema as authority.
- `docs/04_DESIGN.md:163` — added `resource-exhaustion` to the surface enumeration of objective signals (T3 same-commit). `docs/00_ADR.md` left unchanged — it records the 0319 decision state at decision time.
- `packages/domain/tests/stage-registry/schema.test.ts:545-591` — 4 new tests: (R4) enum contains `resource-exhaustion` and retains the four; (R5) a `resource-exhaustion` fallback entry validates and resolves through `getNextFallback` like any trigger; (R6) legacy configs and every registered canonical stage's `model_policy` still validate; additive-only (unknown triggers still reject). Updated the schema-version assertion at `packages/domain/tests/stage-registry/schema.test.ts:82` to `minor: 1`.

No detection or escalation logic changed (R7 confirmed).
### Testing
**Verification verdict: PASS**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Vocabulary decision and rationale at `packages/config/src/index.ts:283` and `packages/app/src/services/agent-service.ts:55`. |
| R2 | MET | Operator `--agent` / domain executor split is enforced by `plugins/sp/tests/inline-execution-contract.test.ts:96`. |
| R3 | MET | No alias or migration is required; both spellings are authoritative in their layer (`packages/config/src/index.ts:296`). |
| R4 | MET | `resource-exhaustion` and its rate-limit/quota/token scope are defined at `packages/domain/src/stage-registry/schema.ts:355` and `:364`. |
| R5 | MET | `fallback[].trigger` uses the shared trigger schema at `packages/domain/src/stage-registry/schema.ts:398`; schema tests exercise parsing and resolution. |
| R6 | MET | Additive change uses schema minor `1` at `packages/domain/src/stage-registry/schema.ts:41`; legacy policy tests pass. |
| R7 | MET | Detection/retry is independently owned and verified by 0407. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R8 — The flag name is settled and applied consistently | MET | test | Derived command inventory enforces `--agent` and rejects `--executor`; full suite passed. |
| R3 — Resource exhaustion is expressible as a trigger | MET | test | Stage-registry schema tests cover the enum member. |
| The new trigger is a first-class fallback entry | MET | test | Schema test parses and resolves the new trigger through `getNextFallback`. |
| Existing configs keep validating | MET | test | Legacy and canonical policies validate in the full suite. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Additive trigger schema and vocabulary boundary match the approved design. |
| SECUA | pass | No blocker or unresolved major finding. |
| repository | pass | `bun run spur-check`: 4318 pass, 0 fail; 99.32% functions / 99.28% lines. `bun run test-cf`: 1 passed. `bun run build`: exit 0. |

Fix-pass artifact: `.spur/run/0405-verdict.json:1-26` (fresh requirement/AC evidence and gate results).
### Review
**Three-dimensional review** (sp-dev-review 0405 --auto, 2026-08-01)

**Functional Verdict: PASS** — all 7 requirements MET with verified file:line evidence.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Decision "keep both deliberately" recorded at `packages/config/src/index.ts:283-298` (operator↔domain bridge) and cross-referenced at `packages/app/src/services/agent-service.ts:52-63` (domain definition site). Reasoning is at the vocabulary definition, not only in a commit message. |
| R2 | MET | CLI uses `--agent` consistently (`apps/cli/src/commands/agent.ts:46` — no `--executor` flag exists); domain uses `executor` consistently (`agent-service.ts:64` `AgentExecutorConfig`, `schema.ts:423` `isTierEligible`, `schema.ts:436` `getNextFallback`). Consistent within each layer. |
| R3 | MET | No alias retained, no migration required — both spellings authoritative within their layer. Stated explicitly at `packages/config/src/index.ts:296-298`. R3 N/A is the correct resolution. |
| R4 | MET | `resource-exhaustion` added as fifth member: `packages/domain/src/stage-registry/schema.ts:364-370` (`objectiveEscalationTriggerSchema`). Covers rate limits, quota, token-budget per doc comment L355-359. |
| R5 | MET | `stageModelPolicySchema.fallback[].trigger` references `objectiveEscalationTriggerSchema` at `schema.ts:398` — no special-casing. Test proves first-class fallback behavior: `schema.test.ts:555-564` (validates + resolves through `getNextFallback`). |
| R6 | MET | Additive enum extension. Schema version bumped minor 0→1 at `schema.ts:43`. Backward-compat proven: `schema.test.ts:566-583` (legacy policy + every canonical stage's `model_policy` validates). Unknown-trigger rejection test at `schema.test.ts:585-592`. |
| R7 | MET | No detection or escalation logic changed. Diff confirms: only schema enum, type derivation (`ObjectiveEscalationSignal` now `z.infer` at `schema.ts:373`), doc comments, and tests. `getNextFallback` (`schema.ts:436-451`) body untouched. |

**SECUA Review** — no blocker / major / minor findings.

| Priority | Dimension | Finding |
|----------|-----------|---------|
| P4 | — | No P1–P3 findings. Schema change is additive (zod enum member); type narrowing tightened (`ObjectiveEscalationSignal` is now `z.infer` of the schema rather than a hand-maintained union — eliminates a class of drift). No security, efficiency, correctness, or usability regressions. Adapter mirror at `plugins/sp/scripts/stage-registry-adapter.ts:74-79` kept in sync with a comment naming the domain schema as authority. |

**Architecture Review** — no blocker / major findings; 1 advisory.

| # | Severity | Signal | Location | Finding |
|---|----------|--------|----------|---------|
| C1 | advisory | wrong seam (potential) | `plugins/sp/scripts/stage-registry-adapter.ts:74-79` | The `ObjectiveEscalationTrigger` type is a hand-maintained mirror of the domain `objectiveEscalationTriggerSchema`. The comment correctly names the domain as authority and says "update both together," but there is no compile-time link ensuring they stay in sync — a future enum member added to the domain schema would not cause a type error here. **Non-blocking** because: (a) the adapter is a deliberate self-contained boundary (plugins/sp cannot import from packages/domain at runtime — it's a stage-registry mirror for the plugin layer), (b) the comment creates a procedural checkpoint, (c) the existing test suite exercises both sides. **Deepening proposal (advisory, deferred):** consider a compile-time assertion test that compares `ObjectiveEscalationTrigger` members against `objectiveEscalationTriggerSchema.options` to catch drift at CI time. Do not act on this under 0405 — it's a cross-cutting pattern affecting all mirrored types in the adapter, not specific to this task. |

**Verification evidence (run this turn):**
- `bun test packages/domain/tests/stage-registry/schema.test.ts` → 53 pass, 0 fail. `schema.ts` coverage: 100% funcs / 100% lines.
- `bun test plugins/sp/tests/stage-registry-adapter.test.ts` → 81 pass, 0 fail.
- `tsc --noEmit` on domain + config → silent (no errors).
- `biome check` on 5 touched files → clean.
- Line-anchor re-read: all cited `file:line` anchors re-read this run and content matches the requirement subject.

**Residual note (P4, non-blocking):** `docs/00_ADR.md:782` (ADR-033) leaves the trigger enumeration at the 0319-decision state (`gate-fail`, `timeout`, `insufficient-evidence`, `retry-exhausted`) — it does not list `resource-exhaustion`. This is correct: an ADR records the decision at decision time, not retroactively. The live surface enumeration at `docs/04_DESIGN.md:163` is updated same-commit (T3). No action needed.

**Aggregate Verdict: PASS** — functional PASS, SECUA clean, architecture advisory-only. Task 0405 is ready for progression.
### References

H9

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-01T16:52:58.812Z todo → wip (system)
- 2026-08-01T16:52:59.259Z wip → testing (system)
- 2026-08-01T16:52:59.739Z testing → done (system)
- 2026-08-01T16:53:17.209Z done → wip (system)
- 2026-08-01T16:54:19.059Z wip → testing (system)
- 2026-08-01T17:26:17.239Z testing → done (system)
