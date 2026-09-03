---
schema_version: 1
name: "S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle with run-bound cost evidence"
status: todo
template: feature-impl
created_at: 2026-09-03T20:27:39.492Z
updated_at: "2026-09-03T21:13:35.497Z"
feature_id: D9
dependencies: ["0754", "0757", "0751"]
priority: P1
ac_altitude: task-local
---

## 0758. S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle with run-bound cost evidence

### Background
The proportional route table was proven executable in the D8 prototype (`docs/analysis/d8-0732-proportional-gate-prototype.md`) — but on a **fixture**, across 5 real engine runs, not on a shipped workflow with a real caller. This task moves it onto the two workflows the fit classification selected as pilots (`docs/inventory/d8-0731-workflow-fit-classification.md` §6): `wrapup-pipeline` (primary — real caller `/sp:dev-wrap`, 4 advisories, dry `done` already proven) and `task-lifecycle` (secondary — real caller `spur task update/record`, 0 advisories, and the vehicle for exercising the version both-forms case).

`task-pipeline` is deliberately not a pilot: it carries the worst advisory count and depends on the primitives 0751 repairs. It migrates last, in 0759.

This task is **conditional**. It proceeds only if the re-measure gate (0757) clears the bar — ≥5 real terminal runs per pilot with ≥80% run-scoped cost row coverage. If 0757 records the Option B stop, this task closes as not-built.

It also carries an operator consent gate: changing a shipped workflow's routing is a production change (plan §7, S3).
### Requirements
- [ ] R1. `wrapup-pipeline` and `task-lifecycle` carry the closed route table from the strategy §4: every input maps to exactly one route through mutually exhaustive predicates, with no unrouted input.
- [ ] R2. Missing, unknown, or conflicting evidence always selects the safety path.
- [ ] R3. The immutable safety floor is never traded for speed on any route: proof-bracket guards, budget-unverifiable fail-closed dispatch, reviewer/executor independence, and run-id confinement hold on the fast path exactly as on the safety path.
- [ ] R4. Every route writes a bounded, machine-readable reason for the run. No route is silent, and no skip is unexplained.
- [ ] R5. Route and skip facts are provable from run-bound evidence — engine-persisted transition records, the run's own artifacts, and the run-start definition digest — not from log scraping.
- [ ] R6. Each pilot accumulates ≥5 real terminal runs with ≥80% run-scoped cost row coverage; the run-scoped cost importer and the verified-outcome binding fix land as part of reaching that bar.
- [ ] R7. `task-lifecycle` exercises the version both-forms case: unversioned and explicit copies take the same route and differ only in digest.
- [ ] R8. Each pilot's routing is revertable on its own, without touching the engine, the other pilot, or `task-pipeline`.
- [ ] R9. ADR-103 records the proportional-gate contract as implemented.
### Acceptance Criteria
```gherkin
Feature: Proportional routing on the surrounding pilots

  @core
  Scenario: R1 — Every input resolves to exactly one route
    Given a piloted workflow carrying the closed route table
    When any input is routed
    Then exactly one route is selected
    And no input is left unrouted.

  @core
  Scenario: R2 — Unknown or conflicting evidence takes the safety path
    Given routing input that is missing, unrecognized, or self-conflicting
    When the route is selected
    Then the safety path is selected.

  @core
  Scenario: R3 — The safety floor holds on the fast path
    Given a run that takes the fast route
    When its guards are inspected
    Then the proof-bracket guards, the budget-unverifiable fail-closed dispatch, the reviewer-independence check, and run-id confinement all applied
    And none was bypassed by the routing decision.

  @core
  Scenario: R4 — Every route explains itself
    Given any completed piloted run
    When its evidence is read
    Then a bounded reason for the selected route was written for that run
    And no skip occurred without one.

  @core
  Scenario: R5 — Route facts are provable from run-bound evidence
    Given a completed piloted run
    When its route is reconstructed
    Then it is derivable from the engine-persisted transition records, the run's artifacts, and the run-start definition digest
    And no log scraping is required.

  @core
  Scenario: R6 — Each pilot reaches the evidence bar
    Given the piloted workflows after the rollout window
    When their runs are counted
    Then each has at least five real terminal runs
    And at least eighty percent of those runs carry run-scoped cost rows.

  @edge
  Scenario: R7 — Version form does not change the route
    Given unversioned and explicitly versioned copies of task-lifecycle
    When each is run
    Then both take the same route
    And only their definition digests differ.

  @edge
  Scenario: R8 — A pilot reverts alone
    Given a piloted workflow's routing
    When it is reverted
    Then the other pilot, task-pipeline, and the engine are unaffected.

  @core
  Scenario: A proportional route always resolves and never trades the safety floor
    Given a piloted workflow carrying the closed route table
    When any input including missing, unknown, or conflicting evidence is routed
    Then exactly one route is selected
    And unknown or conflicting evidence selects the safety path
    And a bounded reason is written for the run
    And no proof-bracket guard, budget fail-closed dispatch, reviewer-independence check, or run-id confinement is bypassed by any route.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Transfer the prototype's contract, not its fixture.** 0732 §2 established the closed two-path table and §5 the run-bound evidence shape. Reuse both. One caution the packet is explicit about: the fixture's `safety:conflict` reason *label* on the `skipped` terminal is a wart — `skipped` is a genuine terminal, not a safety route. Implement against the route table and the transition records, never against the fixture's reason strings.

**Safety floor is not a route input.** R3 is the requirement most likely to erode under a "fast path" framing. The floor guards are unconditional; the route decides how much *optional* work runs, never whether a floor guard applies. If a fast route needs a floor guard relaxed to be fast, the route is wrong.

**R6 is the expensive half.** Reaching the bar means the run-scoped cost importer must map runs to sessions and the verified-outcome binding defect (0730 §B — wrong proof shape, no `runId` in the verdict, no digest re-check at read) must be fixed, or the coverage number is unmeasurable. Budget for that work; it is not incidental to the YAML change.

**Wrapup first, lifecycle second.** `wrapup-pipeline` is the primary because it is an orchestrator with a proven caller and an already-proven dry `done`. `task-lifecycle` follows and additionally carries R7's version exercise. Do not start both at once; the second pilot's value is confirming the first's contract transfers.

**Rollback is per-workflow (R8)** — a per-workflow option, revertable without touching the engine. This is what makes the pilot safe to try on production surfaces.

**Consent:** operator sign-off before either pilot's routing is committed.

**Conditional on 0757.** If the re-measure records the Option B stop, close this task as not-built rather than proceeding on unestablished budgets.
### Plan
- [ ] Confirm 0757 cleared the bar and recorded a continue disposition; if it recorded the stop, close this task as not-built and update the D9 Notes.
- [ ] R6 prerequisite: land the run-scoped cost importer mapping and fix the verified-outcome binding (proof shape, `runId` in the verdict, digest re-check at read).
- [ ] R1-R5: apply the closed route table to `wrapup-pipeline`; reproduce the 0732 fixture assertions against the real wrapup graph. **Operator consent before commit.**
- [ ] Accumulate real terminal runs on the primary pilot; verify the reason files and transition records reconstruct each route.
- [ ] R1-R5, R7: apply the route table to `task-lifecycle`; exercise unversioned vs explicit both-forms. **Operator consent before commit.**
- [ ] R6: confirm ≥5 real terminal runs and ≥80% run-scoped cost coverage per pilot; record the numbers.
- [ ] R8: verify each pilot reverts independently.
- [ ] R9: write ADR-103 for the proportional-gate contract as implemented.
- [ ] `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §4 (route contract), §7 (S3), §2.1 (pilot dispositions)
- Prototype: `docs/analysis/d8-0732-proportional-gate-prototype.md` §2 (closed route table), §5 (run-bound evidence), §7 (version both-forms), §8 (constraints inherited by task-pipeline)
- Pilot selection: `docs/inventory/d8-0731-workflow-fit-classification.md` §5, §6
- Binding defect: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §B
- Surfaces: `config/workflows/wrapup-pipeline.yaml`, `config/workflows/task-lifecycle.yaml`; the run-scoped cost importer; the verified-outcome fold
- New ADR: 103 (proportional-gate contract)
- Depends on: 0757 (gate), 0754. Gates: 0759.
### History
