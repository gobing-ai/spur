---
schema_version: 1
name: "Measure and reduce pipeline model-query cost and wall-clock"
status: todo
template: feature-impl
created_at: 2026-08-20T00:09:14.651Z
updated_at: "2026-08-20T07:52:28.612Z"
feature_id: D6
dependencies: ["0606", "0610"]
---

## 0607. Measure and reduce pipeline model-query cost and wall-clock

### Background
Implements feature D6 scenarios R1–R3.

**Provenance.** The original workflow-refactor brief said *"Agent query is expensive… with a good design, we tend to merge some LLM queries into one to reduce the LLM query cost"* and, separately, *"the whole execution process is still slow and in a blackbox without detail todo list"*. The blackbox half was answered by D5 R3 (`projectWorkflowProgress`, shipped in task 0603). The **cost and speed** half was not: D5 R7 only ever committed to *"the measured model-query count does not increase"* — a non-regression floor, never a reduction, and nothing in D5 measures wall-clock at all outside the one-off eval-pipeline promotion band.

**Verified state on entry (2026-08-19 tree):**

- Live `agent.run` counts: `task-pipeline.yaml` 4, `docs-pipeline.yaml` 1, plus hops in `idea-pipeline.yaml` and `wrapup-pipeline.yaml`. `config/workflow-composition-baseline.json` already records a `modelQueries` state list per workflow — that is the natural anchor for a budget, and it is checked two-sided today.
- Task 0604 removed one model hop (wrap-up `metrics-record`) and added none, so the current counts are the post-migration floor.
- `scripts/spur-dev.ts eval-pipeline` (task 0595) measures wall-clock for the task pipeline only, against `tests/fixtures/pipeline-eval/`, and only when deliberately invoked. There is no equivalent for docs, idea, or wrap-up, and no standing gate.
- **The old ±10% band around I6's 538s baseline is retired (ADR-076, 2026-08-20).** Treat 538s as an unusable target, not a goal: it is the outlier across the recorded runs. The only other full-depth run is **2053s**, and two 2026-08-20 runs measured **2023s / 1985s** — all within 4% of each other. Establish this task's baseline by measurement and state its sample count; do not inherit 538s.
- **The harness cannot complete a run today** — `createEvalRun()` does `git worktree add --detach <dir> HEAD`, which brings no `node_modules`, so the fixture worktree fails the project quality gate (`bun run format && bun run spur-check` → exit **127**, `tsc: command not found`). Task **0610** owns that fix; this task depends on it.
- **Cost is not readable from where the harness looks.** `eval-pipeline` derives `tokenCost` from `action_runs.result_json`, where only **44 of 1971** rows carry any token field, so it reports `null` every run. Real per-message `input_tokens` / `output_tokens` / `cost_usd` live in `history_message` (since 2026-08-15: pi 13,576 rows; claude 7,454; omp 3,739; codex 698).
- `stepTimeoutMs` defaults to 1800000 (30 min) per agentic hop, raised from 600s after five consecutive implement timeouts. Timeouts bound the worst case; they do not measure the typical case.

**Known candidate — do not treat as the answer, verify it first.** `task-pipeline.yaml` runs `review` and `verify` as separate `agent.run` hops, and `/sp:dev-verify --fix all` already performs a SECUA review internally. That adjacency is the most obvious merge candidate, but the `approve` operator-decision pause sits between them and the verdict artifact is a hard boundary — R2's rule is that a merge folding an operator-decision pause or a verdict boundary into another hop is rejected. Measure before proposing.
### Requirements
- [ ] R1. Per-pipeline model-query and wall-clock cost is measured reproducibly (feature R1). Capture, from a source-local command, the model-query count and wall-clock for each shipped pipeline against a named fixture set. Extend the existing `scripts/spur-dev.ts eval-pipeline` harness rather than standing up a parallel timing rig, and reuse the `modelQueries` list already frozen per workflow in `config/workflow-composition-baseline.json` as the query-count source of truth. Hand timings and prose claims are not measurements. **Derive cost from the history plane** (`history_message` per-message `input_tokens` / `output_tokens` / `cost_usd`), not from `action_runs.result_json` — the latter carries usage on 44 of 1971 rows and is why the harness reports `tokenCost: null` today. A completed run must report a non-null cost reconcilable against `history_message` for the same window.

- [ ] R2. Mergeable model queries are consolidated and the count strictly drops (feature R2). Enumerate adjacent `agent.run` hops whose prompts one query could answer, and for each record merge-or-reject with the reason. Every merge preserves the gates, artifacts, and failure edges the separate hops enforced; a merge that would fold an operator-decision pause or a verdict boundary into another hop is **rejected**, not argued around. At least one merge lands, and the post-merge count for the affected pipeline is strictly below the recorded baseline.

- [ ] R3. A committed budget fails visibly when exceeded (feature R3). Land a per-pipeline query and wall-clock budget as checked config, and a gate that fails naming the pipeline, the budget, and the measured value. Raising a budget requires an explicit recorded decision in the same commit — a silent bump is the failure mode this requirement exists to prevent. Wire the gate where a pipeline change will actually hit it; do not add it to the fast `spur-check` path if the measurement cost is material, and say which gate it joined and why.

- [ ] R4. Wall-clock findings that are not query-count are reported, not silently absorbed. The brief's complaint was that execution is slow, and model queries are only one contributor. Record the measured breakdown (agent hops vs deterministic steps vs gate re-runs) and file anything material outside this task's scope as a note rather than folding an unrelated optimization into this change.

- [ ] R5. Performance questions are answerable from **real runs**, not only fixtures (handed over from task 0610). Provide a repeatable way to read per-workflow wall-clock and cost from actual pipeline executions already recorded in history. The fixture harness is a deliberate spot-check; real runs are the larger and more representative dataset, and they are already paid for. No new public CLI noun/verb without ADR-051 consent (route surface questions to task 0608); prefer existing `spur history` surfaces.

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
**WHAT.** Make per-pipeline model-query count and wall-clock **measurable**, then use the measurement
to remove at least one query and to hold the result with a budget gate. Cost comes from the history
plane; the fixture harness is extended, never forked.

**WHY.** D5 R7 only promised "the measured model-query count does not increase" — a floor, not a
reduction — and nothing measured wall-clock outside the retired promotion band (ADR-076). The brief
asked for a *reduction*. Nothing can be reduced before it is measured, which is why R1 strictly
precedes R2 and R3.

#### WHERE — frozen scope (verified against this tree, 2026-08-20)

**In-scope pipelines = the five in `config/workflow-composition-baseline.json`.** Their `modelQueries`
lists are the query-count SSOT and are already checked two-sided:

| Workflow | modelQueries | count |
| --- | --- | --- |
| `task-pipeline` | implement, test-fix, review, verify | 4 |
| `idea-pipeline` | discovery, feature-create, ac-generate, system-design, decompose | 5 |
| `wrapup-pipeline` | doc-sync, learning-capture | 2 |
| `docs-pipeline` | draft | 1 |
| `pr-review` | *(none)* | 0 |

Live `kind: agent.run` counts match those numbers exactly, so the baseline is trustworthy as the anchor.

**Out of scope, deliberately:** `basic.yaml` (1 `agent.run`), `feature-dev.yaml` (4),
`wayfinder-resolution.yaml` (2). These carry model hops but are **not** in the composition baseline,
so they have no frozen query list to budget against. Adding them means baselining them first — a
separate decision. Record the exclusion; do not silently widen.

**`pr-review` has zero model queries.** Its budget is trivially 0; treat it as a guard that the gate
handles an empty list, not as a measurement target.

#### The fixture gap — decide this before writing code

`tests/fixtures/pipeline-eval/templates/` contains exactly **one** template (`fixture-minimal.md`), a
task-pipeline fixture. R1 says "each shipped pipeline against a named fixture set", but there is no
docs, idea, or wrap-up fixture. Two honest options — pick one and record it:

- **(a) Task-pipeline only, stated as such.** Measure what a fixture exists for; declare the other
  four out of scope for fixture measurement and cover them via R5 real-run data. Smallest change.
- **(b) Add a fixture per in-scope pipeline.** Real coverage, but each new fixture is its own
  design problem (idea-pipeline's fixture must survive feature-create and batch-create).

**Recommendation: (a) for this task**, with (b) filed as a follow-up if fixture coverage proves
necessary. Rationale: R5 already provides real-run data across every pipeline that actually executes,
which is a larger and more representative sample than any fixture, and it needs no new fixture design.

#### Cost derivation — frozen source

`history_message` carries per-message `input_tokens` / `output_tokens` / `cost_usd`. Correlate on the
run's time window plus session id. Do **not** read `action_runs.result_json`: 44 of 1971 rows carry any
token field, which is why `tokenCost` is `null` today. Coverage by source since 2026-08-15 — pi 13,576
rows; claude 7,454; omp 3,739; codex 698; grok 24; agy 0 — so a run on **grok or agy will legitimately
have no cost data**; report `null` honestly rather than zero.

#### Frozen names — no new public API

This task adds no `spur` noun, verb, flag, JSON field, or human-output contract. Surface questions
route to task **0608** (ADR-051 consent). Reuse the frozen `EvalRecord` / `EvalReport` shapes from task
0596 — `{ wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs, exitCode }`
— and populate `tokenCost` rather than changing the shape. `eval-pipeline` flags stay `--label`,
`--pipeline`, `--fixture`, `--runs`, `--keep`, `--dry`, `--vars`.

#### Precedence / algorithm

1. **Measure first (R1).** No merge or budget may be proposed from an unmeasured claim.
2. **Baseline by measurement, with sample count (R1).** Use `--runs N` so variance is reported; a
   single sample is not a baseline. **Do not inherit the 538s figure** — it is retired (ADR-076) and is
   the outlier against 2053s / 2023s / 1985s.
3. **Merge only where the gate survives (R2).** The `approve` operator-decision pause sits between
   `review` (state `review`, line 448) and `verify` (line 472) in `task-pipeline.yaml`; the verdict
   artifact is a hard boundary. A merge folding either is **rejected**, not argued around.
4. **Budget last (R3).** A budget over an unstable measurement is noise.

#### Anti-patterns (do not implement)

- A parallel timing rig beside `eval-pipeline`. Extend the existing harness.
- Re-deriving query counts by parsing YAML at measure time — the baseline `modelQueries` list is the SSOT.
- Reading cost from `action_runs`; it is empty in practice.
- Inheriting 538s, or any single-sample number, as a budget.
- Merging `review` into `verify` across the `approve` pause or the verdict boundary.
- Adding the budget gate to the fast `spur-check` path if measurement cost is material (R3 says say
  which gate it joined and why).
- Widening scope to `basic` / `feature-dev` / `wayfinder-resolution` without baselining them first.

#### Cross-task contract

- **Depends on 0610 R3.** The harness cannot complete a fixture run today: the eval worktree carries no
  `node_modules`, so `bun run format && bun run spur-check` exits 127 (`tsc: command not found`) and
  every run ends `test-gate=FAIL`. 0610 owns that fix. R1 is unmeasurable until it lands — **do not
  work around it here** by weakening `qualityGateCmd`.
- **Depends on 0606** for D5 closure ordering only; no code overlap.
- **Hands to 0608:** any finding that a measurement or budget needs a new public surface.
- **Leaves for dependents:** the per-pipeline budget file and the gate that reads it become the
  contract any future pipeline change is measured against.
### Plan
0. **Precondition — confirm the harness can finish (blocks R1).** Task **0610 R3** symlinks
   `node_modules` into the eval worktree. Until it lands, every fixture run ends `test-gate=FAIL`
   (exit 127, `tsc: command not found`) and R1 is unmeasurable. Verify: a non-`--dry` fixture run
   reaches a verdict. **Do not** work around this by weakening `qualityGateCmd`.

1. **Freeze the measurement scope (R1).** Record the fixture decision from Design — recommended
   option (a): measure the task pipeline against `fixture-minimal`, and state the other four in-scope
   pipelines as covered by real-run data (R5) rather than fixtures, because only one template exists.
   Verify: the decision and its reason are written down before any code.

2. **Baseline by measurement (R1).** Extend `scripts/spur-dev.ts eval-pipeline` to emit per-pipeline
   `{modelQueries, wallClockMs, tokenCost}`; take the query list from each workflow's `modelQueries`
   entry in `config/workflow-composition-baseline.json`, and derive cost from `history_message`
   (`input_tokens` / `output_tokens` / `cost_usd`) correlated on the run window — never from
   `action_runs`. Use `--runs N`. Verify: two consecutive runs agree on query count, wall-clock
   variance is reported with its sample count, and `tokenCost` is non-null and reconcilable against
   `history_message` for the same window (or honestly null on a source with no token data).

3. **Candidate enumeration (R2).** For every pair of adjacent `agent.run` hops, record merge-or-reject
   with the reason. Apply the rejection rule first: an operator-decision pause or a verdict boundary
   between the hops is disqualifying — in `task-pipeline.yaml`, `approve` sits between `review` and
   `verify`, so that adjacency is rejected by rule, not by argument. Verify: the table covers every
   adjacency across the five in-scope pipelines, with no "TBD" rows.

4. **Land at least one consolidation (R2).** Implement the highest-value non-disqualified merge.
   Verify: the affected pipeline's own tests are green, its transition/artifact/failure contracts are
   unchanged, `config/workflow-composition-baseline.json` is updated in the same commit, and the
   re-measured query count is **strictly** below the recorded baseline.

5. **Budget + gate (R3).** Commit the per-pipeline budget as checked config and add a gate that fails
   naming pipeline, budget, and measured value. Handle the `pr-review` zero-query case. Verify: a
   deliberately over-budget fixture fails with all three named; a budget raise without a recorded
   decision is rejected; the report says which gate it joined and why it is not on the fast
   `spur-check` path if measurement cost is material.

6. **Real-run reading path (R5).** Provide the repeatable way to read per-workflow wall-clock and cost
   from executions already recorded in history. Prefer existing `spur history` surfaces; route any
   surface question to task 0608. Verify: the same numbers are obtainable for a pipeline that has no
   fixture.

7. **Breakdown + residuals (R4).** Record the agent-hop / deterministic-step / gate-re-run split. File
   material non-query slowness as notes, not commits. Verify: the breakdown is in `## Testing`;
   out-of-scope findings are listed, not implemented.

8. **Gates.** `bun run lint`, targeted tests, `spur workflow validate` on every changed definition,
   baseline updated in the same commit as any YAML change, then `bun run spur-check`.

**Done when** the in-scope pipelines have a reproducible measured cost with a stated sample count, at
least one merge has strictly reduced a pipeline's query count without losing a gate, an over-budget
change fails a gate that names the numbers, and the same questions are answerable from real runs.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
