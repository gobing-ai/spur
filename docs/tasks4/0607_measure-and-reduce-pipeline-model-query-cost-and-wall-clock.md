---
schema_version: 1
name: "Measure and reduce pipeline model-query cost and wall-clock"
status: todo
template: feature-impl
created_at: 2026-08-20T00:09:14.651Z
updated_at: "2026-08-20T00:13:38.122Z"
feature_id: D6
dependencies: ["0606"]
---

## 0607. Measure and reduce pipeline model-query cost and wall-clock

### Background
Implements feature D6 scenarios R1–R3.

**Provenance.** The original workflow-refactor brief said *"Agent query is expensive… with a good design, we tend to merge some LLM queries into one to reduce the LLM query cost"* and, separately, *"the whole execution process is still slow and in a blackbox without detail todo list"*. The blackbox half was answered by D5 R3 (`projectWorkflowProgress`, shipped in task 0603). The **cost and speed** half was not: D5 R7 only ever committed to *"the measured model-query count does not increase"* — a non-regression floor, never a reduction, and nothing in D5 measures wall-clock at all outside the one-off eval-pipeline promotion band.

**Verified state on entry (2026-08-19 tree):**

- Live `agent.run` counts: `task-pipeline.yaml` 4, `docs-pipeline.yaml` 1, plus hops in `idea-pipeline.yaml` and `wrapup-pipeline.yaml`. `config/workflow-composition-baseline.json` already records a `modelQueries` state list per workflow — that is the natural anchor for a budget, and it is checked two-sided today.
- Task 0604 removed one model hop (wrap-up `metrics-record`) and added none, so the current counts are the post-migration floor.
- `scripts/spur-dev.ts eval-pipeline` (task 0595) measures wall-clock for the task pipeline only, against `tests/fixtures/pipeline-eval/`, and only when deliberately invoked. I6 recorded a 538s PASS baseline with a ±10% promotion band. There is no equivalent for docs, idea, or wrap-up, and no standing gate.
- `stepTimeoutMs` defaults to 1800000 (30 min) per agentic hop, raised from 600s after five consecutive implement timeouts. Timeouts bound the worst case; they do not measure the typical case.

**Known candidate — do not treat as the answer, verify it first.** `task-pipeline.yaml` runs `review` and `verify` as separate `agent.run` hops, and `/sp:dev-verify --fix all` already performs a SECUA review internally. That adjacency is the most obvious merge candidate, but the `approve` operator-decision pause sits between them and the verdict artifact is a hard boundary — R2's rule is that a merge folding an operator-decision pause or a verdict boundary into another hop is rejected. Measure before proposing.
### Requirements
- [ ] R1. Per-pipeline model-query and wall-clock cost is measured reproducibly (feature R1). Capture, from a source-local command, the model-query count and wall-clock for each shipped pipeline against a named fixture set. Extend the existing `scripts/spur-dev.ts eval-pipeline` harness rather than standing up a parallel timing rig, and reuse the `modelQueries` list already frozen per workflow in `config/workflow-composition-baseline.json` as the query-count source of truth. Hand timings and prose claims are not measurements.

- [ ] R2. Mergeable model queries are consolidated and the count strictly drops (feature R2). Enumerate adjacent `agent.run` hops whose prompts one query could answer, and for each record merge-or-reject with the reason. Every merge preserves the gates, artifacts, and failure edges the separate hops enforced; a merge that would fold an operator-decision pause or a verdict boundary into another hop is **rejected**, not argued around. At least one merge lands, and the post-merge count for the affected pipeline is strictly below the recorded baseline.

- [ ] R3. A committed budget fails visibly when exceeded (feature R3). Land a per-pipeline query and wall-clock budget as checked config, and a gate that fails naming the pipeline, the budget, and the measured value. Raising a budget requires an explicit recorded decision in the same commit — a silent bump is the failure mode this requirement exists to prevent. Wire the gate where a pipeline change will actually hit it; do not add it to the fast `spur-check` path if the measurement cost is material, and say which gate it joined and why.

- [ ] R4. Wall-clock findings that are not query-count are reported, not silently absorbed. The brief's complaint was that execution is slow, and model queries are only one contributor. Record the measured breakdown (agent hops vs deterministic steps vs gate re-runs) and file anything material outside this task's scope as a note rather than folding an unrelated optimization into this change.

**Non-goals:** re-running D5's migrations; changing the proof-state invariant or any operator-decision pause to buy speed; merging hops across a verdict boundary; a new public CLI noun/verb (route surface questions to task 0608); optimizing anything before it is measured.
### Acceptance Criteria
```gherkin
Feature: Pipeline model-query cost and wall-clock budgets

  Scenario: R1 — Model-query cost and wall-clock are measured per pipeline
    Given the shipped pipelines carry agent.run hops whose cost has only ever been bounded as "not increasing"
    When the cost baseline is captured
    Then each pipeline records its model-query count and wall-clock against a named fixture set
    And the measurement is reproducible from a source-local command, not a hand-timed run
    And the numbers are committed as a checked budget rather than a prose claim

  Scenario: R2 — Mergeable model queries are consolidated without losing a gate
    Given adjacent agent.run hops that ask one model for judgments a single prompt could return
    When consolidation candidates are evaluated
    Then each merge preserves every gate, artifact, and failure edge the separate hops enforced
    And a merge that would fold an operator-decision pause or a verdict boundary into another hop is rejected
    And the post-consolidation model-query count is strictly lower than the recorded baseline

  Scenario: R3 — A pipeline exceeding its cost budget fails visibly
    Given a committed per-pipeline query and wall-clock budget
    When a change pushes a pipeline past its budget
    Then the gate fails naming the pipeline, the budget, and the measured value
    And the budget can only be raised by an explicit recorded decision, never silently
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
1. **Baseline (R1).** Extend `scripts/spur-dev.ts eval-pipeline` to emit per-pipeline `{modelQueries, wallClockMs}` for docs, idea, task, and wrap-up against a named fixture set; take the query list from each workflow's `modelQueries` entry in `config/workflow-composition-baseline.json`. Verify: two consecutive runs agree on query count and land within a stated wall-clock variance.
2. **Candidate enumeration (R2).** For every pair of adjacent `agent.run` hops, record merge-or-reject with the reason. Check each candidate against the rejection rule before proposing it — an operator-decision pause or verdict boundary between the hops is disqualifying. Verify: the table covers every adjacency, with no "TBD" rows.
3. **Land at least one consolidation (R2).** Implement the highest-value non-disqualified merge. Verify: the affected pipeline's own tests are green, its transition/artifact/failure contracts are unchanged, and the re-measured query count is strictly below baseline.
4. **Budget + gate (R3).** Commit the per-pipeline budget as checked config and add a gate that fails naming pipeline, budget, and measured value. Verify: a deliberately over-budget fixture fails with all three named; a budget raise without a recorded decision is rejected.
5. **Breakdown + residuals (R4).** Record the agent-hop / deterministic-step / gate-re-run split. File material non-query slowness as notes, not commits. Verify: the breakdown is in `## Testing`; out-of-scope findings are listed, not implemented.
6. **Gates.** `bun run lint`, targeted tests, `spur workflow validate` on every changed definition, `config/workflow-composition-baseline.json` updated in the same commit as any YAML change, then `bun run spur-check`.

**Done when** every pipeline has a reproducible measured cost, at least one merge has strictly reduced a pipeline's query count without losing a gate, and an over-budget change fails a gate that names the numbers.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
