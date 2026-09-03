---
schema_version: 1
name: "Re-measure gate: re-run the workflow run-economy measurement and decide Option A continuation or the Option B stop"
status: todo
template: meta
created_at: 2026-09-03T20:27:39.200Z
updated_at: "2026-09-03T21:13:08.052Z"
feature_id: D9
dependencies: ["0751", "0752", "0753"]
priority: P1
ac_altitude: task-local
---

## 0757. Re-measure gate: re-run the workflow run-economy measurement and decide Option A continuation or the Option B stop

### Background
This is the decision point the operator attached to the D8 approval, and it is a real gate, not a formality.

The strategy's budgets are **explicitly unestablished**. At the D8 freeze the cohort held 11 workflows, 65 dry probes, 3 non-terminal runs, and **0 real terminal runs**, with no run-scoped cost mappings and a defective verified-outcome binding (`docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §G, §B). 0730's sufficiency rule was NOT MET, so no ceiling in the plan is evidence — the packet says so in §4.7 and repeats it in §9.2. A postscript dated 2026-09-02 notes the main-tree database has since gained terminal runs and 25 run-scoped sessions, which is exactly why the number must be taken again rather than assumed.

Two things must be true before proportional routing is worth building: real terminal runs exist in useful numbers, and enough of them carry run-scoped cost attribution to make a cost-per-verified-PASS denominator meaningful. The plan's pilot exit bar is ≥5 real terminal runs per pilot with ≥80% run-scoped cost row coverage (§7, S3).

This task re-runs the measurement **after** S0 lands, because S0 is what makes the measured proof honest — measuring against a fail-open proof path (F-5, F-7, F-8) would produce a confident wrong number. The outcome is a recorded verdict, either way:

- **Bar met** → Option A continues; 0758 (S3 pilots) and then 0759 (S5) proceed.
- **Bar not met** → the feature stops at the Option B boundary. 0758 and 0759 are closed as not-built with this verdict as the reason. That is a completion path, not a failure.
### Requirements
- [ ] R1. The 0730 measurement is re-run against the current database using the source-local CLI, with the binary and importer provenance recorded before the run.
- [ ] R2. The re-measure reports, per shipped workflow: real terminal run count, dry-probe count, non-terminal count, and run-scoped cost row coverage.
- [ ] R3. Unknowns stay unknown. A missing cost row is never counted as zero, dry runs are excluded from real-run counts, and token-only rows are not dropped.
- [ ] R4. The verified-outcome binding defect (0730 §B) is either repaired or explicitly excluded, and which one is stated. A verdict is not correlated to a run whose binding is known broken without saying so.
- [ ] R5. The result is compared against the pilot bar — ≥5 real terminal runs per candidate pilot and ≥80% run-scoped cost row coverage — and the comparison is recorded with its numbers, not just its conclusion.
- [ ] R6. A disposition is recorded: continue Option A, or stop at the Option B boundary. On a stop, tasks 0758 and 0759 are closed as not-built citing this verdict, and the feature's Notes record the boundary.
- [ ] R7. The measurement is reproducible: the exact commands and their outputs are recorded so a later reader can re-derive the numbers.
### Acceptance Criteria
```gherkin
Feature: Workflow run-economy re-measure gate

  @core
  Scenario: R1 — The measurement runs against honest proof
    Given tasks 0751, 0752, and 0753 are done
    When the run-economy measurement is re-run through the source-local CLI
    Then the binary and importer provenance is recorded before any query
    And the measurement reflects the repaired proof paths.

  @core
  Scenario: R2/R3 — Unknowns are reported as unknown
    Given the re-measure output
    When it is inspected
    Then per-workflow real terminal, dry, and non-terminal counts are reported separately
    And a missing cost row is reported as unknown rather than zero
    And no dry run is counted as a real terminal run.

  @core
  Scenario: R5 — The bar comparison records its numbers
    Given the pilot bar of five real terminal runs per candidate and eighty percent run-scoped cost coverage
    When the re-measure result is compared against it
    Then the recorded comparison carries the measured numbers, not only the conclusion.

  @core
  Scenario: R6 — The re-measure decides whether proportional routing is built
    Given the completed comparison
    When the disposition is written
    Then it states either that Option A continues or that the feature stops at the Option B boundary
    And on a stop, tasks 0758 and 0759 are closed as not-built citing this verdict.

  @edge
  Scenario: R7 — The numbers are re-derivable
    Given the recorded measurement
    When a later reader follows it
    Then the exact commands and their outputs are present
    And the reported numbers can be re-derived from them.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Measure after S0, never before.** The whole point of sequencing this behind 0751-0753 is that a fail-open proof path manufactures passes. A measurement taken before those repairs would be precise and wrong.

**Reuse 0730's method, do not invent a second one.** The comparison only means something if it is the same measurement. Re-run the same tooling (`scripts/commands/real-run-cost.ts`, the pipeline-budgets check, the cohort queries in 0730) against the current database, and note any tooling change since the original run — a changed denominator invalidates the comparison and must be called out rather than silently absorbed.

**Provenance first (project rule).** Real-data history validation runs through the source-local CLI (`bun run apps/cli/src/index.ts …`), never a possibly stale global `spur`, and the binary/importer provenance is recorded before the run.

**The honest-stop is the valuable outcome.** The failure mode this gate exists to prevent is building S3 and S5 because they were planned, on a run economy that is still 97% dry probes. If the numbers say stop, stopping is the deliverable — record it plainly, close 0758/0759 as not-built, and leave the reopening condition written down.

**Do not tune the bar to the result.** ≥5 real terminal runs per pilot and ≥80% coverage come from the frozen packet. If the operator wants a different bar, that is a decision to make *before* reading the numbers, not after.
### Plan
- [ ] Confirm 0751, 0752, and 0753 are done; record their commits.
- [ ] Record binary and importer provenance for the source-local CLI before any query.
- [ ] R1/R2: re-run the 0730 measurement; capture per-workflow real terminal, dry, and non-terminal counts plus run-scoped cost coverage.
- [ ] R3: verify unknowns are reported as unknown — no zero-substitution, no dry runs in real counts, no dropped token-only rows.
- [ ] R4: state whether the verified-outcome binding is repaired or excluded.
- [ ] R5: compare against the ≥5-runs / ≥80%-coverage bar and record the numbers.
- [ ] R6: record the disposition. On a stop, close 0758 and 0759 as not-built citing this verdict and update the D9 Notes with the Option B boundary.
- [ ] R7: write the commands and outputs into the Solution so the numbers are re-derivable.
### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §1 (Option A/B), §4.7 (budgets unestablished), §7 (S3 exit bar), §9.3 disposition conditions
- Measurement authority: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §B (verified-outcome binding defect), §F (cohort), §G (sufficiency rule)
- Tooling: `scripts/commands/real-run-cost.ts`, `scripts/commands/pipeline-budgets.ts`
- Project rule: `CLAUDE.md` — real-data history validation uses the source-local CLI with recorded provenance
- Depends on: 0751, 0752, 0753 (S0). Gates: 0758, 0759.
### History
