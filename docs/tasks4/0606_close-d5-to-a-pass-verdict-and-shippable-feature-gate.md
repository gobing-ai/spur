---
schema_version: 1
name: "Close D5 to a PASS verdict and shippable feature gate"
status: todo
template: feature-impl
created_at: 2026-08-20T00:05:44.231Z
updated_at: "2026-08-20T00:32:05.432Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
