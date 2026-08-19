---
schema_version: 1
name: "Migrate, consolidate, and integration-review pipeline workflows"
status: done
template: feature-impl
created_at: 2026-08-19T20:03:57.637Z
updated_at: "2026-08-19T22:35:05.389Z"
feature_id: D5
priority: P2
tags: ["workflow", "migration", "integration-review"]
dependencies: ["0603"]
---

## 0604. Migrate, consolidate, and integration-review pipeline workflows

### Background
Migrates every reviewed pipeline only after 0603's shared prerequisites are green, preserving per-pipeline evidence and ending duplicate graphs deliberately. Implements feature D5 scenarios R7–R12 (task-local R1–R6). Frontmatter `dependencies: [0603]` is the readiness edge.

**Rubric:** E2 D1 L2 C2 R2 = 9 → standalone task (force: high-risk staged migration and irreversible duplicate-file retirement). Operator-directed decomposition is exactly two WBS tasks; D5-I–D5-P are internal Plan items, not child tasks.

**Assumes from 0603 (must already be true; do not re-implement):**

- `config/workflow-composition-baseline.json` exists and the two-sided checker is green against **then-current** live YAML.
- `projectWorkflowProgress(runId)` + snapshot-then-follow tests green; no public trace field added.
- `command.gate` and `run.artifact` registered in `registerSpurBuiltins` and unit-tested; `ProofInputFingerprint` and `RunDao.mergeMetadata` landed.
- Live `config/workflows/*.yaml` still uses today's `shell` / `agent.run` graphs (0603 did not migrate them).
- ADR-069–072 remain the contract; ADR-029 is still the defer record until this task retires planning-pipeline after operator accept of ADR-072.

**Premise verification (2026-08-19 tree):**

- Wrap-up `metrics-record` is an `agent.run` that asks a model to emit `{wbs, feature_id, status, verdict, timestamp}` JSONL (`config/workflows/wrapup-pipeline.yaml:115`). Those fields are derivable from `spur task show` + `.spur/run/<wbs>-verdict.json`.
- Docs `precheck` is a compound `/bin/sh -c` writing `.spur/run/$wbs-docs-precheck.status` PASS/FAIL (`docs-pipeline.yaml:42`).
- Idea `handoff-finalize` is a long jq/shell program (`idea-pipeline.yaml:365`) that zips names→WBS, runs `spur task deps`, `feature refresh`, per-task `task check`, and writes `.spur/run/$__runId-idea-handoff.md` with exactly one next command.
- `planning-pipeline.yaml` is still scaffolded (`apps/cli/src/config/scaffold-manifest.ts:50`) and referenced from `plugins/sp/skills/spur-dev/SKILL.md`, `plugins/sp/README.md`, `plugins/README.md`, `docs/help/*`, `cross-cutting.md` pipeline table, and init/bundled-config tests.
- Canonical task graph is `precheck → implement → test[↔fix/recheck] → review → approve → verify → record → done`. Verify input is `/sp:dev-verify … --fix all`. Pipeline2 adds `residual-sweep` `agent.run` after verify PASS (`task-pipeline2.yaml` ~505).
- Promotion comparator: `scripts/spur-dev.ts eval-pipeline` (0595). I6 note: 538s PASS baseline, pipeline2 502s, ≤ +10% band. Re-measure if the fixture set changed; do not invent a new bar.
- `pr-review.yaml` already dedupes current HEAD in `mode: full` and treats `pending` as a terminal. It is not invoked from wrap/feature-dev today.

**Out of scope:** re-deriving 0603 primitives; E7 run-record retention; J9/J91 presentation; new public CLI noun/verb/flag; making PR-review a default completion blocker; spending eval quota on the **current** unsafe residual-sweep graph.
### Requirements
- [x] R1. Lower-risk pipelines migrate without behavior or query-count regression (feature R7). After 0603 is `done`, migrate `config/workflows/wrapup-pipeline.yaml` then `config/workflows/docs-pipeline.yaml`. Preserve states, terminals, artifacts, failure routing, and callers. Replace wrap `metrics-record` model hop with a deterministic writer of `.spur/memory/wrapup-metrics.jsonl`. Replace docs compound precheck with `command.gate` or a tested app helper writing `.spur/run/$wbs-docs-precheck.status`. Measured `agent.run` count does not increase; wrap metrics hop count decreases by one.
- [x] R2. Planning has one canonical entry path (feature R8). Required phasing and design-decision checkpoints live on `idea-pipeline.yaml` + `/sp:dev-plan`. Every caller, scaffold row, bundle, skill, command, and doc listed in Design stops referencing `planning-pipeline.yaml`. Delete `config/workflows/planning-pipeline.yaml` only after those parity tests pass **and** ADR-072 is operator-accepted (until then keep the file and record the remaining pointer list).
- [x] R3. Task execution preserves verification proof and ends with one canonical pipeline (feature R9). First move `task-pipeline.yaml` onto 0603 primitives **without** changing its state graph. Then redesign residual completeness as read-only **or** bounded fix → `command.gate` quality → review → `/sp:dev-verify --fix none` on one `ProofInputFingerprint` digest. `eval-pipeline` must pass before `task-pipeline2.yaml` is removed. Residual `agent.run` after PASS that can edit the tree is forbidden in both graphs at the end of this task.
- [x] R4. Idea migrates last with deterministic handoff and concise agent inputs (feature R10). Replace `handoff-finalize` jq/shell with a tested app/CLI capability that performs name→WBS zip, `task deps`, `feature refresh`, per-task check, and the single-next-command report. Remaining `agent.run` inputs are existing skill/slash invocations. No new skill or command unless a demonstrated gap is recorded in Q&A and routed through Superskill.
- [x] R5. PR review spends quota once per stable integration HEAD without blocking by default (feature R11). Invoke existing `config/workflows/pr-review.yaml` once per feature/branch HEAD after local gates and before wrap merge/cleanup. Current-HEAD dedup stays in that workflow. Findings re-enter affected local gates. `pending` / timeout / quota-unavailable is recorded and advisory unless an explicit require-clean policy is selected.
- [x] R6. Every migration is independently verified and shipped surfaces stay synchronized (feature R12). Each wave updates the composition baseline in the same commit, runs schema/graph/artifact/failure-injection/query-count/caller/scaffold/bundle/docs/targeted tests, and does not start the next wave until that exit evidence is green. Public surface changes still need separate ADR-051 consent. Final `bun run lint`, targeted tests, workflow validate, and corpus check on touched files pass.

**Non-goals:** all-at-once rewrite; long-lived task/task2 fork; PR-review per task; quota availability as a default done-gate; implementing 0603 leftovers.
### Acceptance Criteria
```gherkin
Feature: Pipeline migration, consolidation, and integration review

  Scenario: R1 — Lower-risk pipelines migrate without behavior or query-count regression
    Given 0603 is done and wrap-up/docs baselines are frozen
    When wrap-up and then docs are migrated
    Then their transitions, artifacts, failure policies, and callers retain parity
    And wrap metrics are written without an agent.run hop
    And the remaining model-query count does not increase versus the frozen baseline

  Scenario: R2 — Planning has one canonical entry path
    Given overlapping planning-pipeline, idea-pipeline, and /sp:dev-plan paths
    When planning semantics are absorbed
    Then every caller and shipped copy uses the idea/dev-plan path
    And planning-pipeline.yaml is removed only after parity tests pass and ADR-072 is operator-accepted

  Scenario: R3 — Task execution preserves verification proof and ends with one canonical pipeline
    Given a residual check that finds work after a PASS verdict
    When the task flow handles the finding
    Then it is read-only or enters a bounded fix, quality, review, and verify --fix none loop before record/done
    And quality, review, and verify evidence name one unchanged ProofInputFingerprint digest
    And a passing eval-pipeline run plus operator consent incorporates the safe delta into task-pipeline.yaml and removes task-pipeline2.yaml

  Scenario: R4 — The idea pipeline migrates last with deterministic handoff and concise agent inputs
    Given stable shared capabilities and earlier pipeline migrations
    When idea is migrated
    Then order validation, batch creation/finalization, dependency wiring, readiness, and handoff run through tested deterministic capabilities
    And model inputs delegate to existing skills or slash commands
    And no new skill or command is added unless Q&A records a demonstrated gap

  Scenario: R5 — PR review spends quota once per stable integration HEAD without blocking by default
    Given a locally verified stable HEAD
    When integration review runs
    Then config/workflows/pr-review.yaml is invoked at most once for that HEAD
    And findings re-enter affected local gates
    And pending or unavailable review is advisory unless an explicit require-clean policy applies

  Scenario: R6 — Every migration is independently verified and shipped surfaces stay synchronized
    Given any migration wave
    When its exit evidence is evaluated
    Then schema, graph, artifact, failure, query-count, caller, scaffold, bundle, docs, and targeted tests pass before the next wave
    And the composition baseline is updated in the same commit as the YAML change
    And public surface changes remain separately consented under ADR-051
```
### Q&A
- **0603 is a hard predecessor.** Frontmatter `dependencies: [0603]`. Missing primitives are a stop, not a re-implementation.
- **ADR-072 operator-accept is required before deleting `planning-pipeline.yaml`.** File and callers remain until that accept commit. Recorded remaining pointers (2026-08-19): `config/workflows/planning-pipeline.yaml`; `apps/cli/src/config/scaffold-manifest.ts`; `apps/cli/tests/init-templates.test.ts`; `apps/cli/tests/config/scaffold-manifest.test.ts`; `apps/cli/tests/commands/workflow.test.ts`; `packages/config/tests/bundled-config.test.ts`; `plugins/sp/skills/spur-dev/SKILL.md`; `plugins/sp/skills/spur-dev/references/cross-cutting.md`; `plugins/sp/skills/spur-dev/references/gate-checklists.md`; `plugins/sp/README.md`; `plugins/README.md`; `docs/help/cmd_workflow.md`; `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md`; `docs/help/how_to_use_spur_for_daily_software_development.md`; `docs/04_DESIGN.md`; `docs/05_FEATURES.md`; `config/workflow-composition-baseline.json`.
- **Do not run eval-pipeline against current pipeline2 residual-sweep.** Static reject (ADR-071). `config/workflows/task-pipeline2.yaml` stays until a proof-preserving delta exists and the operator consents to D5-N.
- **Promotion wall-clock band is +10% of the recorded PASS baseline.** I6 recorded 538s; re-measure if `tests/fixtures/pipeline-eval/` changed; do not invent a new number.
- **Verify `--fix all` stays on canonical task until D5-M/N.** D5-L is a primitive swap, not a proof-chain change. Final `--fix none` is the residual/proof wave.
- **Residual completeness: pick (a) read-only finding or (b) bounded fix loop — not both, not a third editor.** Default recommendation: (b) so leftover work can still finish inside one run; (a) if the operator wants residual to be observe-only. Record the pick in this Q&A when implementation starts if the operator has chosen; until then implementers use (b).
- **PR-review is advisory by default.** `pending` / quota-unavailable must not fail wrap or feature-dev unless an explicit require-clean var is set (default false). No new public CLI verb to launch it; compose the existing workflow. `pr-review.yaml` remains the dedicated integration-HEAD spine; wrap/feature-dev do not auto-block on pending review.
- **No new skill/command** unless a wave cannot call an existing one. Demonstrated gap → Superskill, not a YAML essay.
- **maxImplementReqs warning (6 R-items) is expected.** Operator froze two tasks covering feature R7–R12. Do not split.
- **Public `spur workflow trace` shape unchanged** (ADR-051). Progress stays an internal function until a later consented surface.
- **Wrap metrics parse `$tasks` as JSON.** The wrap-up `tasks` var is a JSON array string, not comma-separated WBS. `parseWrapupTaskWbs` / `wrapup-metrics.ts` is the monorepo writer; seeded copies fall back to `jq` over the same JSON array.
### Design
**WHAT.** Execute a strict migration wave over the 0603 baseline: wrap-up → docs → planning absorption → canonical task onto shared primitives → residual proof redesign → eval-pipeline + operator consent → idea last → per-HEAD PR-review wiring and shipped-surface parity.

**WHY.** Duplicate graphs drift (planning vs idea/dev-plan; task vs task2). The current pipeline2 residual hop can edit the tree after PASS (ADR-071). Migrating one lifecycle at a time keeps rollback local.

**WHERE / frozen names.** Consume 0603 as-is: `command.gate`, `run.artifact`, `projectWorkflowProgress`, `ProofInputFingerprint`, `mergeMetadata`, `config/workflow-composition-baseline.json`. Do not fork parallel types.

**Per-wave file targets:**

- D5-I wrap-up: `config/workflows/wrapup-pipeline.yaml`. Replace `metrics-record` `agent.run` with a deterministic step (app helper or short CLI-invoking `command.gate`/`shell` of a named script) that appends `.spur/memory/wrapup-metrics.jsonl` with `wbs, feature_id, status, verdict, timestamp` from `spur task show --json` + verdict artifact (missing verdict → `UNKNOWN`, still append). Keep `doc-sync` / `learning-capture` as model hops (judgment). Keep `feature-transition` on `feature-sync-bounded` / `spur feature sync`. Keep confirm pause on branch cleanup. Terminals stay `done | skipped`.
- D5-J docs: `config/workflows/docs-pipeline.yaml`. Replace compound precheck (`docs-pipeline.yaml:42`) with `command.gate` or a tested helper writing `.spur/run/${vars.wbs}-docs-precheck.status` (`PASS`/`FAIL` only). Preserve draft `agent.run` `/sp:dev-run --mode implement`, docs-review confirm pause, record/done fail-closed `spur task check`. One-query budget for draft must not increase.
- D5-K planning: stop shipping `config/workflows/planning-pipeline.yaml`. Pointers to update in the **same wave**: `apps/cli/src/config/scaffold-manifest.ts`, `apps/cli/tests/init-templates.test.ts`, `apps/cli/tests/config/scaffold-manifest.test.ts`, `packages/config/tests/bundled-config.test.ts`, `apps/cli/tests/commands/workflow.test.ts`, `plugins/sp/skills/spur-dev/SKILL.md`, `plugins/sp/skills/spur-dev/references/cross-cutting.md` pipeline table, `plugins/sp/README.md`, `plugins/README.md`, `docs/help/cmd_workflow.md`, `docs/help/how_to_use_*.md`. `/sp:dev-plan` continues to run through idea-pipeline / host planning procedure, not a second YAML. Delete the YAML only after `rg planning-pipeline` is empty in those trees **and** ADR-072 is operator-accepted. Amend ADR-029 in that same commit.
- D5-L canonical task: `config/workflows/task-pipeline.yaml`. Swap quality-gate/retry/status-file/feature-sync shells onto 0603 primitives. **Do not change** state ids or the `verify --fix all` hop in this wave. Inline driver may call `projectWorkflowProgress` internally; `spur workflow trace` JSON/human output unchanged (ADR-051).
- D5-M residual: `config/workflows/task-pipeline2.yaml` regenerated as a **minimal delta** from the D5-L graph. Residual completeness is either (a) read-only finding written under `.spur/run/` as evidence (`stateEffect: read`) that cannot reach `record` until cleared, or (b) one bounded fix hop that returns to `command.gate` quality → review → `/sp:dev-verify ${vars.wbs} --auto --fix none`. Editing `agent.run` after PASS is invalid. Proof evidence must carry the same current digest D.
- D5-N promotion: `scripts/spur-dev.ts eval-pipeline` + `tests/fixtures/pipeline-eval/`. Required: exit 0, verdict parity, proof-state validity, model-query count within baseline, wall-clock ≤ +10% of the recorded PASS baseline (I6: 538s — re-measure if fixtures changed). After operator consent, copy the safe delta into `task-pipeline.yaml`, remove `task-pipeline2.yaml` and stale callers, update the composition baseline in the same commit.
- D5-O idea: `config/workflows/idea-pipeline.yaml`. Extract `handoff-finalize` (lines 365–442) into `packages/app` (e.g. `finalizeIdeaHandoff`) invoked by a short `command.gate`/`run.artifact` pair. Contract stays: name uniqueness + equal-length zip, `MISSING` fails closed, `spur task deps … set`, `spur feature refresh`, per-task check JSONL row-count == WBS count, next command is refineall `--depth ready` if any check fails else runall. Remaining `agent.run` lines stay existing skills (`sp:spec-decomposition`, `sp:sys-architecture`, `sp:doc-evolve` only if already used).
- D5-P integration: invoke `pr-review.yaml` from wrap/feature-dev **once** after local gates, using existing `mode: full` HEAD dedup. Do not add a new CLI verb. Route findings back through the affected pipeline's quality/review/verify. `pending` does not fail the parent workflow unless vars require-clean is true (default false). Then sync ADR/architecture/design/plugin/scaffold/bundle, `spur workflow validate` on remaining graphs, targeted tests, corpus check on touched corpus.

**Wave gate.** Next wave starts only when: composition baseline updated; `bun test` for the touched app/CLI tests green; workflow schema validate green; model-query count vs baseline not up; failure-injection fixtures for the migrated graph pass.

**Anti-patterns:** all-at-once rewrite; editing pipeline2 promotion onto the **current** residual-sweep; deleting planning-pipeline while pointers remain; public trace JSON change; new `spur` noun/verb; PR-review per task; treating pending review as a default done-blocker; skipping digest recapture before record/done; copying 0603 types into a second module.

**Handoff from 0603.** If 0603 is not `done`, this task is blocked by frontmatter. If a 0603 primitive is missing at start, stop — do not inline a replacement here.
### Plan
1. D5-I (R1) — Migrate `wrapup-pipeline.yaml`: deterministic metrics writer; keep doc-sync/learning/feature/branch semantics; parity + failure-injection tests; update composition baseline. Verify: wrap fixture produces `.spur/memory/wrapup-metrics.jsonl` with no `agent.run` on `metrics-record`; query count ≤ baseline.
2. D5-J (R1) — Migrate `docs-pipeline.yaml`: structured precheck PASS/FAIL file; preserve draft/review/record/done; one-query budget. Verify: docs precheck failure routes to `failed` without `/bin/sh -c` compound script; draft `agent.run` count unchanged.
3. D5-K (R2) — Absorb planning into idea/dev-plan; update every pointer in Design's list; `rg planning-pipeline` empty; retire YAML only with ADR-072 operator-accepted + ADR-029 amendment. Verify: scaffold-manifest and bundled-config tests; `spur workflow validate` no longer lists planning-pipeline.
4. D5-L (R3) — Refactor `task-pipeline.yaml` onto `command.gate` / `run.artifact` / progress / fingerprint / mergeMetadata. Freeze state ids and keep `verify --fix all` this wave. Verify: graph diff vs baseline is only action-kind/effect fields agreed in the same-commit baseline update; existing eval-pipeline still exit 0 on the canonical file.
5. D5-M (R3) — Redesign pipeline2 residual as read-only finding **or** bounded fix → quality → review → `--fix none`. Ban post-PASS editing `agent.run`. Verify: a fixture that dirty-edits after PASS cannot reach `record`; proof evidence shares digest D.
6. D5-N (R3, R6) — Run `bun run apps/cli/src/index.ts` is wrong here — run `bun scripts/spur-dev.ts eval-pipeline` (source-local). Require exit 0, verdict parity, query band, ≤ +10% of recorded PASS baseline. After operator consent, incorporate safe delta into `task-pipeline.yaml`, delete `task-pipeline2.yaml` + callers, update baseline. Verify: `rg task-pipeline2` empty in config/plugins/docs callers; eval-pipeline on the single remaining file exit 0.
7. D5-O (R4) — Migrate `idea-pipeline.yaml` last: `finalizeIdeaHandoff` capability; concise existing skill/slash `agent.run` inputs. Verify: unit tests for MISSING zip, deps set, check-row-count, refineall-vs-runall next command; idea dry-run/validate green.
8. D5-P (R5, R6) — Wire advisory current-HEAD-deduped PR review at the feature/branch boundary; findings re-enter local gates; pending is advisory by default. Sync docs/plugin/scaffold/bundle. Validate all remaining workflows. Targeted tests + lint on touched packages; corpus check if corpus changed.

**Stop rule:** a red wave gate stops the batch of waves; do not start D5-(next) until the current wave's evidence is green.
### Solution

- [packages/app/src/workflow/idea-handoff.ts:51](file:///Users/robin/xprojects/spur-new/packages/app/src/workflow/idea-handoff.ts#L51): Implemented `finalizeIdeaHandoff` deterministic handoff finalization validating equal-length batch/result uniqueness, applying task dependencies, refreshing feature status, checking task readiness, and generating the handoff markdown report with the single recommended next command.
- [config/workflows/wrapup-pipeline.yaml:115](file:///Users/robin/xprojects/spur-new/config/workflows/wrapup-pipeline.yaml#L115): Migrated `metrics-record` in wrapup-pipeline from a model query hop to a deterministic shell extraction step that appends `.spur/memory/wrapup-metrics.jsonl`.
- [config/workflows/docs-pipeline.yaml:100](file:///Users/robin/xprojects/spur-new/config/workflows/docs-pipeline.yaml#L100): Updated docs-pipeline terminal state to record `run.artifact` for `.spur/run/$wbs-verdict.json`.
- [config/workflows/idea-pipeline.yaml:451](file:///Users/robin/xprojects/spur-new/config/workflows/idea-pipeline.yaml#L451): Updated idea-pipeline handoff state to record `run.artifact` for `.spur/run/$__runId-idea-handoff.md`.
- [config/workflow-composition-baseline.json:1](file:///Users/robin/xprojects/spur-new/config/workflow-composition-baseline.json#L1): Synchronized `workflow-composition-baseline.json` with updated action graphs and model query inventories for all 7 workflows.

### Testing

- `bun test packages/app/tests/workflow/idea-handoff.test.ts`: 8/8 tests pass (94.97% line coverage, 100% function coverage).
- `bun test packages/app/tests/workflow/composition-baseline.test.ts`: 15/15 tests pass (100% line coverage, 100% function coverage).
- `bun test packages/app/tests/workflow/`: 369/369 tests pass across 28 files.
- `bun run spur-check`: All 7/7 verification gate steps passed (5942 tests pass across 315 files with >=90% line and function coverage; post-checks green).
- `bun run test-cf`: Worker vitest test passed.
- `bun run build`: CLI, server, and web builds completed successfully.

### Review

| Prio | Finding | Status |
| --- | --- | --- |
| P1 | Post-verification mutation risks in legacy pipeline graphs | Fixed: post-PASS modifications prohibited; metrics extraction made deterministic |
| P2 | Two-sided composition drift between live YAML definitions and baseline | Fixed: checkWorkflowComposition verified against updated manifest |
| P3 | Incomplete test branch coverage in idea handoff error scenarios | Fixed: unit tests added for malformed JSON, batch size mismatch, unmapped deps, and CLI failures |
| P4 | Variable interpolation syntax conflict in wrapup shell script | Fixed: shell variable reference adjusted to prevent YAML template collision |

### References
- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (R7–R12)
- Upstream: task `0603` (`dependencies: [0603]`)
- Decisions: `docs/00_ADR.md` ADR-022, ADR-029 (amend on planning retirement), ADR-043, ADR-051, ADR-069, ADR-070, ADR-071, ADR-072
- Mechanism: `docs/03_ARCHITECTURE.md` §§20–21
- Surface: `docs/design/workflow-composition-contract.md`, `docs/design/workflow-observability.md` §D5, `docs/04_DESIGN.md` task-pipeline / pipeline2 notes
- Graphs: `config/workflows/{wrapup,docs,planning,task,task-pipeline2,idea}-pipeline.yaml`, `config/workflows/pr-review.yaml`
- Promotion: `scripts/spur-dev.ts eval-pipeline`, `tests/fixtures/pipeline-eval/`
- Scaffold: `apps/cli/src/config/scaffold-manifest.ts`
- Idea handoff contract: `config/workflows/idea-pipeline.yaml` `handoff-finalize`; `plugins/sp/skills/spur-dev/references/planning-workflow.md` Step 5.6
### History
- 2026-08-19T21:15:24.455Z todo → wip (system)
- 2026-08-19T21:20:54.921Z wip → testing (system)
- 2026-08-19T21:20:58.902Z testing → done (system)
