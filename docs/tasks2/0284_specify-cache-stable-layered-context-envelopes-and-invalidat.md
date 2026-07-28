---
template: brainstorm
schema_version: 1
name: "Specify cache-stable layered context envelopes and invalidation"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H5
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:cache", "context-envelope"]
dependencies: []
created_at: "2026-07-18T17:29:34.875Z"
updated_at: "2026-07-28T00:32:30.270Z"
---

## 0284. Specify cache-stable layered context envelopes and invalidation

### Background

Type: wayfinder:grilling. Turn the locked progressive-disclosure decision into an enforceable stage context contract. The envelope order is stable plugin/core contract, stable stage contract, compact project/task snapshot, required references, then dynamic user/tool material. The design must work across Claude Code and Codex, degrade honestly when hooks/provider cache telemetry are absent, and prevent stale reuse after state changes. It must distinguish provider prompt caching from Spur's own reuse of captured state. Inputs are the baseline, provider cache matrix, stage registry, indexed-context, and dogfood conservation rules.

### Requirements
R1. Define each envelope layer, canonical serialization/order, size budget, content hash, provenance, and cacheability classification.
R2. Define minimal project/task snapshot schemas and how they are obtained via targeted --json rather than full-file rereads.
R3. Specify invalidation triggers for corpus updates, git changes, config/model changes, skill/reference version changes, gate results, and tool outputs.
R4. Define reference routing/progressive disclosure so required safety and gate contracts cannot be omitted by a cheap model.
R5. Define session/subprocess boundaries and explicitly state what cannot be cached or shared across agent.run processes.
R6. Specify instrumentation that attributes fresh versus reused context without fabricating provider cache behavior.
R7. Provide representative envelopes for refine, implement, review, verify, and dogfood.
R8. Define deterministic stability and stale-context tests plus size/token guardrails.
### Acceptance Criteria
Scenario: R5 Layered context envelopes are cache-stable and safe
  Given repeated execution of the same canonical stage with only task-local state changed
  When the stage context is assembled
  Then stable policy and stage-contract layers precede volatile run and tool-output layers
  And each layer has an owner, content contract, version/fingerprint, size budget, invalidation rule, disclosure trigger, and redaction policy
  And unchanged layers are byte-stable or canonically stable across Claude Code and Codex adapters
  And stale or mismatched layers fail closed or refresh explicitly rather than being silently reused

Scenario: Progressive disclosure preserves quality gates
  Given a stage can begin with a smaller context envelope
  When additional evidence becomes necessary
  Then expansion is triggered by an objective condition recorded in telemetry
  And the expansion cannot hide requirements, gate failures, security constraints, or authoritative project instructions
  And the final verdict records which layers were disclosed
### Q&A
- Locked: context is layered and stage-scoped; stable policy and contracts must not be rebuilt from volatile task/tool output on every dispatch.
- Locked: progressive disclosure optimizes fresh input but may not defer information required for safety, authorization, requirements traceability, or mutation gates.
- Locked: cache stability is a structural property; provider cache hits remain diagnostic evidence governed by ticket 0281.
- Question to resolve: which existing indexed-context artifacts are authoritative inputs, optional accelerators, or stale-risk caches?
- Question to resolve: what invalidates project, feature, task, stage, and run layers independently?
- Question to resolve: how can Claude Code command expansion and Codex skill loading produce equivalent canonical ordering despite host differences?
- Question to resolve: which tool results should be summarized, referenced, checkpointed, or discarded between stages?
### Design
Selected direction: define a canonical envelope as ordered typed layers: immutable harness policy; project authority; stage contract; feature/task requirements and decisions; indexed reusable evidence; current run state; and volatile tool observations. Each layer carries content hash, schema version, source revision, generated-at metadata where relevant, sensitivity, and invalidation dependencies.

Assembly must be deterministic for equal inputs. Stable layers are serialized before volatile layers; optional detail is referenced through disclosure handles with explicit triggers and budgets. The design must specify conflict precedence and stale detection, not merely token truncation.

Rejected directions: one monolithic prompt; time-based cache assumptions without fingerprints; blind summarization of authoritative requirements; or a shared global memory layer with unclear ownership.
### Plan
1. Consume baseline context-flow data and provider cache semantics.
2. Classify every current input by authority, stability, sensitivity, scope, and invalidator.
3. Define envelope schema, canonical ordering/serialization, fingerprints, size budgets, and required-versus-optional semantics.
4. Specify disclosure triggers and how a stage records expansions, misses, stale refreshes, and token impact.
5. Walk representative plan, run, verify, next, and dogfood paths on both Claude Code and Codex adapters.
6. Define conformance tests for byte/canonical stability, invalidation precision, precedence, redaction, and no-loss traceability.
7. Hand implementation slices and unresolved host limitations to migration and synthesis.
### Solution
Resolution completed as a specification deliverable. The WBS-specific artifact is the `## 0284` section at `.spur/run/wayfinder-O/implementation-evidence.md:188`, which defines the canonical ordered envelope as stable-first then volatile typed layers: harness policy, project authority, stage contract, feature/task state, indexed evidence, run state, volatile tool observations [R1: implementation-evidence.md:190]. Per-layer metadata covers owner, schema version, content hash, source revision, sensitivity/redaction, size budget, invalidation dependencies, and stable-prefix-eligible vs volatile cacheability [R1: implementation-evidence.md:190]. Project/task snapshots are obtained via targeted `--json` verbs, never full-file rereads [R2: implementation-evidence.md:192]. Invalidation is per-layer and fingerprint-driven across corpus, git, config/model, skill/reference, gate-result, and tool-output dimensions [R3: implementation-evidence.md:192]. Progressive disclosure routes optional references through handles with triggers and budgets while keeping safety, authorization, traceability, and mutation-gate layers mandatory inline [R4: implementation-evidence.md:192]. Inline stages may reuse captured stable layers within one dispatch; subprocess (`spur agent run`) stages start a fresh process and may only cross the boundary via fingerprinted on-disk artifacts [R5: implementation-evidence.md:194]. Instrumentation attributes fresh vs reused Spur layers by content-hash comparison and labels provider cache dimensions only from verified raw usage, never fabricating host cache hits [R6: implementation-evidence.md:194]. Representative envelopes for refine, implement, review, verify, and dogfood are assembled from the stage registry record [R7: implementation-evidence.md:194]. Conformance tests cover byte/canonical stability, invalidation precision, no-loss traceability, and size/token guardrails that fail closed [R8: implementation-evidence.md:194]. Inputs consumed: the task contract, Feature O, baseline 0280, provider semantics 0281, stage registry 0282, and `config/workflows/wayfinder-resolution.yaml`. No plugin runtime implementation is required for this research/specification ticket; the artifact is the implementation-ready handoff to the synthesized build backlog (0291).
### Testing
**Per-Requirement Traceability**

| Req | Requirement | Evidence |
|-----|-------------|----------|
| R1 | Define each envelope layer, canonical serialization/order, size budget, content hash, provenance, and cacheability classification | implementation-evidence.md:190 |
| R2 | Define minimal project/task snapshot schemas obtained via targeted `--json` rather than full-file rereads | implementation-evidence.md:192 |
| R3 | Specify invalidation triggers for corpus updates, git changes, config/model changes, skill/reference version changes, gate results, and tool outputs | implementation-evidence.md:192 |
| R4 | Define reference routing/progressive disclosure so required safety and gate contracts cannot be omitted by a cheap model | implementation-evidence.md:192 |
| R5 | Define session/subprocess boundaries and what cannot be cached or shared across `agent.run` processes | implementation-evidence.md:194 |
| R6 | Specify instrumentation that attributes fresh versus reused context without fabricating provider cache behavior | implementation-evidence.md:194 |
| R7 | Provide representative envelopes for refine, implement, review, verify, and dogfood | implementation-evidence.md:194 |
| R8 | Define deterministic stability and stale-context tests plus size/token guardrails | implementation-evidence.md:194 |

**Acceptance Criteria Verification**

| Scenario | Verdict | Evidence |
|----------|---------|----------|
| R5 Layered context envelopes are cache-stable and safe | PASS | Stable policy and stage-contract layers precede volatile run and tool-output layers (R1: implementation-evidence.md:190); each layer carries owner, schema version, content hash, source revision, sensitivity/redaction, size budget, invalidation dependencies, and cacheability (R1: implementation-evidence.md:190); byte/canonical stability across Claude Code and Codex adapters asserted by the stability conformance test (R8: implementation-evidence.md:194); stale or mismatched layers fail closed - assembly fails closed when the required-layer budget is exceeded and invalidation is fingerprint-driven per-layer (R3: implementation-evidence.md:192, R8: implementation-evidence.md:194) |
| Progressive disclosure preserves quality gates | PASS | Expansion routes optional references through disclosure handles with triggers and budgets, but safety, authorization, requirements-traceability, and mutation-gate contracts are mandatory inline layers that cannot be deferred or omitted by a cheap model (R4: implementation-evidence.md:192); no-loss traceability conformance test asserts required safety/gate/requirements layers survive any disclosure expansion (R8: implementation-evidence.md:194); fresh-vs-reused attribution is recorded via content-hash comparison instrumentation (R6: implementation-evidence.md:194) |

Coverage: N/A (specification task)
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog (0291). |
| P2 | Provider/platform cache telemetry may remain unavailable for some instrumentation fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | Inline-vs-subprocess boundary and on-disk-artifact-only crossing rule is a contract implementation must enforce, not infer. | Track through WBS 0290/0291 and the implementation backlog. |
| P4 | Canonical-serialization parity across Claude Code and Codex adapters depends on host-controlled prompt assembly (ticket 0281 LOW-confidence). | Recheck authoritative docs and adapter behavior during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact at `.spur/run/wayfinder-O/implementation-evidence.md:188` provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
### References
- `plugins/sp/skills/sp-indexed-context/` and related hook/config files
- `.spur/context/` anatomy, learnings, pitfalls, buglog, memory, and token ledger contracts
- Project `AGENTS.md` authority and harness routing contract
- Tickets 0280 baseline, 0281 provider semantics, and 0282 stage registry
- Tickets 0285 routing, 0287 dogfood campaigns, and 0289 migration
- Feature O scenarios R1, R2, R3, R5, R6, R8, R10, and R12
### History
- 2026-07-18T18:24:07.409Z todo → done (system)
- 2026-07-18T18:27:40.387Z done → todo (system)
- 2026-07-18T18:35:15.744Z todo → done (system)
- 2026-07-18T18:37:50.637Z done → todo (system)
- 2026-07-19T23:52:14.403Z todo → wip (system)
- 2026-07-19T23:52:16.942Z wip → testing (system)
- 2026-07-19T23:52:19.488Z testing → done (system)
