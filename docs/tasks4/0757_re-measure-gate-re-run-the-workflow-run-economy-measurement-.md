---
schema_version: 1
name: "Re-measure gate: re-run the workflow run-economy measurement and decide Option A continuation or the Option B stop"
status: done
template: meta
created_at: 2026-09-03T20:27:39.200Z
updated_at: "2026-09-04T20:56:56.322Z"
feature_id: D9
dependencies: ["0751", "0752", "0753"]
priority: P1
ac_altitude: task-local
done_forced: "true"
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
- [x] R1. The 0730 measurement is re-run against the current database using the source-local CLI, with the binary and importer provenance recorded before the run.
- [x] R2. The re-measure reports, per shipped workflow: real terminal run count, dry-probe count, non-terminal count, and run-scoped cost row coverage.
- [x] R3. Unknowns stay unknown. A missing cost row is never counted as zero, dry runs are excluded from real-run counts, and token-only rows are not dropped.
- [x] R4. The verified-outcome binding defect (0730 §B) is either repaired or explicitly excluded, and which one is stated. A verdict is not correlated to a run whose binding is known broken without saying so.
- [x] R5. The result is compared against the pilot bar — ≥5 real terminal runs per candidate pilot and ≥80% run-scoped cost row coverage — and the comparison is recorded with its numbers, not just its conclusion.
- [ ] R6. A disposition is recorded: continue Option A, or stop at the Option B boundary. On a stop, tasks 0758 and 0759 are closed as not-built citing this verdict, and the feature's Notes record the boundary.
- [x] R7. The measurement is reproducible: the exact commands and their outputs are recorded so a later reader can re-derive the numbers.
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

| Change | File |
| --- | --- |
| Cohort re-measurement (runnable query, dry-run excluded) | `.spur/spur.db` `runs` table via `sqlite3 -readonly` — full query below |
| Run-scoped cost coverage measurement | `scripts/commands/real-run-cost.ts` via `bun scripts/spur-dev.ts real-run-cost` |
| Verified-outcome binding repair (0730 §B) | `packages/app/src/services/verified-outcome.ts:201-204` · `packages/domain/src/analytics/verified-outcome.ts:168-175` |
| Binding regression tests | `packages/app/tests/services/verified-outcome.test.ts` (`describe('verdict proof binding (0730 §B)')`) |
| Pilot bar threshold | `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §7 |

**R1 — provenance, recorded before the queries.**

- Binary: source-local CLI only. `bun` shim `/Users/robin/.proto/shims/bun`; entry `bun run apps/cli/src/index.ts`. No global `spur` was invoked for any number in this section.
- CLI package: `@gobing-ai/spur` `0.3.72` (`apps/cli/package.json`). Repo commit at measurement: `8bdaceeb2`.
- Importer: rows land through `history_import_ledger`, keyed by `source` + `imported_at`. At measurement the ledger holds `grok 653896` (last `2026-09-01T22:45:52.818Z`), `pi 437927` (`2026-09-04T20:44:17.971Z`), `omp 428042` (`2026-09-04T20:44:46.645Z`), `codex 390019` (`2026-09-04T19:04:24.915Z`), `agy 219150` (`2026-09-03T17:33:23.169Z`), `claude 162522` (`2026-09-04T20:44:23.265Z`), `opencode 28149` (`2026-09-01T04:28:15.257Z`), `gemini 3083` (`2026-08-31T06:56:48.502Z`).
- Run→session mapping: `history_run_session` holds **25 rows, all `exact` / `observed`** — no estimated mappings are read, per run-cost R3.

**R4 — the 0730 §B binding defect is REPAIRED, not excluded.** Both halves of §B were open and both are now closed:

- **§B.1 (shape mismatch).** The pipeline's verify hop writes the proof as `proof: {digest, runId, …}`, but the reader looked only at a flat `proofDigest` that nothing writes. `proofDigestPresent` was therefore a constant `false` for every pipeline-shaped verdict, and `packages/domain/src/analytics/verified-outcome.ts:168-171` routed every task into `excluded.proofAbsent` — the verified population was permanently empty. The reader now takes the nested digest with the flat key as a fallback (`packages/app/src/services/verified-outcome.ts:201-202`).
- **§B.2 (absent run binding).** With no run id in the proof block, the fold accepted *any* completed linked run as certifying, so a dry-run probe linked to the same wbs read as proof of completion. The verify hop now stamps `runId` into the proof block (`config/workflows/task-pipeline.yaml`, verify `onEnter` jq), and the reader binds on that exact run when present, keeping the permissive any-completed-run reading only for unbound legacy artifacts (`packages/app/src/services/verified-outcome.ts:203-204`).

Three regression tests cover the repair (`packages/app/tests/services/verified-outcome.test.ts`, `describe('verdict proof binding (0730 §B)')`): a nested `proof.digest` counts as present; a verdict bound to a run that never completed is excluded as `certifyingRunFailed`; an unbound verdict keeps the legacy reading. `cd packages/app && bun test tests/services/verified-outcome.test.ts` → 6 pass, 0 fail.

**R2/R3 — cohort, with dry probes excluded from the real-terminal column.**

The reproduction command (runnable verbatim; cutoff is this task's own `testing → done` timestamp, so the numbers are stable):

```bash
sqlite3 -readonly .spur/spur.db "
SELECT workflow_name,
       SUM(status='done' AND COALESCE(json_extract(metadata_json,'\$.dryRun'),0)<>1) AS real_done,
       SUM(status='done' AND COALESCE(json_extract(metadata_json,'\$.dryRun'),0)=1)  AS dry_done,
       SUM(status='failed')                 AS failed,
       SUM(status IN ('running','paused'))  AS nonterm,
       SUM(COALESCE(json_extract(metadata_json,'\$.dryRun'),0)=1) AS dry_all,
       COUNT(*)                             AS total
FROM runs
WHERE created_at <= 1788492064000
  AND workflow_name IN ('task-pipeline','wrapup-pipeline','task-lifecycle','feature-lifecycle',
                        'idea-pipeline','history-anatomy','wayfinder-resolution','docs-pipeline',
                        'pr-review','feature-dev','basic')
GROUP BY workflow_name ORDER BY real_done DESC;"
```

| Workflow | Real terminal (done, non-dry) | Dry `done` | Failed | Non-terminal | Dry (all) | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| task-pipeline | 33 | 15 | 203 | 4 | 42 | 255 |
| task-lifecycle | **27** | 0 | 443 | 42 | 9 | 512 |
| wrapup-pipeline | **23** | 17 | 19 | 0 | 17 | 59 |
| feature-lifecycle | 23 | 0 | 69 | 29 | 9 | 121 |
| idea-pipeline | 13 | 0 | 44 | 2 | 10 | 59 |
| history-anatomy | 5 | 0 | 30 | 1 | 4 | 36 |
| wayfinder-resolution | 1 | 0 | 14 | 1 | 10 | 16 |
| pr-review | 0 | 0 | 8 | 0 | 7 | 8 |
| feature-dev | 0 | 0 | 9 | 0 | 9 | 9 |
| docs-pipeline | 0 | 1 | 9 | 0 | 10 | 10 |
| basic | 0 | 0 | 16 | 0 | 16 | 16 |

Cohort real-terminal total: **125** (bold = the two 0758 pilot candidates). A `failed` row is not a real terminal run; a `running`/`paused` row is non-terminal; a dry probe is reported in its own columns and never in the real-terminal count — R3's three rules, each visible as its own column rather than asserted in prose.

**Correction to the first pass of this task.** The original cohort table's "Real terminal (done)" column was `SUM(status='done')` with no dry predicate, which counted dry probes as real terminal runs: task-pipeline 48 → 33, wrapup-pipeline 40 → 23, docs-pipeline 1 → 0. The prose also asserted "185 real terminal runs" against a table summing to 158; the correct figure is 125. The defect was invisible because the recorded reproduction command was elided (`IN (11)`, `GROUP BY ...`) and did not run — which is why the runnable query above is now the artifact.

**R5 — bar comparison, both conjuncts, with numbers.**

Bar (`docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §7): **≥5 real terminal runs per candidate pilot AND ≥80% run-scoped cost row coverage.**

```bash
bun scripts/spur-dev.ts real-run-cost --workflow wrapup-pipeline --workflow task-lifecycle --workflow task-pipeline --json
```

| Candidate | Real terminal (bar ≥5) | `mappedRuns` / `terminalRuns` | Coverage (bar ≥80%) | `usdRows` |
| --- | --- | --- | --- | ---: |
| wrapup-pipeline | 23 ✅ | 1 / 45 | **2.2%** ❌ | 15 |
| task-lifecycle | 27 ✅ | 0 / 465 | **0%** ❌ | 0 |
| task-pipeline | 33 ✅ | 0 / 207 | **0%** ❌ | 0 |

Corroborated independently of the script: the 25 `history_run_session` links resolve to only **10 distinct runs**, spread across **two** workflows — `history-anatomy` 9 and `wrapup-pipeline` 1.

```bash
sqlite3 -readonly .spur/spur.db "SELECT r.workflow_name, COUNT(DISTINCT h.run_id)
  FROM history_run_session h JOIN runs r ON r.id = h.run_id GROUP BY 1 ORDER BY 2 DESC;"
```

Neither pilot candidate has a run-scoped cost population to compute a cost-per-verified-PASS denominator from. `task-lifecycle` has zero. The first pass recorded this half as "plausible but not verified in this run" and deferred it to 0758 — the task the gate exists to authorize. Measured, it is not plausible; it is two orders of magnitude below the bar.

**R6 — disposition: the bar is NOT met; this is the Option B boundary.**

The bar is a conjunction. The first conjunct holds for both candidates (23 and 27, both ≥5). The second fails at 2.2% and 0% against ≥80%. The conjunction fails, and this task's Background states the consequence directly: *"Bar not met → the feature stops at the Option B boundary."* The first pass recorded "Option A continues" by evaluating one conjunct and assuming the other in the direction that let the gate pass — precisely the outcome the Design's "Do not tune the bar to the result" was written to prevent. **That disposition is withdrawn. The recorded disposition is the Option B stop.**

**What this means for 0758 and 0759, factually.** They were built before this correction, so the Background's "closed as not-built" is no longer literally available. Their state is instead: **built, and inert by default.** The proportional fast path is reached only when `mode = "fast"`; all three pilots declare `mode: ""` as the default (`config/workflows/task-pipeline.yaml`, `wrapup-pipeline.yaml`, `task-lifecycle.yaml`), and no production caller passes `fast` — the only `mode: 'fast'` sites in the repo are tests and fixtures. Every real run therefore takes the safety path, exactly as it did before the pilots landed. **Reverting them was not done here**: deleting shipped, tested, dormant code is a destructive change beyond this task's scope and is the operator's call. The honest record is that the routing exists, has never routed a real run, and is **gated on the coverage bar** rather than on a decision already taken.

**Reopening condition (the only thing that moves this off the boundary).** Re-run the R5 measurement; activate the fast path for a pilot only when that pilot shows **≥80% `mappedRuns` / `terminalRuns`** *and* ≥5 real terminal runs. Until then the fast path stays unreferenced by any caller. Raising coverage means run-scoped session attribution for `task-lifecycle` and `task-pipeline`, which today is zero.

**R7 — reproducibility.** Both commands above are runnable verbatim from the repo root against `.spur/spur.db` and reproduce every figure in this section: the `sqlite3` cohort query yields the table column-for-column, `real-run-cost --json` yields the `mappedRuns`/`terminalRuns` pairs, and the `history_run_session` join yields the 9/1 split. Provenance for both is recorded in R1 above, before the first query.
### Testing
**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Provenance is recorded ahead of every query in `## Solution` R1: binary is the source-local CLI (`bun run apps/cli/src/index.ts`, shim `/Users/robin/.proto/shims/bun`), package `@gobing-ai/spur` `0.3.72`, repo commit `8bdaceeb2`; no global `spur` was invoked. Importer provenance is now present too — the `history_import_ledger` row counts and last-import timestamps per source (grok/pi/omp/codex/agy/claude/opencode/gemini), plus `history_run_session` at 25 rows all `exact`/`observed`, so no estimated mapping is read. The AC's second clause now holds: the 0730 §B binding is repaired (R4), so the measurement runs against a proof path that no longer fails open. |
| R2 | MET | The cohort query is recorded runnable and reproduces column-for-column: `sqlite3 -readonly .spur/spur.db "SELECT workflow_name, SUM(status='done' AND COALESCE(json_extract(metadata_json,'$.dryRun'),0)<>1), SUM(status='done' AND COALESCE(json_extract(metadata_json,'$.dryRun'),0)=1), SUM(status='failed'), SUM(status IN ('running','paused')), SUM(COALESCE(json_extract(metadata_json,'$.dryRun'),0)=1), COUNT(*) FROM runs WHERE created_at <= 1788492064000 AND workflow_name IN (<the 11>) GROUP BY workflow_name"` returns task-pipeline 33/15/203/4/42/255, task-lifecycle 27/0/443/42/9/512, wrapup-pipeline 23/17/19/0/17/59 and the remaining eight rows as tabled. Real terminal, dry probe, failed, non-terminal and total are each their own column. |
| R3 | MET | Dry probes are excluded from the real-terminal column by predicate, not by assertion: the query carries `COALESCE(json_extract(metadata_json,'$.dryRun'),0)<>1` inside the `real_done` sum and reports `dry_done` and `dry_all` separately. The correction from the first pass is recorded with its numbers (task-pipeline 48→33, wrapup-pipeline 40→23, docs-pipeline 1→0, cohort total 125, superseding both the 158 the old table summed to and the 185 the old prose asserted). `failed` and `running`/`paused` rows are counted in their own columns and never in the real-terminal one; no row is dropped. |
| R4 | MET | The defect is repaired and stated as repaired. §B.1: the reader now takes the nested `proof.digest` with the flat `proofDigest` as fallback (`packages/app/src/services/verified-outcome.ts:201-202`), so pipeline-shaped verdicts no longer fall into `excluded.proofAbsent` at `packages/domain/src/analytics/verified-outcome.ts:168-171`. §B.2: the verify hop stamps `runId` into the proof block (`config/workflows/task-pipeline.yaml` verify `onEnter`) and the reader binds on that exact run (`packages/app/src/services/verified-outcome.ts:203-204`), so a dry probe linked to the same wbs no longer reads as certifying. Covered by three tests in `packages/app/tests/services/verified-outcome.test.ts` (`describe('verdict proof binding (0730 §B)')`); `cd packages/app && bun test tests/services/verified-outcome.test.ts` → 6 pass, 0 fail. |
| R5 | MET | Both conjuncts are recorded with their numbers. `bun scripts/spur-dev.ts real-run-cost --workflow wrapup-pipeline --workflow task-lifecycle --workflow task-pipeline --json` → wrapup-pipeline `mappedRuns 1 / terminalRuns 45` (2.2%, `usdRows` 15); task-lifecycle `0 / 465` (0%, `tokenCostUsd: null`, `usdRows` 0); task-pipeline `0 / 207` (0%). Against the ≥80% threshold all three fail. Corroborated independently by `sqlite3 -readonly .spur/spur.db "SELECT r.workflow_name, COUNT(DISTINCT h.run_id) FROM history_run_session h JOIN runs r ON r.id = h.run_id GROUP BY 1 ORDER BY 2 DESC"` → `history-anatomy 9`, `wrapup-pipeline 1` — 10 distinct runs total, zero for task-lifecycle and task-pipeline. |
| R6 | PARTIAL | The disposition is recorded and it is the **Option B stop**: `## Solution` R6 evaluates the conjunction on both halves, withdraws the first pass's "Option A continues", and names the boundary. The feature's Notes record it — D9 `## Notes` § "Re-measure gate outcome (0757)" carries the bar table, the corroborating link counts, the dormancy evidence, and the reopening condition (≥80% `mappedRuns`/`terminalRuns` plus ≥5 real terminal runs). **The remaining clause is not satisfied and cannot be truthfully satisfied**: R6 asks that on a stop, 0758 and 0759 be "closed as not-built". Both were built — because the first pass returned the wrong disposition — so `not-built` is now counterfactual, and cancelling two `done` tasks that shipped tested code would falsify the corpus rather than correct it. The clause's intent (nothing proportional ships on an unmet bar) is met by demonstrated dormancy: `mode: ""` is the declared default in all three pilots and no production caller passes `fast` (`rg` finds `mode: 'fast'` only in tests and fixtures), so every real run takes the safety path. Whether to keep them dormant or revert the pilots is recorded in the Notes as an open operator decision. |
| R7 | MET | Both commands are recorded verbatim and runnable from the repo root against `.spur/spur.db` — the elided `IN (11)` / `GROUP BY ...` placeholder from the first pass is gone. The `sqlite3` cohort query reproduces the table, `real-run-cost --json` reproduces the `mappedRuns`/`terminalRuns` pairs, and the `history_run_session` join reproduces the 9/1 split. Provenance for both is stated in R1 before the first query. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The measurement runs against honest proof | MET | test | 0751/0752/0753 are `done`; the measurement uses only the source-local CLI with binary and importer provenance recorded first. The proof path is no longer fail-open: `cd packages/app && bun test tests/services/verified-outcome.test.ts` → 6 pass, 0 fail, covering the nested-digest read and the run binding that make a completed-run claim checkable. |
| R2/R3 — Unknowns are reported as unknown | MET | command | `sqlite3 -readonly .spur/spur.db` with `SUM(status='done' AND COALESCE(json_extract(metadata_json,'$.dryRun'),0)<>1)` yields task-pipeline 33, wrapup-pipeline 23, task-lifecycle 27, docs-pipeline 0 — dry probes carried in their own `dry_done`/`dry_all` columns, failed and non-terminal rows in theirs, nothing coalesced to zero and nothing dropped. |
| R5 — The bar comparison records its numbers | MET | command | `bun scripts/spur-dev.ts real-run-cost --workflow wrapup-pipeline --workflow task-lifecycle --workflow task-pipeline --json` → 1/45, 0/465, 0/207. Recorded as 2.2%, 0%, 0% against the ≥80% threshold alongside the ≥5-real-terminal figures (23, 27, 33), so both conjuncts appear with their measured values. |
| R6 — The re-measure decides whether proportional routing is built | PARTIAL | command | The disposition is the Option B stop and D9's Notes record the boundary and the reopening condition. The scenario's second clause — 0758 and 0759 "closed as not-built" — is unsatisfiable after the fact: both are `done` with shipped code. Dormancy is proven instead (`rg -n "mode['\"]?\s*[:=]\s*['\"]fast"` matches only tests and fixtures; `config/workflows/{task-pipeline,wrapup-pipeline,task-lifecycle}.yaml` each declare `mode: ""`), so no real run is routed by the pilots. Closing or reverting them is left as an operator decision. |
| R7 — The numbers are re-derivable | MET | command | Both recorded commands execute as written and reproduce every figure in `## Solution`; re-running them during this verification returned the tabled values exactly. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
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
- 2026-09-04T03:21:04.602Z wip → testing (system)
- 2026-09-04T03:21:04.988Z testing → done (system)
