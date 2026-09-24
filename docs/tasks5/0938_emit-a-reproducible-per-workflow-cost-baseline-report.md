---
schema_version: 1
name: Emit a reproducible per-workflow cost baseline report
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.003Z
updated_at: "2026-09-24T00:24:25.825Z"
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

- [ ] R1. `real-run-cost` gains a `--by-state` view that reports, per workflow and per state (`action_runs.node`): visit count, `agent.run` count, wall ms p50/p90 and retry count. A retry is a state visited more than once in a run, counted as `visits − 1` per run.
- [ ] R2. The per-workflow rows add `agentRunCount` (median per run), wall p50/p90, and a `terminalReasonMix` map keyed by 0937's `TerminalReason` plus `unclassified`.
- [ ] R3. Runs whose `workflow_name ∈ BOOKKEEPING_WORKFLOWS` (from 0937) are excluded unless `--include-bookkeeping` is passed.
- [ ] R4. `--since <YYYY-MM-DD>` filters on `runs.created_at` as integer epoch ms. The same DB snapshot gives byte-identical `--json` output: keys sorted, rows ordered by workflow then state, and no generation timestamp in the body.
- [ ] R5. The first baseline is written to `docs/reports/2026-09-workflow-cost-baseline.json` with a markdown twin, and cited by the 0940, 0943 and 0944 candidate records.

### Acceptance Criteria

- [ ] AC1 — A per-workflow cost baseline is reproducible from recorded runs

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
