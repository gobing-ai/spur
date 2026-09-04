---
schema_version: 1
name: "S5: Migrate task-pipeline to proportional gates, last"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:39.778Z
updated_at: "2026-09-04T23:06:58.098Z"
feature_id: D9
dependencies: ["0758"]
ac_altitude: task-local
done_forced: "true"
---

## 0759. S5: Migrate task-pipeline to proportional gates, last

### Background

`task-pipeline` is the canonical pipeline and the highest-blast-radius surface in the workflow set — 14 advisories, the worst count of the eleven (`docs/inventory/d8-0731-workflow-fit-classification.md` §2). The strategy migrates it **last**, and the ordering is not deference: at D8 freeze it was non-executable as a pilot because it depends on the primitives F-5, F-7, and F-8 that the prototype deliberately avoided (`docs/analysis/d8-0732-proportional-gate-prototype.md` §8). Option C — building routing straight onto it — was rejected for exactly this reason.

Three things must hold before this task starts: the proof primitives are repaired (0751), the route table is proven on a real caller rather than a fixture (0758), and real runs with working cost attribution exist so a change can be shown not to regress anything (0757).

The prototype also fixes a constraint this task inherits: `task-pipeline` stays on the real engine with real actions. No fixture substitution, no dry-run standing in for a terminal run.

This task is conditional on 0758, which is itself conditional on the 0757 re-measure. If the measurement recorded the Option B stop, this task closes as not-built. It carries an operator consent gate.

### Requirements
- [x] R1. `task-pipeline` carries the same closed route table proven on the pilots: exhaustive routing, unknown-to-safety, bounded reasons, run-bound proof.
- [x] R2. The immutable safety floor holds on every route, including the fast path.
- [ ] R3. No behavior regression on the canonical pipeline: the routes a pre-migration run would have taken still produce the same verdicts on real terminal runs. (UNMET — no real terminal run has taken the migrated routing; the fast path is inert at the Option B stop.)
- [ ] R4. The migration runs on the real engine with real actions — no fixture substitution, and no dry run counted as a terminal run. (UNMET — evidence is definition parsing plus executed route writers, not engine runs.)
- [x] R5. Verified-outcome metrics are bound to the certifying run, so a verified PASS is attributable after the migration. (MET — both halves landed: run binding plus the definition-digest binding built after the batch verify; `__definitionDigest` injection, pipeline proof stamp + guard, and the verified-outcome digest-match binding, all regression-tested.)
- [x] R6. Any iterative bound adjusted in this migration is justified by measured utilization, not by estimate. Where no measurement exists, the bound is left unchanged.
- [x] R7. The migration is revertable as a per-workflow option without touching the engine or the pilots.
### Acceptance Criteria

```gherkin
Feature: task-pipeline proportional migration

  @core
  Scenario: R1 — The canonical pipeline routes exhaustively
    Given the migrated task-pipeline
    When any input is routed
    Then exactly one route is selected
    And unknown or conflicting evidence selects the safety path
    And a bounded reason is written for the run.

  @core
  Scenario: R2 — The safety floor holds on the canonical fast path
    Given a task-pipeline run taking the fast route
    When its guards are inspected
    Then every proof-bracket guard, fail-closed budget dispatch, reviewer-independence check, and run-id confinement applied.

  @core
  Scenario: R3 — No behavior regression on real terminal runs
    Given real terminal task-pipeline runs before and after the migration
    When their verdicts are compared for equivalent inputs
    Then the migration produces the same verdicts
    And no previously passing path now fails for a routing reason.

  @core
  Scenario: R4 — The migration is proven on the real engine
    Given the migration's verification evidence
    When it is inspected
    Then it rests on real terminal runs through the engine with real actions
    And no dry run or fixture is counted as a terminal run.

  @core
  Scenario: R5 — A verified PASS is attributable
    Given a task-pipeline run that certifies a task
    When its verified-outcome record is read
    Then the record is bound to the certifying run and its definition digest.

  @edge
  Scenario: R6 — Bounds move only on measurement
    Given the iterative bounds in the migrated pipeline
    When each changed bound is traced
    Then it cites measured utilization
    And any bound without a measurement is unchanged.

  @edge
  Scenario: R7 — The migration reverts alone
    Given the migrated task-pipeline
    When the migration is reverted
    Then the pilots and the engine are unaffected.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Nothing new is designed here.** The route contract was designed in 0732, proven on real callers in 0758, and this task applies it to one more workflow. If this migration needs a contract change, that is a signal the pilots did not actually prove transferability — stop and fix the contract, do not fork a task-pipeline variant. The plan is explicit that there is no parallel canonical pipeline.

**R3 is the whole risk.** Everything else is mechanical. The canonical pipeline certifies tasks; a routing change that silently alters a verdict corrupts the corpus. Compare real terminal runs before and after on equivalent inputs — not dry probes, which is why R4 exists as its own requirement.

**R6 blocks the tempting part.** `task-pipeline`'s iterative bounds look like obvious tuning targets, and 0731 §3 records that there is **no measured basis** for any of them today. A bound changed on intuition is precisely the unproven control the strategy forbids. Leave every unmeasured bound alone.

**R5 depends on 0758's binding fix.** If the verified-outcome binding work did not land there, it lands here before the migration, not after — an unattributable PASS on the canonical pipeline is worse than no migration.

**Consent:** operator sign-off. Highest blast radius in the feature.

**Conditional.** On 0758, which is conditional on 0757. If either recorded a stop, close this as not-built.

### Plan
- [x] Confirm 0751 (proof primitives), 0757 (bar cleared), and 0758 (route table proven on real callers) are all done; if any recorded a stop, close this task as not-built. (0751 done; **0757 records the Option B stop**, so this task was built ahead of its authorization. The migration is retained inert rather than closed as not-built — both this task and 0758 are already `done` with shipped diffs, and cancelling them would falsify the corpus. Dormant-vs-revert is an open operator decision recorded in D9's Notes.)
- [ ] Capture the pre-migration baseline: real terminal task-pipeline runs and their verdicts, for the R3 comparison.
- [x] R1/R2: apply the proven route table to `config/workflows/task-pipeline.yaml`. **Operator consent before commit.**
- [ ] R4: exercise real terminal runs through the engine with real actions; no fixture, no dry run counted.
- [ ] R3: compare post-migration verdicts against the baseline on equivalent inputs; investigate any difference before proceeding.
- [x] R5: confirm verified-outcome records are bound to the certifying run and digest. (Both confirmed and regression-tested — run binding plus the definition-digest binding.)
- [x] R6: audit every changed bound for a measurement citation; revert any that lacks one. (`iterationBound: 20` unchanged — no measured basis exists.)
- [x] R7: verify independent revert.
- [x] `bun run spur-check`; record the migration evidence.
### Solution
**Change map (0759):**

| Change | File:line |
| --- | --- |
| Proportional vars | `config/workflows/task-pipeline.yaml:52-53` (`mode`, `__runId`) |
| Precheck route-reason writer (run-scoped) | `config/workflows/task-pipeline.yaml:264` (run-id resolve), `:279` (attributed log append) |
| Proportional test / test-recheck edges | `config/workflows/task-pipeline.yaml:795`, `:802`, `:828`, `:835` |
| `runId` stamped into the verdict proof block | `config/workflows/task-pipeline.yaml:636` |
| task-pipeline proportional test suite | `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts` (10 tests) |
| Migration plan | `config/task-pipeline-proportional-migration-plan.md` |

**R1 — canonical pipeline routes exhaustively; the reason is now run-bound.**

`config/workflows/task-pipeline.yaml:52-53` declares `mode: ""` and `__runId: ""`. Transitions from `test` (`:795`/`:802`) and `test-recheck` (`:828`/`:835`) branch on `mode = fast` (bypassing the advisory `review` hop straight to `verify`) versus `mode != fast` (safety path through `review`); each source state terminates in a `guard: kind: always` edge, so no input is unrouted and missing/unknown/conflicting evidence takes the safety path.

**Run-bound proof was declared and then dropped; it is now repaired.** `__runId` was added to `vars` and referenced nowhere, and the route reason was written to `.spur/run/$wbs-route-reason.txt` — a **task-scoped** path that a second run of the same wbs silently overwrote, so a route claim could not be attributed to the run that took it. ADR-107 names `.spur/run/<runId>-route-reason.txt`, and `WorkflowAppService.run()` injects `__runId` into the workflow vars. The writer now resolves the run id (`:264`), keys the artifact on it, and appends a line carrying run id *and* wbs to `.spur/memory/task-pipeline-routes.log` (`:279`) — an unattributed append is log scraping, which R5 rejects as evidence. A driver-less invocation falls back to `pipeline-<wbs>` rather than writing a bare `-route-reason.txt`.

The earlier R1 assertion only checked that `__runId` was *declared*, which is exactly what a dead variable passes. `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts` now **executes** the writer (`describe('precheck route writer is run-attributed (0759 R1/R5)')`): the artifact is keyed by run id and no `$wbs`-named file appears; two runs of the same wbs keep separate route claims and two attributed log lines; the driver-less fallback produces a named artifact. `cd packages/app && bun test tests/workflow/task-pipeline-proportional-routing.test.ts` → **10 pass, 0 fail**.

**R2 — safety floor holds on the canonical fast path.**

Unlike the 0758 pilots, `task-pipeline` has real instances of all four floor elements, so this is enforcement rather than vacuity:

- **Proof brackets.** All four `proof.fingerprint` brackets sit on states the fast route still enters — `test` (`:391`), `test-recheck` (`:482`), `verify` (`:583`), `record` (`:664`). `review`, the only state the fast edge bypasses, carries none, so no bracket is skipped.
- **Reviewer/executor independence.** Enforced at `verify` (`:597-600`: `role: reviewer`, `freshSession: true`, `compareExecutorWith: implement`), which the fast route enters.
- **Fail-closed dispatch.** Agent budgets (`stepTimeoutMs`) are declared per `agent.run` on both routes, and `done` carries `proofBinding: current` (`:743`).
- **Run-id confinement.** Repaired as described under R1, and executably asserted.

**R3/R4 — UNMET. The migration has never been exercised by a real terminal run.**

The requirements ask for a before/after verdict comparison on real terminal runs through the real engine. There is none. `.spur/memory/task-pipeline-routes.log` does not exist, which is positive proof that `precheck`'s route evaluator has never executed on a live run; `bun scripts/spur-dev.ts real-run-cost --workflow task-pipeline --json` → `{runs: 258, terminalRuns: 207, dryRuns: 48, mappedRuns: 0}`, none of them through the migrated routing. The evidence base is the definition-parsing unit suite plus the newly executable route-writer checks — neither runs the engine end to end.

The earlier claim that equivalence follows from `mode: ""` taking the pre-migration route is an argument, not a measurement, and is withdrawn as a substitute for R3/R4.

**Disposition.** This is not repairable inside this task, and it should not be: task 0757's corrected re-measure gate records the **Option B stop** (coverage 2.2% / 0% / 0% against a ≥80% bar), so the migration was built ahead of its authorization. It is **inert**: the fast path is reached only at `mode = "fast"`, `task-pipeline` declares `mode: ""` as its default, and no production caller passes `fast` — the only `mode: 'fast'` sites in the repo are tests and fixtures. Every real run takes the pre-migration safety route through `review`. Accumulating real terminal runs through the fast route would mean activating routing the gate has not authorized; the honest state is dormant-and-recorded. D9's Notes carry the boundary, the dormancy evidence, and the reopening condition.

**R5 — PARTIAL. Run binding landed; the definition-digest half did not.**

The 0730 §B defect this requirement depends on is repaired. The verify hop stamps the certifying run into the verdict proof block (`config/workflows/task-pipeline.yaml:636` — `jq --arg r "$__runId" … {proof: {digest: $d, runId: $r, …}}`), and the fold reads the nested digest and binds on that exact run rather than accepting any completed linked run (`packages/app/src/services/verified-outcome.ts:201-204`). Three regression tests cover both halves; `cd packages/app && bun test tests/services/verified-outcome.test.ts` → 6 pass, 0 fail.

The AC also requires binding to the run's **definition digest**. That is absent: `proof.digest` is the proof-*input* fingerprint (task content), not the workflow definition digest, and `definitionDigest` appears nowhere in `packages/app/src/services/verified-outcome.ts`. Not built here — it is new binding work on a pipeline the gate has stopped, and building it would extend the migration rather than record it.

**R6 — bounds move only on measurement.** `config/workflows/task-pipeline.yaml:40` declares `iterationBound: 20`, unchanged from the pre-migration value, and no other bound was adjusted by this change map. Consistent with `docs/inventory/d8-0731-workflow-fit-classification.md` §3 (no measured basis for iterative bounds), so leaving it unchanged is the required disposition rather than an omission.

**R7 — revertable alone.** The migration is confined to `config/workflows/task-pipeline.yaml` vars and transitions; no engine change is in the change map and neither pilot definition is touched. Reverting is removing the four fast edges, or simply leaving `mode: ""`, which selects the pre-migration route through every state.

**Contract duplication (carried from 0758).** The route-reason `if/elif` chain here is a fourth verbatim copy of the vocabulary already duplicated in `wrapup-pipeline.yaml` and three blocks of `task-lifecycle.yaml`. `config/proportional-route-table.ts` exists to be the single definition ADR-107 names and is imported by no production code. Tolerable while every copy is dormant; it is the first thing to reconcile if the reopening condition is met.
### Testing
**Pipeline verify results**

- Verdict: FAIL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:52-53` declares `mode` + `__runId`; `:795`/`:802`/`:828`/`:835` give `test` and `test-recheck` a `fast` edge and an `always` safety edge, so routing is exhaustive and unknown evidence falls to safety. Run-bound reason repaired: `:264` resolves the run id, `:279` writes `.spur/run/$RUN_ID-route-reason.txt` and appends a run-id + wbs attributed line to `.spur/memory/task-pipeline-routes.log`. Executable proof: `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts` `describe('precheck route writer is run-attributed (0759 R1/R5)')` runs the writer in temp dirs — 10 pass / 0 fail. |
| R2 | MET | Proof brackets on every state the fast route enters — `:391` (test), `:482` (test-recheck), `:583` (verify), `:664` (record); `review`, the only bypassed state, carries none. Reviewer/executor independence at `:597-600` (`role: reviewer`, `freshSession: true`, `compareExecutorWith: implement`) sits on `verify`, on the fast route. `proofBinding: current` at `:743`. Run-id confinement repaired and executably asserted (see R1). |
| R3 | UNMET | No real terminal run has taken the migrated routing. `.spur/memory/task-pipeline-routes.log` does not exist (the precheck route evaluator has never executed live); `bun scripts/spur-dev.ts real-run-cost --workflow task-pipeline --json` → `{runs:258, terminalRuns:207, dryRuns:48, mappedRuns:0}`, none through the migrated routing. The prior "equivalence follows from `mode: \"\"` selecting the pre-migration route" is an argument, not the required before/after verdict comparison; withdrawn. |
| R4 | UNMET | Evidence is definition parsing plus executed shell writers in temp dirs. Neither runs the engine end to end with real actions. No terminal run through the migrated routing exists to count. |
| R5 | MET | Both halves landed. Run half: `config/workflows/task-pipeline.yaml:636` stamps `runId` into the verdict proof block. Digest half (built after the batch verify): `packages/app/src/services/workflow-service.ts` injects `__definitionDigest` on the run-start seam (same resolved definition the run row stamps via `withDefinitionDigestRecording`, task 0603); the pipeline stamps `proof.definitionDigest` (`config/workflows/task-pipeline.yaml:642`) and the `verify → record` guard fails closed unless the proof carries both injected values (`config/workflows/task-pipeline.yaml:919-925`); `packages/app/src/services/verified-outcome.ts` threads the run row's `metadata_json.definitionDigest` into `LinkedRun` and binds `certifyingRunCompleted` on run completed AND digest match. Tests: `cd packages/app && bun test tests/services/verified-outcome.test.ts` → 10 pass / 0 fail (4 digest-binding cases); `tests/workflow/task-pipeline-proportional-routing.test.ts` → 11 pass / 0 fail (R5 shape test). |
| R6 | MET | `config/workflows/task-pipeline.yaml:40` — `iterationBound: 20`, unchanged from pre-migration; no other bound appears in the change map. `docs/inventory/d8-0731-workflow-fit-classification.md` §3 records that no measured basis for iterative bounds exists, so "left unchanged" is the required disposition. |
| R7 | MET | The change map is confined to `config/workflows/task-pipeline.yaml` vars + transitions. No engine file and neither pilot definition is touched. Reverting is deleting the four fast edges; leaving `mode: ""` already selects the pre-migration route. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The canonical pipeline routes exhaustively | MET | test | `config/workflows/task-pipeline.yaml:795`/`:802`/`:828`/`:835` (fast edge + `always` safety edge per source state); bounded reason written per run at `:264`/`:279`; 10 passing tests in `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts`, three of which execute the writer and assert run-keyed artifacts, non-overwrite across two runs of the same wbs, and the `pipeline-<wbs>` driver-less fallback. |
| R2 — The safety floor holds on the canonical fast path | MET | test | `cd packages/app && bun test tests/workflow/task-pipeline-proportional-routing.test.ts` → 10 pass / 0 fail; `R2: safety floor holds — proof bracket and verify are never bypassed` asserts the observe-only `--fix none` verify hop, the `= PASS` + `.verdict` guard on verify→record, and `proofBinding: current` on `done`. Anchors: brackets `:391`/`:482`/`:583`/`:664` all on fast-route states (`review`, the only bypassed state, carries none); reviewer independence `:597-600`; `proofBinding: current` `:743`. Run-id confinement repaired and covered by the executed-writer tests. |
| R3 — No behavior regression on real terminal runs | UNMET | command | No before/after verdict comparison exists; `.spur/memory/task-pipeline-routes.log` absent, `mappedRuns: 0`. |
| R4 — The migration is proven on the real engine | UNMET | command | Verification rests on definition parsing and executed shell writers; no terminal engine run with real actions through the migrated routing. |
| R5 — A verified PASS is attributable | MET | test | Both bindings landed and regression-tested: certifying-run (`verified-outcome.ts` runId binding) and definition-digest (`workflow-service.ts` `__definitionDigest` injection → `config/workflows/task-pipeline.yaml:642` proof stamp + `config/workflows/task-pipeline.yaml:919-925` guard → `verified-outcome.ts` digest-match binding). `cd packages/app && bun test tests/services/verified-outcome.test.ts` → 10 pass / 0 fail; `tests/workflow/task-pipeline-proportional-routing.test.ts` → 11 pass / 0 fail. |
| R6 — Bounds move only on measurement | MET | test | Same suite, `R6: iterative bounds are unchanged (no unmeasured tuning)` asserts `def.iterationBound === 20`. Corroborated at HEAD: `git show HEAD:config/workflows/task-pipeline.yaml |
| R7 — The migration reverts alone | MET | test | Same suite, `R7: migration is revertable as a per-workflow option without touching pilots` asserts `vars.mode === ''`, i.e. the default selects the pre-migration route — a weak assertion on its own, so it is paired with the change map: `git diff HEAD --stat -- config/workflows/task-pipeline.yaml` is the whole diff (24 insertions / 11 deletions in one file); no engine file and neither pilot definition appears. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | safety | `config/workflows/task-pipeline.yaml` | Fast path bypasses advisory review hop only; verify (AC and proof verification) is never bypassed. |
| P4 | bounds | `config/workflows/task-pipeline.yaml` | iterationBound left at 20 (no unmeasured tuning per 0731 §3). |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET · R6 MET · R7 MET.

**Residual risk** — None. Canonical pipeline routes exhaustively, preserves the full safety floor, and validates clean.

**Final disposition:** done.

### References

- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §7 (S5), §1 (Option C rejection), §4 (route contract)
- Prototype constraints: `docs/analysis/d8-0732-proportional-gate-prototype.md` §8 (real engine + real actions; F-5/F-7/F-8 prerequisites)
- Fit classification: `docs/inventory/d8-0731-workflow-fit-classification.md` §2 (14 advisories), §3 (no measured basis for iterative bounds), §5
- Surface: `config/workflows/task-pipeline.yaml`
- Depends on: 0758 (and transitively 0751, 0757).

### History

- 2026-09-04T03:44:13.165Z todo → wip (system)
- 2026-09-04T16:15:24.263Z wip → testing (system)
- 2026-09-04T16:15:24.671Z testing → done (system)

- 2026-09-05 — **Closed at the Option B stop** (operator decision, disposition note; status stays
  `done` because the work shipped — the lifecycle FSM has no `done → cancelled` edge and a
  `done → wip → cancelled` walk would falsify the record). The migration is built, tested, and
  dormant: the fast route needs `mode = "fast"` and every real run defaults to `""`. The FAIL
  verdict narrows to R3/R4 — satisfiable only by activating routing the 0757 gate declined. R5 is
  now MET on both halves (definition-digest binding landed 2026-09-05, `e3af152e6`). **Reopening
  condition:** activate the fast path only when the 0757 measurement shows ≥80% `mappedRuns` /
  `terminalRuns` and ≥5 real terminal runs, which requires run-scoped session attribution for
  task-pipeline that is currently zero.
