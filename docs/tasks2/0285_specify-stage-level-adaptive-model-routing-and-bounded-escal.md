---
template: brainstorm
schema_version: 1
name: "Specify stage-level adaptive model routing and bounded escalation"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:model-routing", "reliability"]
dependencies: []
created_at: "2026-07-18T17:29:34.882Z"
updated_at: "2026-07-19T23:52:45.787Z"
---

## 0285. Specify stage-level adaptive model routing and bounded escalation

### Background

Type: wayfinder:grilling. Replace coarse prompt-regex phase routing with explicit stage-aware policy while preserving named executors, default-by-phase compatibility, fail-fast configuration errors, and explicit operator overrides. A stage starts with the cheapest qualified executor allowed by its policy; deterministic risk signals may select a stronger starting tier; machine-observable failures trigger bounded fallback. Model self-confidence is not an escalation signal. The result is a policy schema, selection algorithm, trigger matrix, and audit contract, not implementation.

### Requirements
R1. Define executor capability/tier metadata without hardcoding vendor price or assuming model-name ordering.
R2. Define per-stage eligibility, minimum capability, preferred chain, retry limits, timeout, and terminal failure behavior.
R3. Define objective risk signals including mutation breadth, security/data/schema impact, task complexity, historical stage failure, missing context, and irreversible action.
R4. Define escalation triggers: unavailable executor, non-zero/timeout, malformed schema/artifact, failed deterministic gate, missing evidence, PARTIAL/FAIL verdict, or exhausted repair budget.
R5. Define anti-loop and token-budget guards; retries/fallback count against total-token-per-PASS guardrails.
R6. Preserve explicit --agent/--model precedence and document interaction with default/default-by-phase.
R7. Define decision/audit events sufficient to reproduce why an executor was selected or escalated.
R8. Provide policies for at least planning, implement, test generation, review, verify, wrap/docs, and dogfood campaign stages.
### Acceptance Criteria
Scenario: R6 Adaptive model routing escalates objectively
  Given a stage contract, declared minimum capability, approved model pool, and current run evidence
  When a model route is selected
  Then the initial model is the least-capable qualified option under static eligibility rules
  And escalation occurs only on bounded objective signals such as schema failure, gate failure, retry exhaustion, unsupported capability, or verifier disagreement
  And each attempt records stage, model, reason, consumed tokens, result, and terminal verdict
  And no stage can self-certify eligibility or escalate from an unrecorded confidence claim

Scenario: Efficiency cannot buy a lower-quality PASS
  Given candidate routing policies are compared against the qualified reference path
  When results are evaluated
  Then requirements, SECUA, tests, and verification gates use the same thresholds
  And fresh/uncached input per verified PASS is the primary optimization metric
  And total input plus output tokens per PASS and retry/escalation waste do not regress beyond explicit budgets
### Q&A
- Locked: use static eligibility/minimum capability plus adaptive start/fallback based on objective signals; never route from model self-confidence.
- Locked: provider price is not part of qualification or the primary optimization metric.
- Locked: “cheaper model” means a replaceable portfolio choice after capability qualification, not a permanent model name in lifecycle logic.
- Locked: fallback is bounded and must not turn systematic cheap-model failure into hidden token waste.
- Question to resolve: which capabilities are stage-relevant and can be tested objectively: tool use, context capacity, structured output, code reasoning, source use, or mutation reliability?
- Question to resolve: when should verifier disagreement cause same-model retry, stronger-model escalation, human stop, or ticket failure?
- Question to resolve: how are model portfolio changes introduced without rewriting commands or invalidating historical comparisons?
### Design
Selected direction: registry stages reference a versioned routing policy, not model names. The policy has static eligibility constraints, an ordered qualified pool, attempt budgets, objective escalation triggers, terminal stop conditions, and required evidence. Model qualification results are external data with validity windows and corpus/version provenance.

Track both first-attempt success and terminal verified PASS. Attribute fresh input, output, retries, repair prompts, and escalations to stage/run so a low-cost first hop cannot mask greater total waste. Preserve a deterministic override for diagnosis and rollback.

Rejected directions: global default-by-phase regex as the final abstraction; cheapest-first regardless of qualification; price-based hardcoding; subjective confidence thresholds; or unlimited retries before escalation.
### Plan
1. Inventory existing model profiles, phase routing, executor settings, retry behavior, and observability gaps.
2. Derive stage capability requirements from the registry and concrete failure history.
3. Define routing-policy schema, qualification binding, objective signals, budgets, overrides, and stop states.
4. Specify event attribution and metric formulas for first-pass success, terminal PASS, fresh input, total tokens, and escalation waste.
5. Exercise policy examples across low-risk deterministic stages, ambiguous planning, code implementation, adversarial review, and verification.
6. Define shadow comparison, qualification expiry, portfolio update, and rollback behavior with tickets 0286 and 0289.
7. Produce implementation and test slices for synthesis only after the corpus contract is stable.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
**Per-Requirement Traceability**

| Requirement | Evidence |
|---|---|
| R1 | implementation-evidence.md:198 |
| R2 | implementation-evidence.md:198 |
| R3 | implementation-evidence.md:198 |
| R4 | implementation-evidence.md:198 |
| R5 | implementation-evidence.md:198 |
| R6 | implementation-evidence.md:198 |
| R7 | implementation-evidence.md:198 |
| R8 | implementation-evidence.md:198 |

**Acceptance Criteria Verification**

| Scenario | Verification | Evidence |
|---|---|---|
| R6 Adaptive model routing escalates objectively | Evidence section specifies static eligibility, qualified model pool, bounded objective escalation triggers, attempt budgets, terminal stops, and override; events attribute model, stage, retries, escalation, fresh input, output, and verdict. No self-certification of eligibility is expressible in the policy. | implementation-evidence.md:198 |
| Efficiency cannot buy a lower-quality PASS | Evidence section specifies outcome-equivalence qualification with price as a non-primary metric and per-attempt event attribution of fresh input, output, and verdict. | implementation-evidence.md:198 |

Coverage: N/A (specification task)
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
### References
- Existing Spur model profile and executor configuration
- Current command-phase model routing implementation and tests
- Ticket 0281 provider telemetry semantics
- Ticket 0282 stage contracts and ticket 0284 context envelopes
- Ticket 0286 qualification corpus and ticket 0289 shadow rollout
- Feature O scenarios R2, R3, R5, R6, R7, R10, and R12
### History
- 2026-07-18T18:24:07.506Z todo → done (system)
- 2026-07-18T18:27:40.487Z done → todo (system)
- 2026-07-18T18:35:15.842Z todo → done (system)
- 2026-07-18T18:37:50.748Z done → todo (system)
- 2026-07-19T23:52:40.690Z todo → wip (system)
- 2026-07-19T23:52:43.233Z wip → testing (system)
- 2026-07-19T23:52:45.787Z testing → done (system)
