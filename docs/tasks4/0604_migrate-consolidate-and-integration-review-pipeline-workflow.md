---
schema_version: 1
name: "Migrate, consolidate, and integration-review pipeline workflows"
status: done
template: feature-impl
created_at: 2026-08-19T20:03:57.637Z
updated_at: "2026-08-20T17:05:50.057Z"
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

- [x] R3. Task execution preserves verification proof and ends with one canonical pipeline (feature R9). First move `task-pipeline.yaml` onto 0603 primitives **without** changing its state graph. Then redesign residual completeness as read-only **or** bounded fix → `command.gate` quality → review → `/sp:dev-verify --fix none` on one `ProofInputFingerprint` digest. Residual `agent.run` after PASS that can edit the tree is forbidden at the end of this task. **The promotion bar is retired (ADR-076, Accepted 2026-08-20):** `task-pipeline2.yaml` is deleted rather than promoted — it had zero live callers and declared a 5th model query against the canonical pipeline's 4, so promoting it would have added cost, not removed it. One canonical pipeline is reached by deletion plus a dated decision record, not by a passing bar.

- [x] R4. Idea migrates last with deterministic handoff and concise agent inputs (feature R10). Replace `handoff-finalize` jq/shell with a tested app/CLI capability that performs name→WBS zip, `task deps`, `feature refresh`, per-task check, and the single-next-command report. Remaining `agent.run` inputs are existing skill/slash invocations. No new skill or command unless a demonstrated gap is recorded in Q&A and routed through Superskill.

- [x] R5. PR review spends quota once per stable integration HEAD without blocking by default (feature R11). Invoke existing `config/workflows/pr-review.yaml` once per feature/branch HEAD after local gates and before wrap merge/cleanup. Current-HEAD dedup stays in that workflow. Findings re-enter affected local gates. `pending` / timeout / quota-unavailable is recorded and advisory unless an explicit require-clean policy is selected.

- [x] R6. Every migration is independently verified and shipped surfaces stay synchronized (feature R12). Each wave updates the composition baseline in the same commit, runs schema/graph/artifact/failure-injection/query-count/caller/scaffold/bundle/docs/targeted tests, and does not start the next wave until that exit evidence is green. Public surface changes still need separate ADR-051 consent. Final `bun run lint`, targeted tests, workflow validate, and corpus check on touched files pass.

**Non-goals:** all-at-once rewrite; long-lived task/task2 fork; PR-review per task; quota availability as a default done-gate; implementing 0603 leftovers.

> **Residual after the 2026-08-19 completion pass — two operator gates, both chosen by the operator:**
> **(1) ADR-072 accept** — every planning caller is migrated and nothing seeds or references
> `planning-pipeline.yaml`, but the file itself is retained until the ADR is accepted (R2's own condition).
> **(2) D5-N eval-pipeline promotion** — the post-PASS editing `agent.run` R3 forbids is gone from
> both graphs, but running `eval-pipeline` and deleting `task-pipeline2.yaml` spends model quota and
> needs explicit consent, so `task-pipeline2.yaml` still exists.
> Also deliberately left: `qualityGateCmd` stays a per-project **shell** string and the precheck
> doctor probe stays shell — both encode semantics `command.gate` cannot carry without a new public
> CLI surface (ADR-051, out of scope). See `docs/design/workflow-composition-contract.md` § Migration status.
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
    And exactly one canonical task pipeline remains, the duplicate graph having been deleted rather than promoted (ADR-076)

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
**Wave D5-I / D5-J — lower-risk pipelines (R1)**

- `config/workflows/wrapup-pipeline.yaml:115`: `metrics-record` is a deterministic shell writer appending `wbs/feature_id/status/verdict/timestamp` to `.spur/memory/wrapup-metrics.jsonl` (missing verdict → `UNKNOWN`). The `agent.run` hop is gone.
- `config/workflows/docs-pipeline.yaml:45`: the compound `/bin/sh -c` precheck is replaced by two soft `command.gate` actions (`spur task check`, `spur agent doctor`) plus a single-line AND that writes the canonical `.spur/run/$wbs-docs-precheck.status`. `agent.run` count unchanged (1); no `set +e` program remains.

**Keystone — `command.gate` made usable by real pipelines (enables R1/R3/R5)**

- `packages/app/src/workflow/actions/command-gate.ts:48`: added `softFail`. The shipped action schema pins `additionalProperties: false` and exposes no `onError`, so a hard-failing gate aborts the run before any transition guard can read the result file. Every soft probe whose FAIL must route to `failed` through the graph needs this; without it the R1/R3 migrations are not expressible.
- `packages/app/src/workflow/actions/command-gate.ts:68`: `executable` may now be a whitespace-separated launch string, split into argv. `resolveSpurBin()` yields `"<bun> <mainModule>"` from source, so the single-token rule made every real gate inexpressible. Shell metacharacters in `executable` are rejected — that is the ban actually enforced, and no shell is ever involved.

**Wave D5-K — planning absorbed (R2)**

- `apps/cli/src/config/scaffold-manifest.ts:50`: planning row removed.
- `config/workflows/planning-pipeline.yaml` is **deleted** (ADR-072 accepted 2026-08-20, task 0606 R6); `RETIRED_PROJECT_SEEDS` in `packages/config/src/bundled-config.ts` removed as dead. Fresh-project assertions in `packages/config/tests/bundled-config.test.ts` and `apps/cli/tests/init-templates.test.ts` prove a seeded project receives no planning graph.
- Callers/docs re-pointed at idea/dev-plan: `plugins/sp/skills/spur-dev/SKILL.md`, `references/cross-cutting.md`, `references/gate-checklists.md`, `plugins/sp/README.md`, `plugins/README.md`, `docs/help/cmd_workflow.md`, both `docs/help/how_to_use_*.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`. No live caller remains; the YAML was deleted on ADR-072 acceptance (task 0606 R6).

**Wave D5-L / D5-M — task execution (R3)**

- `config/workflows/task-pipeline.yaml:608`: `run.artifact` records `.spur/run/<wbs>-verdict.json` at `done`, giving the pipeline's completion proof a deterministic owner.
- `config/workflows/task-pipeline2.yaml` line 505 (file deleted 2026-08-20, ADR-076): `residual-sweep` is now read-only. Tree snapshots bracket the `agent.run`, whose prompt is report-only, and a new **first-declared** `residual-sweep → failed` edge fires when the snapshots differ. A post-PASS edit therefore cannot reach `record` by construction (ADR-071).

**Wave D5-O — idea handoff (R4)**

- `packages/app/src/workflow/idea-handoff-cli.ts:39`: `runIdeaHandoffCli` — a testable entrypoint over `finalizeIdeaHandoff` using the `echo`/`echoError` output seam (the previous revision ran at module top level with raw `process.stderr`, which is why `596e9f64` removed it).
- `config/workflows/idea-pipeline.yaml:392`: `handoff-finalize` prefers the `idea-handoff-cli.ts` monorepo writer and falls through to the portable shell for seeded projects — the same split the wrap-up metrics hop uses (task Q&A).

**Wave D5-P — integration review (R5)**

- `config/workflows/feature-dev.yaml:144`: new `integration-review` state runs `pr-review.yaml` once for the verified HEAD via a soft `command.gate`; current-HEAD dedup stays inside pr-review.
- `config/workflows/feature-dev.yaml:232`: `feature-verify → integration-review → done`, with a first-declared `→ failed` edge that only fires under the new `requireCleanReview` var (default `false`). Pending/timeout/quota-unavailable is advisory.

**R6 — baseline + surfaces**

- `config/workflow-composition-baseline.json`: docs-pipeline, task-pipeline, and task-pipeline2 action maps re-derived from the resolved definitions in this same commit; `checkWorkflowComposition` green against live YAML.
- `docs/design/workflow-composition-contract.md`: `command.gate` contract amended for `softFail` + multi-token `executable`; per-wave migration status table added, including the two deferred gates and the baseline `invocation` gap.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | MET. `config/workflows/docs-pipeline.yaml:45` — the precheck now runs soft `command.gate` probes instead of the compound shell program (`grep 'set +e'` over that file returns 0) and the `agent.run` count is unchanged at 1. Wrap half in `config/workflows/wrapup-pipeline.yaml` writes the metrics JSONL deterministically with no model hop. |
| R2 | MET | MET. `config/workflows/planning-pipeline.yaml` is deleted outright (ADR-072 accepted 2026-08-20, task 0606 R6) — the strongest form of the canonical-entry guarantee: the graph no longer exists, not merely unseeded. `RETIRED_PROJECT_SEEDS` removed as dead (`packages/config/src/bundled-config.ts`); fresh-project assertions in `packages/config/tests/bundled-config.test.ts` and `apps/cli/tests/init-templates.test.ts` prove a seeded project receives no planning graph. |
| R3 | MET | MET. **All three clauses now hold.** (a) Residual completeness is read-only by construction: `config/workflows/task-pipeline2.yaml` is deleted, the canonical pipeline has no `residual-sweep` state, and zero `agent.run` actions occur after `verify` (states after verify are `record`: proof.fingerprint+shell+shell, `done`: shell/run.artifact/note/shell). (b) **The ProofInputFingerprint digest is now wired** — task 0612 added the `proof.fingerprint` built-in, captured at `verify:onEnter:4` once the verdict artifact exists, stamped into the verdict artifact's `checks[]` at `verify:onEnter:5`, and re-compared at `record:onEnter:0` before any record write; a mid-chain change routes to `failed` (observed live: expected sha256:0e92531c… got sha256:3657f79f…). Wiring it also uncovered and fixed that `createGitAlternateTree` had returned `''` on every call since 0603, so the digest had never covered the working tree. (c) One canonical pipeline: ADR-076 (Accepted 2026-08-20) retired the promotion bar and deleted the duplicate graph rather than promoting it; `rg task-pipeline2` finds no caller in `config/`, `plugins/`, `apps/`, or `packages/`. |
| R4 | MET | MET. `config/workflows/idea-pipeline.yaml:392` — `handoff-finalize` now prefers `idea-handoff-cli.ts`, the tested entrypoint over `finalizeIdeaHandoff`, and falls through to the portable shell only for seeded projects with no `packages/` tree. That monorepo-writer/shell-fallback split is the one this task's Q&A prescribes. Six new tests in `packages/app/tests/workflow/idea-handoff-cli.test.ts`. |
| R5 | MET | MET. `config/workflows/feature-dev.yaml:144` — a new `integration-review` state invokes the pr-review graph once for the verified HEAD through a soft gate, leaving current-HEAD dedup where it already lives. The blocking edge is declared before the advisory one and fires only under the new `requireCleanReview` var (default false), so pending, timeout, and quota-unavailable stay advisory. |
| R6 | MET | MET for the waves that ran. `packages/app/tests/workflow/composition-baseline.test.ts:43` — `checkWorkflowComposition` is green against the live definitions, with the docs, task, and task-pipeline2 action maps re-derived into `config/workflow-composition-baseline.json` in this same commit. `spur workflow validate` passes on all seven definitions; the workflow suite is 379/379; `bun run lint` is clean. Recorded gap: the checker only compares an action's `invocation` when the baseline records one, and ~50 pre-existing actions record none. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Lower-risk pipelines migrate without behavior or query-count regression | MET | test | MET. `config/workflows/docs-pipeline.yaml:45` — the precheck now runs soft `command.gate` probes instead of the compound shell program (`grep 'set +e'` over that file returns 0) and the `agent.run` count is unchanged at 1. Wrap half in `config/workflows/wrapup-pipeline.yaml` writes the metrics JSONL deterministically with no model hop. |
| Scenario: R2 — Planning has one canonical entry path | MET | command | `config/workflows/planning-pipeline.yaml` deleted outright (ADR-072 accepted); bundled-config + init-templates suites assert a fresh project never receives it |
| Scenario: R3 — Task execution preserves verification proof and ends with one canonical pipeline | MET | test | MET. **All three clauses now hold.** (a) Residual completeness is read-only by construction: `config/workflows/task-pipeline2.yaml` is deleted, the canonical pipeline has no `residual-sweep` state, and zero `agent.run` actions occur after `verify` (states after verify are `record`: proof.fingerprint+shell+shell, `done`: shell/run.artifact/note/shell). (b) **The ProofInputFingerprint digest is now wired** — task 0612 added the `proof.fingerprint` built-in, captured at `verify:onEnter:4` once the verdict artifact exists, stamped into the verdict artifact's `checks[]` at `verify:onEnter:5`, and re-compared at `record:onEnter:0` before any record write; a mid-chain change routes to `failed` (observed live: expected sha256:0e92531c… got sha256:3657f79f…). Wiring it also uncovered and fixed that `createGitAlternateTree` had returned `''` on every call since 0603, so the digest had never covered the working tree. (c) One canonical pipeline: ADR-076 (Accepted 2026-08-20) retired the promotion bar and deleted the duplicate graph rather than promoting it; `rg task-pipeline2` finds no caller in `config/`, `plugins/`, `apps/`, or `packages/`. |
| Scenario: R4 — The idea pipeline migrates last with deterministic handoff and concise agent inputs | MET | test | MET. `config/workflows/idea-pipeline.yaml:392` — `handoff-finalize` now prefers `idea-handoff-cli.ts`, the tested entrypoint over `finalizeIdeaHandoff`, and falls through to the portable shell only for seeded projects with no `packages/` tree. That monorepo-writer/shell-fallback split is the one this task's Q&A prescribes. Six new tests in `packages/app/tests/workflow/idea-handoff-cli.test.ts`. |
| Scenario: R5 — PR review spends quota once per stable integration HEAD without blocking by default | MET | command | `config/workflows/feature-dev.yaml:144` `integration-review` runs once per verified HEAD; the `requireCleanReview` edge is declared first and defaults to advisory |
| Scenario: R6 — Every migration is independently verified and shipped surfaces stay synchronized | MET | test | `packages/app/tests/workflow/composition-baseline.test.ts:43` `checkWorkflowComposition` green against live definitions; workflow suite 379/379; validate green on all seven |
| R7 — Lower-risk pipelines migrate without behavior or query-count regression | MET | test | MET. `config/workflows/docs-pipeline.yaml:45` — the precheck now runs soft `command.gate` probes instead of the compound shell program (`grep 'set +e'` over that file returns 0) and the `agent.run` count is unchanged at 1. Wrap half in `config/workflows/wrapup-pipeline.yaml` writes the metrics JSONL deterministically with no model hop. |
| R8 — Planning has one canonical entry path | MET | test | MET. `config/workflows/planning-pipeline.yaml` is deleted outright (ADR-072 accepted 2026-08-20, task 0606 R6) — the strongest form of the canonical-entry guarantee: the graph no longer exists, not merely unseeded. `RETIRED_PROJECT_SEEDS` removed as dead (`packages/config/src/bundled-config.ts`); fresh-project assertions in `packages/config/tests/bundled-config.test.ts` and `apps/cli/tests/init-templates.test.ts` prove a seeded project receives no planning graph. |
| R9 — Task execution preserves verification proof and ends with one canonical pipeline | MET | test | MET. **All three clauses now hold.** (a) Residual completeness is read-only by construction: `config/workflows/task-pipeline2.yaml` is deleted, the canonical pipeline has no `residual-sweep` state, and zero `agent.run` actions occur after `verify` (states after verify are `record`: proof.fingerprint+shell+shell, `done`: shell/run.artifact/note/shell). (b) **The ProofInputFingerprint digest is now wired** — task 0612 added the `proof.fingerprint` built-in, captured at `verify:onEnter:4` once the verdict artifact exists, stamped into the verdict artifact's `checks[]` at `verify:onEnter:5`, and re-compared at `record:onEnter:0` before any record write; a mid-chain change routes to `failed` (observed live: expected sha256:0e92531c… got sha256:3657f79f…). Wiring it also uncovered and fixed that `createGitAlternateTree` had returned `''` on every call since 0603, so the digest had never covered the working tree. (c) One canonical pipeline: ADR-076 (Accepted 2026-08-20) retired the promotion bar and deleted the duplicate graph rather than promoting it; `rg task-pipeline2` finds no caller in `config/`, `plugins/`, `apps/`, or `packages/`. |
| R10 — The idea pipeline migrates last with deterministic handoff and concise agent inputs | MET | test | MET. `config/workflows/idea-pipeline.yaml:392` — `handoff-finalize` now prefers `idea-handoff-cli.ts`, the tested entrypoint over `finalizeIdeaHandoff`, and falls through to the portable shell only for seeded projects with no `packages/` tree. That monorepo-writer/shell-fallback split is the one this task's Q&A prescribes. Six new tests in `packages/app/tests/workflow/idea-handoff-cli.test.ts`. |
| R11 — PR review spends quota once per stable integration HEAD without blocking by default | MET | test | MET. `config/workflows/feature-dev.yaml:144` — a new `integration-review` state invokes the pr-review graph once for the verified HEAD through a soft gate, leaving current-HEAD dedup where it already lives. The blocking edge is declared before the advisory one and fires only under the new `requireCleanReview` var (default false), so pending, timeout, and quota-unavailable stay advisory. |
| R12 — Every migration is independently verified and shipped surfaces stay synchronized | MET | test | MET for the waves that ran. `packages/app/tests/workflow/composition-baseline.test.ts:43` — `checkWorkflowComposition` is green against the live definitions, with the docs, task, and task-pipeline2 action maps re-derived into `config/workflow-composition-baseline.json` in this same commit. `spur workflow validate` passes on all seven definitions; the workflow suite is 379/379; `bun run lint` is clean. Recorded gap: the checker only compares an action's `invocation` when the baseline records one, and ~50 pre-existing actions record none. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
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
