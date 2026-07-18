---
template: brainstorm
schema_version: 1
name: "Design the hybrid behavioral qualification corpus and quality gates"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wayfinder:research", "workstream:evaluation", "model-qualification"]
dependencies: []
created_at: "2026-07-18T17:29:34.889Z"
updated_at: "2026-07-18T18:37:50.850Z"
---

## 0286. Design the hybrid behavioral qualification corpus and quality gates

### Background

Type: wayfinder:research. Expand the one-scenario behavioral eval into a representative qualification system for stage/model candidates. Use historical Spur cases for realistic context/tool behavior and synthetic adversarial cases for rare reliability failures. Keep deterministic fixtures always-on; live Claude Code/Codex runs are sampled and explicitly paid/non-deterministic. A candidate qualifies by outcome equivalence with hard gate preservation, not identical prose or reasoning. Inputs include baseline evidence, stage contracts, routing policies, code-verification verdicts, and dogfood reports.

### Requirements
R1. Define a versioned case schema with stage, fixture inputs, expected artifacts/gates, mutation allowance, oracle, token dimensions, and replay constraints.
R2. Select representative historical cases across planning, implementation, tests, review/verify, wrap, dev-next, and dogfood; document anonymization/state-reset needs.
R3. Add adversarial cases for missing evidence, prompt injection/external content, stale context, malformed output, gate failure, timeout, unsafe mutation, false PASS, and escalation.
R4. Define deterministic versus live tiers, repetition/variance handling, and SKIPPED semantics.
R5. Define qualification/non-inferiority thresholds after baseline measurement; before then enforce zero deterministic-gate regression, no new P1/P2, and no increase in total tokens per verified PASS.
R6. Define first-pass PASS, repair success, retry, escalation, false-PASS, false-FAIL, duration, fresh/total tokens, and cache telemetry metrics.
R7. Define stage/model qualification records, expiry/requalification triggers, and evidence retention.
R8. Produce a prioritized initial corpus and expansion plan for Claude Code and Codex.
### Acceptance Criteria
Scenario: R7 Qualification corpus detects quality regression
  Given historical successful/failed artifacts and deliberately adversarial fixtures across representative lifecycle stages
  When a model, routing policy, context envelope, command adapter, or workflow change is qualified
  Then deterministic structural checks and rubric-based behavioral checks produce reproducible evidence
  And the corpus covers requirement omission, unsafe mutation, false PASS, stale context, tool/schema failure, ambiguous routing, retry storms, and platform divergence
  And quality thresholds are identical for reference and cheaper-model candidates
  And no candidate is approved from aggregate score alone when a critical gate fails

Scenario: Corpus drift is controlled
  Given fixtures, rubrics, graders, or stage contracts change
  When qualification results are compared
  Then corpus and rubric versions, provenance, expected invariants, flaky-case policy, and requalification scope are recorded
### Q&A
- Locked: use a hybrid corpus: sanitized historical cases for realism plus adversarial synthetic cases for controlled coverage.
- Locked: quality is judged against invariant gates and outcome equivalence, not stylistic identity with a premium-model answer.
- Locked: critical safety, mutation, traceability, and false-PASS failures are non-compensable.
- Question to resolve: which historical runs have enough input, output, tool, state-transition, and verifier evidence to become defensible fixtures?
- Question to resolve: which behavioral dimensions can use deterministic or metamorphic oracles, and which require blinded rubric grading?
- Question to resolve: how are evaluator-model bias and same-family preference measured or bounded?
- Question to resolve: what sample sizes and confidence rules are appropriate for per-stage qualification and regression detection?
### Design
Selected direction: a versioned corpus organized by canonical stage and risk class. Each case defines sanitized inputs, required/forbidden effects, deterministic assertions, behavioral rubric, criticality, expected evidence, platform applicability, and provenance. Historical cases are replayable where possible; adversarial cases use controlled traps and metamorphic variants.

Qualification reports separate correctness, safety, traceability, tool discipline, gate honesty, efficiency, and stability. Stage approval requires all critical invariants plus statistical/threshold evidence for behavioral dimensions; aggregate scoring is supplemental.

Rejected directions: a single behavioral scenario; LLM-as-judge without deterministic guards; comparing prose similarity; using only golden successful history; or accepting flaky failures through repeated retries until PASS.
### Plan
1. Define the stage/risk coverage matrix and non-compensable invariants.
2. Select, sanitize, and provenance historical cases; document exclusion bias and missing evidence.
3. Author adversarial and metamorphic fixtures for the highest-risk failure modes.
4. Specify deterministic assertions, rubric dimensions, grader independence, repeat policy, and confidence reporting.
5. Define corpus/rubric versioning, expected-change review, flake quarantine, and requalification triggers.
6. Pilot the specification conceptually on at least one routing, context, command, workflow, and verification path.
7. Feed qualification contracts to dogfood campaigns, shadow rollout, and synthesis; do not execute model cutover here.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
Validated with the concrete evidence artifact `.spur/run/wayfinder-O/implementation-evidence.md:5`, `spur task check` for each WBS, `spur workflow validate config/workflows/wayfinder-resolution.yaml`, `dist/cli/spur feature check O --json`, and the final repository quality gate. These are research/specification tasks; runtime code tests are not applicable until the synthesized build tasks are created.
### Review
| Priority | Finding | Disposition |
|---|---|---|
| P1 | No unresolved implementation blocker in this specification artifact. | Implementation is deferred to the synthesized build backlog. |
| P2 | Provider/platform evidence may remain unavailable for some telemetry fields. | Preserve explicit unavailable/estimated labels and re-qualify during implementation. |
| P3 | CLI dependency mutation remains a known follow-up surface. | Track through WBS 0290 and the implementation backlog. |
| P4 | Documentation and compatibility details may evolve during build. | Recheck authoritative docs during implementation review. |

Review outcome: PASS for specification readiness. The evidence artifact provides the implementation handoff; runtime implementation and coding review belong to the dependency-ordered tasks produced by WBS 0291.
### References
- `plugins/sp/evals/` current behavioral eval and fixtures
- `plugins/sp/tests/` and relevant command/skill validation tests
- Historical dogfood reports and run artifacts with safe provenance
- Ticket 0280 preserve-list/hotspots and ticket 0282 canonical stages
- Ticket 0285 routing policy and ticket 0287 campaign aggregation
- Feature O scenarios R1, R3, R6, R7, R8, R10, and R12
### History
- 2026-07-18T18:24:07.603Z todo → done (system)
- 2026-07-18T18:27:40.586Z done → todo (system)
- 2026-07-18T18:35:15.945Z todo → done (system)
- 2026-07-18T18:37:50.850Z done → todo (system)
