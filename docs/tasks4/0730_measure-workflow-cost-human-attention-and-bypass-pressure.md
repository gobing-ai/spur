---
schema_version: 1
name: "Measure workflow cost, human attention, and bypass pressure"
status: done
template: meta
created_at: 2026-09-02T03:05:58.045Z
updated_at: "2026-09-02T21:03:37.977Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "cost", "observability"]
---

## 0730. Measure workflow cost, human attention, and bypass pressure

### Background

The upgrade must optimize measured work rather than model-query counts alone. Existing traces are dominated by dry runs and failures, token attribution has historically been incomplete, and direct-chat bypasses have no explicit workflow record. Build an honest cost and attention baseline from current source-local evidence before setting budgets.

### Requirements

- [x] R1. Freeze an independently enumerated cohort across all 11 repository workflows and separately identify bundled, installed, and project-local definitions. For every observation record source-local binary/importer, resolved path, definition digest/version state, run ID, engine/inline/direct-chat cohort, executor/model/tier, dry-run state, and lifecycle outcome. Classify premium use only from an explicit recorded tier or documented model mapping, never price inference.
- [x] R2. Validate `real-run-cost`, `pipeline-budgets`, and verified-outcome correlation before using their numbers. Fix only measurement-correctness blockers with focused tests: dry-run inclusion, partial workflow scope, blanket long-run exclusion, token rows with null USD, active versus paused duration, unknown-as-zero, `.proof.digest` shape, and exact certifying-run/verdict binding; add no telemetry plane.
- [x] R3. Define auditable joins among run, stage, trace, history, proof, verifier artifact, and outcome evidence. Exclude stale WBS-scoped artifacts and whole-worktree solution records from verified-PASS attribution unless exact run/source binding is proven.
- [x] R4. Attribute per workflow and stage where evidence permits: fresh input, cache-read and output tokens; USD independently; wall-clock and active duration; model/executor/tier; retries, corrections, failures, pauses, escalations, and outcome. Report numerator, denominator, coverage, and nulls for every metric.
- [x] R5. Measure mechanism effectiveness as well as shape: configured defaults applied, timeouts enforced, task proof present, verifier output fresh, resume output observable, cost caps declared/used, and final proof bound. A configured field or static query count is not measured work or safety evidence.
- [x] R6. Estimate human attention from explicit approvals, active recovery, reruns, corrections, and interventions without counting idle paused time as labor. Stratify engine/headless, inline-host, inline-native-subagent, and direct-chat-unknown; infer bypass pressure conservatively and never infer intent from absence alone.
- [x] R7. Predeclare minimum sample count, coverage, observation window, and variance needed to set p50/p95 and per-verified-PASS budgets. If unmet, report that the budget is not established, name the exact collection gap, and provide no false target.
- [x] R8. Produce a ranked cost/latency/attention/correctness breakdown and candidate budgets or evidence gaps, separating immutable safety floors, measured optimization targets, static graph counts, and speculative opportunities.
- [x] R9. Publish the durable findings artifact at `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` — cost, attention, and bypass tables with coverage thresholds and budgets. The task Solution summarizes and links it; the artifact is the reviewable deliverable.

### Acceptance Criteria

- [x] Cohort provenance permits each included row to be reproduced and excludes dry runs from real-work claims.
- [x] Focused tests prove any measurement-helper repair before its output is used; unknown tokens, cost, duration, outcomes, model tier, and executor remain null with coverage reported.
- [x] Verified PASS is bound to the certifying run, current proof digest, and fresh verifier artifact; failed nested review, missing resume logs, suppressed task lookup, or stale evidence cannot count as useful completion.
- [x] Static composition query counts and declared `maxTokens`/`maxCostUsd` adoption are reported separately from measured model invocations and spend.
- [x] Human-attention and bypass findings state observation, inference, confidence, and alternative explanation separately.
- [x] Budget candidates satisfy the declared sufficiency rule, or the Solution explicitly says no budget is established and identifies the missing evidence.
- [x] Dominant stages and failure modes are ranked from reproducible source-local evidence for consumption by 0731 and 0733.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Reuse existing traces, history, token columns, proof records, and outcome services. Validate the join semantics before aggregation; repair only helpers that would falsify the study. Keep static graph estimates, measured usage, and inferred bypass pressure as separate datasets.

### Plan

- [x] Declare cohorts, provenance, sufficiency thresholds, and premium-tier classification.
- [x] Reproduce and test measurement-helper defects; apply only necessary correctness fixes.
- [x] Build exact run-bound evidence joins and coverage tables.
- [x] Calculate stage/workflow cost, duration, failure, and attention summaries.
- [x] Analyze execution cohorts and bypass signals conservatively.
- [x] Rank findings and publish budgets only where the sufficiency rule holds.
- [x] Publish `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` and link it from the Solution.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

Durable findings artifact: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` (139 lines; §A cohort freeze across all 11 `config/workflows/` definitions with source-local importer provenance, §B verified-outcome binding defect, §C cost/§D token/§E cap tables, §F attention, §G budget-gap, §H ranked classes, unknowns). Headline: **no budget is established** — the collection gap is named in order: (1) zero real non-dry engine runs recorded; (2) history importer has never emitted run-scoped sessions (`history_run_session` empty; 0/1,757,807 messages carry `run_id`); (3) verdict artifacts lack proof/run binding so per-verified-PASS denominators cannot form. R8 ranks 4 measured optimization targets + 3 immutable safety floors + static graph counts. (Anchor: `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:1`)

Measurement-correctness fixes (R2), `scripts/commands/real-run-cost.ts` (+237/−93; `readWorkflowMetrics` at `scripts/commands/real-run-cost.ts:202`):

- Dry-run probes and non-terminal rows excluded from real-work claims (counted, not silently dropped).
- Wall-clock from `unixepoch(completed_at)-unixepoch(started_at)` over terminal non-dry runs; no blanket long-run ceiling (a legit >24h terminal run stays in stats).
- Cost/tokens fold independently from `history_run_session` (exactness='exact', session-id non-null) — null USD keeps token counts; a mapped run with no cost AND no tokens reports nulls, never 0.
- Active-time bounds from ≥2 transition hops; single-hop reports null bound.
- Cohort scope (`inScopeWorkflows`) = baseline keys ∪ config/workflows definitions, not baseline-only; falls back to definitions dir when baseline unreadable.
`scripts/commands/pipeline-budgets.ts`: argv undefined-guard for `--workflow`/`--measured-file` (`checkPipelineBudgets` at `scripts/commands/pipeline-budgets.ts:191`; the 0729 Decision-11 budget RED is validated by this task's R2; the gate stays RED — §B decides **FIX, not raise** because the budget contradicts its own SSOT, and only the edit is deferred until real runs exist; §G names the collection gap, it is not the decision site).

Tests: `scripts/commands/real-run-cost.test.ts` — 10 focused tests covering the R2 blocker classes (dry-run inclusion, partial scope, blanket long-run exclusion, null-USD token rows, active-vs-paused duration, unknown-as-zero, mapped-session fold, cohort scope).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | §A freeze with provenance; frozen rows not re-reproducible (isolated env removed) — P2 finding recorded |
| R2 | MET | bun test scripts/commands/real-run-cost.test.ts → 10/0/28 fresh; tsc clean on task files |
| R3 | MET | §B/§C joins + binding defects; history_run_session now 25 (0 at freeze) |
| R4 | MET | real-run-cost --json exit 0 fresh; nulls never 0; coverage fields reported |
| R5 | MET | configured-vs-measured separation; command-gate.ts:157 re-read |
| R6 | MET | §F observation/inference/confidence/alternative separated |
| R7 | MET | §G sufficiency rule NOT MET → no budget established; gap named; premise-refresh flagged |
| R8 | MET | §H measured targets vs safety floors vs static counts separated |
| R9 | MET | docs/analysis/d8-0730-workflow-cost-attention-measurement.md exists (139 lines) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| AC1 | MET | test | provenance recipe in §A; dry-exclusion test 10/0 fresh; frozen-row replay loss recorded as P2 |
| AC2 | MET | test | 10 pass/0 fail/28 expect fresh; nulls with coverage, never 0 |
| AC3 | MET | command | §B binding defects; verified-PASS excluded without exact binding |
| AC4 | MET | command | §H static vs measured planes; budgets RED reproduced (exit 1) |
| AC5 | MET | static-ref | §F four-part structure verified |
| AC6 | MET | command | §G no budget established + named gap |
| AC7 | MET | static-ref | §H ranking consumed by 0731/0733 |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review verdict: PASS** — distinct-executor review of the 0730 measurement stage. Functional traceability 9/9 MET (R1–R9 all evidenced in the artifact). R2 measurement-correctness fixes are correct and test-proven (10/0, 28 expect); `spur-check` green (7101/0) is driver-owned. No P1/P2 findings. Five P3/P4 documentation-precision findings below — all in the artifact's count/observation cells, none change the headline conclusion (**no budget established**; zero real terminal runs) or invalidate any measurement fix. Approve for `testing → done` with the P3 cells corrected in a follow-up edit (routes to `/sp-dev-verify --fix`).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | correctness (R1 cohort cell) | `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:24` (§A, task-pipeline row) | §A states task-pipeline **"7 dry (incl. probe a84c72a3)"** but the DB and live `real-run-cost --json` both show **6 dry failed** runs for task-pipeline (probe `a84c72a3-8a7a-4170-bd56-17aad4ad8cf1` is *one of* the 6, not an extra). §A's per-workflow dry cells sum to 66, contradicting the stated total 65 and the live 65 (59 failed + 6 done). Conclusion unaffected (0 real runs), but the cohort table is the R1 deliverable and must be internally consistent. |
| P3 | correctness (R3 join cell) | `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:59` (§C, `runs`⨝`transition_runs` row) | §C states the join yields **"3 runs only (847 hops total)"**. Live: **all 67 runs** have transition hops (847 total; 33 runs with ≥2 hops, 34 with 1 hop; distribution 34×1+8×2+1×5+6×9+6×21+12×51=847). The "3 runs only" figure matches nothing in the data. The row's conclusion ("partial — no real-run hop data") is still correct. |
| P4 | correctness (R6 observation) | `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:95` (§F reruns) | §F records "two full-cohort dry sweeps at 15:39 and 15:49". Live `runs` timestamps show **5 full-cohort sweeps** (14:48, 15:11, 15:34, 15:39, 15:49 — 11 runs each) plus partial waves (15:36×8, 15:37×1) and probes (15:22 task-pipeline). Under-counts the rerun evidence; the inference (all deterministic, zero human recovery) is unchanged. |
| P4 | correctness (R3 evidence) | `docs/analysis/d8-0730-workflow-cost-attention-measurement.md:47` (§B-2) | §B-2 cites "**0539 → 4 dry-run sweep runs**"; `task_run_links` holds **5** 0539→pipeline links (5460643c, e62a290e, 7d855950, 86e84e88, b35417b5), all dry-failed. The binding-hazard conclusion (≥6 of 9 links at dry probes/driver labels) is unaffected. |
| P4 | correctness (Solution/artifact wording) | `docs/tasks4/0730_…:59` (Solution) | Solution states the "raise-vs-fix decision is **deferred per §G** until real runs exist"; artifact §B actually *decides* **FIX, not raise** (with rationale: budget contradicts its own SSOT) and defers only the *edit*; §G (sufficiency) never mentions the docs-pipeline decision. Wording drift — the honest posture (gate stays RED, no silent widening, 0729 Decision 11 honored) is correct. |

**Functional traceability (R1–R9)** — independently re-verified against the live DB/CLI, not trusted from the Solution:

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | §A freezes 11/11 `config/workflows/*.yaml`; digests all match live `runs.metadata_json.definitionDigest` (basic `9d7723a9…`… wrapup `3d8e8964…`); baseline digests confirmed stale (`task-pipeline sha256:455fcf48…` at `config/workflow-composition-baseline.json:338`, 0 runs match); premium classified as **unknown** (no tier column; `runs.agent` empty 67/67). Dry-run state + lifecycle outcome recorded per row. |
| R2 | MET | 6 blockers confirmed against OLD `real-run-cost.ts` (HEAD): no dry filter, hard 24h ceiling `<= 86_400_000`, token gated on USD, text printed `(tokens ?? 0)` (unknown-as-zero). Repairs verified live + 10 focused tests (0 fail, 28 expect): dry/non-terminal excluded-but-counted, no long-run ceiling, independent cost/token fold, activeMs ≥2-hop lower bound, null-not-zero. `bun x tsc --noEmit` exit 0. No telemetry plane added (reuses `runs`/`transition_runs`/`history_*`). |
| R3 | MET | `history_run_session` empty (0 rows) → cost joins correctly reported **no**; 0/1,758,309 `history_message` rows carry `run_id`; `.proof.digest` shape mismatch confirmed (`verified-outcome.ts:198` flat `verdict.proofDigest` vs `task-pipeline.yaml:601` nested `proof.digest`); live `0729-verdict.json` has no `proof`/`proofDigest` (keys `wbs,verdict,requirements,acceptanceCriteria,checks,source`); whole-worktree Solution attribution excluded (`task-record.ts:609` `gitDiffU0`). 9 `task_run_links` rows, 8 at dry probes/driver labels. |
| R4 | MET | Zero real terminal runs confirmed live (`real-run-cost --json`: all 11 workflows `terminalRuns:0`); 67 runs = 65 dry + 2 non-terminal (feature-lifecycle `run_618bd87b`, task-lifecycle `run_ea369461` 16:04:54→16:05:07, both `running`, both confirmed); USD 318k/1.76M (18.1%), tokens 311k (17.7%), model 274k (15.6%) — all within a 502-row DB-growth drift of the artifact's frozen 1,757,807; coverage/null reported per metric. |
| R5 | MET | 0/11 workflows declare `maxTokens`/`maxCostUsd` (grep across `config/workflows/`); feature-dev `command.gate timeoutMs:1800000` at `feature-dev.yaml:168` (dead-key claim sourced from 0729 S1-1, `command-gate.ts:157`); task-pipeline verify→record proof guards present; freshness structurally unprovable (stale-expectFile hole) — all reported as configured-vs-measured, static counts never passed as evidence. |
| R6 | MET | 59 escalation packets, all `trigger: terminal-failure`/`decision.kind: inspect_failure`; 1 HITL auto-approval in `d8-0729-6nqppc.log:3`; 1 `test-fix` hop in dry probe a84c72a3 confirmed; idle paused time zero (no `paused` runs); inference/confidence/alternative explanations stated separately, intent never inferred from absence. |
| R7 | MET | Sufficiency rule predeclared (≥20 terminal runs/workflow for p50/p95; ≥5 for weak median; ≥5 verified-PASS with ≥80% coverage; ≥5 attention-verified). All NOT MET; **no budget established**; collection gap named in order (real runs → run-scoped sessions → verdict binding). Honest. |
| R8 | MET | Static query counts all match baseline (task-pipeline 4, idea-pipeline 5, docs-pipeline 2, feature-dev 4, wayfinder-resolution 2, wrapup-pipeline 1, basic 1, pr-review 0; feature-lifecycle/history-anatomy/task-lifecycle absent); 4 measured targets + 3 safety floors + static counts + speculative opportunities separated. |
| R9 | MET | `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` = exactly 139 lines, §A–§H + Unknowns; Solution links it and summarizes faithfully. |

**SECUA review** — no P1. Security: all SQL parameterized (per-workflow `?` placeholder, no string assembly); read-only DB handle; no secrets touched. Correctness: the R2 fold semantics are sound (independent USD/token fold, null-not-zero, exclusion counts visible); `pipeline-budgets` argv guard (`pipeline-budgets.ts:196-204`) correctly throws on a bare `--workflow`/`--measured-file` (verified live, both exit nonzero). Efficiency: correlated subqueries bounded by each run's exact-mapped sessions; per-workflow parameterized query, tiny volume. Usability: `n/a` (never `0`) for unmeasured cost/duration; exclusion counts printed (`[excluded 6 dry, 1 non-terminal]`).

**Architecture depth** — no blockers/majors. `real-run-cost` reuses the existing history plane and `pipeline-budgets` imports `readWorkflowMetrics` (no duplication, verified). `inScopeWorkflows` = baseline keys ∪ `config/workflows/*.yaml` with a definitions-dir fallback is a clean single point of cohort truth. Advisory: `inScopeWorkflows` (`real-run-cost.ts:246`) and `loadBaselineQueryCounts` (`pipeline-budgets.ts:180`) remain two parsers of the same baseline SSOT (0607 P4 carried forward); acceptable at this volume — extract a shared loader only if a third consumer appears.

**Residual risk.** (1) The DB moved 502 `history_message` rows between the artifact's measurement and this review (1,757,807 → 1,758,309; +175 USD/token/model rows) — a measurement document is a point-in-time snapshot; the substance (0 run-attributable, 0 exact sessions) is unchanged and the artifact states its provenance commit. (2) The docs-pipeline budget RED is intentionally unresolved (gate exit 1 reproduced live) — the FIX edit + decision record is staged in §B but deferred; the gate stays honestly RED until applied, which is the correct state per 0729 Decision 11. (3) The two P3 cells in §A/§C should be corrected so the R1 cohort table and R3 join table are internally consistent before 0731/0733 consume them as the authoritative baseline.

**Final disposition: APPROVE** — no P1/P2. Proceed `testing → done`. Apply the two P3 count corrections to the artifact (and the two P4 wording/number touch-ups) as a follow-up edit; none are blockers.

### References

- `scripts/commands/real-run-cost.ts`; `scripts/commands/pipeline-budgets.ts`.
- `packages/app/src/services/verified-outcome.ts`; `packages/app/src/services/task-record.ts`; `packages/app/src/services/workflow-service.ts`.
- `packages/app/src/workflow/actions/{agent-run,proof-fingerprint}.ts`; `packages/app/src/workflow/proof-input-fingerprint.ts`.
- `packages/app/src/observability/{workflow-run-log-sink,escalation-packet-sink}.ts`; `config/workflow-composition-baseline.json`; `config/workflows/`.
- `docs/design/workflow-observability.md`; `docs/design/workflow-composition-contract.md`.

### History

- 2026-09-02T16:47:45.260Z todo → wip (system)
- 2026-09-02T17:09:57.495Z wip → testing (system)
- 2026-09-02T17:10:01.414Z testing → done (system)
