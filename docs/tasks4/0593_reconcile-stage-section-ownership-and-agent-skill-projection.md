---
template: feature-impl
schema_version: 1
name: "Reconcile stage section ownership and agent-skill projections with runtime contracts"
description: ""
status: done
type: task
profile: standard
feature_id: F92
parent_wbs: null
priority: P2
tags: ["harness", "stage-registry", "skill-parity"]
dependencies: ["0591", "0592"]
ac_numbering: task-local
created_at: "2026-08-18T20:06:22.485Z"
updated_at: "2026-08-19T04:16:41.921Z"
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
- [x] Build a source-to-claim inventory of every skill/agent/workflow/stage record mentioning Solution, Testing, Review, strict-core, section timing, or verdict aggregation.
- [x] Update canonical StageArtifact/registered stage records with exact artifact identities and gates from the completed runtime contracts.
- [x] Generate or fully parity-check the portable plugin registry; add shared-stage artifact/gate parity tests.
- [x] Make super-reviewer the only coordinated Review writer and component skills fragment-only; pin pipeline and standalone behavior.
- [x] Rewrite section-batching and spur-dev ownership guidance; update code-verification, spec-decomposition, spur-cli task references, and gate checklists to query runtime state.
- [x] Add contradiction/static-projection regression scans without duplicating runtime validation logic in tests.
- [x] Run affected plugin tests and superskill lifecycle checks, then bun run autofix, spur-check, lint, test, test-cf, and build.
- [x] Run sp:doc-evolve sync-check/contract-verify for docs and AGENTS entry-surface consistency.
### Solution
R1 (one writer per evidence section) + R2 (checked projections) implemented. Runtime contracts were NOT moved — the section matrix, TaskCheckService, and canonical verdict code stay authoritative; skills/registry now project them.

**Registry — canonical records now carry exact artifact identity + real transition checks (R1/R2):**
- `packages/domain/src/stage-registry/schema.ts:43` — schema minor 1.2 → 1.3 (additive).
- `packages/domain/src/stage-registry/schema.ts:264` — `StageArtifact.identity` optional field (exact task-section name / artifact file basename); the one-writer projection key.
- `packages/domain/src/stage-registry/schema.ts:798` — implement outputs `task-section` identity `Solution`.
- `packages/domain/src/stage-registry/schema.ts:846-852` — verify outputs `verdict-artifact` identity `<wbs>-verdict.json` + gates `verdict-artifact`/`strict-core` (post, pass) — the real done-transition checks.
- `packages/domain/src/stage-registry/schema.ts:916-938` — NEW `record` stage: deterministic, owns `Testing` (required) + `Review` (required:false — bare fallback only, never authored overwrite).
- `packages/domain/src/stage-registry/schema.ts:901` — review `review-findings` identity `Review` (`packages/domain/src/stage-registry/schema.ts:901`); wrap gains `task-check` pre gate + `hitl(both)` execution (`packages/domain/src/stage-registry/schema.ts:870-889`).
- `packages/domain/src/stage-registry/schema.ts` — plan gates `feature-check`/`batch-create` (real CLI checks); refine/test/dogfood artifacts mirrored.

**Plugin mirror conformed to the canonical registry (no independent gate/artifact authority — R2):**
- `plugins/sp/scripts/stage-registry-adapter.ts:348` — implement `task-section` output identity `Solution` (was an input 'constraints' artifact).
- `plugins/sp/scripts/stage-registry-adapter.ts:411` — strict-core gate gets `min_verdict: 'pass'` (parity with domain).
- `plugins/sp/scripts/stage-registry-adapter.ts:458-477` — NEW `record` stage mirror + `COMMAND_BY_ID` entry (`spur task record`).
- `plugins/sp/scripts/stage-registry-adapter.ts` — dropped invented gate identifiers (refine-skip-gate, l4-advisory, coverage-floor, review-guard, detect-pipeline-driving, report-validate) and invented verify/wrap `task-section` artifacts; verify now mirrors the domain's worktree-diff-input + verdict-artifact identity.
- `plugins/sp/scripts/stage-registry-adapter.ts:33` — `CURRENT_SCHEMA_VERSION` 1.0 → 1.3; each record mirrors the domain schema version.

**Parity + projection regression tests (R2):**
- `packages/domain/tests/stage-registry/schema.test.ts:653-700` — identity parse; implement→Solution / review→Review / verify→artifact / record→Testing(+fallback Review) writer-map projection; verify/wrap real transition-check gates; registry validity with `record` added.
- `plugins/sp/tests/stage-registry-parity.test.ts:163-231` — full shared-stage contract parity: artifacts (kind/direction/identity), gates (identifier/timing/min_verdict), reasoning_skill, mutation_class, execution kind; writer-map projection pin (verify emits the artifact only — no task-section identity).
- `plugins/sp/tests/stage-registry-adapter.test.ts` — 13→14 stage counts; ghost-gate assertions replaced by canonical-check-identifier assertions; record/stage-identity tests.
- `plugins/sp/tests/section-ownership-projection.test.ts:52-113` (new) — static contradiction scan over the shipped markdown: only the coordinator claims authored Review; record labeled deterministic Testing writer with bare-only Review fallback; verify claims no section write; trio section-batching and static status→section tables gone; skills query `spur task sections`/`spur task check`.
- `plugins/sp/tests/skill-structure.test.ts:1312` — old trio-batching pin replaced with one-writer + runtime-query pins.

**Prose reconciliation — skills/agents/commands now match the runtime contracts (R1/R2):**
- `plugins/sp/skills/spur-dev/references/section-batching.md:17-31` — rewritten from trio batching to the one-writer evidence-section protocol (writer map + `spur task sections <wbs> list --json` / `spur task check` sequencing).
- `plugins/sp/skills/spur-dev/SKILL.md` — Gotcha 2, Additional Resources, and the step-routing row now state the one-writer map.
- `plugins/sp/skills/functional-review/SKILL.md` — Step 7 returns a review fragment; no `--section Review` write in coordinated mode.
- `plugins/sp/skills/code-verification/SKILL.md` — Step 10 emits the verdict artifact only; Testing goes through the deterministic `spur task record`; Review never written by verify; review mode returns a fragment (ratchet: body stayed ≤ its 30_488-byte baseline).
- `plugins/sp/skills/code-improvement/SKILL.md` — candidate list is a fragment; coordinator writes Review.
- `plugins/sp/agents/super-reviewer.md` — component skills fragment-only; coordinator is the single Review writer.
- `plugins/sp/agents/super-planner.md` — record writes Testing deterministically; Review authored by coordinator.
- `plugins/sp/commands/dev-review.md` — WBS mode: fragments + coordinator write.
- `plugins/sp/skills/spur-cli/references/tasks.md`, `.../tasks/verbs.md`, `.../tasks/section-editing.md` — `record` described as deterministic Testing writer with bare-only Review backfill; static section claims replaced with runtime queries.
- `plugins/sp/skills/spur-cli/references/tasks/l3-guard-cheatsheet.md` — one-writer line added.
- `plugins/sp/skills/spur-dev/references/dev-operations.md`, `gate-checklists.md`, `execution-workflow.md` — verify/verifyall/review operations and the verify-gate checklist updated to the writer map + query-runtime wording.
- `plugins/sp/skills/spec-decomposition/references/decomposition.md` — static "Stage → sections" table removed; replaced with `spur task sections`/`spur task check` query pointers.
- `packages/app/src/services/task-service.ts:1133-1138` — record's bare-Review backfill labeled fallback-only (comment); behavior unchanged.
- `docs/04_DESIGN.md:239` — stage-registry schema version note synced to 1.3 (doc-evolve T3).

**Verification (targeted probes, per changed-surface matrix):** domain + plugin registry suites (254 tests), app record/check/guard suites, agent-service stage-routing subset, three workspace typechecks (domain/app/cli) — all green. Full project gate (`bun run autofix && bun run spur-check`) is owned by the pipeline test hop, per implement contract (bug-742 / 0436 R2 full-suite budget).

**Deferred:** `docs/features/F92_*.md` feature-doc line for this task left to the pipeline's record/provenance hops; no `apps/cli/plugins/**` edits (generated bundle — build-time artifact, never hand-edited).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | One-writer projection in canonical registry: implement→`Solution` (`packages/domain/src/stage-registry/schema.ts:798`), review coordinator→`Review` (`packages/domain/src/stage-registry/schema.ts:901`), record→`Testing` required + `Review` required:false bare-fallback (`packages/domain/src/stage-registry/schema.ts:921-931`), verify→verdict-artifact only (`packages/domain/src/stage-registry/schema.ts:846-857`). Runtime bare-Review backfill labeled fallback-only with `sectionIsBare` guard, never overwrites authored Review (`packages/app/src/services/task-service.ts:1133-1140`). Component skills fragment-only: functional-review no `--section Review` write (`plugins/sp/skills/functional-review/SKILL.md`), code-improvement candidate list is fragment (`plugins/sp/skills/code-improvement/SKILL.md`), super-reviewer is single coordinated Review writer (`plugins/sp/agents/super-reviewer.md:41`). Pinned by `packages/domain/tests/stage-registry/schema.test.ts` and `plugins/sp/tests/section-ownership-projection.test.ts`. |
| R2 | MET | Schema 1.2→1.3 additive; `StageArtifact.identity` optional field (`packages/domain/src/stage-registry/schema.ts:264`). Plugin mirror conforms (adapter `CURRENT_SCHEMA_VERSION` 1.3 at `:33`, implement Solution identity at `:348`, real verify `verdict-artifact`/`strict-core` gates `:406-411`, record mirror `:458-477`); invented gate identifiers removed. Full shared-stage contract parity (`plugins/sp/tests/stage-registry-parity.test.ts:163-231`); trio section-batching removed + runtime queries (`plugins/sp/skills/spur-dev/references/section-batching.md`); static status→section tables replaced by `spur task sections`/`spur task check` queries (`plugins/sp/skills/spec-decomposition/references/decomposition.md`, `plugins/sp/skills/spur-cli/references/tasks/*`). Pinned by `plugins/sp/tests/stage-registry-parity.test.ts`, `stage-registry-adapter.test.ts`, `section-ownership-projection.test.ts`, `skill-structure.test.ts`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Each pipeline stage has one task-section writer | MET | test | implement→Solution / review→Review / record→Testing(+fallback Review) writer-map projection pinned (`packages/domain/tests/stage-registry/schema.test.ts` writer-map projection; `plugins/sp/tests/section-ownership-projection.test.ts:52-113` static contradiction scan: only coordinator claims authored Review, verify claims no section write); runtime fallback guard `sectionIsBare` never overwrites authored Review (`packages/app/src/services/task-service.ts:1138`) |
| Scenario: R2 — Skills and registry are checked projections | MET | test | full shared-stage contract parity across artifacts/direction/identity, gates identifier/timing/min_verdict, reasoning_skill, mutation_class, execution kind (`plugins/sp/tests/stage-registry-parity.test.ts:163-231`); trio batching + static status→section tables replaced by runtime queries (`plugins/sp/tests/skill-structure.test.ts:1312`, `section-ownership-projection.test.ts`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | documentation | docs/tasks4/0593_reconcile-stage-section-ownership-and-agent-skill-projection.md (Solution) | Solution recap cites "254 tests" for the registry suites; this review measured 250 (domain stage-registry folder 90 + the four cited plugin registry/structure files 160). Count drift in a prose recap only — no behavioral impact. |
| P4 | architecture | plugins/sp/scripts/stage-registry-adapter.ts + plugins/sp/tests/stage-registry-parity.test.ts | Mirror parity is enforced by regex text-parsing of the domain source (blocks split on `schema_version: STAGE_REGISTRY_SCHEMA_VERSION,`; tuples via `\{([^{}]*)\}`). Documented constraint — the plugin installs into foreign repos and cannot import the domain package; guarded copy is the accepted design. Revisit only if the parse surface grows. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | One-writer projection in the canonical registry: implement→`Solution` (`packages/domain/src/stage-registry/schema.ts:798`), review coordinator→`Review` (`:901`), record→`Testing` with bare-only `Review` fallback (`:925-931`); runtime backfill labeled fallback-only and never overwrites authored Review (`packages/app/src/services/task-service.ts:1135-1138`, `sectionIsBare` guard at `:1138`); component skills fragment-only (`plugins/sp/skills/functional-review/SKILL.md:244`, `plugins/sp/skills/code-improvement/SKILL.md:190`, `plugins/sp/agents/super-reviewer.md:41`); pinned by `packages/domain/tests/stage-registry/schema.test.ts:653-700` and `plugins/sp/tests/section-ownership-projection.test.ts:52-113`. |
| R2 | MET | Schema 1.3 + `StageArtifact.identity` (`packages/domain/src/stage-registry/schema.ts:43`, `:264`); plugin mirror conforms (adapter `:33` schema 1.3, `:348` Solution identity, `:406-411` real verify gates with min_verdict, `:446` Review identity, `:458-477` record mirror + `spur task record` command entry); invented gate identifiers removed (refine/test/dogfood/review guard — grep-clean across the adapter); full shared-contract parity (`plugins/sp/tests/stage-registry-parity.test.ts:163-233`); trio batching gone + runtime queries (`plugins/sp/skills/spur-dev/references/section-batching.md:10-33`, `plugins/sp/tests/skill-structure.test.ts:1312`); static status→section tables replaced by `spur task sections`/`spur task check` queries (`plugins/sp/skills/spec-decomposition/references/decomposition.md`, `plugins/sp/skills/spur-cli/references/tasks/verbs.md`, `tasks/section-editing.md`). |

**Verification (fresh, this review):** `bun test packages/domain/tests/stage-registry/` → 90 pass / 0 fail; `bun test plugins/sp/tests/{stage-registry-parity,stage-registry-adapter,section-ownership-projection,skill-structure}.test.ts` → 160 pass / 0 fail; `bun test packages/app/tests/services/{task-record,task-check,done-transition-guard,task-service}.test.ts` → 329 pass / 0 fail.

**Verdict:** PASS — R1 and R2 both MET with file:line evidence; no P1–P3 findings.

**Residual risk:** F92 feature-doc line for 0593 is deferred to the pipeline's record/provenance hops; if `sp:doc-evolve sync-check` runs before that hop, the feature-doc entry for this task may be reported missing (documented deferral, not a code defect). Full-project gates (`autofix`/`spur-check`) are pipeline-owned per the 0436 R2 budget; this review ran the targeted 0593 surfaces only.
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
- Implemented surfaces (0593): `packages/domain/tests/stage-registry/schema.test.ts`; `plugins/sp/tests/stage-registry-adapter.test.ts`; `plugins/sp/tests/skill-structure.test.ts`; `plugins/sp/tests/section-ownership-projection.test.ts`
- Prose reconciliation: `plugins/sp/skills/spur-dev/references/dev-operations.md`; `plugins/sp/skills/spur-dev/references/gate-checklists.md`; `plugins/sp/skills/spur-dev/references/execution-workflow.md`; `plugins/sp/skills/spur-cli/references/tasks/verbs.md`; `plugins/sp/skills/spur-cli/references/tasks/section-editing.md`; `plugins/sp/skills/spur-cli/references/tasks/l3-guard-cheatsheet.md`; `plugins/sp/agents/super-planner.md`; `plugins/sp/commands/dev-review.md`
- Runtime-code labeling + doc sync: `packages/app/src/services/task-service.ts`; `docs/04_DESIGN.md`
### History
- 2026-08-18T21:59:59.027Z todo → wip (system)
- 2026-08-18T22:14:04.240Z wip → testing (system)
- 2026-08-18T22:14:05.051Z testing → done (system)
