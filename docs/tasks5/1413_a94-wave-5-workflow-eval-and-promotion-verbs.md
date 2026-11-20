---
schema_version: 1
name: "A94 wave 5: workflow eval and promotion verbs"
status: done
template: feature-impl
created_at: 2026-11-20T07:58:05.085Z
updated_at: "2026-11-20T18:36:50.332Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

dependencies: ["1410"]
estimate_hours: 6
done_forced: "false"
done_reason: unforced close
---

## 1413. A94 wave 5: workflow eval and promotion verbs

### Background

Implements: R9 — Pipeline evaluation is a workflow verb; R10 — Workflow promotion records are workflow verbs.

eval-pipeline and workflow-promotion are useful to any project authoring pipelines (C7, C8).

Design authority: docs/design/downstream-tooling-absorption.md (consent C1–C10 granted 2026-11-19).

**Refine corrections (2026-11-20)**

- "Fixtures resolve via the template layer" → fixtures live in the test tree (`scripts/commands/eval-pipeline.ts:33` `tests/fixtures/pipeline-eval/templates/fixture-minimal.md`), which is not shipped. No pipeline-eval layer exists in `config/templates/`. → Move them to `config/templates/pipeline-eval/`, which ships via `bundle-config`. Resolution order: project `.spur/templates/pipeline-eval/<name>.md`, then bundled (`bundledConfigRoot()/templates/pipeline-eval`, `packages/config/src/bundled-config.ts:102`).
- Flag parity → today's flags are `--label --pipeline --fixture --runs --keep --dry --vars`. C7 grants `<pipeline>… --fixture --runs --label --keep --dry-run`. → `--pipeline` becomes the positional `<pipeline>…` and `--dry` becomes `--dry-run`. `--vars` is **not in C7**, so it is dropped. Fixture variables come from the fixture template frontmatter. Passing `--vars` is a usage error. The operator can grant it later; no current caller passes `--vars` (rg 2026-11-20: only the script's own test).
- "Detached run-local worktree" → today it is created at `$TMPDIR/spur-eval-pipeline-*/worktree`, outside the project. Fixture WBS start at `FIXTURE_BASE_COUNTER = 9499` (`:55`). Nesting is guarded by `SPUR_EVAL_PIPELINE_ACTIVE` (`:601`, documented at `docs/help/environment_variables.md:83`). → All of it is kept unchanged.
- `promotion` dispatcher case is at `scripts/spur-dev.ts:194` (R3 cited only `:173` for `eval-pipeline`). Candidates path is hardcoded to `REPO_ROOT/config/workflow-candidates.json` (`workflow-promotion.ts:53`). → `--candidates <path>` defaults to `config/workflow-candidates.json` under the cwd. A missing file → exit 2 `candidates file not found: <path>`.
- Root `eval` (`package.json:97`) stays skill-eval and retained, as stated.

- Erratum: the `--vars` usage check found no caller at all, not even the script test (`rg "eval-pipeline.*--vars"`, 2026-11-20). Only the parser itself mentions it (`eval-pipeline.ts:331`).

### Requirements

- [x] R1. `spur workflow eval <pipeline>… [--fixture <name>] [--runs <n>] [--label <s>] [--keep] [--dry-run] [--json]` keeps the eval record shape:
  - per run: `wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs, exitCode`;
  - aggregate: `runCount`, variance.

  It also keeps the worktree isolation, the 9499+ fixture WBS range and the `SPUR_EVAL_PIPELINE_ACTIVE` nesting refusal. `--fixture` defaults to `fixture-minimal`. An unknown fixture → exit 2 listing the searched paths.
- [x] R2. Three verbs share `--candidates <path>` (default `config/workflow-candidates.json`), `--json`, and today's schema and refusal semantics (zero-history refusal, strict-fewer bar, pinned baseline, contradicting resolve refused):
  - `spur workflow promote-check`
  - `spur workflow promote-evaluate <id>`
  - `spur workflow promote-resolve <id>`
- [x] R3. Root `package.json:100` `workflow-promotion-check` runs `bun run apps/cli/src/index.ts workflow promote-check`. The `eval-pipeline` (`scripts/spur-dev.ts:173`) and `promotion` (`:194`) cases go to RETIRED. `scripts/commands/{eval-pipeline,workflow-promotion}.ts` and their tests move or are deleted. `tests/fixtures/pipeline-eval/templates/*` moves to `config/templates/pipeline-eval/`. The A94 inventory is updated.

**Out of scope:** `--vars` (not consented), skill-eval, new candidate-schema fields, nested groups (`workflow promotion <op>` was rejected).

### Acceptance Criteria

- [x] AC1 — Pipeline evaluation is a workflow verb (req: R1, R3)
- [x] AC2 — Workflow promotion records are workflow verbs (req: R2, R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-20T08:36:00.133Z

- **Q:** Keep `--vars`? **A (closed):** no. It is outside C7 with no live caller, and fixture frontmatter carries variables. The operator may grant it as a follow-up.
- **Q:** Where do fixtures live so downstream can use them? **A (closed):** bundled `config/templates/pipeline-eval/`, overridable by project `.spur/templates/pipeline-eval/`.

### Design

**WHAT/WHY.** Pipeline evaluation and promotion bookkeeping are workflow lifecycle concerns that downstream projects need for their own pipelines. They become leaf workflow verbs over `packages/app` services.

**WHERE (frozen).**
- `packages/app/src/workflow/pipeline-eval.ts`: `git mv` from `scripts/commands/eval-pipeline.ts`. Replace `REPO_ROOT` with `projectRoot`. Swap `FIXTURE_DIR` for `resolveEvalFixture(projectRoot, name)` (project layer, then bundled).
- `packages/app/src/workflow/promotion-evaluation.ts`: existing core. Fold the CLI-only glue from `scripts/commands/workflow-promotion.ts` (`check`/`evaluate`/`resolve` entry functions) into `packages/app/src/workflow/promotion-commands.ts`.
- CLI: `apps/cli/src/commands/workflow/{eval,promote-check,promote-evaluate,promote-resolve}.ts`, registered in `workflow/index.ts`, with shared flag helpers in `workflow/shared.ts`.
- Tests:
  - `scripts/commands/eval-pipeline.test.ts` → `packages/app/tests/workflow/pipeline-eval.test.ts`;
  - `workflow-promotion{,.e2e}.test.ts` → `apps/cli/tests/commands/workflow/promote.e2e.test.ts` plus an app test.
- `config/templates/pipeline-eval/fixture-minimal.md` and its README.

**Edge rules.**
- `--runs` is a positive integer ≤ 20, else exit 2.
- `--dry-run` prints the resolved plan (pipelines, fixture path, worktree root) and creates nothing.
- `--keep` retains the worktree path in the JSON.

**Handoff.** 1415 covers the four verbs in the surface-shape test and adds a workflow rows section to the spur-cli reference.

**Anti-patterns.**
- No `--vars`.
- No `--pipeline` alias.
- No worktree inside the project tree.
- No change to the record field names.
- No `promotion` subcommand group.

### Plan

- [x] 1. Write a failing E2E `apps/cli/tests/commands/workflow/eval-promote.e2e.test.ts`:
  - `workflow eval task-pipeline.yaml --dry-run --json` prints the plan, and a project-layer fixture override wins;
  - an unknown fixture → 2; `--vars` → usage error; nested `SPUR_EVAL_PIPELINE_ACTIVE=1` → refusal;
  - the promote verbs against a temp candidates file: zero-history refusal, strict-fewer pass/fail, contradicting resolve refused.

  (R1, R2)
- [x] 2. Move the service and fixtures, add the fixture resolver. (R1)
- [x] 3. Add the promotion command glue and register the four verbs. (R1, R2)
- [x] 4. Rewire `package.json:100`, add RETIRED entries, delete the scripts, update A94. (R3)
- [x] 5. Receipt `.spur/run/1413-receipt.md`: one real `workflow eval` (`--runs 1`) record, `bun run workflow-promotion-check`, packed and standalone `--dry-run` proofs, `bun run spur-check`. (all)

### Solution

**WHAT.** Pipeline comparison and candidate promotion became four leaf workflow verbs (`eval`, `promote-check`, `promote-evaluate`, `promote-resolve`) over services in `packages/app/src/workflow/`; the fixture catalog moved to the bundled `config/templates/pipeline-eval/` with a project-layer override, and the two repository scripts retired.

**WHY.** A downstream project runs its own pipelines but had no way to compare them or to keep the candidate/deadline discipline; both lived in `scripts/commands/` behind repository paths.

**Change map** (one anchored row per file):

| Area | Anchor | Change |
| --- | --- | --- |
| eval service | packages/app/src/workflow/pipeline-eval.ts:99 | moved from `scripts/commands/`, roots pinned by `configureEvalRoots`, executor-based spawns |
| fixture resolution | packages/app/src/workflow/pipeline-eval.ts:141 | `resolveEvalFixture`: project layer then bundled catalog, unknown fixture names every searched path |
| nesting guard | packages/app/src/workflow/pipeline-eval.ts:676 | per-invocation: set for the call, cleared afterwards (children inherit during the run) |
| eval entry | packages/app/src/workflow/pipeline-eval.ts:702 | returns `{report, reportPath, lines, keptWorktrees}` instead of printing |
| dry-run plan | packages/app/src/workflow/pipeline-eval.ts:790 | `planEval` resolves pipelines, fixtures and worktree root without creating anything |
| promotion service | packages/app/src/workflow/promotion-commands.ts:60 | moved from `scripts/commands/`, roots pinned, three verb entry points returning outcomes |
| promotion entry points | packages/app/src/workflow/promotion-commands.ts:397 | `promoteCheck` / `promoteEvaluate` / `promoteResolve`, refusal lines preserved verbatim |
| zero-history tolerance | packages/app/src/workflow/promotion-commands.ts:495 | no history DB → measured on an empty window instead of failing |
| app barrel | packages/app/src/index.ts:1339 | exports both services, their types and helpers |
| eval transport | apps/cli/src/commands/workflow/eval.ts:46 | `--fixture/--runs/--label/--keep/--dry-run/--json`, exit 0/1/2 |
| promote transport | apps/cli/src/commands/workflow/promote.ts:63 | three verbs, findings envelope, uniform flag grammar |
| workflow noun | apps/cli/src/commands/workflow/index.ts:32 | registers the four verbs |
| fixture catalog | config/templates/pipeline-eval/fixture-minimal.md:1 | moved from `tests/fixtures/pipeline-eval/` (bundled and overridable) |
| root script | package.json:100 | `workflow-promotion-check` runs the verb |
| dispatcher | scripts/spur-dev.ts:110 | `eval-pipeline` and `promotion` RETIRED; imports, cases and usage entries removed |
| inventory | docs/reports/A94-script-ownership.json:1 | 40 → 35 entries; caller anchors re-resolved |
| boundary rule | config/rules/strict/runtime-boundaries.yaml:88 | two fs-io exemptions (mtime snapshots, recursive worktree cleanup) |
| tests | packages/app/tests/workflow/pipeline-eval.test.ts:1 | moved; adds the full dry-run, non-dry and variance paths |
| tests | packages/app/tests/workflow/promotion-commands-coverage.test.ts:1 | the service suite (moved from `apps/cli`) |
| tests | apps/cli/tests/commands/workflow/eval.test.ts:1 | transport: plan, unknown fixture, runs bounds, nesting, JSON, text failure |
| tests | apps/cli/tests/commands/workflow/promote.test.ts:1 | transport: check/evaluate/resolve outcomes and usage errors |
| tests | apps/cli/tests/commands/workflow/promote.e2e.test.ts:1 | moved E2E against disposable fixtures through the verbs |
| help pages | docs/help/cmd_workflow.md:86 | four verb sections with their flags |
| plugin help page | docs/help2/workflow.md:39 | the same four sections |
| prompt reference | plugins/sp/skills/spur-cli/references/workflows.md:271 | command surface + the eval/promotion rows |
| surface matrix | docs/help/spur-cli-matrix.md:22 | `workflow` 17 → 21 verbs, unique 102 → 106, cells 129 → 133 |
| JSON inventory | docs/design/data-output-contracts.md:224 | eval + three promote rows |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/src/workflow/pipeline-eval.ts:702 (`evalPipeline` keeps the record shape) and :790 (`planEval`); transport proven at apps/cli/tests/commands/workflow/eval.test.ts (plan, bounds, unknown fixture, nesting, JSON, text) |
| R2 | MET | packages/app/src/workflow/promotion-commands.ts:397-545 (three verbs, unchanged refusal semantics); transport at apps/cli/tests/commands/workflow/promote.test.ts and the moved E2E |
| R3 | MET | package.json:100 runs the verb; scripts/spur-dev.ts:110 retires both names; scripts, tests and the fixture catalog moved; inventory 40 → 35 (`docs/reports/A94-script-ownership.json`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Pipeline evaluation is a workflow verb (req: R1, R3) | MET | test | apps/cli/tests/commands/workflow/eval.test.ts — 7 cases incl. a JSON dry-run over a fixture project and a text run whose record exits 1 |
| AC2 — Workflow promotion records are workflow verbs (req: R2, R3) | MET | test | apps/cli/tests/commands/workflow/promote.test.ts (7 transport cases) + promote.e2e.test.ts (9 end-to-end cases through the verbs) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Satellite §4 (eval record, promotion semantics), §5 C7/C8.
- Code: `scripts/commands/eval-pipeline.ts:33,55,601`, `scripts/commands/workflow-promotion.ts:53`, `packages/app/src/workflow/promotion-evaluation.ts`, `packages/config/src/bundled-config.ts:102`, `docs/help/environment_variables.md:83`.
- Upstream: 1410. Downstream: 1415.

### History

- 2026-11-20T17:46:08.115Z todo → wip (system)
- 2026-11-20T18:36:49.093Z wip → testing (system)
- 2026-11-20T18:36:50.326Z testing → done (system)

