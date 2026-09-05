---
schema_version: 1
name: "Reconcile D9 Option B closure evidence and corpus findings"
status: done
template: feature-impl
created_at: 2026-09-05T00:16:59.004Z
updated_at: "2026-09-05T00:57:56.433Z"
feature_id: D9
---

## 0764. Reconcile D9 Option B closure evidence and corpus findings

### Background
Forced D9 verification found four non-PASS verdicts after the Option B stop had already been accepted. The implementation gates are green; the mismatch is between conditional feature intent and task contracts that still describe the abandoned Option A branch as mandatory. Reconcile the corpus without activating dormant routing, erasing historical measurements, or regenerating the corpus waiver around known findings.
### Requirements
- [x] R1. `bun run corpus-check` is green without regenerating `config/corpus-baseline.json`; abandoned 0758/0759 Option A work is classified explicitly as not applicable under Option B rather than left as unchecked work.
- [x] R2. Task 0757 records the disposition that actually shipped: Option B stops activation; the breaking task-lifecycle pilot is reverted; retained wrapup/task-pipeline routing stays unreachable until the existing measurement bar is met.
- [x] R3. Tasks 0758 and 0759 state conditional Option A/Option B requirements and acceptance criteria. Their Option B branch is verifiably complete without real fast-path runs, while their historical measurement remains recorded.
- [x] R4. ADR-107 receives an append-only amendment and feature D9 Notes describe the same active scope, dormant surfaces, and reopening condition.
- [x] R5. A PASS verdict covers the three remaining D9 scenario titles exactly: `The corpus and composition gates are green on regenerated snapshots`, `The re-measure decides whether proportional routing is built`, and `A proportional route always resolves and never trades the safety floor`.
- [x] R6. Tasks 0754, 0757, 0758, 0759, and 0764 have PASS verdicts; feature D9 has no check findings and reaches `done`; full project gates remain green.
- [x] R7. Every D9 task record has no completed-but-unchecked Plan item or template-only cancellation section; superseded Option B, Review, and History claims are removed or explicitly marked historical.
### Acceptance Criteria
```gherkin
Feature: D9 Option B closure reconciliation

  @core
  Scenario: The corpus and composition gates are green on regenerated snapshots
    Given the accepted Option B closure and current regenerated baselines
    When the corpus and composition gates run without a baseline regeneration
    Then both gates pass
    And abandoned Option A work is recorded as not applicable rather than incomplete.

  @core
  Scenario: The re-measure decides whether proportional routing is built
    Given the recorded run-scoped coverage measurement
    When it is compared with the frozen activation bar
    Then Option B is the single recorded disposition
    And no proportional fast path is activated below the bar.

  @core
  Scenario: A proportional route always resolves and never trades the safety floor
    Given the retained wrapup proportional route and dormant task-pipeline route
    When their definitions and defaults are inspected
    Then every retained route table is exhaustive
    And missing, unknown, or conflicting evidence selects safety
    And no production default activates the fast path.

```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Treat Option B as a first-class completed branch of D9. Keep the failed measurement as evidence, but make activation-dependent work explicitly N/A under that branch. Preserve the working proof/binding code, the safe wrapup route table, and the dormant task-pipeline route; do not restore the task-lifecycle duplicate-edge design. Record the decision delta as an ADR-107 amendment before synchronizing derived feature text.
### Plan
- [x] Amend ADR-107 with the final Option B scope and reopening rule.
- [x] Reconcile 0757 Requirements and Acceptance Criteria with the actual Option B disposition.
- [x] Reconcile 0758/0759 Requirements, Acceptance Criteria, and Plan sections; remove abandoned-branch unchecked boxes.
- [x] Synchronize D9 Notes and retain exact scenario-title coverage in 0764.
- [x] Re-verify 0754/0757/0758/0759/0764 and record PASS verdicts.
- [x] Run targeted tests, `corpus-check`, `spur-check`, feature check/refresh/sync, and final status audit.
- [x] Audit every linked D9 record; reconcile completed Plan boxes, cancelled duplicate sections, stale Reviews, duplicate History, and obsolete Option B wording.
### Solution
| Change | Evidence |
| --- | --- |
| Option B is an explicit completed branch with a frozen reopening bar | `docs/00_ADR.md:2220` |
| D9 records the active, reverted, and dormant surfaces plus closure traceability | `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md:204` |

The source-local measurement is unchanged: wrapup `1 / 45` (2.2%), task-lifecycle `0 / 465` (0%), and task-pipeline `0 / 207` (0%) mapped terminal runs. Those values fail the frozen 80% coverage conjunct and select Option B. The reconciliation does not regenerate the corpus baseline, manufacture fast-path runs, or activate dormant routing.

The lifecycle pilot stays reverted because the engine resolves one `(from,to)` edge and cannot fall through a sibling guard. Wrapup retains its exhaustive, safety-defaulting route table. Task-pipeline retains its dormant migration and proof binding with `mode: ""`; no production caller selects `fast`.

The three exact D9 scenario titles are present in this task's Acceptance Criteria so one PASS artifact closes traceability after the task reaches `done`.

The final residue sweep covers all thirteen linked tasks. It checks off 21 already-completed Plan items in 0751/0753/0755/0756; explains the consolidated cancellations in 0761/0762; removes the duplicate 0758 history entry; and replaces obsolete "not-built," FAIL, WIP, and resolved-review wording with the final Option B state. The only non-corpus change corrects an inaccurate scanner comment without changing the rule.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Fresh `bun run corpus-check` exits 0 with 0 new errors and 0 new warnings; `config/corpus-baseline.json` was not regenerated. 0758/0759 plans use plain `N/A — Option B` entries rather than unchecked work. |
| R2 | MET | 0757 records Option B; `packages/app/tests/workflow/lifecycle-adapter.test.ts:94` pins the lifecycle rollback by requiring unique `(from,to)` edges; `config/workflows/wrapup-pipeline.yaml:65` and `config/workflows/task-pipeline.yaml:52` keep `mode` empty. |
| R3 | MET | 0758/0759 Requirements and AC encode both branches; selected Option B treats activation-only real runs as N/A while retaining the exact failed measurement. |
| R4 | MET | ADR-107 amendment at `docs/00_ADR.md:2220` and D9 Notes at `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md:204` agree on scope and reopening. |
| R5 | MET | This task's AC contains all three D9 scenario titles verbatim, each verified below. |
| R6 | MET | 0754/0757/0758/0759/0764 verdict artifacts are PASS; strict feature check has no findings and feature sync applied `active → verifying → done`. `spur-check` exits 0 with 7,376 pass / 0 fail and corpus exits 0. |
| R7 | MET | Source-local task inspection across all thirteen D9 records finds zero unchecked Plan boxes, no template-only Background/Plan/Solution in cancelled 0761/0762, one lifecycle-revert entry in 0758 History, and no current Review claiming resolved work remains open. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| The corpus and composition gates are green on regenerated snapshots | MET | command | Corpus exits 0; composition `--check` reports baseline match/no write; `spur-check` exits 0. |
| The re-measure decides whether proportional routing is built | MET | command | The recorded source-local measurement reports 2.2%/0%/0%; production-scope `rg` finds no active `fast` caller. |
| A proportional route always resolves and never trades the safety floor | MET | test | 48 targeted routing/lifecycle/binding tests pass; retained routes are exhaustive and safety-defaulting. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | correctness | `docs/00_ADR.md:2201` | The amendment preserves the failed measurement and makes Option B a completed branch. |
| P4 | safety | `packages/app/tests/workflow/lifecycle-adapter.test.ts:94` | The known unsafe duplicate-edge pilot remains reverted and regression-pinned; no runtime change was introduced by reconciliation. |
| P4 | traceability | `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md:1` | Active scope and reopening conditions now agree with task contracts. |
| P4 | record integrity | D9 linked task set | Completed Plans, consolidated cancellations, Reviews, and History now describe the final state without false pending work. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET · R6 MET · R7 MET.

**Residual risk** — No D9 work remains under Option B. Fast-path routing lacks sufficient run-scoped coverage and remains inactive by design.

**Final disposition:** PASS recorded; D9 closed.
### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Decision authority: ADR-107 in `docs/00_ADR.md`
- Re-measurement and branch selection: task 0757
- Reconciled pilot and canonical workflow records: tasks 0758 and 0759
### History
- 2026-09-05T00:21:52.175Z todo → wip (system)
- 2026-09-05T00:35:02.594Z wip → testing (system)
- 2026-09-05T00:35:10.136Z testing → done (system)
- 2026-09-05T00:44:38.395Z done → wip (system)
- 2026-09-05T00:57:44.234Z wip → testing (system)
- 2026-09-05T00:57:56.433Z testing → done (system)
