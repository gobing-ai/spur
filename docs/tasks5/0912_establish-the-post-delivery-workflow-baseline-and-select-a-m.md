---
schema_version: 1
name: Establish the post-delivery workflow baseline and select a measured task-pipeline pilot
status: todo
template: standard
created_at: 2026-09-22T00:44:35.777Z
updated_at: "2026-09-22T00:46:22.119Z"
feature_id: D62

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "6"
priority: P1
---

## 0912. Establish the post-delivery workflow baseline and select a measured task-pipeline pilot

### Background

Robin accepted the measured, incremental workflow-optimization recommendation on 2026-09-21 ("agree. then go ahead"). Start with one bounded evidence-and-pilot decision under existing owner D62. B6/B7/B8/G66 provide dispatch/session foundations; D3 provides reliability repairs; I31 investigations and corrective tasks 0906–0909 are recorded done. Recheck current receipts rather than treating historical handoff status as live truth.

I31/0905 had two docs-only pipeline runs, no terminal inline/fleet cohort and no usable cost joins. Its missing traces are not proof of a runtime defect. Preparation on 2026-09-21 queried the latest 100 workflow traces: 15 task-pipeline rows (2 done, 4 failed, 9 running), spanning multiple definition digests. This is a capped discovery sample, NOT a completion-rate denominator or post-delivery cohort. Some running rows may be stale; do not clean or relabel them during measurement.

One task owns the baseline, adoption comparison and concrete pilot decision because these use the same evidence and review context. Estimate: 6 hours. No phase split or separate telemetry system. Task-local AC is intentional: these research deliverables support D62 R4/R9/R13/R14 but are not new feature ship criteria. P owns reproduced runtime/receipt defects; E6 owns missing session/cost joins; I4/Superskill owns installed-role propagation. No duplicate implementation tasks before reproduction.

### Requirements

- [ ] R1. Freeze a reproducible 14-day cohort ending at collection time, recording source commit, source-local CLI and runner versions, selection rules, run/definition identities, execution mode, task and change class, plus every exclusion and denominator.
- [ ] R2. Measure complete-run and stage duration, agent invocations, fresh/reused sessions, gate repetitions, repair attempts, terminal state, verified outcome and operator interventions; keep tokens/USD and all missing measurements null with explicit coverage.
- [ ] R3. Compare the actual source, project-registered/bundled and installed-adapter paths for task-pipeline and its inline driver, then inventory idea, batch and wrap-up adoption without modifying generated adapters.
- [ ] R4. Reconcile apparent stale terminals and absent joins against persisted identities and task/verdict evidence; classify confirmed defects, adoption gaps and unknowns separately, with P/E6/I4/D62 ownership.
- [ ] R5. Rank measured avoidable overhead and choose at most one task-pipeline pilot, or explicitly issue INSUFFICIENT_EVIDENCE with the smallest missing-evidence experiment; preserve verification, reviewer isolation and bounded recovery.
- [ ] R6. Specify the pilot's exact target, before/after comparison, required regression checks, promotion/delete deadline and rollback; distinguish analytical replay projections from observed live improvement.
- [ ] R7. Deliver a sanitized JSON baseline and readable decision report with a runnable integrity check, commands/provenance, limitations and one executable next action.

### Acceptance Criteria

- [ ] AC1 — The cohort is reproducible and separates execution modes and change classes (req: R1)
- [ ] AC2 — Timing reliability and cost metrics expose their actual denominators (req: R2)
- [ ] AC3 — The executing workflow and installed guidance are compared to canonical contracts (req: R3)
- [ ] AC4 — Every apparent defect is reproduced or explicitly retained as unknown under its existing owner (req: R4)
- [ ] AC5 — The decision selects one supported pilot or names the evidence preventing selection (req: R5)
- [ ] AC6 — A selected pilot has a falsifiable benefit criterion and preserves safety contracts (req: R6)
- [ ] AC7 — Baseline artifacts and the next action are independently checkable (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T00:45:53.490Z

Decision source: Robin's 2026-09-21 acceptance of the measurement-and-pilot recommendation. Proceed within that scope without another planning confirmation.

One cohesive six-hour evidence deliverable under D62; no new feature or decomposition batch. Dependencies: I31 0903–0905 and corrective 0906–0909 are already done; refresh their status at execution. No outstanding semantic prerequisite to measurement. Actual workflow implementation remains conditional on the measured candidate; fleet/paid-run experiments must carry a finite scope and budget before dispatch.

A truthful INSUFFICIENT_EVIDENCE outcome completes the decision report only; it does not complete the pilot or justify broader migration. No percentage improvement, feature closure or runtime defect may be inferred from the capped preparation sample.

### Design

Approach: reuse source-local workflow trace/progress, existing action_runs/system_events projections, task show/verdict artifacts and history correlation. Consult scripts/commands/real-run-cost.ts and scripts/commands/workflow-promotion.ts before adding analysis logic. The latter measures real-run agent count/duration and projects graph deltas; it does not establish realized latency or quality gains.

Deliverables: docs/reports/i31/0912-workflow-baseline.json, 0912-workflow-baseline.md and one small 0912-check.ts following the existing report-check convention. JSON carries provenance, cohort selection, included/excluded runs, per-mode coverage, adoption rows, ranked findings and pilotDecision. No new runtime schema or design satellite: this changes no product boundary.

Collection: freeze end time before querying; include all qualifying runs in the 14-day window, or disclose truncation and refrain from population claims. Deduplicate by persisted run ID. Separate inline, subprocess pipeline and fleet using dispatch evidence, not run-name guesses. Keep lifecycle FSMs, dry runs and in-flight rows outside terminal execution denominators. Record docs-only versus code-changing diffs and definition/executor versions; never pool pre-fix and post-fix runs as one improvement comparison. Process exit, workflow terminal and verify PASS are distinct.

Coverage rule: a mode-specific candidate needs attributable real code-changing runs for that mode and enough repeated observations to distinguish overhead from one task's complexity. Report sample counts; do not invent a universal reliability percentage from small n. Generalizing to all workflows requires terminal evidence across all three modes and a recovery case. Missing fleet or cost evidence permits a narrower timing decision, not a fleet/cost claim.

Decision: rank repeated avoidable wall-clock/model time and operator work. Preserve task-local checks and existing feature-wide split, proof invalidation after mutations, reviewer/verify isolation, operator-decision boundaries and truthful terminal states. A pilot is eligible only with a concrete shared cause, observable saved work and unchanged correctness contracts. Before implementation, freeze a benefit target appropriate to the mechanism (for example elimination of one proven duplicate gate plus its measured duration); never choose a percentage after seeing results. Graph candidates use the existing promotion record and a calendar deadline set at candidate creation. Analytical savings must be labeled projected. One successful replay is not live proof.

Execution budget: at most 2 hours initial collection and 4 hours correlation/reporting; each external read bounded to 60 seconds, large scans checkpointed. At the boundary persist partial artifacts and an explicit evidence disposition. Do not launch paid agents or a live fleet merely to fill a denominator; specify the minimal controlled run if retained history is inadequate. mutationPolicy: none for runtime/source/workflows/config/installed adapters; requireDiff: false for measurement. Report/task artifacts are the deliverable. No workflow cleanup, status auto-closure, scheduler, public verb or new dependency.

Rejected: blanket YAML rewrite, new telemetry plane, docs-only tests used to justify source-check removal, cost nulls treated as zero, speculative P fixes, separate tasks for each metric. This single deliverable is reviewed together; later implementation is specified only once a concrete pilot is selected.

### Plan

1. Recheck feature/task receipts and current Git state; freeze the evidence window and provenance. Read I31 reports and D62 promotion/trace contracts.
2. Collect trace summaries and details with bounded source-local CLI calls; join task/verdict and changed-file evidence. Persist exclusions and unknowns before computing metrics.
3. Compare actual workflow resolution and installed adapter semantics with canonical source; record exact paths, versions and hashes without writing outside the project.
4. Attribute timings, repeated gates, sessions and recovery; correlate available history using existing read surfaces. Do not mutate/import a live history DB without following its backup contract.
5. Rank findings and select one eligible pilot or record INSUFFICIENT_EVIDENCE; write its bounded next experiment and exact owner. Keep planning, batch and wrap-up migration conditional on pilot evidence.
6. Add the smallest runnable integrity check: duplicate IDs, count/denominator consistency, nonnegative durations, null/zero distinction, supported references and truthful decision readiness. Run it against valid data and deliberately invalid in-memory cases.
7. Run task structural checks and the applicable report validation, then the required task/feature gates during execution; record actual verify evidence through the harness. Leave a concrete next action, without claiming the pilot implemented.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T00:46:22.119Z backlog → todo (system)

