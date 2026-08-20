---
schema_version: 1
name: "Close D5 to a PASS verdict and shippable feature gate"
status: wip
template: feature-impl
created_at: 2026-08-20T00:05:44.231Z
updated_at: "2026-08-20T02:19:16.260Z"
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
- [ ] R1. The D5-N promotion bar is executed and recorded. Run `bun scripts/spur-dev.ts eval-pipeline` (source-local, never a global `spur`) against the current `task-pipeline.yaml` and the redesigned `task-pipeline2.yaml`. Require exit 0, verdict parity, proof-state validity, model-query count within the frozen baseline, and wall-clock within +10% of the recorded PASS baseline (I6: 538s — re-measure if `tests/fixtures/pipeline-eval/` changed; do not invent a new number). Record the measured numbers in `## Testing`. A failing bar is a legitimate outcome: report it and stop rather than widening the band.

- [ ] R2. On a passing bar **and** explicit operator consent, the duplicate task graph is retired. Fold the proof-preserving residual delta into `config/workflows/task-pipeline.yaml`, delete `config/workflows/task-pipeline2.yaml`, remove its callers, and update `config/workflow-composition-baseline.json` in the same commit. `rg task-pipeline2` must be empty across `config/`, `plugins/`, and `docs/` callers afterwards. Without consent, leave both files and record the bar result — do not delete on your own authority.

- [ ] R3. Task 0604's verify verdict becomes PASS. Re-run `/sp:dev-verify 0604 --force --fix all` after R1/R2 land so R3 (feature scenario R9) is MET rather than PARTIAL, and `.spur/run/0604-verdict.json` carries `"verdict": "PASS"`. The verdict's AC rows are already aliased to the feature scenario titles R7–R12; preserve that aliasing so the feature traceability layer resolves them.

- [ ] R4. `spur feature check D5` reports zero `L4.scenario-unverified` findings and the feature is shippable. All six scenarios R7–R12 resolve to a covering task with a PASS verdict and a MET requirement. `bun run corpus-check` is green with **no new entry added to `config/corpus-baseline.json` for these six findings** — they must disappear because the condition is fixed, never because it was suppressed.

- [ ] R5. The composition baseline's `invocation` blind spot is closed. `checkWorkflowComposition` compares an action's `invocation` only when the baseline records one (`packages/app/src/workflow/composition-baseline.ts`, the `expAction.invocation !== undefined &&` guard), and 67 of the 82 actions that carry a live invocation record none (docs 4, idea 18, planning 5, task 13, task-pipeline2 13, wrapup 6, pr-review 8 — measured 2026-08-19; the planning and pipeline2 rows disappear if R2/R6 delete those files, so run this after them) — so their shell bodies can be rewritten undetected, which defeats feature scenario R2's "a field-level diff fails the checker". Record an `invocation` for every action that has one, make an unrecorded-but-present invocation an error, and reconcile the resulting fallout in the same commit (constitution T10).

- [ ] R6. ADR statuses reflect reality. If the operator accepts ADR-072, flip it Proposed → Accepted, amend ADR-029 to record the planning retirement, and delete `config/workflows/planning-pipeline.yaml` in that same commit (all callers are already migrated). If the operator does not accept, leave every ADR status untouched and record the decision — never flip an ADR status to make a gate go green.

**Non-goals:** widening the eval-pipeline promotion band to force a pass; baselining the six D5 findings; deleting `task-pipeline2.yaml` or `planning-pipeline.yaml` without the corresponding consent; introducing a new public CLI noun/verb/flag (that is the sibling CLI-surface task); re-doing waves D5-I/J/K/L/M/O/P, which are already landed and verified.
### Acceptance Criteria
The product behavior this task completes is already specified by feature D5's own scenarios, so the
AC reuses those titles rather than inventing parallel ones. Process-level closing conditions (verdict
PASS, feature gate green, corpus-check green without suppression) are tracked in `## Plan`.

```gherkin
Feature: D5 closure to a PASS verdict and a shippable feature gate

  Scenario: R9 — Task execution preserves verification proof and ends with one canonical pipeline
    Given the canonical task pipeline and the residual-safe pipeline2 both on the shared prerequisites
    When `bun scripts/spur-dev.ts eval-pipeline` runs source-local and the operator consents to promotion
    Then the bar exits 0 with verdict parity, valid proof state, model-query count within baseline, and wall-clock within +10% of the recorded PASS baseline
    And the proof-preserving delta is folded into task-pipeline.yaml and task-pipeline2.yaml is removed with its callers
    And without a passing bar or without consent both graphs remain and only the measured result is recorded

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
- **The two operator gates are decisions, not blockers to route around.** ADR-072 accept and D5-N promotion consent are both explicitly reserved to the operator (recorded in task 0604's Q&A and re-confirmed 2026-08-19). A hold on either is a legitimate outcome; this task records it and reports which D5 scenarios remain unverified as a result. It does **not** proceed on assumed consent.
- **A failing promotion bar does not block this task's other requirements.** R5 (checker), R6 (ADR decision), and the parts of R3/R4 that do not depend on the delta still land. Only the pipeline2 deletion and R9's full satisfaction wait on a passing bar.
- **If the bar fails, D5 cannot reach PASS in this task.** That is the honest outcome: report the measured numbers, leave R9 PARTIAL, and let the operator decide whether to redesign the delta (new task) or accept the canonical pipeline as final and amend D5's AC. Do not force a PASS.
- **R5 is scoped after the deletions, deliberately.** 67 unrecorded invocations today; 18 of them belong to files that may not exist by the time R5 runs. Ordering is frozen in Design.
- **The `--fix all` re-verify of 0604 must preserve the R7–R12 AC aliases.** Task 0604's verdict artifact carries acceptance-criteria rows keyed to the *feature* scenario titles as well as the task's local R-numbers; the feature traceability layer resolves on the former. A re-verify that drops them re-opens the six findings for a different reason.
- **Corpus-check will still be red after this task if D6 is unstarted.** `bun run corpus-check` currently reports 6 D5 findings, 6 D6 findings, 2 `prerequisite-not-done` on 0607/0608, and 1 pre-existing finding on task 0601. R4 owns only the six D5 rows; the D6 rows and the prerequisite rows are expected in-flight state for unstarted follow-up work and must not be baselined either.
- **Deferred with owner:** `qualityGateCmd` and the `task-pipeline` precheck doctor probe stay shell in this task. Owner: task **0608** (feature D6), which holds the ADR-051 surface decision that would let them move.
### Design
**WHAT.** Execute the two open D5 consent decisions, close the composition-checker blind spot task 0604 found, and drive task 0604's verdict to PASS so `spur feature check D5` reports no unverified scenarios. No new product capability ships here — this is closure of already-specified work.

**WHY.** D5's six scenarios (R7–R12) are all blocked on a single PARTIAL requirement in 0604, which is itself blocked on one unrun measurement (D5-N) and one operator decision (ADR-072). The checker gap is folded in because it is the same file, the same baseline, and the same commit discipline — and because leaving it open means feature scenario R2's "a field-level diff fails the checker" is only ~18% true today.

**WHERE (frozen file targets):**

- `scripts/commands/eval-pipeline.ts` + `tests/fixtures/pipeline-eval/` — the promotion bar. Reuse; do not fork a second harness.
- `config/workflows/task-pipeline.yaml`, `config/workflows/task-pipeline2.yaml` — the promotion delta and the deletion.
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

- Widening the eval-pipeline promotion band, changing the fixture set, or re-running until a pass appears. A failing bar is a reportable result.
- Adding the six D5 findings (or the six D6 findings) to `config/corpus-baseline.json`. They must vanish because the condition is fixed.
- Flipping ADR-072 or ADR-029 status to make a gate green. Status changes follow an operator decision, never a red check.
- Deleting `task-pipeline2.yaml` or `planning-pipeline.yaml` without the corresponding consent.
- Re-implementing verdict derivation — `eval-pipeline` already reads `spur task verdict --json`.
- Editing `.spur/run/0604-verdict.json` by hand to say PASS. The verdict follows re-verification; hand-editing it is the exact dishonesty D5's gate exists to catch.
- "Fixing" `process-inspector.ts` coverage or `test-cf`. Both fail only under a sandbox that denies `ps` spawn and `listen`; neither is touched by D5.

**Cross-task contract.** Assumes from 0603/0604 (both `done`, both `spur task check` clean): the composition baseline and checker exist, the shared primitives are registered, `residual-sweep` is already read-only with its snapshot guard, and every planning caller is already migrated so only the YAML file itself remains. Leaves for dependents: tasks **0607** and **0608** both declare `dependencies: [0606]` and edit the same pipeline definitions, so this task must land its promotion delta before either starts. This task does **not** own the query-cost budget (0607) or the CLI-surface decision (0608) — do not absorb them.

**Sandbox note.** `bun run spur-check` and `bun run test-cf` must be certified outside the authoring sandbox; there they fail on `ps` spawn denial (`process-inspector.ts` coverage) and `listen EPERM` respectively, for reasons unrelated to this work.
### Plan
Ordered to match the Design's frozen precedence — **R1 → R6 → R2 → R5 → R3 → R4**. R5 runs after
the two deletions because 18 of its 67 records belong to files that may no longer exist.

1. **Measure the bar (R1).** Run `bun scripts/spur-dev.ts eval-pipeline` source-local — never a global `spur`, which silently wins on PATH and runs stale code (AGENTS.md, task 0504 R4). Re-measure the PASS baseline first if `tests/fixtures/pipeline-eval/` changed since I6's 538s. Consume the frozen `EvalRecord` / `EvalReport` shapes; do not fork a harness. **Verify:** exit code, verdict parity, proof-state validity, `tokenCost`, and `wallClockMs` vs the ±10% band, all pasted into `## Testing`. A failing bar is recorded and reported, never re-run until green.

2. **ADR-072 decision (R6).** Present the migrated-caller evidence and ask the operator to accept or hold. **On accept:** flip ADR-072 Proposed → Accepted, amend ADR-029 to record the retirement, delete `config/workflows/planning-pipeline.yaml`, and remove the now-dead `RETIRED_PROJECT_SEEDS` entry in `packages/config/src/bundled-config.ts` plus the two tests that assert the exclusion. **On hold:** change nothing, record the decision. **Verify:** `bun test packages/config apps/cli/tests`; `spur workflow validate` on the remaining definitions.

3. **Promotion decision and deletion (R2).** Present the step-1 numbers. **On a passing bar plus consent:** fold the proof-preserving residual delta into `config/workflows/task-pipeline.yaml`, delete `config/workflows/task-pipeline2.yaml` and its callers, and update `config/workflow-composition-baseline.json` in the same commit. **Otherwise:** leave both graphs and record the result. **Verify:** `rg task-pipeline2` empty across `config/`, `plugins/`, `docs/`; `spur workflow validate` green on every remaining definition.

4. **Close the checker blind spot (R5).** Now that the surviving workflow set is final, regenerate each baseline `actions` map from `extractResolvedWorkflowFacts`, carrying forward curated `stateEffect` / `evidenceEffect` where `kind` is unchanged and failing loudly on any unclassified action. Record the full invocation string (not a digest — see Design). Then delete the `expAction.invocation === undefined` short-circuit at `packages/app/src/workflow/composition-baseline.ts:316` so a live-present, baseline-absent invocation is its own error. Reconcile all fallout in the same commit (constitution T10). **Verify:** `bun test packages/app/tests/workflow/composition-baseline.test.ts`, plus a new case proving a silent shell-body edit now fails the checker.

5. **Re-verify 0604 (R3).** `/sp:dev-verify 0604 --force --fix all`. **Verify:** `.spur/run/0604-verdict.json` reads `"verdict": "PASS"` with every requirement row MET **and** the acceptance-criteria rows keyed to feature scenario titles R7–R12 still present; `spur task check 0604` clean.

6. **Close the feature gate (R4).** **Verify:** `spur feature check D5 --json` → zero `L4.scenario-unverified`; `git diff config/corpus-baseline.json` shows **no** entry added for those six findings; `bun run corpus-check` no longer reports any D5 row (D6 rows and the 0607/0608 prerequisite rows are expected to remain).

7. **Residual reporting (R4 continued).** If step 1 failed or either consent was withheld, state plainly which D5 scenarios remain unverified and why, rather than presenting the feature as closed.

8. **Final gates.** `bun run lint`, `bun run spur-check`, `bun run test-cf`, `bun run build`, `spur workflow validate` on every definition. Certify `spur-check` and `test-cf` **outside** the authoring sandbox — there they fail on `ps` spawn denial (`process-inspector.ts` coverage) and `listen EPERM`, unrelated to this work.

9. **Transition D5.** Only once R4 holds, return the feature to a terminal status (`spur feature update D5 done`, or `spur feature sync D5`). D5 was reopened `done → active` when this task was created; leaving it `active` on an unfinished outcome is correct.

**Done when** the eval bar is measured and recorded, both operator decisions are executed or recorded as holds, the checker rejects unrecorded invocations, 0604 verifies PASS, `spur feature check D5` reports zero unverified scenarios, and no D5 finding was baselined to get there.
### Solution
## R1 measurement (D5-N promotion bar) — attempted, NOT executable today

Ran `bun scripts/spur-dev.ts eval-pipeline --pipeline config/workflows/task-pipeline.yaml --pipeline config/workflows/task-pipeline2.yaml` (source-local, never a global spur). Both fixture runs died before any verdict — the bar cannot be measured in this environment right now:

- **task-pipeline2.yaml**: precheck PASS → `implement/agent.run` exited 3 with **HTTP 429 "Weekly usage limit reached. Resets in 4 days"** from the omp provider (`opencode/deepseek-v4-flash`). The model hop that runs `/sp:dev-run --mode implement` cannot get a response.
- **task-pipeline.yaml**: died earlier at the precheck size gate. The eval harness resolves `spurBin` from the run process launch (`scripts/commands/eval-pipeline.ts:28` `SPUR_BIN` + `apps/cli/src/workflow/resolve-spur-bin.ts:47` `resolveSpurBin`), which points into the disposable worktree (`bun <worktree>/apps/cli/src/index.ts`); the worktree has no `node_modules`, so the CLI cannot resolve `@commander-js/extra-typings` and `task show 9500` fails → size precheck writes FAIL. This is a harness/worktree artifact, not a task-pipeline defect; the same 429 would block implement regardless.

**Measured numbers:** exit=1 for both pipelines; verdict=UNKNOWN (no run completed); wallClockMs 1.5s / 4.4s (pre-verdict, not comparable to the 538s baseline); tokenCost=null; gateOutcomes show only precheck rows. Reports: `.spur/reports/pipeline-eval/2026-08-20T01-00-13-128Z-d5n-bar-0606.json`, `...-keep-inspect.json`, `...-keep-p2.json`. Reproducible: HTTP 429 from the omp provider. Primary evidence is the provider run log `.spur/run/4ae04c92-0428-4ee8-8931-6e29bad075fa.log` — "Weekly usage limit reached. Resets in 4 days" with `retry-after-ms=359796000` (~4.16 days); a sibling run log records `retry-after-ms=365476000`. (Verify re-audit 2026-08-19: an earlier draft of this section cited "Resets in 4 days" and `retry-after-ms=359796000`; that figure appears only in downstream authored artifacts, never in a provider log, and is corrected here to the logged values.)

Per R1's own rule ("a failing bar is a legitimate outcome: report it and stop rather than widening the band"), this is a reportable blocker, not a reason to widen the band or re-run until green. Nothing was promoted or deleted; both graphs remain.

## R2 decision — recorded, no deletion this run (operator, 2026-08-20)

Operator chose **record the 429 and defer** (asked via the pipeline's consent gate; options were record-defer vs retry-on-claude, the latter rejected because a different executor would break parity against the omp-recorded 538s baseline and model-query count). Per the task's own conditions, the deletion of `config/workflows/task-pipeline2.yaml` does not apply on a non-passing bar: **both graphs remain** and only the measured result is recorded. Re-run the bar after quota reset (~4.16 days) or on another authenticated omp-capable executor — see the residual-reporting note in `## Testing`.

## R6 decision — ADR-072 ACCEPTED (operator, 2026-08-20)

Operator accepted. Landing commit (same commit, constitution T10):

- `docs/00_ADR.md` — ADR-072 flipped **Proposed → Accepted** with an acceptance note; ADR-029 amended to record the planning retirement (deferral resolved: planning routes through idea/dev-plan).
- `config/workflows/planning-pipeline.yaml` — **deleted** (git rm). All 11 remaining workflow definitions pass `spur workflow validate`.
- `packages/config/src/bundled-config.ts` — `RETIRED_PROJECT_SEEDS` removed (now-dead: nothing references the retired graph at init).
- `packages/config/tests/bundled-config.test.ts` — the `listBundledConfigFiles includes the expected assets` assertion for planning-pipeline removed (file gone) and the `excludes retired planning-pipeline (D5-K)` test replaced with a canonical-pipelines test.
- `apps/cli/tests/init-templates.test.ts` — the planning-pipeline negative assertion kept (comment updated to ADR-072 accepted).
- `apps/cli/tests/commands/workflow.test.ts` — `planning-pipeline.yaml` removed from the bundled-workflows validate loop.

**Verify:** `bun test packages/config/tests/bundled-config.test.ts apps/cli/tests/init-templates.test.ts apps/cli/tests/config/scaffold-manifest.test.ts` → 39 pass / 0 fail; `spur workflow validate` → 11/11 true.

## R5 — composition-baseline invocation blind spot closed

Regenerated `config/workflow-composition-baseline.json` actions maps from live workflow facts (algorithm per task Design: `extractResolvedWorkflowFacts`-equivalent extraction, `stateEffect`/`evidenceEffect` carried forward only where `kind` is unchanged, full invocation string recorded — never a digest) and deleted the `expAction.invocation !== undefined &&` short-circuit at `packages/app/src/workflow/composition-baseline.ts:316`:

- **Before:** 112 baseline actions, 15 with invocation recorded; an action present live with an invocation but unrecorded in the baseline was silently skipped (feature scenario R2 was only ~18% true).
- **After:** 104 actions across 6 workflows (planning-pipeline entry dropped with the deleted file), **77 with invocation recorded**; every `shell`/`agent.run` action that carries a live invocation is now recorded, and a live-present-but-baseline-absent invocation is its own error. Every action whose kind is unchanged carried its curated `stateEffect`/`evidenceEffect` forward; none were defaulted in (the regeneration script refused to write on any unclassified action — zero such actions).
- New test cases in `packages/app/tests/workflow/composition-baseline.test.ts`: (1) an unrecorded-but-present invocation fails the checker; (2) a silent shell-body edit (baseline invocation no longer matching live) fails the checker.

**Verify:** `bun test packages/app/tests/workflow/` → 381 pass / 0 fail (29 files, incl. the 2 new cases and the live-baseline parity test).

## R3 — re-verify 0604 (honest PARTIAL, R9 blocked)

Re-ran verification of 0604 (per R3's `/sp:dev-verify 0604 --force --fix all` intent, executed inline in the pipeline run). Outcome is **PARTIAL — as designed**, not PASS:

- `.spur/run/0604-verdict.json` re-emitted: `"verdict": "PARTIAL"`, requirement rows R1/R2/R4/R5/R6 MET, **R3 PARTIAL**, acceptance-criteria rows still keyed to the feature scenario titles R7–R12 (aliasing preserved).
- R2/R8 evidence refreshed and now **stronger**: `config/workflows/planning-pipeline.yaml` is deleted outright (ADR-072 accepted), `RETIRED_PROJECT_SEEDS` removed as dead; fresh-project assertions in the bundled-config + init-templates suites prove a seeded project receives no planning graph.
- R9 evidence refreshed: `config/workflows/task-pipeline2.yaml:515-521` residual-sweep read-only + snapshot-bracketed (D5-M / ADR-071); D5-N promotion bar blocked by HTTP 429 (omp quota, `retry-after-ms=359796000` ~4.16 days); operator recorded-and-deferred. `task-pipeline2.yaml` therefore remains — R9 cannot be MET until the bar passes.
- `spur task check 0604` → **PASS** (0 findings; stale anchors fixed in Solution + Testing).

Per the task's own Q&A, this is the honest outcome: the bar failing means D5 cannot reach PASS in this task. No PASS was forced, no verdict was hand-edited to say PASS.

## R4 — feature gate D5 (honestly unverified, R9 blocked)

`spur feature check D5` → `pass=true` (structural) but still reports **6 × `L4` scenario-unverified warnings** (R7–R12), each "covering task(s) 0604 have no PASS verdict with MET requirement". They will not clear until 0604's verdict is PASS, which waits on the D5-N bar. `bun run corpus-check` accordingly still reports the D5 rows. No finding was added to `config/corpus-baseline.json` — the rows must vanish because the condition is fixed, never by suppression. D5 stays `active`.

**Residual (operator decision needed, ~4 days):** when the omp quota resets, re-run `bun scripts/spur-dev.ts eval-pipeline` (source-local) to pass the bar, then re-run this task (or a follow-up) to promote the residual delta, delete `task-pipeline2.yaml`, re-verify 0604 → PASS, and close D5.

## Cross-cutting notes

- The working tree was clean at launch. `docs/tasks4/0609_*.md` carries an external concurrent edit (not made by this run) — left untouched.
- The eval harness left two disposable worktrees under `.spur/tmp/eval-pipeline-*/worktree` (detached HEAD at 5fbcbe7f); the implement subagent deliberately kept them for inspection. They are removable via `git worktree remove --force`.
- Sandbox caveats: `bun run spur-check` fails on `process-inspector.ts` coverage (ps spawn denied) and `bun run test-cf` fails with `listen EPERM` — both need unsandboxed certification and are unrelated to D5.
### Testing
**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | PARTIAL | The bar was attempted and recorded, but not measured in the sense R1 requires. `.spur/reports/pipeline-eval/2026-08-20T01-00-13-128Z-d5n-bar-0606.json` shows 2 runs, both `exitCode: 1`, both `verdict: null`, `tokenCost: null`, wallClock 1526 ms / 4382 ms — pre-verdict values not comparable to the 538 s baseline. gateOutcomes confirm the two distinct failure points the Solution describes: task-pipeline `precheck-size=FAIL`, task-pipeline2 `precheck-doctor=PASS, precheck-size=PASS` then death at the implement hop. The blocking cause is independently confirmed real: `.spur/run/4ae04c92-0428-4ee8-8931-6e29bad075fa.log` records HTTP 429 "Weekly usage limit reached. Resets in 4 days" with `retry-after-ms=359796000`. Model-query count and wall-clock vs baseline remain unobtainable, so R1's stated outcome is only half delivered. |
| R2 | MET | R2 is explicitly conditional and its else-branch was taken correctly. The bar did not pass, so no promotion occurred: `config/workflows/task-pipeline2.yaml` is still present (42567 bytes) and no delta was folded into the canonical pipeline. The operator decision to record-and-defer is documented in the Solution. Nothing was deleted on a non-passing bar, which is exactly what the requirement demands. |
| R3 | PARTIAL | Headline outcome NOT achieved: `.spur/run/0604-verdict.json` reads `verdict=PARTIAL` with R3 still the sole non-MET row, not PASS. The stated sub-conditions did hold — the re-verify ran, the 6 acceptance-criteria rows keyed to feature scenario titles R7-R12 are preserved (counted 6), and `spur task check 0604` is clean at 0 findings. Blocked by R1's quota failure, which the task's own Q&A pre-authorized as an honest outcome. |
| R4 | PARTIAL | Headline outcome NOT achieved: `spur feature check D5 --json` still reports 6 `L4.scenario-unverified` findings (R7-R12), each naming 0604's non-PASS verdict. The requirement's anti-suppression condition did hold and is the part that matters most — `git diff config/corpus-baseline.json` is empty, so not one of the six findings was baselined away. D5 remains `active`. |
| R5 | MET | Independently re-verified. The short-circuit is gone: `packages/app/src/workflow/composition-baseline.ts:316` now reads `if (expAction.invocation !== actAction.invocation)`, so a baseline entry lacking an invocation that the live definition carries is itself a mismatch. `config/workflow-composition-baseline.json` holds 104 actions across 6 workflows with 77 invocations recorded, consistent with the 82 live invocations I measured pre-change minus planning-pipeline's 5. New regression case at `packages/app/tests/workflow/composition-baseline.test.ts:190` covers the blind spot. `bun test packages/app/tests/workflow/` → 381 pass / 0 fail. |
| R6 | MET | Independently re-verified against the tree. `docs/00_ADR.md:885` reads `**Status:** Accepted · **Date:** 2026-08-19 · **Feature:** D5 · **Amends:** ADR-029`; ADR-029 carries an appended dated amendment at `docs/00_ADR.md:218` resolving the deferral (original Defer wording retained as history, which is correct ADR practice). `config/workflows/planning-pipeline.yaml` no longer exists; `RETIRED_PROJECT_SEEDS` is gone from `packages/config/src/bundled-config.ts` (grep count 0) as now-dead code. 11/11 remaining workflow definitions pass `spur workflow validate`; the three affected suites are 39 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R9 — Task execution preserves verification proof and ends with one canonical pipeline | PARTIAL | command | Bar ran source-local and failed on an external quota limit, correctly reported rather than re-run to green; both graphs remain, nothing promoted or deleted. The scenario's shipped-outcome half is unreachable until quota resets. |
| R2 — Every shipped pipeline has a reviewed disposition and frozen baseline | MET | test | `packages/app/src/workflow/composition-baseline.ts:316` compares invocation unconditionally; 77 of 104 baseline actions now record one; `packages/app/tests/workflow/composition-baseline.test.ts:190` proves an unrecorded live invocation fails the checker. 381 pass / 0 fail. |
| R1 — Workflow composition rules are authoritative and enforceable | MET | static-ref | ADR-072 Accepted at `docs/00_ADR.md:885` with `Amends: ADR-029`; ADR-029 amendment appended at `docs/00_ADR.md:218`; `config/workflows/planning-pipeline.yaml` deleted; no ADR status was flipped to clear a gate — the bar failure was reported, not papered over. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Coordinated review 2026-08-20 (functional traceability + SECUA + architecture). Disposition: PARTIAL — do not close.**

Supersedes the earlier disposition line, which read "PASS (no P1/P2 findings)". This pass found one P2, so that line was inaccurate.

| Prio | Dimension | Location | Finding | Status |
| --- | --- | --- | --- | --- |
| P2 | Correctness (evidence) | this file, `## Review` (prior revision) | The prior Review cited `.spur/reports/pipeline-eval/*.json` as recording the 429 with `retry-after-ms=341900000`. Those reports contain no 429 and no retry-after field — `grep -ol "429\|Weekly usage limit" .spur/reports/pipeline-eval/*.json` returns nothing. The blocker is real, but the artifact named as corroborating it does not. | Fixed — citation replaced with the primary provider log below |
| P3 | Correctness (evidence) | `## Solution` (prior revision) | Stated "Resets in 3 days" and `retry-after-ms=341900000`. The provider log records 4 days and `retry-after-ms=359796000` (sibling run `365476000`); `341900000` appears only in downstream authored artifacts, never in a provider log. | Fixed in the verify `--fix all` pass |
| P3 | Correctness (docs) | `docs/03_ARCHITECTURE.md:912` | §20 heading still labelled ADR-072 "proposed" after acceptance. | Fixed |
| P4 | Architecture | `packages/config/src/bundled-config.ts` | `RETIRED_PROJECT_SEEDS` removed rather than left as a dead guard once the file was deleted — delete-don't-layer applied correctly. | Accepted |
| P4 | Architecture | `plugins/sp/tests/skill-structure.test.ts` | R37/R38 were re-pointed at `idea-pipeline.yaml` instead of deleted, preserving the structural assertions rather than dropping coverage with the retired file. | Accepted |
| P4 | Security | `package.json` | The now-dead `planning-pipeline` script was removed; no new dependency, script, or network surface introduced. | Accepted |
| P4 | Efficiency | `packages/app/src/workflow/composition-baseline.ts:316` | The guard removal is a strict inequality — no added traversal cost, and it closes the blind spot for all 104 actions at once. | Accepted |

**Primary evidence for the R1 blocker** (replacing the prior false citation): `.spur/run/4ae04c92-0428-4ee8-8931-6e29bad075fa.log` records HTTP 429 "Weekly usage limit reached. Resets in 4 days" with `retry-after-ms=359796000`. The eval reports independently corroborate the *failure*, not its cause: `.spur/reports/pipeline-eval/2026-08-20T01-00-13-128Z-d5n-bar-0606.json` shows 2 runs, both `exitCode: 1`, both `verdict: null`, `tokenCost: null`.

**Functional traceability (per-requirement):** R1 PARTIAL — bar attempted and recorded, model-query count and wall-clock still unobtainable. R2 MET — conditional else-branch correctly taken, nothing deleted on a non-passing bar. R3 PARTIAL — 0604 still PARTIAL, though the re-verify ran and preserved all 6 feature-scenario alias rows. R4 PARTIAL — 6 `L4.scenario-unverified` remain, but the anti-suppression condition held (`git diff config/corpus-baseline.json` empty). R5 MET — verified independently. R6 MET — verified independently.

**Architecture:** no shallow-module, coupling, or seam findings. The change is a guard removal plus data regeneration in the module that already owns the contract; no new abstraction, no parallel implementation, no new public surface (ADR-051 clean).

**Verification re-run this pass:** `bun run lint` clean (723 files + tsc across 7 workspaces); `bun test packages/app/tests/workflow/ packages/config apps/cli/tests plugins/sp/tests/skill-structure.test.ts` → 1343 pass / 0 fail; `spur workflow validate` → 11/11.

**Residual risk: medium, and it is scheduling, not defect.** The landed work (R5 checker, R6 ADR-072 acceptance and planning retirement) is complete and independently verified. R1/R3/R4 are blocked on an omp weekly quota that resets ~2026-08-24; until the bar runs, D5 cannot reach PASS and `task-pipeline2.yaml` must remain. Nothing was forced, suppressed, or hand-edited to close a gate.

**Housekeeping (not defects):** two eval worktrees remain registered at `.spur/tmp/eval-pipeline-{BpsGlO,vU6Otd}/worktree` (detached at 5fbcbe7f), deliberately kept for inspection — clear with `git worktree remove --force`. A stale `apps/cli/config/workflows/planning-pipeline.yaml` remains in the gitignored `build:bundle` output and clears on the next bundle.
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
