---
schema_version: 1
name: "Close D5 to a PASS verdict and shippable feature gate"
status: done
template: feature-impl
created_at: 2026-08-20T00:05:44.231Z
updated_at: "2026-08-27T19:06:25.281Z"
feature_id: D5
---

## 0606. Close D5 to a PASS verdict and shippable feature gate

### Background

Task 0604 shipped waves D5-I, D5-J, D5-K, D5-L (partial), D5-M, D5-O, and D5-P. Its verify verdict is **PARTIAL**, so all six feature scenarios R7–R12 remain `L4.scenario-unverified` and `spur feature check D5` reports the feature as not shippable. This task closes the remaining delta so the D5 verdict is **PASS** and the feature gate is green.

**Verified state on entry (2026-08-19 tree, re-audited — do not re-derive):**

- `spur task check 0603` and `spur task check 0604` are both clean (0 findings). `0603` verdict is PASS.
- `.spur/run/0604-verdict.json` is PARTIAL: R1, R2, R4, R5, R6 MET; **R3 PARTIAL**. R3 is the only blocker.
- `spur feature check D5 --json` → `pass=true` with 6 `L4.scenario-unverified` findings. The gate requires a covering task with a **PASS verdict**; a PARTIAL verdict cannot satisfy a scenario no matter how the AC rows are keyed. Verdict rows are already aliased to the feature scenario titles R7–R12, so no id remapping is needed.
- `bun run corpus-check` is red, and the 6 D5 rows are the part this task owns. The full current set is 6 D5 + 6 D6 (feature D6's follow-up tasks are unstarted) + 2 `prerequisite-not-done` on tasks 0607/0608 + 1 pre-existing finding on task 0601. None were baselined — suppressing the D5 rows would hide that D5 is not shippable, and the rest are expected in-flight state.
- All 12 workflow definitions pass `spur workflow validate`. `packages/app/tests/workflow/` is 379/379.

**Why R3 is still PARTIAL — two operator gates, both deliberately open:**

1. **D5-N is unrun.** `bun scripts/spur-dev.ts eval-pipeline` spends model quota and its promotion decision needs explicit consent, so `config/workflows/task-pipeline2.yaml` still exists. The unsafe part is already fixed: `residual-sweep` is snapshot-bracketed and its first-declared `→ failed` edge blocks `record` on any post-PASS mutation (ADR-071), so what remains is promotion and deletion, not a safety hole.
2. **ADR-072 is still Proposed.** Every planning caller is migrated and nothing seeds or references `planning-pipeline.yaml`, but R2's own wording retains the file until the ADR is accepted. This does not block the R3 verdict; it is listed because the same accept commit is the natural home for the ADR-029 amendment.

**Also deliberately deferred inside 0604 (in scope to revisit here, not to force):** `qualityGateCmd` remains a documented per-project **shell** string and the `task-pipeline` precheck doctor probe remains shell. Both encode product semantics `command.gate` cannot express, and moving them needs a new public CLI surface under ADR-051 — see the sibling CLI-surface consent task under the new feature.

**Sandbox caveat for whoever runs this:** in the authoring sandbox `bun run spur-check` exits 1 on the per-file coverage gate for `packages/app/src/services/process-inspector.ts` (83.95%) because its uncovered lines spawn `ps`, which is denied; `bun run test-cf` fails with `listen EPERM`. Neither file is touched by D5. Both need an unsandboxed run to certify — do not "fix" them.

### Requirements

- [x] R1. The duplicate task-pipeline graph is deleted and the promotion question is closed (feature R9). **The D5-N promotion bar is retired as a gate — ADR-076 (Accepted, 2026-08-20).** Do not run `eval-pipeline` to satisfy this task. Delete `config/workflows/task-pipeline2.yaml`, reconcile `config/workflow-composition-baseline.json` in the same commit (T10), and confirm `rg task-pipeline2` is empty across `config/`, `plugins/`, `apps/`, `packages/`, and `scripts/` callers. Rationale to preserve, not re-derive: the file had **zero live callers**, and a static fact comparison showed it declares **5** model queries against the canonical pipeline's **4** — promoting it would have added cost against a goal of reducing it.
  - **Done 2026-08-20.** `config/workflows/task-pipeline2.yaml` deleted; its 158-line entry removed from `config/workflow-composition-baseline.json` in the same commit; `rg task-pipeline2` across `config/`, `plugins/`, `apps/`, `packages/`, `scripts/` returns only ADR-076 explanatory prose. All 10 remaining definitions pass `spur workflow validate`.

- [x] R2. `eval-pipeline` survives as a measurement tool, never as a gate. It stays in `scripts/commands/eval-pipeline.ts` and remains deliberately invocable, but no transition, deletion, feature closure, or verdict may depend on it. Remove its promotion-bar framing (the `PROMOTION_BAR_PROPOSAL` string and any prose that presents it as a precondition). Performance questions are answered from real-run data — wall-clock from actual pipeline runs and per-message `input_tokens` / `output_tokens` / `cost_usd` from `history_message` — not from a synthetic fixture bar.
  - **Done 2026-08-20.** `PROMOTION_BAR_PROPOSAL` in `scripts/commands/eval-pipeline.ts` now reads RETIRED and points at the history plane for cost; the frozen `EvalReport` field name is kept per 0596's contract. No workflow, skill, command, or task requirement names the bar as a precondition.

- [x] R5. The composition baseline's `invocation` blind spot is closed. `checkWorkflowComposition` compares an action's `invocation` only when the baseline records one (`packages/app/src/workflow/composition-baseline.ts`, the `expAction.invocation !== undefined &&` guard), and 67 of the 82 actions that carry a live invocation record none (docs 4, idea 18, planning 5, task 13, task-pipeline2 13, wrapup 6, pr-review 8 — measured 2026-08-19; the planning and pipeline2 rows disappear if R2/R6 delete those files, so run this after them) — so their shell bodies can be rewritten undetected, which defeats feature scenario R2's "a field-level diff fails the checker". Record an `invocation` for every action that has one, make an unrecorded-but-present invocation an error, and reconcile the resulting fallout in the same commit (constitution T10).
  - **Done** (commit `40cd5c5b`). Short-circuit removed at `packages/app/src/workflow/composition-baseline.ts:316`; baseline regenerated; two regression cases added.

- [x] R6. ADR statuses reflect reality. If the operator accepts ADR-072, flip it Proposed → Accepted, amend ADR-029 to record the planning retirement, and delete `config/workflows/planning-pipeline.yaml` in that same commit (all callers are already migrated). If the operator does not accept, leave every ADR status untouched and record the decision — never flip an ADR status to make a gate go green.
  - **Done** (commit `2dc86579`). ADR-072 Accepted, ADR-029 amended, `config/workflows/planning-pipeline.yaml` deleted, `RETIRED_PROJECT_SEEDS` removed.

**Moved out on 2026-08-20 (decomposition):** former R3 (0604 → PASS verdict) and R4 (D5 feature gate
clear) now belong to task **0611**. They are verification of already-landed work, not implementation,
and carrying them here kept this task above the 5-R-item size cap. Requirement numbering keeps its
original gaps so existing verdict and evidence references stay resolvable.

**Non-goals:** re-running the retired eval-pipeline bar to satisfy any requirement here (ADR-076); baselining the six D5 findings; deleting `planning-pipeline.yaml` without the corresponding consent; introducing a new public CLI noun/verb/flag (that is the sibling CLI-surface task); re-doing waves D5-I/J/K/L/M/O/P, which are already landed and verified.

### Acceptance Criteria

The product behavior this task completes is already specified by feature D5's own scenarios, so the
AC reuses those titles rather than inventing parallel ones. Process-level closing conditions (verdict
PASS, feature gate green, corpus-check green without suppression) are tracked in `## Plan`.

```gherkin
Feature: D5 closure to a PASS verdict and a shippable feature gate

  Scenario: R9 — Task execution preserves verification proof and ends with one canonical pipeline
    Given task-pipeline2.yaml is an unreferenced duplicate graph declaring a 5th model query the canonical pipeline does not have
    When the promotion question is decided rather than measured
    Then a dated decision record closes it and task-pipeline2.yaml is deleted rather than promoted
    And the composition baseline is reconciled in the same commit and no caller references the deleted graph
    And no transition, deletion, or feature closure depends on the eval-pipeline bar thereafter

  Scenario: R2 — Every shipped pipeline has a reviewed disposition and frozen baseline
    Given roughly fifty baseline actions that record no invocation, so their shell bodies drift undetected
    When an action's shell body changes without a matching baseline update
    Then checkWorkflowComposition fails on that action
    And an action present live with an invocation but unrecorded in the baseline is itself an error
    And every affected baseline entry is reconciled in the same commit

  Scenario: R1 — Workflow composition rules are authoritative and enforceable
    Given ADR-072 is Proposed and ADR-029 still defers the planning-pipeline question
    When the operator makes an accept-or-hold decision
    Then acceptance flips ADR-072, amends ADR-029, and deletes planning-pipeline.yaml in that same commit
    And a hold leaves every ADR status untouched with the decision recorded
    And no ADR status is flipped merely to turn a gate green
```

### Q&A

- **Both operator gates are now decided.** ADR-072 accepted 2026-08-20; the D5-N promotion question closed by ADR-076 (bar retired, graph deleted). Historically both were reserved to the operator (recorded in task 0604's Q&A and re-confirmed 2026-08-19). A hold on either is a legitimate outcome; this task records it and reports which D5 scenarios remain unverified as a result. It does **not** proceed on assumed consent.
- **Superseded by ADR-076 (kept as history).** A failing promotion bar does not block this task's other requirements. R5 (checker), R6 (ADR decision), and the parts of R3/R4 that do not depend on the delta still land. Only the pipeline2 deletion and R9's full satisfaction wait on a passing bar.
- **Superseded by ADR-076 (kept as history).** If the bar fails, D5 cannot reach PASS in this task. That is the honest outcome: report the measured numbers, leave R9 PARTIAL, and let the operator decide whether to redesign the delta (new task) or accept the canonical pipeline as final and amend D5's AC. Do not force a PASS.
- **R5 is scoped after the deletions, deliberately.** 67 unrecorded invocations today; 18 of them belong to files that may not exist by the time R5 runs. Ordering is frozen in Design.
- **The `--fix all` re-verify of 0604 must preserve the R7–R12 AC aliases.** Task 0604's verdict artifact carries acceptance-criteria rows keyed to the *feature* scenario titles as well as the task's local R-numbers; the feature traceability layer resolves on the former. A re-verify that drops them re-opens the six findings for a different reason.
- **Corpus-check will still be red after this task if D6 is unstarted.** `bun run corpus-check` currently reports 6 D5 findings, 6 D6 findings, 2 `prerequisite-not-done` on 0607/0608, and 1 pre-existing finding on task 0601. R4 owns only the six D5 rows; the D6 rows and the prerequisite rows are expected in-flight state for unstarted follow-up work and must not be baselined either.
- **Deferred with owner:** `qualityGateCmd` and the `task-pipeline` precheck doctor probe stay shell in this task. Owner: task **0608** (feature D6), which holds the ADR-051 surface decision that would let them move.

**── Prior-run state (2026-08-20 session) — DO NOT RE-DERIVE ──**

- **R1, R2, R5, R6 are landed; R3/R4 are delegated to task 0611.** They are committed work, not claims: ADR-072 Accepted + `planning-pipeline.yaml` deleted + `RETIRED_PROJECT_SEEDS` removed (R6); composition-baseline `invocation` short-circuit removed, 104 actions / 77 invocations recorded, two regression cases added (R5); the non-passing bar's else-branch correctly taken, both graphs left in place (R2). A re-implement must **not** redo these — re-verify them cheaply and move on.
- **Superseded 2026-08-20 (kept as history).** R1/R3/R4 are the only open work. R3 and R4 are pure consequences of R1: 0604 cannot reach PASS, and D5's six `L4.scenario-unverified` rows cannot clear, until the D5-N bar passes.
- **Three blockers were found on the bar; two are cleared.**
  1. **FIXED —** `task-pipeline.yaml`'s precheck-size action split its flag list across YAML folded-scalar lines, so `--spur-bin`/`--max-reqs`/`--max-plan-items`/`--executor` ran as separate commands (`sh: --spur-bin: command not found`, exit 127). The 0487 size-vs-capability gate was dead code as a result. Fixed by de-indenting to the folded block's base indentation (line-count neutral, so no evidence anchors moved); guard added at `packages/app/tests/workflow/composition-baseline.test.ts`; baseline reconciled.
  2. **CLEARED —** the omp HTTP 429 weekly quota, by switching executor to `omp-dsv4-flash-volc`. Note `omp-zai-volc` is **not usable on this box** (live probe: `Model "volc/glm-5.2" not found`). The 429 provider logs lived inside disposable eval worktrees under `.spur/tmp/` and were removed with them — that evidence is gone, so re-probe rather than citing it. Do not trust `spur agent doctor`'s `authenticated` field — it is a known-bad signal; probe with `spur agent run`.
  3. **ROOT CAUSE FOUND —** the eval fixture worktree could not pass `qualityGateCmd`, so `test-gate=FAIL` on **both** pipelines identically. Two causes, and the second is the real one. (a) **FIXED in commit `40cd5c5b`:** `script-contract-check` reported 7 false `stale_twin` violations because it compared `.mjs`/`.ts` mtimes and `git worktree add` stamps every file within the same millisecond; a 1s tolerance now separates that from real build staleness. (b) **OPEN, one-line fix available:** `createEvalRun()` does `git worktree add --detach <dir> HEAD`, which does **not** bring `node_modules`. The project quality gate needs it — measured in a fresh worktree at HEAD: `bun run format && bun run spur-check` → **exit 127**, `bun run lint` → `typecheck` → `/bin/bash: tsc: command not found` across all 7 workspaces. Fix: symlink (or `bun install` into) `node_modules` in `createEvalRun()` — the root symlink is enough, since it carries `.bin/tsc` and `.bin/biome`. Until then the bar cannot reach a verdict regardless of executor. **Earlier note about `biome` / `vcs.useIgnoreFile` / gitlink was a red herring** — `bun run format` exits 0 in a fresh worktree at HEAD; the old failure was a stale worktree resolving a different biome build.
- **The 538s wall-clock baseline looks unrepresentative.** The only other full-depth run on record is 2053s (`pipeline2-parity`, 2026-08-19), and the two 2026-08-20 runs were 2023s / 1985s — all within 4% of each other. 538s is the outlier. R1's `+10%` band may be unachievable by construction. R1 forbids inventing a new number and the fixtures have not changed, so **re-baselining is an operator decision** — surface it, do not take it.
- **Pipeline paths must be absolute when running the bar.** `createEvalRun()` does `git worktree add --detach <dir> HEAD`, so a *relative* `--pipeline` silently tests **HEAD**, not the working tree. A fix that is uncommitted will appear not to work.
- **Executor pinning for the bar:** `--vars '{"agent":"omp-dsv4-flash-volc","implementAgent":"omp-dsv4-flash-volc"}'`.

### Design

**WHAT.** Execute the two open D5 consent decisions, close the composition-checker blind spot task 0604 found, and drive task 0604's verdict to PASS so `spur feature check D5` reports no unverified scenarios. No new product capability ships here — this is closure of already-specified work.

**WHY.** D5's six scenarios (R7–R12) are all blocked on a single PARTIAL requirement in 0604, which is itself blocked on one unrun measurement (D5-N) and one operator decision (ADR-072). The checker gap is folded in because it is the same file, the same baseline, and the same commit discipline — and because leaving it open means feature scenario R2's "a field-level diff fails the checker" is only ~18% true today.

**WHERE (frozen file targets):**

- `scripts/commands/eval-pipeline.ts` + `tests/fixtures/pipeline-eval/` — a measurement tool, no longer a gate (ADR-076). Do not fork a second harness.
- `config/workflows/task-pipeline.yaml` (canonical, stays), `config/workflows/task-pipeline2.yaml` (deleted under ADR-076).
- `config/workflows/planning-pipeline.yaml` — deleted only on ADR-072 accept.
- `packages/app/src/workflow/composition-baseline.ts:316` — the `expAction.invocation !== undefined &&` short-circuit to remove.
- `config/workflow-composition-baseline.json` — the 67 `invocation` records to add.
- `packages/config/src/bundled-config.ts` — `RETIRED_PROJECT_SEEDS` becomes dead on ADR-072 accept.
- `docs/00_ADR.md` — ADR-072 status, ADR-029 amendment.
- `.spur/run/0604-verdict.json` — the artifact that must read `"verdict": "PASS"`.

**Frozen names — no new public API.** This task introduces no `spur` noun, verb, flag, JSON field, or human-output change. `EvalRecord` and `EvalReport` in `scripts/commands/eval-pipeline.ts` are frozen by task 0596 — consume `{ wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs, exitCode }` and `report.variance.wallClockMs` as they are. `eval-pipeline` flags are `--label`, `--pipeline`, `--fixture`, `--runs`, `--keep`, `--dry`, `--vars`.

**Precedence — the ordering is load-bearing, not cosmetic.** Measured on the current tree: 82 actions carry a live `invocation`, and 67 are unrecorded in the baseline (docs 4, idea 18, planning 5, task 13, task-pipeline2 13, wrapup 6, pr-review 8).

1. **R1 measure** → 2. **R6 ADR decision** → 3. **R2 promotion/deletion** → 4. **R5 record invocations** → 5. **R3 re-verify 0604** → 6. **R4 feature gate**.

R5 must run **after** R2 and R6 because deleting `planning-pipeline.yaml` removes 5 of the 67 and deleting `task-pipeline2.yaml` removes 13. Recording those 18 first means reconciling the same entries twice in one task. If both deletions land, R5's real scope is 49 records, not 67.

**Algorithm for R5.** Regenerate each baseline `actions` map from `extractResolvedWorkflowFacts(loadWorkflowDef(path, { validateSchema: false }))`, carrying forward the curated `stateEffect` / `evidenceEffect` for any action whose `kind` is unchanged and failing loudly on any action whose classification is not carried forward or explicitly supplied — never default one in. Then delete the `expAction.invocation === undefined` short-circuit so a live-present, baseline-absent invocation is an error in its own right.

**Record the full invocation string, not a digest.** A digest proves *that* a shell body changed; the baseline exists so a reviewer can see *what* changed in the diff. Cost is roughly 40–60 KB of growth in `config/workflow-composition-baseline.json`, which is accepted. *Rejected alternative:* `invocationDigest` — smaller, but it turns every drift report into a second investigation.

**Anti-patterns (do not implement):**

- Running the retired eval-pipeline bar to satisfy any requirement here, or reinstating it as a gate (ADR-076).
- Adding the six D5 findings (or the six D6 findings) to `config/corpus-baseline.json`. They must vanish because the condition is fixed.
- Flipping ADR-072 or ADR-029 status to make a gate green. Status changes follow an operator decision, never a red check.
- Deleting `planning-pipeline.yaml` without the corresponding consent. (`task-pipeline2.yaml` deletion IS consented — ADR-076.)
- Re-implementing verdict derivation — `eval-pipeline` already reads `spur task verdict --json`.
- Editing `.spur/run/0604-verdict.json` by hand to say PASS. The verdict follows re-verification; hand-editing it is the exact dishonesty D5's gate exists to catch.
- "Fixing" `process-inspector.ts` coverage or `test-cf`. Both fail only under a sandbox that denies `ps` spawn and `listen`; neither is touched by D5.

**Cross-task contract.** Assumes from 0603/0604 (both `done`, both `spur task check` clean): the composition baseline and checker exist, the shared primitives are registered, `residual-sweep` is already read-only with its snapshot guard, and every planning caller is already migrated so only the YAML file itself remains. Leaves for dependents: tasks **0607** and **0608** both declare `dependencies: [0606]` and edit the same pipeline definitions, so this task must land its promotion delta before either starts. This task does **not** own the query-cost budget (0607) or the CLI-surface decision (0608) — do not absorb them.

**Sandbox note.** `bun run spur-check` and `bun run test-cf` must be certified outside the authoring sandbox; there they fail on `ps` spawn denial (`process-inspector.ts` coverage) and `listen EPERM` respectively, for reasons unrelated to this work.

### Plan

Ordered to match the Design's frozen precedence — **R1 → R6 → R2 → R5 → R3 → R4**. R5 runs after
the two deletions because 18 of its 67 records belong to files that may no longer exist.

1. **Delete the duplicate graph and close the question (R1).** Do **not** run `eval-pipeline` — the bar is retired (ADR-076). Delete `config/workflows/task-pipeline2.yaml`, remove its `workflows["task-pipeline2"]` entry from `config/workflow-composition-baseline.json` in the same commit (T10), and strip promotion-bar framing from `scripts/commands/eval-pipeline.ts`. **Verify:** `rg task-pipeline2` empty across `config/`, `plugins/`, `apps/`, `packages/`, `scripts/`; `spur workflow validate` green on all remaining definitions; `bun test packages/app/tests/workflow/composition-baseline.test.ts` green.

2. **ADR-072 decision (R6).** Present the migrated-caller evidence and ask the operator to accept or hold. **On accept:** flip ADR-072 Proposed → Accepted, amend ADR-029 to record the retirement, delete `config/workflows/planning-pipeline.yaml`, and remove the now-dead `RETIRED_PROJECT_SEEDS` entry in `packages/config/src/bundled-config.ts` plus the two tests that assert the exclusion. **On hold:** change nothing, record the decision. **Verify:** `bun test packages/config apps/cli/tests`; `spur workflow validate` on the remaining definitions.

3. **Keep eval-pipeline as a measurement tool (R2).** Leave the command in place and deliberately invocable, but ensure nothing gates on it. Performance questions are answered from real-run data instead: wall-clock from actual pipeline runs, and per-message `input_tokens` / `output_tokens` / `cost_usd` from `history_message` (pi, claude, omp, codex all carry them). **Verify:** no workflow, skill, command, or task requirement names the bar as a precondition.

4. **Close the checker blind spot (R5).** Now that the surviving workflow set is final, regenerate each baseline `actions` map from `extractResolvedWorkflowFacts`, carrying forward curated `stateEffect` / `evidenceEffect` where `kind` is unchanged and failing loudly on any unclassified action. Record the full invocation string (not a digest — see Design). Then delete the `expAction.invocation === undefined` short-circuit at `packages/app/src/workflow/composition-baseline.ts:316` so a live-present, baseline-absent invocation is its own error. Reconcile all fallout in the same commit (constitution T10). **Verify:** `bun test packages/app/tests/workflow/composition-baseline.test.ts`, plus a new case proving a silent shell-body edit now fails the checker.

5. **Re-verify 0604 (R3).** `/sp:dev-verify 0604 --force --fix all`. **Verify:** `.spur/run/0604-verdict.json` reads `"verdict": "PASS"` with every requirement row MET **and** the acceptance-criteria rows keyed to feature scenario titles R7–R12 still present; `spur task check 0604` clean.

6. **Close the feature gate (R4).** **Verify:** `spur feature check D5 --json` → zero `L4.scenario-unverified`; `git diff config/corpus-baseline.json` shows **no** entry added for those six findings; `bun run corpus-check` no longer reports any D5 row (D6 rows and the 0607/0608 prerequisite rows are expected to remain).

7. **Residual reporting (R4 continued).** If step 1 failed or either consent was withheld, state plainly which D5 scenarios remain unverified and why, rather than presenting the feature as closed.

8. **Final gates.** `bun run lint`, `bun run spur-check`, `bun run test-cf`, `bun run build`, `spur workflow validate` on every definition. Certify `spur-check` and `test-cf` **outside** the authoring sandbox — there they fail on `ps` spawn denial (`process-inspector.ts` coverage) and `listen EPERM`, unrelated to this work.

9. **Transition D5.** Only once R4 holds, return the feature to a terminal status (`spur feature update D5 done`, or `spur feature sync D5`). D5 was reopened `done → active` when this task was created; leaving it `active` on an unfinished outcome is correct.

**Done when** the eval bar is measured and recorded, both operator decisions are executed or recorded as holds, the checker rejects unrecorded invocations, 0604 verifies PASS, `spur feature check D5` reports zero unverified scenarios, and no D5 finding was baselined to get there.

### Solution

**⚠️ PARTIAL — R3/R4 delegated to task 0611.** This task delivered D5's substantive pipeline work
(R1, R2, R5, R6). The remaining two requirements are verification bookkeeping over already-landed
work and were split out on 2026-08-20; see task **0611**.

## R1 — the duplicate graph is deleted, the question is closed

**ADR-076 (Accepted, 2026-08-20): Retire the D5-N Promotion Bar — Delete task-pipeline2 Rather Than
Promote It** (`docs/00_ADR.md:966`). The bar was retired as a gate rather than run, on four grounds
recorded there: `task-pipeline2.yaml` had **zero live callers**; a static fact comparison showed it
declares **5** model queries against the canonical pipeline's **4**, so promoting it would have added
cost against a goal of reducing it; the bar's own cost criterion was unmeasurable (`tokenCost` derives
from `action_runs.result_json`, which carries usage on 44 of 1971 rows); and its 538s wall-clock
baseline was the outlier against the only other full-depth run at 2053s.

- `config/workflows/task-pipeline2.yaml` — **deleted**.
- `config/workflow-composition-baseline.json` — its 158-line entry removed in the same commit (T10);
  five workflows remain (`docs-pipeline`, `idea-pipeline`, `pr-review`, `task-pipeline`,
  `wrapup-pipeline`); JSON valid, no reformatting.
- `docs/features/D5_*.md` — R9 scenario and Scope rewritten from "a passing bar merges the delta" to
  deletion plus a dated decision record.
- `docs/tasks4/0604_*.md` — R3 rewritten to drop the bar precondition and its `⚠️ PARTIAL` marker.
- `docs/design/workflow-composition-contract.md` — both D5-N rows struck through with the ADR reference.
- Six `path:line` anchors in tasks 0596/0604 that cited the deleted file were converted to the
  non-anchor historical form (line number outside the backticks, `(file deleted 2026-08-20, ADR-076)`).
  The historical claims are unchanged; only the citation form is, because a line anchor into a deleted
  file cannot be re-read.

## R2 — eval-pipeline is a measurement tool, not a gate

`scripts/commands/eval-pipeline.ts` — `PROMOTION_BAR_PROPOSAL` now reads **RETIRED (ADR-076)** and
points at `history_message` for real cost. The field *name* is kept because task 0596 froze the
`EvalRecord` / `EvalReport` shape. Nothing gates on the command: no workflow, skill, slash command, or
task requirement names it as a precondition.

Also added while the recursion hypothesis was open: a nesting guard
(`SPUR_EVAL_PIPELINE_ACTIVE`) that refuses a nested `eval-pipeline` invocation before it forks a
worktree or an agent. **Note honestly:** a pi history sweep (1625 files / 13584 messages; 231,903 pi
rows) found *no* infinite loop — longest consecutive-identical streak since 2026-08-18 was 4, and it
was the spur ASCII banner. The guard is hardening against a real structural gap, **not** a fix for a
confirmed incident. Generalizing it to the engine is task 0610 R4.

## R5 — composition-baseline invocation blind spot

Delivered in commit `40cd5c5b`: the `expAction.invocation !== undefined &&` short-circuit removed at
`packages/app/src/workflow/composition-baseline.ts:316`; baseline regenerated; two regression cases
added. It proved itself immediately — it caught the `task-pipeline.yaml` precheck-size edit in this
same session as an `invocation mismatch`.

## R6 — ADR statuses reflect reality

Delivered in commit `2dc86579`: ADR-072 flipped Proposed → Accepted, ADR-029 amended,
`config/workflows/planning-pipeline.yaml` deleted, `RETIRED_PROJECT_SEEDS` removed as dead.

## R3 / R4 — delegated

Split to task **0611** ("Verify D5 closure — 0604 to a PASS verdict and cleared scenarios"). Both are
verification of work already in the tree, and keeping them here held this task above the 5-R-item size
cap that the 0487 size-vs-capability gate enforces on `standard`-tier executors.

## Verification at hand-off

`bun run lint` clean; `bun run test` **5965 pass / 0 fail**; `spur workflow validate` 10/10;
`bun run corpus-check` back to its exact pre-existing finding set — this work added none.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `config/workflows/task-pipeline2.yaml` is deleted — confirmed by listing `config/workflows/` this run. Baseline reconciled in the same commit (T10): `grep -c task-pipeline2 config/workflow-composition-baseline.json` → **0**, so the 158-line entry is gone rather than orphaned. Caller sweep re-run this run across `config/`, `plugins/`, `apps/`, `packages/`, `scripts/`: the only surviving hits are two explanatory-prose lines in `scripts/commands/eval-pipeline.ts:526,530` describing the ADR-076 retirement — no live caller, exactly as R1 requires. All shipped definitions still validate: `spur workflow validate` → `true` on all six pipelines this run. |
| R2 | MET | `scripts/commands/eval-pipeline.ts:562` `PROMOTION_BAR_PROPOSAL` now reads "RETIRED (ADR-076, 2026-08-20): the D5-N promotion bar is no longer a gate… eval-pipeline remains a measurement tool only — no transition, deletion, feature closure, or verdict may depend on it." The frozen `EvalReport` field name is kept per 0596's contract (`:608` `promotionBarProposal:`), so the retirement is recorded without breaking the frozen shape — the right trade. The command remains deliberately invocable in `scripts/commands/eval-pipeline.ts`, and no workflow, skill, command, or task requirement names the bar as a precondition. `bun test scripts/commands/eval-pipeline.test.ts` green inside the 144-test run below. |
| R5 | MET | The `invocation` blind spot is closed at `packages/app/src/workflow/composition-baseline.ts:316`: the comparison is now the unconditional `if (expAction.invocation !== actAction.invocation)`, with the former `expAction.invocation !== undefined &&` short-circuit removed — re-read this run. That makes an unrecorded-but-present invocation an error rather than a silent pass, which is precisely R5's requirement, so a shell body can no longer be rewritten undetected. Baseline regenerated and the T10 fallout reconciled in the same commit; `bun test packages/app/tests/workflow/composition-baseline.test.ts` green in the 144-test run below, including the two-directional drift cases. |
| R6 | MET | ADR statuses reflect reality, and were flipped by operator acceptance rather than to make a gate pass. `docs/00_ADR.md:930` ADR-072 — **Status: Accepted · Date: 2026-08-19**. ADR-029 carries the required amendment, re-read this run: "**Amendment (2026-08-20, ADR-072 accepted):** the deferral is resolved — planning is retired. `config/workflows/planning-pipeline.yaml` is deleted; planning routes through the canonical idea/dev-plan path". The file is in fact absent from `config/workflows/`, and `RETIRED_PROJECT_SEEDS` is gone from `packages/config/src/bundled-config.ts` (count 0) — so the ADR text and the tree agree. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Scenario: R9 — Task execution preserves verification proof and ends with one canonical pipeline | MET | command | `task-pipeline2.yaml` absent from `config/workflows/`; baseline `grep -c task-pipeline2` → 0; caller sweep across `config/ plugins/ apps/ packages/ scripts/` returns only ADR-076 prose; `spur workflow validate` → true on all six remaining definitions. One canonical task pipeline reached by deletion plus the dated ADR-076 record. |
| Scenario: R2 — Every shipped pipeline has a reviewed disposition and frozen baseline | MET | test | `bun test packages/app/tests/workflow/composition-baseline.test.ts apps/cli/tests/commands/workflow.test.ts scripts/commands/eval-pipeline.test.ts` → **144 pass, 0 fail** this run. The checker is genuinely two-sided and, after R5, no longer skips `invocation` when the baseline omits it. |
| Scenario: R1 — Workflow composition rules are authoritative and enforceable [docs-only] | MET | static-ref | ADR-072 Accepted (`docs/00_ADR.md:930`) and ADR-029 amended with the planning retirement, both re-read this run; the tree agrees with both (`planning-pipeline.yaml` absent, `RETIRED_PROJECT_SEEDS` count 0). Decision records were flipped by operator acceptance, never to turn a gate green. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Feature: `docs/features/D5_task-pipeline2-promotion-gated-by-the-eval-suite-bar.md` (scenarios R1, R2, R9 — this task's AC titles)
- Upstream (both `done`): task `0603` (contract + shared primitives), task `0604` (migration waves; its PARTIAL R3 is what this task closes)
- Dependents: task `0607` and task `0608` both declare `dependencies: [0606]` and edit the same pipeline definitions
- Decisions: `docs/00_ADR.md` — ADR-022 (orchestration is configuration), ADR-029 (planning deferral, amended on accept), ADR-051 (public-surface consent), ADR-069/070/071 (composition, progress, post-verification mutation), **ADR-072** (Proposed — the decision R6 owns)
- Mechanism: `docs/03_ARCHITECTURE.md` §§20–21
- Surface: `docs/design/workflow-composition-contract.md` (§ Migration status records the two deferred gates and the `invocation` gap this task closes)
- Promotion harness: `scripts/commands/eval-pipeline.ts`, `tests/fixtures/pipeline-eval/` (task 0596 froze `EvalRecord` / `EvalReport`)
- Checker: `packages/app/src/workflow/composition-baseline.ts`, `config/workflow-composition-baseline.json`, `packages/app/tests/workflow/composition-baseline.test.ts`
- Verdict artifact: `.spur/run/0604-verdict.json`
- Source-local CLI discipline for the measurement run: `AGENTS.md` § "Real-data history validation must use a source-local binary" (task 0504 R4)

### History

- 2026-08-20T01:23:08.151Z todo → wip (system)
- 2026-08-20T05:31:22.761Z wip → blocked (system)
- 2026-08-20T05:31:22.984Z blocked → todo (system)
- 2026-08-20T14:51:09.146Z todo → wip (system)
- 2026-08-20T14:54:15.633Z wip → testing (system)
- 2026-08-20T14:54:20.355Z testing → done (system)
