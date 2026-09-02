---
schema_version: 1
name: "Classify shipped workflows by fit and select surrounding pilots"
status: todo
template: meta
created_at: 2026-09-02T03:05:58.076Z
updated_at: "2026-09-02T03:56:59.026Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "fit", "pilot"]
dependencies: ["0729", "0730"]
---

## 0731. Classify shipped workflows by fit and select surrounding pilots

### Background

D8 follows the operator's surrounding-workflows-first rule. Audit the full shipped workflow inventory against the existing replay + machine branch + durable record fit gate, actual callers, and observed usage before selecting any pilot. The canonical task pipeline is explicitly not the pilot.

### Requirements
- [ ] R1. Independently freeze all 11 repository workflow YAML files and separately inventory bundled, installed, and project-local definitions. Record source-local binary/importer, absolute resolved path/layer, definition digest, optional version state, and full validation result; do not equate `list.valid` or baseline membership with validity.
- [ ] R2. For every definition, identify actual callers and deployment role—canonical engine pipeline, lifecycle, orchestrator, example/fixture, or unused—and trace engine run/continue, prompt-level inline execution, lifecycle, and progress-projection paths where applicable.
- [ ] R3. Record graph facts: states, actions, deterministic/model hops, branches, loops/bounds, pauses, failure terminals, artifacts, composition findings, dry-run behavior, real-run frequency/outcomes, and known prerequisite defects. Unknown evidence stays unknown.
- [ ] R4. Apply the existing replay + machine branch + durable record fit gate and assign keep, simplify/optimize, demote-to-procedure/fixture, or retire with confidence. Identify duplicated orchestration, unconditional stages, redundant probes, overlarge bounds, ownership breaches, and inline-engine parity cost before proposing infrastructure.
- [ ] R5. Build a prerequisite table for each candidate. A workflow cannot be an executable pilot while it relies on an unrepaired timeout, confinement, proof/freshness, nested-run, validation/resolution, or continue defect; `feature-dev` remains ineligible while its nested review is impossible.
- [ ] R6. Rank one or two real-caller surrounding pilots by representativeness, reversibility, trace coverage, prerequisite readiness, and blast radius. Exclude `task-pipeline` and definitions without a proven caller from pilot selection.
- [ ] R7. Classify version only as `unversioned` or `explicit(<literal>)`, reflecting the current behavior-neutral optional string. Identify which eligible pilot can exercise both forms and the source/digest/resume implications; do not invent unsupported-version semantics or a registry.
- [ ] R8. Record the compact workflow matrix, dispositions, prerequisite table, and pilot recommendation in the Solution without changing production definitions or public CLI surfaces.
### Acceptance Criteria
- [ ] All 11 repository workflows and any shadowing bundled/installed/project-local definitions are accounted for independently of the composition baseline.
- [ ] Every workflow has an evidence-grounded caller/deployment role, fit verdict, target disposition, version state, and confidence; absent optional `version` is valid and reported as unversioned.
- [ ] Run and continue paths, configured and bundled resolution, inline execution, lifecycle, projection, and dry-run limits are represented where they affect a workflow.
- [ ] Deletion, retirement, or demotion opportunities are evaluated before optimization or new infrastructure.
- [ ] Each pilot has a closed prerequisite table and a proven real caller; no known-broken primitive is treated as safety or observability evidence.
- [ ] `feature-dev` is ineligible while nested review is impossible, no-caller definitions are not pilots, and `task-pipeline` is excluded.
- [ ] No production workflow or public CLI surface changes occur in this ticket.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Use a single sortable matrix sourced from explicit files, callers, validation, graph output, and traces. Apply the existing fit gate before scoring pilots, then subtract candidates with unresolved correctness prerequisites. Prefer retirement/demotion over making an unused definition more sophisticated.
### Plan
- [ ] Load 0729 and 0730 outputs and freeze all definition sources and callers.
- [ ] Validate each explicit file and extract graph, trace, execution-surface, and version facts.
- [ ] Apply deployment-role and fit dispositions, including retire/demote candidates.
- [ ] Attach correctness prerequisites and exclude ineligible/no-caller candidates.
- [ ] Rank one or two surrounding pilots and record the compact matrix and recommendation.
### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `config/workflows/`; `apps/cli/config/workflows/`; `.spur/workflows/` when present.
- `config/workflow-composition-baseline.json`; `packages/app/src/workflow/composition-baseline.ts`.
- `packages/app/src/services/workflow-service.ts`; `packages/app/src/workflow/lifecycle-adapter.ts`; `packages/app/src/workflow/progress-projection.ts`.
- `apps/cli/src/commands/workflow.ts`; `apps/cli/src/workflow/make-lifecycle-adapter.ts`.
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`; `plugins/sp/tests/inline-pipeline-driver.test.ts`.
- `docs/design/workflow-composition-contract.md`; `docs/design/workflow-observability.md`.
### History
