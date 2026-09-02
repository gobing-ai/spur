---
schema_version: 1
name: "Synthesize the task-ready workflow upgrade strategy"
status: todo
template: meta
created_at: 2026-09-02T03:05:58.141Z
updated_at: "2026-09-02T04:02:46.818Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "strategy", "handoff"]
dependencies: ["0732"]
---

## 0733. Synthesize the task-ready workflow upgrade strategy

### Background

D8 ends when the operator can approve a concrete workflow upgrade strategy without re-reading the investigation corpus. Synthesize the completed ADR, baseline, cost, fit, and prototype evidence into a small option set and a task-ready recommendation; do not create implementation tasks before the approval decision.

### Requirements
- [ ] R1. Produce two or three evidence-compatible strategy options with trade-offs, confidence, complexity, blast radius, affected ADRs, and a clear recommendation; deletion/demotion and stabilization-only must be considered before new routing machinery.
- [ ] R2. Include explicit matrices for workflow deployment role and keep/simplify/demote/retire disposition; mandatory/proportional/optional/remove gates; reference snapshot/temporary waiver/remove baseline semantics; and deterministic capability/script ownership.
- [ ] R3. Put a minimal stabilization slice before optimization: one shared definition load/resolve/preflight seam; one run/continue execution harness; correct config/default-kind/action options; exact source/digest resume binding; paused progress; safe path/run-id confinement; fail-closed proof/fresh artifacts; and repair/removal of impossible nested composition.
- [ ] R4. Define the target proportional-routing contract as a closed route table with an immutable safety floor, unknown-to-safety behavior, bounded observable reasons, exact proof, rollback, and budgets that are either evidence-backed or explicitly unestablished under 0730's sufficiency rule.
- [ ] R5. Decide whether each baseline and the prompt-level inline interpreter needs to exist. Any retained mechanism has a single owner, executable effect/parity check, lifecycle/removal criteria, maintenance budget, and no inert fields; otherwise remove or demote it.
- [ ] R6. Draft the ADR keep/amend/supersede/retire matrix, including ADR-102 and ADRs 094-100 derived-doc drift, plus authority-first updates for architecture, design, observability, composition, and surface governance. Do not mutate authority docs before approval.
- [ ] R7. Provide cohesive implementation slices in surrounding-workflow-first order with `task-pipeline` last. Each slice names dependencies, owner, changed surfaces, reproducing/regression/verification checks, rollback boundary, observability, and any public-surface consent gate.
- [ ] R8. Specify the minimal optional workflow-version contract for both dialects: behavior-neutral non-empty opaque string; absent=`unversioned`; present=`explicit(<literal>)`; empty-value diagnostic; source/digest/pause-resume propagation; bundled/project precedence; in-flight compatibility; rollout/rollback; and evidence required before a future-major mandate. Do not add a registry until behavior dispatch requires one.
- [ ] R9. Save a dated plan with a non-trivial Design Summary and self-review it for evidence links, placeholders, contradictions, scope creep, ambiguous handoff, and unproven controls. Record the operator's exact disposition: approval freezes the strategy and unlocks later implementation-task creation; rejection keeps D8 open with requested revisions.
### Acceptance Criteria
- [ ] The strategy is reviewable without loading predecessor task bodies, while every material claim links to its source task evidence.
- [ ] The recommendation prioritizes correctness and verified outcomes, then human attention, fresh premium tokens per verified PASS, wall-clock, and maintenance simplicity.
- [ ] No option treats timeout fields, proof bindings, baselines, composition snapshots, static query counts, or consolidated logs as effective controls without an executable test.
- [ ] Stabilization repairs one shared root-cause seam per cross-surface defect before proportional optimization or migration.
- [ ] Baseline and inline-interpreter recommendations explicitly choose keep/simplify/replace/remove and include effect/parity, lifecycle, observability, rollback, and sunset criteria.
- [ ] Implementation slices are executable after approval, expose dependencies and consent gates, start with surrounding workflows, and migrate `task-pipeline` last.
- [ ] The optional-first version contract preserves unversioned files, exposes literal plus digest, handles paused/in-flight runs, and defines objective evidence—not aspiration—for any future-major mandate.
- [ ] The dated plan has no placeholders or hidden operator decisions, and records approval/rejection consequences explicitly.
- [ ] Project/Workspace/Inbox/Teams consolidation, a second engine/DSL/version registry, production workflow mutation, and unapproved public CLI changes remain out of scope.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Treat the dated plan as the decision packet: compact evidence tables, two or three materially distinct options, one recommendation, a stabilization-first slice graph, and a hard operator-disposition gate. Reference predecessor evidence rather than copying it. Prefer deleting redundant workflow machinery over synchronizing multiple interpreters.
### Plan
- [ ] Load predecessor Solutions and resolve contradictory claims against their executable evidence.
- [ ] Generate and score two or three options, including deletion/demotion and stabilization-only.
- [ ] Write the stabilization prerequisites, proportional contract, matrices, and evidence-qualified budgets.
- [ ] Define optional-version propagation and future-major evidence threshold.
- [ ] Build surrounding-first implementation slices, ADR/doc map, rollback, and consent gates.
- [ ] Self-review the dated plan and record the operator's approval or requested revision.
### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Tasks 0729-0732 Solutions and Testing/Review evidence.
- `docs/00_ADR.md`; `docs/03_ARCHITECTURE.md`; `docs/04_DESIGN.md`; `docs/99_PROJECT_CONSTITUTION.md`.
- `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`; `docs/design/harness-surface-governance.md`.
- `config/workflows/`; `config/workflow-composition-baseline.json`; `config/corpus-baseline.json`; `config/plugin-scripts.json`.
- `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/`; `apps/cli/src/commands/workflow.ts`.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `scripts/commands/{real-run-cost,pipeline-budgets}.ts`.
### History
