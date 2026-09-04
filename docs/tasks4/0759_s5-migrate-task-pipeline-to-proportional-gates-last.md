---
schema_version: 1
name: "S5: Migrate task-pipeline to proportional gates, last"
status: wip
template: feature-impl
created_at: 2026-09-03T20:27:39.778Z
updated_at: "2026-09-04T03:44:13.165Z"
feature_id: D9
dependencies: ["0758"]
ac_altitude: task-local
---

## 0759. S5: Migrate task-pipeline to proportional gates, last

### Background
`task-pipeline` is the canonical pipeline and the highest-blast-radius surface in the workflow set — 14 advisories, the worst count of the eleven (`docs/inventory/d8-0731-workflow-fit-classification.md` §2). The strategy migrates it **last**, and the ordering is not deference: at D8 freeze it was non-executable as a pilot because it depends on the primitives F-5, F-7, and F-8 that the prototype deliberately avoided (`docs/analysis/d8-0732-proportional-gate-prototype.md` §8). Option C — building routing straight onto it — was rejected for exactly this reason.

Three things must hold before this task starts: the proof primitives are repaired (0751), the route table is proven on a real caller rather than a fixture (0758), and real runs with working cost attribution exist so a change can be shown not to regress anything (0757).

The prototype also fixes a constraint this task inherits: `task-pipeline` stays on the real engine with real actions. No fixture substitution, no dry-run standing in for a terminal run.

This task is conditional on 0758, which is itself conditional on the 0757 re-measure. If the measurement recorded the Option B stop, this task closes as not-built. It carries an operator consent gate.
### Requirements
- [ ] R1. `task-pipeline` carries the same closed route table proven on the pilots: exhaustive routing, unknown-to-safety, bounded reasons, run-bound proof.
- [ ] R2. The immutable safety floor holds on every route, including the fast path.
- [ ] R3. No behavior regression on the canonical pipeline: the routes a pre-migration run would have taken still produce the same verdicts on real terminal runs.
- [ ] R4. The migration runs on the real engine with real actions — no fixture substitution, and no dry run counted as a terminal run.
- [ ] R5. Verified-outcome metrics are bound to the certifying run, so a verified PASS is attributable after the migration.
- [ ] R6. Any iterative bound adjusted in this migration is justified by measured utilization, not by estimate. Where no measurement exists, the bound is left unchanged.
- [ ] R7. The migration is revertable as a per-workflow option without touching the engine or the pilots.
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
- [ ] Confirm 0751 (proof primitives), 0757 (bar cleared), and 0758 (route table proven on real callers) are all done; if any recorded a stop, close this task as not-built.
- [ ] Capture the pre-migration baseline: real terminal task-pipeline runs and their verdicts, for the R3 comparison.
- [ ] R1/R2: apply the proven route table to `config/workflows/task-pipeline.yaml`. **Operator consent before commit.**
- [ ] R4: exercise real terminal runs through the engine with real actions; no fixture, no dry run counted.
- [ ] R3: compare post-migration verdicts against the baseline on equivalent inputs; investigate any difference before proceeding.
- [ ] R5: confirm verified-outcome records are bound to the certifying run and digest.
- [ ] R6: audit every changed bound for a measurement citation; revert any that lacks one.
- [ ] R7: verify independent revert.
- [ ] `bun run spur-check`; record the migration evidence.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §7 (S5), §1 (Option C rejection), §4 (route contract)
- Prototype constraints: `docs/analysis/d8-0732-proportional-gate-prototype.md` §8 (real engine + real actions; F-5/F-7/F-8 prerequisites)
- Fit classification: `docs/inventory/d8-0731-workflow-fit-classification.md` §2 (14 advisories), §3 (no measured basis for iterative bounds), §5
- Surface: `config/workflows/task-pipeline.yaml`
- Depends on: 0758 (and transitively 0751, 0757).
### History
- 2026-09-04T03:44:13.165Z todo → wip (system)
