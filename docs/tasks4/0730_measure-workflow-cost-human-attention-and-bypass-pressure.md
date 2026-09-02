---
schema_version: 1
name: "Measure workflow cost, human attention, and bypass pressure"
status: todo
template: meta
created_at: 2026-09-02T03:05:58.045Z
updated_at: "2026-09-02T04:02:45.998Z"
feature_id: D8
priority: P1
tags: ["wayfinder:research", "workflow", "cost", "observability"]
---

## 0730. Measure workflow cost, human attention, and bypass pressure

### Background

The upgrade must optimize measured work rather than model-query counts alone. Existing traces are dominated by dry runs and failures, token attribution has historically been incomplete, and direct-chat bypasses have no explicit workflow record. Build an honest cost and attention baseline from current source-local evidence before setting budgets.

### Requirements
- [ ] R1. Freeze an independently enumerated cohort across all 11 repository workflows and separately identify bundled, installed, and project-local definitions. For every observation record source-local binary/importer, resolved path, definition digest/version state, run ID, engine/inline/direct-chat cohort, executor/model/tier, dry-run state, and lifecycle outcome. Classify premium use only from an explicit recorded tier or documented model mapping, never price inference.
- [ ] R2. Validate `real-run-cost`, `pipeline-budgets`, and verified-outcome correlation before using their numbers. Fix only measurement-correctness blockers with focused tests: dry-run inclusion, partial workflow scope, blanket long-run exclusion, token rows with null USD, active versus paused duration, unknown-as-zero, `.proof.digest` shape, and exact certifying-run/verdict binding; add no telemetry plane.
- [ ] R3. Define auditable joins among run, stage, trace, history, proof, verifier artifact, and outcome evidence. Exclude stale WBS-scoped artifacts and whole-worktree solution records from verified-PASS attribution unless exact run/source binding is proven.
- [ ] R4. Attribute per workflow and stage where evidence permits: fresh input, cache-read and output tokens; USD independently; wall-clock and active duration; model/executor/tier; retries, corrections, failures, pauses, escalations, and outcome. Report numerator, denominator, coverage, and nulls for every metric.
- [ ] R5. Measure mechanism effectiveness as well as shape: configured defaults applied, timeouts enforced, task proof present, verifier output fresh, resume output observable, cost caps declared/used, and final proof bound. A configured field or static query count is not measured work or safety evidence.
- [ ] R6. Estimate human attention from explicit approvals, active recovery, reruns, corrections, and interventions without counting idle paused time as labor. Stratify engine/headless, inline-host, inline-native-subagent, and direct-chat-unknown; infer bypass pressure conservatively and never infer intent from absence alone.
- [ ] R7. Predeclare minimum sample count, coverage, observation window, and variance needed to set p50/p95 and per-verified-PASS budgets. If unmet, report that the budget is not established, name the exact collection gap, and provide no false target.
- [ ] R8. Produce a ranked cost/latency/attention/correctness breakdown and candidate budgets or evidence gaps, separating immutable safety floors, measured optimization targets, static graph counts, and speculative opportunities.
### Acceptance Criteria
- [ ] Cohort provenance permits each included row to be reproduced and excludes dry runs from real-work claims.
- [ ] Focused tests prove any measurement-helper repair before its output is used; unknown tokens, cost, duration, outcomes, model tier, and executor remain null with coverage reported.
- [ ] Verified PASS is bound to the certifying run, current proof digest, and fresh verifier artifact; failed nested review, missing resume logs, suppressed task lookup, or stale evidence cannot count as useful completion.
- [ ] Static composition query counts and declared `maxTokens`/`maxCostUsd` adoption are reported separately from measured model invocations and spend.
- [ ] Human-attention and bypass findings state observation, inference, confidence, and alternative explanation separately.
- [ ] Budget candidates satisfy the declared sufficiency rule, or the Solution explicitly says no budget is established and identifies the missing evidence.
- [ ] Dominant stages and failure modes are ranked from reproducible source-local evidence for consumption by 0731 and 0733.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Reuse existing traces, history, token columns, proof records, and outcome services. Validate the join semantics before aggregation; repair only helpers that would falsify the study. Keep static graph estimates, measured usage, and inferred bypass pressure as separate datasets.
### Plan
- [ ] Declare cohorts, provenance, sufficiency thresholds, and premium-tier classification.
- [ ] Reproduce and test measurement-helper defects; apply only necessary correctness fixes.
- [ ] Build exact run-bound evidence joins and coverage tables.
- [ ] Calculate stage/workflow cost, duration, failure, and attention summaries.
- [ ] Analyze execution cohorts and bypass signals conservatively.
- [ ] Rank findings and publish budgets only where the sufficiency rule holds.
### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `scripts/commands/real-run-cost.ts`; `scripts/commands/pipeline-budgets.ts`.
- `packages/app/src/services/verified-outcome.ts`; `packages/app/src/services/task-record.ts`; `packages/app/src/services/workflow-service.ts`.
- `packages/app/src/workflow/actions/{agent-run,proof-fingerprint}.ts`; `packages/app/src/workflow/proof-input-fingerprint.ts`.
- `packages/app/src/observability/{workflow-run-log-sink,escalation-packet-sink}.ts`; `config/workflow-composition-baseline.json`; `config/workflows/`.
- `docs/design/workflow-observability.md`; `docs/design/workflow-composition-contract.md`.
### History
