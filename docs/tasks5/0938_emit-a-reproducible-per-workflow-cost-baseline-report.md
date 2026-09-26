---
schema_version: 1
name: Emit a reproducible per-workflow cost baseline report
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.003Z
updated_at: "2026-09-26T02:39:57.731Z"
feature_id: D64
priority: P1
tags:
  - workflow
  - observability
  - measurement

dependencies: ["0937"]
estimate_hours: 5
---

## 0938. Emit a reproducible per-workflow cost baseline report

### Background

Implements: R3 — A per-workflow cost baseline is reproducible from recorded runs. This is Phase 0 of docs/design/workflow-catalogue-refactor.md §3. The pinned output is the baseline that every Phase 2 candidate compares against.

**Refine corrections (2026-09-23)**

1. *Command already exists.* The claim was a new command backed by a new `packages/domain` analytics query. In fact `scripts/commands/real-run-cost.ts` already runs as `bun scripts/spur-dev.ts real-run-cost [--workflow] [--json]`. It reports per-workflow wall-clock over terminal non-dry runs (`readWorkflowRuns`, `readWorkflowMetrics`), cost and tokens from `history_run_session`/`history_message`, and a `transition_runs`-bounded span. It has a test file, `scripts/commands/real-run-cost.test.ts`. Extend it; do not add a parallel command or domain query.
2. *agent.run measurement exists.* `scripts/commands/workflow-promotion.ts` already measures the per-run `agent.run` count and duration from `action_runs`. Reuse that query shape so both commands count the same thing.
3. *Schema facts.* The engine `action_runs.node` carries the state id, and `transition_runs.to_state` gives state visits. Both tables use `created_at INTEGER` in epoch ms. `runs.started_at`/`completed_at` are ISO TEXT.
4. *Terminal statuses.* `TERMINAL_RUN_STATUSES` in both scripts is `{done, failed, cancelled}`. `interrupted` is excluded today; keep that, and report it in the reason mix only via 0937's column.

### Requirements

- [x] R1. `real-run-cost` gains a `--by-state` view that reports, per workflow and per state (`action_runs.node`): visit count, `agent.run` count, wall ms p50/p90 and retry count. A retry is a state visited more than once in a run, counted as `visits − 1` per run.
- [x] R2. The per-workflow rows add `agentRunCount` (median per run), wall p50/p90, and a `terminalReasonMix` map keyed by 0937's `TerminalReason` plus `unclassified`.
- [x] R3. Runs whose `workflow_name ∈ BOOKKEEPING_WORKFLOWS` (from 0937) are excluded unless `--include-bookkeeping` is passed.
- [x] R4. `--since <YYYY-MM-DD>` filters on `runs.created_at` as integer epoch ms. The same DB snapshot gives byte-identical `--json` output: keys sorted, rows ordered by workflow then state, and no generation timestamp in the body.
- [x] R5. The first baseline is written to `docs/reports/2026-09-workflow-cost-baseline.json` with a markdown twin, and cited by the 0940, 0943 and 0944 candidate records.

### Acceptance Criteria

- [x] AC1 — A per-workflow cost baseline is reproducible from recorded runs

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:56.273Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:24:25.632Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Extend `real-run-cost.ts`, not a new command or domain query.** The same metric has one owner, and the promotion measurement shape is reused.
- **Retry = repeated state visit within a run.** This is deterministic from `transition_runs`. `test-fix-attempt` files are ephemeral and not in the DB.
- **Nearest-rank percentiles.** They are deterministic and have no floating interpolation.
- **Estimate: 5h.**

### Design

**Approach.** Extend `scripts/commands/real-run-cost.ts` in place.
- New export `readStateMetrics(dbPath, workflows, opts)` uses one read-only SQLite query over `action_runs` joined to `runs`, grouped by `(workflow_name, node)`, plus a `transition_runs` visit count per `(run_id, to_state)` for retries.
- Percentiles use nearest-rank over sorted integer ms. This is deterministic, with no interpolation.
- Serialize with a stable-key JSON writer (sort keys recursively).

**Frozen names:**
- flags `--by-state`, `--include-bookkeeping`, `--since`;
- exports `readStateMetrics`, `StateMetrics {workflow, state, visits, agentRunCount, wallMsP50, wallMsP90, retries}`;
- `WorkflowMetrics` gains `agentRunCountMedian`, `wallMsP50`, `wallMsP90` and `terminalReasonMix`.

**Rejected alternatives:**
- A new `packages/domain` analytics query. It is a second owner of the same metric, and the scripts already query the DB directly.
- A public `spur` verb, which needs consent.
- A separate baseline script.

**Invariants:**
- Read-only (open the DB `readonly`).
- `n/a`, never 0, for missing data, per the existing contract.
- Interrupted and dry runs are excluded exactly as today.

**Anti-patterns:**
- Wall-clock `Date.now()` in the output body.
- Comparing `created_at` as a string.

**Targets:**
- Determinism: two runs on one fixture DB give byte-equal output.
- The existing `real-run-cost.test.ts` cases stay green.

**Handoff:** the candidate records in 0940, 0943 and 0944 set `delta.baselineAgentRunCount` from this report.

### Plan

1. Fixture helper in `scripts/commands/real-run-cost.test.ts`: an in-memory or temp SQLite with the engine DDL (`runs`, `transition_runs`, `action_runs`), plus the `terminal_reason` column from 0937.
2. `readStateMetrics` and the percentile helper, with tests for per-state rows, retries = visits−1, and p50/p90 nearest-rank.
3. Workflow-level additions (`agentRunCountMedian`, p50/p90, `terminalReasonMix` with `unclassified`), with tests.
4. Flags `--by-state`, `--include-bookkeeping` and `--since` (epoch-ms window test), plus the stable JSON writer (byte-equality test).
5. Run against `.spur/spur.db` and save the report and markdown twin under `docs/reports/`.
6. Run `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:897` |
| `packages/app/src/services/workflow-service.ts:2157` |
| `packages/app/src/services/workflow-service.ts:67` |
| `packages/app/src/services/workflow-service.ts:695` |
| `packages/app/src/services/workflow-service.ts:949` |
| `packages/app/src/services/workflow-service.ts:957` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-run-setup.ts:308` |
| `plugins/sp/scripts/inline-run-setup.ts:337` |
| `plugins/sp/scripts/inline-run-setup.ts:35` |
| `plugins/sp/scripts/inline-run-setup.ts:420` |
| `plugins/sp/scripts/inline-run-setup.ts:474` |
| `plugins/sp/scripts/inline-run-setup.ts:490` |
| `plugins/sp/scripts/inline-run-setup.ts:512` |
| `plugins/sp/scripts/inline-run-setup.ts:529` |
| `plugins/sp/scripts/inline-run-setup.ts:96` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | scripts/commands/real-run-cost.ts:352 readStateMetrics; :366-371 visits via transition_runs.to_state; :414 retries = max(0, visitsInRun-1); :360-366 agent.run count; :422-423 + :247-253 nearest-rank p50/p90; :538-540 CLI --by-state; tests real-run-cost.test.ts:269,323 (21/21 pass); live: task-pipeline/record visits=0 agent.run=0 wall=p50=900ms p90=900ms retries=0 |
| R2 | MET | real-run-cost.ts:92,95-96,101 WorkflowMetrics agentRunCountMedian/wallMsP50/wallMsP90/terminalReasonMix; :318-324 computed; :296-303 mix keyed via isTerminalReason else unclassified; 0937 vocabulary packages/app/src/workflow/terminal-reason.ts:8-18; tests :368,440; live JSON agentRunCountMedian=0 terminalReasonMix={"done":1} |
| R3 | MET | BOOKKEEPING_WORKFLOWS/isBookkeepingWorkflow terminal-reason.ts:31-38; consumer real-run-cost.ts:43-47 import, :463-468 scopedWorkflows default-on filter, :517-518 --include-bookkeeping; test :541; live default cohort 8 (bookkeeping excluded), flag = 10 |
| R4 | MET | --since: real-run-cost.ts:178 AND r.created_at >= ? on INTEGER epoch ms, :182 bound param, :519-526 Date.parse+Number.isFinite; determinism: :449-458 stableJson recursive sort, :474-477 buildReportJson, :431-437+:347-352 workflow-then-state order; tests :455 numeric trap, :495,:503,:509 byte-equality; live two --json runs cmp-identical; --since 2026-10-01 excludes / 2026-09-01 includes; no timestamp in body |
| R5 | MET | docs/reports/2026-09-workflow-cost-baseline.json exists, biome clean, payload deep-equals live rebuild (DEEP-EQUAL true); md twin with ## Per-state baseline byte-identical to live --by-state; cited by 0940:42, 0943:46, 0944:48 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A per-workflow cost baseline is reproducible from recorded runs | MET | test | Byte-equality test real-run-cost.test.ts:509; two live --json runs byte-identical and deep-equal to committed baseline; gate .spur/run/0938-test-gate.status=PASS (43651 B, 9029 pass/0 fail); fingerprint sha256:b8f7b48a2f3e554ded368c939fca0db5ae6d982773b2b2fe59364df1570e6f98 reproduced |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0938 (delta re-review #2)

**Review #1** (fresh sp-super-reviewer, run 90bf8202): PARTIAL → remediation. **Re-review #2** (fresh sp-super-reviewer, run 0d8539fa): PASS. R1–R5 + AC1: MET (review #1 evidence tables stand; reproducibility independently demonstrated by reviewer rebuilding `buildReportJson` over the live DB, deep-equal to the committed baseline).

| P | Finding | Disposition |
| --- | --- | --- |
| P2 | Review #1 claimed gate digest mismatch (log hash ≠ recorded digest) | REJECTED — false positive: digest is the ADR-071/0703 proof-input fingerprint, never a gate-log hash; rejection reproduced live in re-review and accepted |
| P4 | Header comment cohort count 9 vs actual 10 (scripts/commands/real-run-cost.ts) | FIXED (worker hop 7edb1e06) |
| P4 | md twin missing `## Per-state baseline` consumed by 0944 R5 | FIXED (worker hop 7edb1e06; byte-identical to live `--by-state`) |
| P4 | `stableJson` emits `"key":undefined` for undefined values | DEFERRED — unreachable via CLI (all metrics fields null-or-value); guard would be speculative |
| P4 | Baseline row renders `visits=0 agent.run=0` beside wall p50/p90 | ACCEPTED — verbatim-faithful CLI rendering; property of thin recorded history; relevant to Phase 2 comparisons |
| P4 | Baseline artifacts git-untracked at verify time | Covered by batch commit (WT-3b) |

Digest chain: `sha256:a44ce07ea56f3534a54dcd0db61914655278d2eab310a9b0e75ae99b7e6098e1` (re-chained post checkbox flips; gate PASS 9029 tests, review #2 PASS, verify PASS).

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T04:25:07.874Z todo → wip (system)
- 2026-09-25T05:29:00.532Z wip → testing (system)
- 2026-09-25T05:29:26.018Z testing → done (system)

