---
schema_version: 1
name: Migrate task-pipeline review-fail-triage decide to the review-failure-class catalog decision
status: blocked
template: feature-impl
created_at: 2026-10-07T16:29:03.402Z
updated_at: "2026-10-07T16:29:38.703Z"
feature_id: P1

dependencies: ["1094"]
tags: ["decision", "workflow"]
---

## 1116. Migrate task-pipeline review-fail-triage decide to the review-failure-class catalog decision

### Background

Feature P1, slice S4 (`docs/design/decision-observability-and-adoption.md` §4–§5), one decision point per slice (operator decision 2026-10-06). Split out of task 1094 on 2026-10-07; 1094 ships the catalog-reference `decide` framework this slice uses.

The task-pipeline `review-fail-triage` state (`config/workflows/task-pipeline.yaml:683`) runs an inline `decide` with id `review-failure-class`, choices fix/stop, default `fix`. The bundled catalog entry `review-failure-class` (`config/decisions/task-pipeline.yaml`) mirrors it with the same choices and fallback. This slice swaps the inline action for a catalog reference. Routing must stay identical: same resultFile, same guards, same fallback.

Blocked until the evidence bar in the feature P1 Entry condition is met for `review-failure-class` on its effective maker.

### Requirements

- [ ] R0. Start condition: the operator records the evidence bar (minimum samples and accepted rate) in this task's Q&A. `spur decision status --reliability --json` on the project database then shows `review-failure-class` meeting it on the effective maker, counting only samples from a reachable maker (no `no-backend` fallbacks). Cite the report output in Solution. Gather samples with `spur decision run review-failure-class --param wbs=<wbs> --evidence <file>` over a recorded non-PASS review answer plus its task spec.
- [ ] R1. Replace the inline `decide` in `review-fail-triage` with `{decision: review-failure-class, params: {wbs: ${vars.wbs}}, evidence: [...], resultFile: ...}`, keeping evidence `.spur/run/${vars.__runId}-review-answer.txt`, `${vars.taskSpecPath}` and resultFile `.spur/run/${vars.wbs}-review-failure-class.decision`.
- [ ] R2. Guards, the following projection shell and the resultFile path are unchanged. With `workflow.decideDecisionMaker` off, the row is `fix` with `source: default`, `reason: disabled`, exactly as today.
- [ ] R3. Regenerate the CLI bundle (`bun run --filter @gobing-ai/spur build:bundle`); `config/workflows/` stays the source of truth.
- [ ] R4. Update the §4 audit row for `review-fail-triage` in the design satellite to "migrated (task 1116)".
- [ ] R5. After this slice no shipped workflow declares an inline decide. Add a committed check that scans `config/workflows/*.yaml` and fails on any inline-form `decide` action (feature R2, first clause); start the one-release deprecation clock for S8 in the feature Notes.

### Acceptance Criteria

- [ ] AC1 — Workflow decide action resolves a catalog decision by id
- [ ] AC2 — Every AI decision in shipped workflows comes from a catalog

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:29:31.035Z

- Evidence bar: _operator to record before start (samples ≥ N, acceptedRate ≥ X on maker M)._

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

1. Confirm R0 and cite the report; stop if the bar is not met.
2. Edit `config/workflows/task-pipeline.yaml` (`review-fail-triage`), regenerate the bundle.
3. E2E: run a real task through `spur workflow run task-pipeline` (or the inline driver) to the `review-fail-triage` state twice: switch off (row `fix`, `reason: disabled`, no `decision.*` events) and switch on with the configured maker (row from the model or a fallback, `decision.start/(success|failure)/end` in `system_events` with `caller: workflow` and the run id). Compare the off-switch row to the pre-change row. Save `.spur/run/1116-decide.json`.
4. `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T16:29:38.703Z backlog → blocked (system)

