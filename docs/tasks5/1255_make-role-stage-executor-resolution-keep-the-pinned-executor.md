---
schema_version: 1
name: Make role-stage executor resolution keep the pinned executor's agent
status: todo
template: issue
created_at: 2026-10-18T19:33:16.740Z
updated_at: "2026-10-19T06:37:45.366Z"

feature_id: B21
priority: P1
ac_altitude: task-local
estimate_hours: 6
dependencies: []
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

- [ ] R1. Every dispatched attempt uses one selected executor's agent and default model together. A model inherited from a workflow pin never overrides a replacement executor's model after escalation or disabled-pin re-resolution.
- [ ] R2. Preserve a deliberate caller/action model override on the initial selected executor. Once routing changes executor, use the new executor's model; do not translate model names, query provider registries or reinterpret model as an executor selector.
- [ ] R3. Auto/role resolution with declared requiresCapabilities skips candidates that cannot satisfy the required execution/session axes using existing attestation evaluators. No requirements means unchanged resolution. Explicit named pins still fail clearly rather than silently substituting. The pre-spawn guard remains authoritative on every actual attempt.
- [ ] R4. Preserve tier-floor semantics, ascending rank and stable config-order ties. Capability filtering belongs in the runtime resolution walk, without changing fleet roster materialization or the generic cheapestEligibleExecutors helper's semantics.
- [ ] R5. Hermetic tests cover replacement between different agent/model namespaces, explicit override lifetime, unattested-first/attested-next selection, exhausted capability eligibility and unchanged explicit pin refusal. Diagnostics name the actual rejected executor and unmet axes without exposing config/env values.

Out of scope: new CLI commands/flags, changing tier defaults or pin precedence, provider/model catalogs, automatic name translation, new failover policy (1260), changing shared availability state, and rewriting stage graphs.

### Acceptance Criteria

- [ ] AC1 — An executor replacement cannot dispatch the prior executor's model (req: R1, R2, R5)
- [ ] AC2 — Auto role selection skips an incapable first candidate while an explicit incapable pin fails closed (req: R3, R5)
- [ ] AC3 — Rank order, stable ties and no-requirement resolution remain unchanged (req: R4, R5)

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

- [ ] 1. Add failing captured-dispatch tests for pinned A → B with different agent/model namespaces and for a true explicit first-attempt override (R1-R2).
- [ ] 2. Add a resolver fixture with incapable first candidate, capable second, same-tier ties and no-requirement cases; explicit pin must still refuse (R3-R5).
- [ ] 3. Fix model override lifetime in the existing dispatch loop; thread existing capability requirements into the runtime role-selection walk and fresh reroll without changing fleet/tier helper policy (R1-R4).
- [ ] 4. Run targeted action/resolver/escalation/capability/tier suites inside packages/app, plus affected CLI agent tests and app/CLI typechecks. Use a fake runner public CLI probe, not real provider discovery (R5).
- [ ] 5. Update the owning contract if changed; run task-local gate, review and verify before done. Record exact routing pairs and negative admission evidence.

### Root Cause

A model inherited from a workflow executor pin becomes indistinguishable from an enduring caller override in AgentRunExecutor: explicitModel remains fixed while the escalation loop replaces the executor. Separately, stage requiresCapabilities reach the pre-spawn guard after role candidate selection, so selection and admission answer different questions. The pure shared tier helper intentionally has no stage-capability or doctor input and must stay process-free.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
