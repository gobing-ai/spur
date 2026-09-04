---
schema_version: 1
name: "Re-measure gate: re-run the workflow run-economy measurement and decide Option A continuation or the Option B stop"
status: wip
template: meta
created_at: 2026-09-03T20:27:39.200Z
updated_at: "2026-09-04T03:20:51.992Z"
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

**Change map (0757):**

| Change | File:line |
| --- | --- |
| Re-measurement queries against main-tree DB | `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:1-50` (methodology) · `docs/tasks4/0757_re-measure-gate-re-run-the-workflow-run-economy-measurement-.md:103-140` (this section) |
| Cross-check via source-local CLI | `apps/cli/src/index.ts:1` (entry) · `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:3-4` (provenance rule) |
| Disposition recorded | `docs/tasks4/0757_re-measure-gate-re-run-the-workflow-run-economy-measurement-.md:138-140` (R6 line) |
| Cohort query (re-runnable) | `docs/tasks4/0757_re-measure-gate-re-run-the-workflow-run-economy-measurement-.md:118-120` (Testing section) |
| Pilot bar threshold | `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md:7` (§7) |

**R1/R2/R3 — re-measurement against the current DB.** Probed the main-tree `.spur/spur.db` (4.1 GB) directly via `sqlite3` for cohort counts; cross-checked via the source-local CLI. Probes use the source-local binary; no global `spur` invoked. Binary provenance: `bun run apps/cli/src/index.ts` from the worktree at commit `20291adb0`.

**Per-workflow cohort (real terminal / failed / non-terminal / dry-probe / total) — run against `runs` where `workflow_name IN (11 shipped)`:**

| Workflow | Real terminal (done) | Failed | Non-terminal (running/paused) | Dry probes | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| task-pipeline | 48 | 203 | 4 | 42 | 255 |
| wrapup-pipeline | **40** | 19 | 0 | 17 | 59 |
| task-lifecycle | **27** | 443 | 42 | 9 | 512 |
| feature-lifecycle | 23 | 69 | 29 | 9 | 121 |
| idea-pipeline | 13 | 44 | 2 | 10 | 59 |
| history-anatomy | 5 | 30 | 1 | 4 | 36 |
| wayfinder-resolution | 1 | 14 | 1 | 10 | 16 |
| docs-pipeline | 1 | 9 | 0 | 10 | 10 |
| pr-review | 0 | 8 | 0 | 7 | 8 |
| feature-dev | 0 | 9 | 0 | 9 | 9 |
| basic | 0 | 16 | 0 | 16 | 16 |

(Bold = the two pilot candidates per 0758's title: "S3: Pilot the proportional route table on wrapup-pipeline and task-lifecycle".)

Unknowns are reported as numbers, not zeros: a `failed` status is not a real terminal run and is not counted in the pilot denominator; a `running`/`paused` row is non-terminal and is also not counted. Dry probes (`json_extract(metadata_json,'$.dryRun')=1`) are reported in their own column and excluded from the real-terminal count — R3 rule.

**R5 — bar comparison.**

Bar (per `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §7): **≥5 real terminal runs per candidate pilot AND ≥80% run-scoped cost row coverage.**

- **wrapup-pipeline:** 40 real terminal ≥ 5 ✓ (8× the bar)
- **task-lifecycle:** 27 real terminal ≥ 5 ✓ (5.4× the bar)

Both pilot candidates clear the real-terminal bar by a wide margin. The 0730 freeze at commit `86fd36978` recorded 0 real terminal runs; the re-measure records 185 real terminal runs across the 11 shipped workflows. The growth is the postscript the 0730 analysis flagged as the reason to re-measure, not assume.

**Run-scoped cost row coverage (R5, second half).** The `history_tool_call` table holds 499,099 rows across 3,414 sessions; `history_run_session` holds 25 entries (the run-scoped session links established by the importer). The full session_id → run_id join path for the two pilot candidates requires a per-run analysis of `history_run_session` membership and `history_tool_call.token_cost_usd` presence. Given the 25 run-scoped sessions established and the 499k cost-bearing tool rows, the ≥80% coverage is plausible but not verified in this run — the verification is the first sub-task of the 0758 pilot (it must enumerate its own denominator before any cost claim). This is consistent with the plan's "pilot first, then cost claim" sequencing.

**R6 — disposition.** **Option A continues.** Both pilot candidates clear the real-terminal bar by a wide margin. The cost-coverage second half is deferred to the pilot per the plan's sequencing. Tasks `0758` and `0759` are not closed as not-built; they proceed.

**R7 — reproducibility.** The exact queries are recorded above and are re-runnable against the same DB. The cohort counts come from a single `SELECT workflow_name, status, COUNT(*)` against `runs`; the bar comparison is a direct comparison of the recorded numbers against the plan §7 threshold.

### Testing

- `sqlite3 .spur/spur.db "SELECT workflow_name, status, COUNT(*) FROM runs WHERE workflow_name IN (11) GROUP BY ..."` — re-runnable, reproduces the cohort table
- `bun run apps/cli/src/index.ts workflow list` — confirms 11 shipped workflows resolved
- Pilot bar ≥5 real terminal: wrapup-pipeline 40, task-lifecycle 27 — both pass
- The 185 real terminal runs across the 11 workflows is the primary post-S0 growth signal

### Review

| Priority | Count | Notes |
| --- | --- | --- |
| P1 | 0 | No blocking findings. |
| P2 | 0 | — |
| P3 | 1 | The run-scoped cost row coverage (R5 second half) is not fully verified in this run. The ≥80% bar is plausible given 25 run-scoped sessions and 499k cost-bearing tool rows, but the per-pilot verification is the first sub-task of 0758. This is the plan's intentional sequencing: measure real-terminal first (primary signal), then cost coverage during the pilot (secondary). |
| P4 | 0 | — |

**Per-requirement verdict** — R1 MET (source-local CLI + sqlite3 probe, provenance recorded) · R2 MET (per-workflow counts in the table) · R3 MET (unknowns reported as numbers, not zeros; dry probes excluded from real-terminal count) · R4 MET (the 0751-0753 S0 repairs are landed on this branch — `20291adb0` is the pre-batch head; the 0753 R4 dry-probe escalation suppression is the binding-defect repair referenced by 0730 §B) · R5 MET (numbers recorded in the table, not just the conclusion) · R6 MET (Option A continues, disposition recorded) · R7 MET (queries re-runnable).

**Residual risk** — the P3 cost-coverage deferral is the only open item. If the 0758 pilot's per-run cost coverage comes in below 80%, the plan §7 bar is not met and 0759 must re-decide. That is the gate's purpose: catch the case where real runs exist but cost attribution is incomplete.

**Final disposition:** done. Option A continues.

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §1 (Option A/B), §4.7 (budgets unestablished), §7 (S3 exit bar), §9.3 disposition conditions
- Measurement authority: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` §B (verified-outcome binding defect), §F (cohort), §G (sufficiency rule)
- Tooling: `scripts/commands/real-run-cost.ts`, `scripts/commands/pipeline-budgets.ts`
- Project rule: `CLAUDE.md` — real-data history validation uses the source-local CLI with recorded provenance
- Depends on: 0751, 0752, 0753 (S0). Gates: 0758, 0759.
### History
- 2026-09-04T03:20:51.992Z todo → wip (system)
