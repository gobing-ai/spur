---
schema_version: 1
name: "S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle with run-bound cost evidence"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:39.492Z
updated_at: "2026-09-05T00:57:42.127Z"
feature_id: D9
dependencies: ["0754", "0757", "0751"]
priority: P1
ac_altitude: task-local
done_forced: "true"
---

## 0758. S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle with run-bound cost evidence

### Background
The D8 prototype proved the proportional route table on fixtures. This task conditionally moved it to the selected wrapup-pipeline and task-lifecycle pilots, subject to the 0757 bar of at least five real terminal runs and at least 80% run-scoped cost coverage per workflow.

The implementation landed before the corrected re-measurement selected Option B. Closure therefore reconciles the shipped surfaces instead of claiming they were never built: wrapup retains its exhaustive route table with the existing safety default, while task-lifecycle is reverted because duplicate `(from,to)` edges are incompatible with the transition API. No production caller activates the retained fast path.

The operator consent gate is resolved by that Option B disposition. Activation remains gated on a future source-local measurement meeting both frozen conjuncts.
### Requirements
- [x] R1. The rollout is conditional. Option A applies the closed route table to both pilots; selected Option B retains the safe wrapup route and reverts the task-lifecycle route whose duplicate `(from,to)` edges are incompatible with the transition API.
- [x] R2. Every retained proportional route is exhaustive, and missing, unknown, or conflicting evidence selects the safety path.
- [x] R3. The immutable safety floor is never traded for speed on any retained route: proof-bracket guards, budget-unverifiable fail-closed dispatch, reviewer/executor independence, and run-id confinement are not bypassed.
- [x] R4. Every retained route writes a bounded, machine-readable reason for the run. No retained skip is unexplained.
- [x] R5. Retained route and skip facts are provable from run-bound evidence rather than log scraping.
- [x] R6. Activation requires ≥5 real terminal runs and ≥80% run-scoped cost coverage per workflow. The recorded measurement fails the coverage conjunct, so Option B leaves the retained route unreachable by default and requires no manufactured fast-path runs.
- [x] R7. Unversioned and explicit task-lifecycle definitions preserve the same behavior and differ only in definition digest after the proportional pilot is reverted.
- [x] R8. Each pilot can be reverted independently without touching the engine, the other pilot, or `task-pipeline`; the lifecycle rollback demonstrates this property.
- [x] R9. ADR-107 records the proportional-gate contract and its 2026-09-04 Option B closure amendment.
### Acceptance Criteria
```gherkin
Feature: Conditional proportional routing on the surrounding pilots

  @core
  Scenario: R1 — The selected rollout branch is coherent
    Given the measured activation gate
    When Option B is selected
    Then only compatible routing is retained
    And an incompatible pilot is reverted rather than forced through the engine.

  @core
  Scenario: R2 — Unknown or conflicting evidence takes the safety path
    Given retained routing input that is missing, unrecognized, or self-conflicting
    When the route is selected
    Then exactly one route is selected
    And it is the safety path.

  @core
  Scenario: R3/R4/R5 — Retained routes preserve proof and explain themselves
    Given a retained proportional route
    When its definition and writer are inspected
    Then no safety-floor guard is bypassed
    And a bounded run-scoped reason reconstructs the selected route without log scraping.

  @core
  Scenario: R6 — The evidence bar gates activation
    Given the recorded real-run and run-scoped coverage counts
    When either activation conjunct is below its frozen threshold
    Then Option B keeps the fast path unreachable
    And no activation-only run evidence is required until the bar is met.

  @edge
  Scenario: R7 — Version form does not change lifecycle behavior
    Given unversioned and explicitly versioned copies of task-lifecycle
    When each definition is inspected after rollback
    Then both expose the same states and transitions
    And only their definition digests differ.

  @edge
  Scenario: R8 — A pilot reverts alone
    Given a piloted workflow's routing
    When it is reverted
    Then the other pilot, task-pipeline, and the engine are unaffected.

  @core
  Scenario: A proportional route always resolves and never trades the safety floor
    Given a retained workflow carrying the closed route table
    When any input including missing, unknown, or conflicting evidence is routed
    Then exactly one route is selected
    And unknown or conflicting evidence selects the safety path
    And a bounded reason is written for the run
    And no safety-floor guard is bypassed by the route.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Branch contract.** Option A activates proportional routing only after the frozen measurement bar is met. Selected Option B closes the feature safely when that bar fails: preserve useful proof/binding work, retain only compatible routing, and keep every fast path unreachable by default.

**Compatibility beats symmetry.** `requestTransition` selects one transition for a `(from,to)` pair, so sibling fast/safety lifecycle edges cannot provide fallback. The lifecycle pilot is therefore reverted; wrapup remains because its route table is closed and tested.

**Evidence stays honest.** The failed 2.2%/0% coverage measurement is a completed gate outcome. Activation-only real-run evidence is N/A under Option B and becomes mandatory only after the reopening threshold is met.
### Plan
- [x] Apply the closed route table to wrapup-pipeline and prove exhaustive safety fallback.
- [x] Attempt the lifecycle transfer, identify the transition-API incompatibility, and revert that pilot independently.
- [x] Repair verified-outcome binding and retain the proof on the safety path.
- N/A — Option B: do not build the run-scoped cost importer solely to manufacture activation coverage.
- N/A — Option B: do not activate a fast route to accumulate real terminal runs below the frozen coverage bar.
- [x] Record the ≥5-runs / ≥80%-coverage comparison and the Option B disposition.
- [x] Verify lifecycle version-form equivalence after rollback.
- [x] Verify independent revertability.
- [x] Amend ADR-107 and synchronize D9 Notes.
- [x] Run targeted routing, lifecycle, and verified-outcome tests.
### Solution
**Selected branch:** Option B.

| Outcome | Evidence |
| --- | --- |
| Compatible pilot retained, inactive by default | `config/workflows/wrapup-pipeline.yaml:65`, `config/workflows/wrapup-pipeline.yaml:293` |
| Incompatible lifecycle pilot reverted | `config/workflows/task-lifecycle.yaml:1`, `packages/app/tests/workflow/lifecycle-adapter.test.ts:113` |
| Exhaustive/safety routing and run-attributed writers | `packages/app/tests/workflow/proportional-routing-pilots.test.ts:93` |
| Contract and closure rule | `docs/00_ADR.md:2201` |

The source-local re-measure recorded wrapup at `1 / 45` mapped terminal runs (2.2%) and task-lifecycle at `0 / 465` (0%), below the frozen 80% coverage bar. Option B therefore prohibits activation and does not require synthetic fast-path runs.

The lifecycle transfer exposed a real engine incompatibility: the transition adapter resolves one `(from,to)` edge rather than falling through sibling guards. Reverting that pilot restored the lifecycle. Wrapup retains the closed empty/fast/safety table; its default `mode: ""` selects safety, and the writer records a bounded run-scoped reason.

Unversioned and explicitly versioned lifecycle definitions still have equivalent behavior with distinct definition digests. The rollback touched neither wrapup, task-pipeline, nor the engine, demonstrating per-workflow revertability.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Selected Option B retains wrapup's closed table at `config/workflows/wrapup-pipeline.yaml:293` and reverts the incompatible lifecycle split, documented at `config/workflows/task-lifecycle.yaml:1`. |
| R2 | MET | Routing tests cover empty, fast, default, unknown, and conflicting input; unknown/conflicting input selects safety. |
| R3 | MET | The retained wrapup fast route bypasses no guard present on its safety route; run-id confinement remains executable and tested. |
| R4 | MET | The wrapup writer emits a bounded run-scoped reason; two-run tests prove artifacts do not overwrite. |
| R5 | MET | Route reconstruction uses `.spur/run/<runId>-route-reason.txt`; the attributed log is secondary rather than proof input. |
| R6 | MET | The 2.2%/0% coverage result fails the frozen bar and correctly keeps Option B inactive; activation-only real-run work is not applicable until reopening. |
| R7 | MET | Version-form tests show the reverted lifecycle definitions expose identical behavior and distinct definition digests. |
| R8 | MET | The lifecycle rollback left wrapup, task-pipeline, and engine unchanged; revertability tests pass. |
| R9 | MET | ADR-107 at `docs/00_ADR.md:2201` plus its amendment at `:2220` record the contract and Option B closure. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The selected rollout branch is coherent | MET | test | Incompatible lifecycle routing is absent; compatible wrapup routing remains closed and safety-defaulting. |
| R2 — Unknown or conflicting evidence takes the safety path | MET | test | `proportional-routing-pilots.test.ts` covers default, unknown, and conflict → safety. |
| R3/R4/R5 — Retained routes preserve proof and explain themselves | MET | test | Executed writer tests prove bounded per-run artifacts and non-overwrite; no retained safety guard is bypassed. |
| R6 — The evidence bar gates activation | MET | command | Measured coverage is below 80%; defaults remain empty and no production `fast` caller exists. |
| R7 — Version form does not change lifecycle behavior | MET | test | Unversioned/explicit definitions have equal states and transitions with different digests. |
| R8 — A pilot reverts alone | MET | test | The lifecycle rollback and revertability assertion leave sibling workflow and engine untouched. |
| A proportional route always resolves and never trades the safety floor | MET | test | Fresh targeted run: 48 pass, 0 fail across routing, lifecycle, and proof-binding suites. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | safety | `config/workflows/wrapup-pipeline.yaml:293` | The retained table is exhaustive and defaults unknown evidence to safety. |
| P4 | compatibility | `config/workflows/task-lifecycle.yaml:1` | The incompatible duplicate-edge design is absent and regression-pinned. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET · R6 MET · R7 MET · R8 MET · R9 MET.

**Residual risk** — No work remains under selected Option B. Activation stays unavailable until real run-scoped coverage reaches the frozen bar.

**Final disposition:** Option B complete.
### References

- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §4 (route contract), §7 (S3), §2.1 (pilot dispositions)
- Prototype: `docs/analysis/d8-0732-proportional-gate-prototype.md` §2 (closed route table), §5 (run-bound evidence), §7 (version both-forms), §8 (constraints inherited by task-pipeline)
- Pilot selection: `docs/inventory/d8-0731-workflow-fit-classification.md` §5, §6
- Binding defect: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §B
- Surfaces: `config/workflows/wrapup-pipeline.yaml`, `config/workflows/task-lifecycle.yaml`; the run-scoped cost importer; the verified-outcome fold
- New ADR: 107 (proportional-gate contract; the 103 reserved at planning time was taken by E91)
- Depends on: 0757 (gate), 0754. Gates: 0759.

### History
- 2026-09-04T03:44:12.933Z todo → wip (system)
- 2026-09-04T16:11:47.244Z wip → testing (system)
- 2026-09-04T16:11:47.671Z testing → done (system)

- 2026-09-04 — **task-lifecycle pilot half reverted** (operator decision). The proportional `wip→testing` / `testing→done` edges and route-reason writers were removed from `config/workflows/task-lifecycle.yaml`. `requestTransition` resolves one transition per `(from,to)` pair and cannot fall through a failed sibling guard, so the pilot blocked normal lifecycle updates. The auto-run engine does evaluate outbound alternatives, which is why wrapup-pipeline remains compatible. Regression tests now require each lifecycle `(from,to)` pair to be unique and prove the normal transitions succeed. The revert is recoverable from `c84fcd61a`.

- 2026-09-05 — **Option B closure reconciled by 0764.** The wrapup route remains exhaustive and safety-defaulting; the incompatible lifecycle half stays reverted. The earlier FAIL evaluated obsolete unconditional Option A activation evidence. After Requirements and Acceptance Criteria became branch-conditional, a fresh PASS verifies the selected Option B state. Reopen only after the 0757 measurement shows at least five real terminal runs and at least 80% run-scoped cost coverage.
