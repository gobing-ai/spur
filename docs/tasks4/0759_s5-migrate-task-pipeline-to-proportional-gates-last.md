---
schema_version: 1
name: "S5: Migrate task-pipeline to proportional gates, last"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:39.778Z
updated_at: "2026-09-05T00:57:42.479Z"
feature_id: D9
dependencies: ["0758"]
ac_altitude: task-local
done_forced: "true"
---

## 0759. S5: Migrate task-pipeline to proportional gates, last

### Background
`task-pipeline` is the canonical, highest-blast-radius workflow and was deliberately migrated last, after proof repair, real-caller pilot work, and the 0757 re-measurement gate.

The migration landed before the corrected measurement selected Option B. Its final state is built, tested, and dormant: `mode` defaults to `""`, no production caller supplies `fast`, missing or conflicting evidence selects safety, and proof remains bound to the certifying run and definition digest. Option B therefore requires no manufactured real fast-path evidence and introduces no active behavior change.

Activation remains conditional on a future source-local measurement meeting both frozen conjuncts: at least five real terminal runs and at least 80% run-scoped cost coverage.
### Requirements
- [x] R1. The migration is conditional. Option A may activate the proven closed route table; selected Option B may retain the migration only while its default and production callers leave the fast path unreachable.
- [x] R2. Every retained route is exhaustive, missing or conflicting evidence selects safety, and the immutable safety floor remains on every reachable path.
- [x] R3. Option A requires a before/after verdict comparison on real terminal runs. Under selected Option B, no active behavior change is introduced: the empty default takes the pre-migration safety route and no production caller selects `fast`.
- [x] R4. Option A requires real-engine fast-path runs. Under selected Option B, dormant definition and writer tests prove non-activation and safety without misrepresenting fixtures as real-run evidence.
- [x] R5. A verified PASS is bound to the certifying run and the run-start workflow definition digest.
- [x] R6. Iterative bounds change only with measured utilization; every unmeasured bound remains unchanged.
- [x] R7. The task-pipeline migration is independently revertable without touching the pilots or engine.
### Acceptance Criteria
```gherkin
Feature: Conditional proportional routing on task-pipeline

  @core
  Scenario: R1 — The canonical pipeline routes exhaustively
    Given the dormant task-pipeline route table
    When any input is evaluated
    Then exactly one route resolves
    And missing, unknown, or conflicting evidence selects safety.

  @core
  Scenario: R2 — The safety floor holds on every reachable path
    Given task-pipeline's default route
    When its guards are inspected
    Then proof brackets, fail-closed dispatch, reviewer independence, and run-id confinement remain applied.

  @core
  Scenario: R3 — Option B introduces no active behavior change
    Given the failed activation measurement
    When current defaults and production callers are inspected
    Then no caller selects the fast path
    And every real run keeps the pre-migration safety route.

  @core
  Scenario: R4 — Dormant routing is not presented as real-run proof
    Given Option B prohibits activation below the bar
    When migration evidence is reviewed
    Then definition and writer tests are identified as dormant-path evidence
    And no fixture or dry run is counted as a real fast-path run.

  @core
  Scenario: R5 — A verified PASS is attributable
    Given a task-pipeline PASS
    When its proof is folded
    Then it is bound to the certifying run
    And its definition digest matches that run.

  @edge
  Scenario: R6 — Bounds move only on measurement
    Given the iterative bounds in the migrated pipeline
    When each changed bound is traced
    Then it cites measured utilization
    And any bound without a measurement is unchanged.

  @edge
  Scenario: R7 — The migration reverts alone
    Given the dormant task-pipeline migration
    When the migration is reverted
    Then the pilots and the engine are unaffected.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Conditional migration.** Option A requires real fast-path runs and verdict equivalence before activation. Selected Option B keeps the already-landed route table dormant: `mode` defaults empty, production callers do not override it, and the existing safety route remains canonical.

**Do not manufacture evidence.** Definition and writer tests prove exhaustiveness, safety fallback, binding, and revertability. They are not labeled as real-run proof; that evidence becomes required only if the measurement bar later reopens activation.

**No tuning without data.** Iterative bounds remain unchanged. The migration stays removable as a workflow-local definition change.
### Plan
- [x] Confirm the 0757 gate selected Option B and record the dormant disposition.
- N/A — Option B: do not capture a fast-path pre-migration baseline for an activation the gate rejected.
- [x] Retain the closed route table with an empty default and exhaustive safety fallback.
- N/A — Option B: do not execute real actions through an unauthorized fast path.
- N/A — Option B: defer before/after fast-path verdict comparison until the measurement bar reopens activation.
- [x] Bind verified outcomes to the certifying run and definition digest.
- [x] Leave unmeasured iterative bounds unchanged.
- [x] Verify independent revertability and absence of a production `fast` caller.
- [x] Run targeted routing and verified-outcome tests.
### Solution
**Selected branch:** Option B; the migration remains dormant.

| Outcome | Evidence |
| --- | --- |
| Empty default keeps the safety route | `config/workflows/task-pipeline.yaml:52` |
| Proof carries run and definition binding | `config/workflows/task-pipeline.yaml:641`, `config/workflows/task-pipeline.yaml:927` |
| Completion remains proof-bound | `config/workflows/task-pipeline.yaml:748` |
| Dormant route, writer, safety, and revert tests | `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:36` |

The source-local measurement records task-pipeline at `0 / 207` mapped terminal runs (0%), below the frozen 80% coverage bar. No production caller selects `mode = "fast"`; the default `mode: ""` therefore follows the pre-migration path through advisory review. Option B introduces no active behavior change and deliberately does not manufacture real fast-path evidence.

The route table is exhaustive, unknown evidence falls to safety, proof brackets and independent verification remain reachable, and the verdict proof is bound to both the certifying run and its definition digest. `iterationBound` remains 20 because there is no measured basis to change it. The YAML-local route split can be removed without changing the pilots or engine.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/task-pipeline.yaml:52` defaults `mode` empty; fast/safety edges are exhaustive and the safety edge is terminal fallback. |
| R2 | MET | Route tests prove unknown evidence falls to safety; proof brackets, independent verify, fail-closed record guard, and run-id confinement stay on reachable paths. |
| R3 | MET | Selected Option B introduces no active behavior change: repository search finds no production `mode = "fast"` caller and the empty default keeps advisory review. |
| R4 | MET | Definition and executed writer tests are recorded as dormant evidence, not mislabeled as real fast-path runs; activation is prohibited below the bar. |
| R5 | MET | `config/workflows/task-pipeline.yaml:641` stamps run and definition digest; `:927` fails closed on mismatch; all 10 verified-outcome tests pass. |
| R6 | MET | `iterationBound` remains 20; no unmeasured bound changed. |
| R7 | MET | The workflow-local migration defaults off and can be removed without changing either pilot or the engine. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The canonical pipeline routes exhaustively | MET | test | Fast and always-safety edges are asserted for both routed states. |
| R2 — The safety floor holds on every reachable path | MET | test | Proof bracket, reviewer independence, record binding, and confinement assertions pass. |
| R3 — Option B introduces no active behavior change | MET | command | Production-scope `rg` returns no `fast` caller; `mode` defaults empty. |
| R4 — Dormant routing is not presented as real-run proof | MET | command | `real-run-cost` records `0 / 207`; the targeted test command is reported separately as dormant-path evidence. |
| R5 — A verified PASS is attributable | MET | test | Run-id and definition-digest binding tests pass all 10 cases. |
| R6 — Bounds move only on measurement | MET | test | The suite asserts `iterationBound === 20`; no bound change exists. |
| R7 — The migration reverts alone | MET | test | The suite asserts default-off behavior and workflow-local ownership. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | activation | `config/workflows/task-pipeline.yaml:52` | The fast path is dormant by default and no production caller enables it. |
| P4 | proof | `config/workflows/task-pipeline.yaml:748` | Run and definition-digest binding fail closed before record. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET · R6 MET · R7 MET.

**Residual risk** — No work remains under selected Option B. Activation stays forbidden until the frozen real-run and coverage bar is met.

**Final disposition:** Option B complete.
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

- 2026-09-05 — **Option B closure reconciled by 0764.** The migration remains built, tested, and dormant: `mode` defaults to `""`, no production caller selects `fast`, and run/definition-digest proof binding remains enforced. The earlier FAIL evaluated obsolete unconditional Option A requirements for active fast-path evidence. The branch-conditional contract now verifies PASS under Option B. Reopen only after a source-local measurement shows at least five real terminal runs and at least 80% run-scoped cost coverage.
