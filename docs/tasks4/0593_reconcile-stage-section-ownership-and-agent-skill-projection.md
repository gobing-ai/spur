---
template: feature-impl
schema_version: 1
name: "Reconcile stage section ownership and agent-skill projections with runtime contracts"
description: ""
status: todo
type: task
profile: standard
feature_id: F92
parent_wbs: null
priority: P2
tags: ["harness", "stage-registry", "skill-parity"]
dependencies: ["0591", "0592"]
ac_numbering: task-local
created_at: "2026-08-18T20:06:22.485Z"
updated_at: "2026-08-18T20:09:13.922Z"
---

## 0593. Reconcile stage section ownership and agent-skill projections with runtime contracts

### Background

Runtime section and verdict rules cannot stay centralized while portable agent instructions retain competing writers and static projections. Current section-batching tells an operation to stage Solution, Testing, and Review together; functional-review and super-reviewer both claim Review writes; spur-dev says record owns both Testing and Review although code preserves non-bare Review; spur-cli/spec-decomposition restate variant-blind status tables; and the canonical domain stage registry has empty verify gates while the plugin mirror independently declares richer artifacts and gates. This task runs after the two runtime-contract tasks and makes skills/registry checked projections rather than policy authorities.

### Requirements
- R1. Establish one writer per evidence section: implementation writes `Solution`; the review coordinator writes the combined `Review`; verification emits the canonical verdict artifact; deterministic record writes `Testing`. Component review skills return fragments and do not write `Review` in coordinated mode. If `TaskService.record` retains bare-Review backfill for standalone compatibility, label and test it as fallback-only and never overwrite authored Review.
- R2. Make runtime contracts authoritative and portable harness material a checked projection. Remove trio section-batching and static status/section tables; skills query `spur task sections <wbs> list --json` and `spur task check`. Reconcile spur-dev, code-implementation, functional-review, code-verification, super-reviewer, spec-decomposition, spur-cli task references, checklists, and workflow descriptions. Extend the existing canonical stage registry with the smallest exact artifact identity needed, populate shared stage artifacts/transition checks, and generate or fully parity-check the plugin mirror across artifacts, check identifiers/timing/minimum verdict, reasoning skill, and execution kind. Add contradiction/projection regression tests and run Superskill/plugin validation plus full Spur gates; do not hand-edit generated platform adapters.
### Acceptance Criteria
```gherkin
Feature: Harness projections of task contracts

  Scenario: R1 — Each pipeline stage has one task-section writer
    Given implementation, review, verification, and record stages
    When they produce task evidence
    Then implementation owns Solution, the review coordinator owns Review, and record owns Testing
    And component reviewers and verification do not overwrite another stage's section

  Scenario: R2 — Skills and registry are checked projections
    Given the runtime task and verdict contracts
    When plugin parity and documentation checks run
    Then stage artifacts, transition checks, and skill instructions match those contracts
    And stale static status-to-section tables are replaced by CLI queries or generated projections
```
### Q&A
- **Why this is separate from runtime changes:** skills and registry must project stable behavior. Updating them in the same task as moving runtime contracts makes drift review harder and obscures which source wins.
- **Who writes Review?** `super-reviewer` in coordinated/pipeline mode after combining component fragments. Direct component-skill use is advisory output unless it is explicitly acting as the coordinator.
- **Can record still backfill Review?** Only as a documented standalone compatibility fallback when Review is bare. It is not normal ownership and must never overwrite authored content. Removing it entirely is allowed if compatibility tests prove no supported path needs it.
- **Why use the stage registry:** it already models artifacts and transition checks. Adding another ownership file would create the third authority this feature is removing.
- **Generated mirror or parity test?** Prefer generation through an existing plugin bundle path. If portability prevents that with a small change, retain the mirror but compare complete shared stage contracts in CI, not only vocabulary arrays.
- **What prose remains allowed?** Explanations of responsibilities and commands. Mutable lists of section obligations, validation severities, or verdict aggregation rules must link/query the executable authority instead of restating it.
### Design
**Decision.** Runtime contracts remain in the section matrix, `TaskCheckService`, and canonical verdict code. The stage registry records exact artifacts/check identifiers for routing and parity; skills explain procedures and query runtime state. None may duplicate semantic matrices or aggregation rules.

**Writer map.**

| Stage | Output authority |
| --- | --- |
| implement | `Solution` plus worktree diff |
| review coordinator | combined `Review` |
| functional/SECUA/architecture component reviews | returned review fragments only |
| verify | canonical verdict artifact only |
| record | `Testing`; optional bare-Review compatibility backfill only if retained and explicitly tested |

**Registry approach.** Extend `StageArtifact` with one optional artifact identifier/name rather than introduce a new section-ownership schema. Canonical domain records list exact task-section outputs and executable check IDs. Because the plugin must run outside the monorepo, either generate its record data at bundle time or strengthen textual/fixture parity so divergence fails CI. Prefer generation if an existing bundle path can carry it; otherwise complete parity testing is acceptable.

**Rejected.** No third policy YAML, no skill-owned validation lists, no component reviewer file writes in coordinated mode, no direct task corpus edits, and no manual per-platform adapter updates.
### Plan
- [ ] Build a source-to-claim inventory of every skill/agent/workflow/stage record mentioning Solution, Testing, Review, strict-core, section timing, or verdict aggregation.
- [ ] Update canonical StageArtifact/registered stage records with exact artifact identities and gates from the completed runtime contracts.
- [ ] Generate or fully parity-check the portable plugin registry; add shared-stage artifact/gate parity tests.
- [ ] Make super-reviewer the only coordinated Review writer and component skills fragment-only; pin pipeline and standalone behavior.
- [ ] Rewrite section-batching and spur-dev ownership guidance; update code-verification, spec-decomposition, spur-cli task references, and gate checklists to query runtime state.
- [ ] Add contradiction/static-projection regression scans without duplicating runtime validation logic in tests.
- [ ] Run affected plugin tests and superskill lifecycle checks, then bun run autofix, spur-check, lint, test, test-cf, and build.
- [ ] Run sp:doc-evolve sync-check/contract-verify for docs and AGENTS entry-surface consistency.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Canonical stage schema/records: `packages/domain/src/stage-registry/schema.ts`
- Portable registry projection: `plugins/sp/scripts/stage-registry-adapter.ts`
- Existing parity tests: `plugins/sp/tests/stage-registry-parity.test.ts`
- Pipeline: `config/workflows/task-pipeline.yaml`
- Conflicting batching guidance: `plugins/sp/skills/spur-dev/references/section-batching.md`
- Coordinator: `plugins/sp/agents/super-reviewer.md`
- Component review: `plugins/sp/skills/functional-review/SKILL.md`; `plugins/sp/skills/code-verification/SKILL.md`; `plugins/sp/skills/code-improvement/SKILL.md`
- Spine/facade projections: `plugins/sp/skills/spur-dev/SKILL.md`; `plugins/sp/skills/spur-cli/references/tasks.md`; `plugins/sp/skills/spec-decomposition/references/decomposition.md`
- Runtime prerequisites: tasks 0591 and 0592
### History
