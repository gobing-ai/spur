---
schema_version: 1
name: Make role-stage executor resolution keep the pinned executor's agent
status: done
template: issue
created_at: 2026-10-18T19:33:16.740Z
updated_at: "2026-10-19T07:38:35.742Z"

feature_id: B21
priority: P1
ac_altitude: task-local
estimate_hours: 6
dependencies: []
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1255-verdict.json
---

## 1255. Make role-stage executor resolution keep the pinned executor's agent

### Background

Two current routing gaps remain. First, `packages/app/src/workflow/actions/agent-run.ts:717-718` forwards a run pin's model as a model flag. `packages/app/src/services/agent-run-executor.ts:315,450` freezes that flag as explicitModel and gives it precedence on every attempt, even after `currentAgent/currentModel` are replaced at `:731-732`. A cross-executor escalation can therefore inherit the previous executor's model. Second, `packages/app/src/services/agent-resolver.ts:698-744` selects a role candidate on availability/tier/doctor usability, whereas required execution capabilities are checked later at `packages/app/src/services/agent-run-executor.ts:453-470`; the initial candidate can be unusable for this stage while a later eligible one would satisfy it.

**Refine corrections (2026-10-18)**
- Retained: atomic executor/model binding across replacement, and stage-specific capability-aware auto/role selection.
- Removed: higher tiers winning ahead of a cheaper attested standard executor because of config order. A direct call with higher-tier first returned floor-tier first; executor-tier.ts sorts by rank, and equal-tier config order is already intentional/stable.
- Removed: provider registry discovery and ambiguous bare-model rejection. Models are opaque runner options; no verified provider registry exists at this seam. Retain the existing explicit model override contract on the selected initial executor.
- Removed: options.model becoming an executor selector; this would silently change a valid public/action option.
- Archived run IDs and operator-global settings are historical hypotheses, not prerequisites or secrets to read. Use hermetic fake executors and deterministic runner captures. Estimate unset → 6h for the narrowed shared-seam fix.

### Requirements

- [x] R1. Every dispatched attempt uses one selected executor's agent and default model together. A model inherited from a workflow pin never overrides a replacement executor's model after escalation or disabled-pin re-resolution.
- [x] R2. Preserve a deliberate caller/action model override on the initial selected executor. Once routing changes executor, use the new executor's model; do not translate model names, query provider registries or reinterpret model as an executor selector.
- [x] R3. Auto/role resolution with declared requiresCapabilities skips candidates that cannot satisfy the required execution/session axes using existing attestation evaluators. No requirements means unchanged resolution. Explicit named pins still fail clearly rather than silently substituting. The pre-spawn guard remains authoritative on every actual attempt.
- [x] R4. Preserve tier-floor semantics, ascending rank and stable config-order ties. Capability filtering belongs in the runtime resolution walk, without changing fleet roster materialization or the generic cheapestEligibleExecutors helper's semantics.
- [x] R5. Hermetic tests cover replacement between different agent/model namespaces, explicit override lifetime, unattested-first/attested-next selection, exhausted capability eligibility and unchanged explicit pin refusal. Diagnostics name the actual rejected executor and unmet axes without exposing config/env values.

Out of scope: new CLI commands/flags, changing tier defaults or pin precedence, provider/model catalogs, automatic name translation, new failover policy (1260), changing shared availability state, and rewriting stage graphs.

### Acceptance Criteria

- [x] AC1 — An executor replacement cannot dispatch the prior executor's model (req: R1, R2, R5)
- [x] AC2 — Auto role selection skips an incapable first candidate while an explicit incapable pin fails closed (req: R3, R5)
- [x] AC3 — Rank order, stable ties and no-requirement resolution remain unchanged (req: R4, R5)

### Q&A

- Closed: same-tier order is configured order; higher tiers are fallbacks after cheaper eligible tiers. No new ordering setting.
- Closed: model values stay opaque and explicit model overrides keep their current meaning for the initial executor.
- Closed: capability-aware selection is stage-specific runtime filtering; no global ban on unattested read-only executors.
- Closed: execution/resource failure retries belong to 1260.

### Design

Chosen: repair existing AgentResolver/AgentRunExecutor seams; no new API surface or second resolver. Thread the already parsed requiresCapabilities through internal resolve flags/role walks, including resolveRoleFresh when an existing pin is disabled. Reuse evaluateCapabilities/evaluateSessionCapabilities and runner capability records; preserve the current pre-spawn guard. Keep cheapestEligibleExecutors a generic ordered candidate supplier because FleetService also uses it without a stage.

Model precedence: first attempt = explicit caller/action override if supplied, else selected executor model. Any replacement attempt = replacement executor model. A pin-derived flag must not become a permanent override; implement the narrowest provenance/attempt handling at the existing dispatcher/loop boundary, not a model-name heuristic. Preserve existing successful pinned, bare-agent and session-affinity paths. Do not replay the old executor session when the executor changes; existing fresh-re-resolution handling remains.

Targets: `packages/app/src/workflow/actions/agent-run.ts`, `packages/app/src/services/agent-run-executor.ts`, `packages/app/src/services/agent-resolver.ts`, `packages/app/src/services/agent-service.ts` only for existing fresh-role plumbing; reuse `packages/app/src/services/capability-attestation.ts`. Tests: `packages/app/tests/workflow/actions/agent-run.test.ts`, `packages/app/tests/services/agent-resolver.test.ts`, existing agent-service escalation suites and executor-tier tests. Owning routing contract: `docs/design/cli-contracts.md` agent role/stage resolution section; capability boundary: `docs/design/session-pinned-dispatch.md`. Update only changed facts; no new satellite.

No prerequisites; 1260 consumes the corrected selected-executor/model/eligibility contract and owns resource-failure policy. Do not implement 1260 here. Bound work to one task and 6h; persist captured argv/routing fixtures as evidence, never live provider credentials.

### Plan

- [x] 1. Add failing captured-dispatch tests for pinned A → B with different agent/model namespaces and for a true explicit first-attempt override (R1-R2).
- [x] 2. Add a resolver fixture with incapable first candidate, capable second, same-tier ties and no-requirement cases; explicit pin must still refuse (R3-R5).
- [x] 3. Fix model override lifetime in the existing dispatch loop; thread existing capability requirements into the runtime role-selection walk and fresh reroll without changing fleet/tier helper policy (R1-R4).
- [x] 4. Run targeted action/resolver/escalation/capability/tier suites inside packages/app, plus affected CLI agent tests and app/CLI typechecks. Use a fake runner public CLI probe, not real provider discovery (R5).
- [x] 5. Update the owning contract if changed; run task-local gate, review and verify before done. Record exact routing pairs and negative admission evidence.

### Root Cause

A model inherited from a workflow executor pin becomes indistinguishable from an enduring caller override in AgentRunExecutor: explicitModel remains fixed while the escalation loop replaces the executor. Separately, stage requiresCapabilities reach the pre-spawn guard after role candidate selection, so selection and admission answer different questions. The pure shared tier helper intentionally has no stage-capability or doctor input and must stay process-free.

### Solution

Bound a selected executor's model to that executor, and made capability requirements filter the
auto/role selection walk instead of only the pre-spawn guard.

| File | Change |
| --- | --- |
| `packages/app/src/services/agent-run-executor.ts:459` | The frozen model preference (explicit caller/action override or the executor pin's model forwarded by the action) now applies to the **initial dispatch only**: `attempt === 0 ? explicitModel : undefined`. Every later attempt exists because the escalation ladder replaced the executor, so it dispatches the replacement's own `currentModel` — a pin-derived or caller-derived model name can no longer ride onto a different executor. |
| `packages/app/src/services/agent-resolver.ts:598-870` | `resolveRole` takes the stage's `requiresCapabilities` and skips a candidate that cannot satisfy it, using the same two evaluations as the pre-spawn guard (`evaluateCapabilities` over executor attestation, then `evaluateSessionCapabilities` over the runner's session-capability record). New private helpers `unmetStageCapability` (bounded diagnosis: axis + state, never config/env values) and `stageCapabilityRequirements` (reads the same `requiresCapabilities` flag the guard consumes; malformed reads as "no requirements" so selection never becomes a lenient second schema). The declared-role, inherited-role and `agent.default`-role walks all pass the parsed requirements; an all-incapable candidate set fails naming every rejected executor and its unmet axes. |
| `packages/app/src/workflow/actions/agent-run.ts:691,1727` | The disabled-pin fresh re-resolution (`resolveRoleFresh`) now receives the same `requiresCapabilities` flag (helper `requiresCapabilitiesFlagForResolve`), so the re-rolled candidate is filtered by capability too; absent/invalid requirements add no flag. |
| `packages/app/src/services/executor-tier.ts:22-39` | The app-layer executor mirror gains the optional `executionCapabilities` block (imported type only), so the role walk can evaluate attestation without importing CLI types; absent stays `unknown` per axis. |
| `docs/design/cli-contracts.md:496-506` | Owning routing contract records both facts: the model binds to the initial selected executor and never travels onto a replacement, and `requiresCapabilities` filters the auto/role walk (including the fresh re-resolution) while an explicit named pin is never silently substituted. |
| `packages/app/tests/services/agent-service.test.ts:2914,2975` | Behavioral: an escalation dispatches the replacement's own configured model while attempt 0 keeps the override (verified red without the fix), and a pinned executor keeps its configured model on a single attempt. |
| `packages/app/tests/services/agent-resolver.test.ts:94-158` | AC2/AC3: incapable-first/capable-next selection, all-incapable failure naming the executor and unmet axes, malformed flag leaves the walk unchanged, and no-requirement resolution keeps config order. |
| `packages/app/tests/workflow/actions/agent-run.test.ts:3402` | The disabled-pin re-resolution carries `requiresCapabilities` when declared and adds no flag when it is not. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/agent-run-executor.ts:459` applies the model preference to the initial dispatch only; `packages/app/tests/services/agent-service.test.ts:2914` dispatches pi with the override, escalates to claude, and asserts the replacement got `anthropic/claude-opus` — the test fails with the fix reverted |
| R2 | MET | `packages/app/tests/services/agent-service.test.ts:2914` (caller override on the initial executor) and `:2975` (pin with its own model, one attempt); the diff contains no model-name translation and no provider lookup |
| R3 | MET | `packages/app/src/services/agent-resolver.ts:598-870` filters the declared-role, inherited-role and `agent.default`-role walks with `evaluateCapabilities`/`evaluateSessionCapabilities`; `packages/app/src/workflow/actions/agent-run.ts:691` forwards the same flag into the fresh disabled-pin re-resolution; `packages/app/tests/services/agent-resolver.test.ts:94` and `packages/app/tests/workflow/actions/agent-run.test.ts:3402` pin both paths |
| R4 | MET | `cheapestEligibleExecutors` and the tier helpers are untouched (`packages/app/src/services/executor-tier.ts:36` only adds an optional mirror field), so rank order and config-order ties are unchanged; `packages/app/tests/services/agent-resolver.test.ts:94` asserts the no-requirement walk still selects the first candidate and the tier suite passes unchanged |
| R5 | MET | `packages/app/tests/services/agent-service.test.ts:2914,2975`, `packages/app/tests/services/agent-resolver.test.ts:94-158` and `packages/app/tests/workflow/actions/agent-run.test.ts:3402` use fakes only (no provider discovery); `packages/app/tests/services/agent-resolver.test.ts:118` asserts the diagnostic names the rejected executor and `fsWrite: unknown` and carries no config/env values |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/agent-service.test.ts:2914` — escalation dispatches the replacement's own model; reverting `packages/app/src/services/agent-run-executor.ts:459` makes it fail |
| AC2 | MET | test | `packages/app/tests/services/agent-resolver.test.ts:94` (incapable first candidate skipped, attested next selected) and `packages/app/tests/workflow/actions/agent-run.test.ts:3200` (explicit incapable pin fails closed pre-spawn, no substitution) |
| AC3 | MET | test | `packages/app/tests/services/agent-resolver.test.ts:94` (no-requirement resolution unchanged) plus the untouched `packages/app/tests/services/executor-tier.test.ts` rank/tie suite |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1255
**Scope:** task 1255 diff — `packages/app/src/services/agent-run-executor.ts`, `agent-resolver.ts`, `executor-tier.ts`, `packages/app/src/workflow/actions/agent-run.ts`, `docs/design/cli-contracts.md`, three app test files
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | correctness | Capability filtering applies to the auto/role walks and the fresh disabled-pin re-resolution, but not to the escalation fallback walk: a fallback executor that cannot satisfy the stage's requirements still fails closed at the pre-spawn guard (exit 2) instead of trying the next fallback entry. That is the declared boundary (the guard stays authoritative, R3) and changing the ladder is 1260's failover policy. | `packages/app/src/services/agent-run-executor.ts:457` | DEFER(1260 owns executor failover policy; this task narrows selection, not the ladder) |
| 2 | P4 (advisory) | architecture | The app-layer `AgentExecutorConfig` mirror now carries `executionCapabilities` as a second structural copy of the config zod block; `executorAttestation` resolves an absent block to `unknown` per axis, so drift degrades to fail-closed rather than permissive. | `packages/app/src/services/executor-tier.ts:36` | ACCEPTED |
| 3 | P4 (advisory) | efficiency | Every role resolve that declares requirements runs one extra pure evaluation per candidate (no doctor probe added — the walk already probed usability); measured cost is a set lookup per axis. | `packages/app/src/services/agent-resolver.ts:767` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/agent-run-executor.ts:459` binds the frozen preference to attempt 0; `packages/app/tests/services/agent-service.test.ts:2914` asserts attempt 0 = the override and the escalated attempt = the replacement's own configured model (fails when the fix is reverted) |
| R2 | MET | `packages/app/tests/services/agent-service.test.ts:2914` (explicit override on the initial executor) and `:2975` (a pinned executor keeps its own configured model); model values are passed through opaquely, with no translation or registry lookup anywhere in the diff |
| R3 | MET | `packages/app/src/services/agent-resolver.ts:598-870` (`stageCapabilityRequirements`, `unmetStageCapability`, filtered walk) reuses `evaluateCapabilities` + `evaluateSessionCapabilities`; `packages/app/tests/services/agent-resolver.test.ts:94-158` covers skip/unchanged/malformed; `packages/app/tests/workflow/actions/agent-run.test.ts:3402` covers the fresh re-resolution; `packages/app/tests/workflow/actions/agent-run.test.ts:3200` keeps the explicit-pin pre-spawn refusal |
| R4 | MET | `cheapestEligibleExecutors` and the tier helpers are untouched, so rank ordering and stable config-order ties are unchanged; `packages/app/tests/services/agent-resolver.test.ts` asserts no-requirement resolution still picks the first candidate and `packages/app/tests/services/executor-tier.test.ts` passes unchanged |
| R5 | MET | The six new/existing cases are hermetic (fake service, fake doctor, mocked runner — no provider discovery); `packages/app/tests/services/agent-resolver.test.ts:118` asserts the failure names the rejected executor and `fsWrite: unknown` and contains no attestation provenance |

**Residual risk:** finding 1 (DEFER-ed P3) — the escalation ladder can still terminate at a pre-spawn refusal instead of walking to a capable fallback; 1260 owns that policy. The two P4s are observations, not defects.

**Next:** close 1255 (`record` writes Testing from the PASS verdict; the only open row is the DEFER-ed P3, which the review gate classifies as a wrap residual).
Confidence: MEDIUM

### References

Refinement audit: 2026-10-18, source-local CLI, tasks 1254–1260 processed sequentially.

Evidence: agent-run.ts pin flags; agent-run-executor.ts explicitModel lifetime; agent-resolver.ts role walk; executor-tier.ts ordering probe.

Concurrency snapshot: git worktree list shows main only; task list --status wip returns []; one writer per tree. Recheck both before implementation. The tracked tree advanced to release 0.4.15 during the audit; preserve those external commits. Inspect installed versions/bundle at task start, then regenerate only artifacts affected by implementation.

Implement-ready checklist (specification, not an implementation PASS):

```json
[
  {
    "id": "requirements",
    "pass": true,
    "evidence": "Requirements contain bounded observable outcomes, scope exclusions and named current seams."
  },
  {
    "id": "design",
    "pass": true,
    "evidence": "Design freezes reused contracts, algorithm/precedence, files, negative cases and no-new-surface constraints."
  },
  {
    "id": "plan",
    "pass": true,
    "evidence": "Ordered Plan starts with failing fixtures, then minimal fix and named workspace/gate evidence."
  },
  {
    "id": "ac",
    "pass": true,
    "evidence": "Task-local checkbox ACs map every retained requirement to test-observable outcomes; implementation remains unchecked."
  },
  {
    "id": "decisions",
    "pass": true,
    "evidence": "Q&A closes original design choices; false premises and speculative APIs removed."
  },
  {
    "id": "dependencies",
    "pass": true,
    "evidence": "No unmet design prerequisites; boundaries to adjacent tasks explicit."
  },
  {
    "id": "premises",
    "pass": true,
    "evidence": "agent-run.ts pin flags; agent-run-executor.ts explicitModel lifetime; agent-resolver.ts role walk; executor-tier.ts ordering probe"
  }
]
```

### History

- 2026-10-19T07:32:50.129Z todo → wip (system)
- 2026-10-19T07:37:45.876Z wip → testing (system)
- 2026-10-19T07:38:35.736Z testing → done (system)

