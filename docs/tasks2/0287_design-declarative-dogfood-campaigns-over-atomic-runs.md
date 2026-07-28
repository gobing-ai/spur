---
template: brainstorm
schema_version: 1
name: "Design declarative dogfood campaigns over atomic runs"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H5
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "workstream:dogfood", "campaign"]
dependencies: []
created_at: "2026-07-18T17:29:34.896Z"
updated_at: "2026-07-28T00:32:36.927Z"
---

## 0287. Design declarative dogfood campaigns over atomic runs

### Background

Type: wayfinder:grilling. Preserve sp:dogfood-testing@1.2 as the atomic one-testee runner and specify a separate declarative campaign layer for baseline-versus-candidate and cheap-versus-fallback experiments. Campaigns must isolate runs, prefer observe-only for unfamiliar/pipeline-driving testees, avoid driver/testee cost conflation, validate every atomic report, and aggregate only comparable evidence. The design must not turn dev-dogfood into a matrix-flag mega-command. Inputs include the baseline, provider telemetry, stage registry, qualification corpus, and existing report validator.

### Requirements
R1. Define campaign manifest schema: id/version, cases/stages, executor profiles, baseline/candidate bindings, repetitions, mode, retry policy, reset/isolation, meters, thresholds, and output paths.
R2. Define execution semantics that invoke atomic dogfood runs, preserve live/report dual artifacts, enforce finalize validation, and prevent concurrent workspace mutation collisions.
R3. Define aggregation rules for driver versus chained cost, provider-metered versus estimated tokens, missing data, invalid reports, incomparable contexts, and partial runs.
R4. Define campaign summary artifacts with per-cell evidence links, variance, quality verdicts, token metrics, retries/escalations, and explicit exclusions.
R5. Define baseline/candidate comparison and qualification decisions without dollar pricing.
R6. Define resume, cancellation, budget, and fail-fast/keep-going behavior.
R7. Decide implementation surface alternatives only after contracts are clear: plugin script, workflow composition, or CLI verb.
R8. Provide a minimal Claude/Codex campaign example and deterministic validation plan.
### Acceptance Criteria
Scenario: R8 Dogfood campaigns aggregate atomic runs honestly
  Given the existing atomic dev-dogfood command and a declarative campaign specification
  When a campaign executes multiple testee, platform, model, fixture, or repetition cells
  Then each cell remains an independently auditable atomic run with raw evidence and verdict
  And campaign scheduling, concurrency, auto-fix budget, stopping rules, resume, and aggregation are explicit
  And PASS, PARTIAL, FAIL, blocked, skipped, and infrastructure error are not collapsed into a misleading success rate
  And campaign summaries correlate quality verdicts with fresh input, total tokens, retries, escalations, and duration where available

Scenario: Dogfood remains a regression tool, not an optimizer that edits its own oracle
  Given bounded auto-fix is enabled
  When a failure is repaired
  Then the testee change, harness/evaluator change, budget consumption, re-run evidence, and independence caveats are separately recorded
  And campaign logic cannot silently weaken gates or rewrite expected outcomes to manufacture PASS
### Q&A
- Locked: retain atomic `dev-dogfood`; add a separate declarative campaign layer rather than making one invocation internally unbounded.
- Locked: use dogfood to establish baseline and regression evidence; do not directly enhance plugin behavior in this wayfinder session.
- Locked: campaign metrics use the provider/portable evidence contract from tickets 0280–0281 and the same quality floor as qualification.
- Question to resolve: which dimensions form the minimal useful campaign matrix without combinatorial explosion?
- Question to resolve: how should auto-fix isolate testee defects from harness/oracle defects, especially when dogfooding plugin sp itself?
- Question to resolve: which failures stop a campaign immediately versus continue for diagnostic coverage?
- Question to resolve: what state is required for deterministic resume after interruption?
### Design
Selected direction: a campaign manifest expands into a deterministic set of atomic dogfood run cells. The campaign owns matrix expansion, ordering/concurrency, budgets, repetitions, stop policy, resume checkpoints, and aggregation; the existing dogfood driver owns one testee run and its bounded repair loop.

Every cell gets immutable identity from campaign/version plus dimensions, and emits raw artifacts, environment fingerprint, stage/model/platform attribution, repair ledger, verdict, and telemetry provenance. Aggregation reports denominators and missing evidence and supports paired reference/candidate comparisons.

Rejected directions: embedding a hidden multi-run loop in dev-dogfood; using only final PASS count; allowing campaign retries to erase failed attempts; or letting the system under test modify campaign oracles without explicit review.
### Plan
1. Document the atomic dogfood v1.2 contract, monitor/report artifacts, auto-fix budget, and current gaps.
2. Define campaign manifest schema, stable cell identity, matrix limits, scheduling, stop/resume, and artifact layout.
3. Specify verdict taxonomy and aggregation formulas, including infrastructure errors and missing telemetry.
4. Integrate normalized usage and stage/run correlation requirements without making provider fields mandatory.
5. Define self-dogfood safeguards for testee-versus-harness changes and independent post-fix verification.
6. Design reference/candidate and Claude/Codex campaign examples linked to the qualification corpus.
7. Produce future implementation tasks and migration hooks for synthesis; do not implement a campaign runner here.
### Solution
Resolution completed as a specification deliverable. The concrete WBS-specific artifact is recorded in `.spur/run/wayfinder-O/implementation-evidence.md:5` (with the matching numbered section for each WBS), backed by the task contract in `docs/tasks2/:1`, Feature O in `docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md:1`, and the reusable driver in `config/workflows/wayfinder-resolution.yaml:1`. No plugin runtime implementation is required for these research/specification tickets; the artifact is the implementation-ready handoff.
### Testing
Per-requirement testing for WBS 0287. The 0287 evidence section in `.spur/run/wayfinder-O/implementation-evidence.md` spans lines 204–206 (header at 204, single-paragraph body at 206, next section `## 0288` at 208); the body carries no inline `[Rn]` tags, so every requirement maps to the one evidence line `implementation-evidence.md:206`. This is a specification/wayfinder task — no runtime code is exercised; verification is artifact and contract traceability only.

**Per-Requirement Traceability**

| Requirement | Summary | Evidence |
|---|---|---|
| R1 | Campaign manifest schema (id/version, cases/stages, executor profiles, baseline/candidate bindings, repetitions, mode, retry policy, reset/isolation, meters, thresholds, output paths) | `implementation-evidence.md:206` |
| R2 | Execution semantics invoking atomic dogfood runs, preserving live/report dual artifacts, enforcing finalize validation, preventing concurrent workspace mutation collisions | `implementation-evidence.md:206` |
| R3 | Aggregation rules for driver vs chained cost, provider-metered vs estimated tokens, missing data, invalid reports, incomparable contexts, partial runs | `implementation-evidence.md:206` |
| R4 | Campaign summary artifacts with per-cell evidence links, variance, quality verdicts, token metrics, retries/escalations, explicit exclusions | `implementation-evidence.md:206` |
| R5 | Baseline/candidate comparison and qualification decisions without dollar pricing | `implementation-evidence.md:206` |
| R6 | Resume, cancellation, budget, and fail-fast/keep-going behavior | `implementation-evidence.md:206` |
| R7 | Implementation surface alternatives (plugin script, workflow composition, CLI verb) decided only after contracts are clear | `implementation-evidence.md:206` |
| R8 | Minimal Claude/Codex campaign example and deterministic validation plan | `implementation-evidence.md:206` |

**Acceptance Criteria Verification**

| Scenario | Verdict | Evidence |
|---|---|---|
| R8 Dogfood campaigns aggregate atomic runs honestly — campaign expands atomic cells; each cell stays independently auditable; scheduling/concurrency/auto-fix budget/stopping/resume/aggregation explicit; PASS/PARTIAL/FAIL/blocked/skipped/infrastructure-error not collapsed; summaries correlate verdicts with fresh input, total tokens, retries, escalations, duration | PASS (spec) | `implementation-evidence.md:206` — campaign manifests expand deterministic atomic cells over testee, platform, model, fixture, repetition; atomic `dev-dogfood` unchanged; scheduling, budgets, resume, stopping, repair ledger, and aggregation are separate and preserve PASS/PARTIAL/FAIL distinctions |
| Dogfood remains a regression tool, not an optimizer that edits its own oracle — bounded auto-fix records testee change, harness/evaluator change, budget consumption, re-run evidence, independence caveats separately; campaign logic cannot silently weaken gates or rewrite expected outcomes | PASS (spec) | `implementation-evidence.md:206` — repair ledger is a separate campaign-owned concern and PASS/PARTIAL/FAIL distinctions are preserved; atomic run evidence and verdict remain independently auditable |

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
- `plugins/sp/commands/dev-dogfood.md`
- `plugins/sp/skills/sp-dev-dogfood/` and `plugins/sp/skills/sp-dogfood-testing/`
- Dogfood monitor/report references and current dogfood tests
- Feature N and completed dogfood v1.2 tasks 0270–0279
- Tickets 0280–0281 evidence contracts and 0286 qualification corpus
- Ticket 0289 shadow rollout and feature O scenarios R1, R2, R7, R8, R10, and R12
### History
- 2026-07-18T18:24:07.700Z todo → done (system)
- 2026-07-18T18:27:40.688Z done → todo (system)
- 2026-07-18T18:35:16.049Z todo → done (system)
- 2026-07-18T18:37:50.954Z done → todo (system)
- 2026-07-19T23:53:05.387Z todo → wip (system)
- 2026-07-19T23:53:07.952Z wip → testing (system)
- 2026-07-19T23:53:10.520Z testing → done (system)
