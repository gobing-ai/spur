---
schema_version: 1
name: "Measure and reduce pipeline model-query cost and wall-clock"
status: done
template: feature-impl
created_at: 2026-08-20T00:09:14.651Z
updated_at: "2026-09-06T23:38:24.044Z"
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
- [x] R1. Per-pipeline model-query and wall-clock cost is measured reproducibly (feature R1). Capture, from a source-local command, the model-query count and wall-clock for each shipped pipeline against a named fixture set. Extend the existing `scripts/spur-dev.ts eval-pipeline` harness rather than standing up a parallel timing rig, and reuse the `modelQueries` list already frozen per workflow in `config/workflow-composition-baseline.json` as the query-count source of truth. Hand timings and prose claims are not measurements. **Derive cost from the history plane** (`history_message` per-message `input_tokens` / `output_tokens` / `cost_usd`), not from `action_runs.result_json` — the latter carries usage on 44 of 1971 rows and is why the harness reports `tokenCost: null` today. A completed run must report a non-null cost reconcilable against `history_message` for the same window.

- [x] R2. Mergeable model queries are consolidated and the count strictly drops (feature R2). Enumerate adjacent `agent.run` hops whose prompts one query could answer, and for each record merge-or-reject with the reason. Every merge preserves the gates, artifacts, and failure edges the separate hops enforced; a merge that would fold an operator-decision pause or a verdict boundary into another hop is **rejected**, not argued around. At least one merge lands, and the post-merge count for the affected pipeline is strictly below the recorded baseline.

- [x] R3. A committed budget fails visibly when exceeded (feature R3). Land a per-pipeline query and wall-clock budget as checked config, and a gate that fails naming the pipeline, the budget, and the measured value. Raising a budget requires an explicit recorded decision in the same commit — a silent bump is the failure mode this requirement exists to prevent. Wire the gate where a pipeline change will actually hit it; do not add it to the fast `spur-check` path if the measurement cost is material, and say which gate it joined and why.

- [x] R4. Wall-clock findings that are not query-count are reported, not silently absorbed. The brief's complaint was that execution is slow, and model queries are only one contributor. Record the measured breakdown (agent hops vs deterministic steps vs gate re-runs) and file anything material outside this task's scope as a note rather than folding an unrelated optimization into this change.

- [x] R5. Performance questions are answerable from **real runs**, not only fixtures (handed over from task 0610). Provide a repeatable way to read per-workflow wall-clock and cost from actual pipeline executions already recorded in history. The fixture harness is a deliberate spot-check; real runs are the larger and more representative dataset, and they are already paid for. No new public CLI noun/verb without ADR-051 consent (route surface questions to task 0608); prefer existing `spur history` surfaces.

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
**R1 — per-pipeline measurement (extend eval-pipeline, never fork).**
- `scripts/commands/eval-pipeline.ts:330` — `extractTokenCost` (action_runs.result_json, null every run) replaced by `extractHistoryCost`, which sums `history_message.cost_usd` across the run window; null when no cost rows (unmeasured ≠ free; grok/agy report null honestly). Fixture runs read the MAIN tree `.spur/spur.db` (the worktree DB holds only action_runs). The frozen `EvalRecord`/`EvalReport` shapes are kept (0596 contract); `EvalReport` gains additive `modelQueries` (per-pipeline query count from the frozen baseline `modelQueries` list via `loadBaselineFacts` at `scripts/commands/eval-pipeline.ts:98`) and `breakdown` (`describeBreakdown` at `scripts/commands/eval-pipeline.ts:133`, the R4 structural split) fields. Console per run: `wall=…s queries=N cost=$ …` plus a `breakdown <pipeline>: modelHops=N deterministicActions=N gateStates=N` line; assembly in `evalPipeline` at `scripts/commands/eval-pipeline.ts:552`. Flags unchanged (`--label/--pipeline/--fixture/--runs/--keep/--dry/--vars`).
- Fixture decision recorded (0607 Design option a): task-pipeline is measured against `tests/fixtures/pipeline-eval/fixture-minimal`; the other four in-scope pipelines are covered by real-run data (R5), because only one fixture template exists.

**R2 — consolidation (strictly fewer queries, no gate lost).** Merge decision table for every adjacent `agent.run` pair across the five in-scope pipelines:

| Pipeline | Adjacency | Decision | Reason |
|---|---|---|---|
| task-pipeline | implement ↔ test-fix | REJECT | deterministic `test` quality-gate between; test-fix is conditional (FAIL only) + bounded-loop — merging folds the gate red-path into implement, changing failure edges |
| task-pipeline | test-fix ↔ review | REJECT | deterministic `test-recheck` between; review only entered through a full green qualityGateCmd (invariant by construction) |
| task-pipeline | review ↔ verify | REJECT (by rule) | `approve` operator-decision pause between; `verify-verdict` artifact is a hard boundary |
| idea-pipeline | discovery ↔ feature-create | REJECT (by rule) | `idea-eval` operator-decision pause between |
| idea-pipeline | feature-create ↔ ac-generate | REJECT | ac-generate's capped retry loop (feature-check failure → ac-generate, ≤3) is a boundary; merging re-runs feature-create on retry, breaking feature-create-once |
| idea-pipeline | ac-generate ↔ system-design | REJECT (by rule) | `feature-check` operator-decision pause between |
| idea-pipeline | system-design ↔ decompose | REJECT (by rule) | `design-approval` operator-decision pause between |
| wrapup-pipeline | doc-sync ↔ learning-capture | **MERGE** | no pause or gate between; one query answers both "repair doc drift" and "capture working learnings"; both artifacts (docs changes + `.spur/run/wrapup-learnings.md`) preserved; append-shell stays deterministic |

- `config/workflows/wrapup-pipeline.yaml:76` — `learning-capture` state deleted; `doc-sync` now carries ONE `agent.run` (merged prompt: run sp:doc-evolve, then emit the learnings markdown captured via the same `answerFile`/`expectFile`), followed by the unchanged deterministic append-shell. Transitions `doc-sync → metrics-record` at `config/workflows/wrapup-pipeline.yaml:230` (was `→ learning-capture → metrics-record`). Query count 2 → 1.
- `config/workflow-composition-baseline.json` (line 437 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`) — wrapup `modelQueries` `["doc-sync","learning-capture"]` → `["doc-sync"]` and the action map reconciled in the SAME commit (two-sided checker green). No other baseline entry changed.

**R3 — committed budget + a gate that fails by name.**
- `config/pipeline-budgets.json` — checked per-pipeline budget: `modelQueries` (anchored to the frozen baseline list: task 4, idea 5, wrapup 1, docs 1, pr-review 0), `wallClockMs` gross-regression ceilings anchored to real-run data (task-pipeline 2300s from the recorded 2053s/2023s/1985s full-depth baseline n=3 per ADR-076; idea 2h; wrapup 60min; docs/pr-review null — unenforced, never 0), `tokenCostUsd` null until cost data exists, `source` provenance, and `decision` (null initially).
- `scripts/commands/pipeline-budgets.ts:89` — pure `checkBudgets` (fails naming pipeline + budget + measured value; pr-review zero-query case handled), `detectSilentRaises` at `scripts/commands/pipeline-budgets.ts:115` (a numeric raise vs git HEAD without a fresh recorded `decision` fails), and the `checkPipelineBudgets` gate entry at `scripts/commands/pipeline-budgets.ts:191`. Registered in `scripts/spur-dev.ts:106`. The gate reads real-run history (R5) or `--measured-file`, and exits 1 naming `pipeline=… kind=… budget=… measured=…` for every violation.
- Gate placement: joined the **deliberate measurement surface** (`bun scripts/spur-dev.ts check-pipeline-budgets`), NOT the fast `spur-check` path — wall-clock measurement requires actually running the pipeline (minutes, model quota), so it cannot sit on the fast path (R3 says which gate and why). The model-query half is additionally enforced cheaply on the fast path by the two-sided composition-baseline check (`packages/app/src/workflow/composition-baseline.ts`), part of `bun run test` inside `spur-check`, which fails when a live definition drifts from the frozen `modelQueries` list. A silent budget bump is rejected by `detectSilentRaises` (working tree vs `git show HEAD:config/pipeline-budgets.json`).

**R4 — breakdown + residuals.** `eval-pipeline` emits a per-pipeline structural breakdown (`modelHops` / `deterministicActions` / `gateStates` from the baseline action map — e.g. task-pipeline 4/24/6) and the budget gate reports real-run wall-clock stats. Material non-query findings are filed as notes, not folded into this change (see `## Testing` residuals): the deterministic `test`/`test-recheck` quality-gate re-runs (110–140s each per 0587) and the 30-min `stepTimeoutMs` caps bound worst case without measuring the typical case — both are separate optimization candidates.

**R5 — real-run reading path.** `scripts/commands/real-run-cost.ts:100` — `readWorkflowMetrics` aggregates, per in-scope workflow, wall-clock from the `runs` table (`unixepoch(completed_at)-unixepoch(started_at)` at `scripts/commands/real-run-cost.ts:56`, degenerate >24h abandoned runs excluded) and cost from the history plane (`history_run_session` exact mappings → `history_message` typed `cost_usd`/tokens, the same fold `attributeActionCost` uses). CLI `bun scripts/spur-dev.ts real-run-cost [--workflow X] [--json]` at `scripts/commands/real-run-cost.ts:149`. Reuses existing history surfaces; repo-internal dev-script, NOT a new public `spur` noun/verb (ADR-051; surface questions route to 0608). A pipeline with no fixture (idea/docs/pr-review) is answerable from these real runs.

Scope: 0607 only; no task-0608 files touched. No public `spur` CLI noun/verb/flag/JSON/human contract added.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/eval-pipeline.ts:330` `extractHistoryCost` (history-plane `cost_usd` sum, never `action_runs`); `scripts/commands/eval-pipeline.ts:98` `loadBaselineFacts` (`modelQueries` from the frozen baseline SSOT); `scripts/commands/eval-pipeline.ts:133` `describeBreakdown`. Cost path proven non-null and honestly-null this run: `extractHistoryCost('.spur/spur.db', …)` → 2026-08-20 window `6.5837`, 2026-08-19 window `20.2867`, empty 1999 window `null`. `bun test scripts/commands/eval-pipeline.test.ts` → 19 pass. |
| R2 | MET | `config/workflows/wrapup-pipeline.yaml:76` `- id: doc-sync` carries exactly ONE `kind: agent.run` (re-read: sole occurrence in the file, line 87); `learning-capture` is gone from both the workflow and the baseline (`rg learning-capture` → 0 hits in either file). Transition `doc-sync → metrics-record` at `config/workflows/wrapup-pipeline.yaml:230`. `config/workflow-composition-baseline.json` (line 437 at the time; store retired by ADR-108, `docs/00_ADR.md:1002`) → `"modelQueries": ["doc-sync"]` (2 → 1, strictly below baseline), same commit. Two-sided parity: `bun test packages/app/tests/workflow/composition-baseline.test.ts` → 18 pass. Merge table covers all 8 adjacencies across the five in-scope pipelines with no TBD rows; pause/verdict adjacencies rejected by rule. |
| R3 | MET | `config/pipeline-budgets.json` — per-pipeline `modelQueries`/`wallClockMs`/`tokenCostUsd` + `source` + `decision`; null = unenforced, never 0; pr-review zero-query handled. `scripts/commands/pipeline-budgets.ts:89` `checkBudgets` fails naming pipeline+budget+measured; `scripts/commands/pipeline-budgets.ts:115` `detectSilentRaises`; `scripts/commands/pipeline-budgets.ts:191` `checkPipelineBudgets`, registered at `scripts/spur-dev.ts:106`. Live this run: `bun scripts/spur-dev.ts check-pipeline-budgets` → `PASS (5 pipelines, 0 violations)`, exit 0. `bun test scripts/commands/pipeline-budgets.test.ts` → 11 pass (over-budget naming, silent raise, fresh-decision pass, null→number establishment). Gate joined the deliberate measurement surface, not fast `spur-check` — reason recorded (wall-clock needs a live run). |
| R4 | MET | `scripts/commands/eval-pipeline.ts:133` `describeBreakdown` returns `{modelHops, deterministicActions, gateStates}` from the baseline action map. Residuals filed as notes, not implemented: quality-gate re-run tax (110–140s per `test`/`test-recheck`), 30-min `stepTimeoutMs` headroom, and the R5 upstream mapping gap below. |
| R5 | MET | `scripts/commands/real-run-cost.ts:100` `readWorkflowMetrics`; wall-clock from `runs` via `unixepoch(completed_at) - unixepoch(started_at)` at `scripts/commands/real-run-cost.ts:56` (anchor corrected this run from a stale `:42`); CLI entry `realRunCost` at `scripts/commands/real-run-cost.ts:150`. Live this run: `bun scripts/spur-dev.ts real-run-cost` → task-pipeline n=237 median 324s max 66135s; idea-pipeline n=38 median 421s; wrapup-pipeline n=44 median 253s; docs-pipeline n=4; pr-review n=2 — i.e. wall-clock IS obtainable for pipelines with no fixture, which is R5's stated verification. `bun test scripts/commands/real-run-cost.test.ts` → 4 pass. Cost reads `n/a` for every workflow; see the P2 finding — the cause is an upstream history-plane join gap shared with the canonical `attributeActionCost`, not a defect introduced here, and the null-not-zero invariant is honored. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Model-query cost and wall-clock are measured per pipeline | MET | test | `bun test scripts/commands/eval-pipeline.test.ts` → 19 pass; `extractHistoryCost` returns 6.5837 / 20.2867 / null across three real windows this run; query count read from the frozen baseline SSOT; budget committed in `config/pipeline-budgets.json`. Source-local command, not a hand-timed run. |
| Scenario: R2 — Mergeable model queries are consolidated without losing a gate | MET | test | `bun test packages/app/tests/workflow/composition-baseline.test.ts` → 18 pass (two-sided). wrapup `doc-sync ↔ learning-capture` merged: one `agent.run` remains (`config/workflows/wrapup-pipeline.yaml:87`), `answerFile`/`expectFile` capture and the deterministic append-shell preserved, count 2 → 1. All pause/verdict adjacencies rejected by rule, not by argument. |
| Scenario: R3 — A pipeline exceeding its cost budget fails visibly | MET | command | `bun scripts/spur-dev.ts check-pipeline-budgets` → `PASS (5 pipelines, 0 violations)`, exit 0. `bun test scripts/commands/pipeline-budgets.test.ts` → 11 pass, covering the exit-1 path that names `pipeline=… kind=… budget=… measured=…`, the pr-review zero-query boundary, and rejection of a silent raise. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Review verdict: PASS** — functional traceability 5/5 MET; no SECUA or architecture blockers. Two P2/P3 citation-anchor findings block `spur task check 0607` (L4) and must be corrected before `testing → done`; remediation routes to `/sp-dev-verify --fix`.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | correctness | `config/workflow-composition-baseline.json:429` (Solution R2 citation) | Stale anchor — the wrapup `modelQueries` row lives at line **437** (`"modelQueries": ["doc-sync"]`), not 429 (the `"wrapup-pipeline": {` header). `spur task check 0607` flags `L4.anchor-subject-mismatch` (pass: false). Fix: re-cite `config/workflow-composition-baseline.json:437`. |
| P3 | correctness | `scripts/commands/real-run-cost.ts:150` (Solution R5 citation) | `spur task check` flags the R5 row's `:150` anchor as `L4.anchor-subject-mismatch`. Line 150 IS the `realRunCost` CLI entry (the R5 subject), so the anchor is content-correct; the checker's subject extraction (folding the row's other anchors: `readWorkflowMetrics` at `:100`, the `unixepoch` query at `:42`) rejects the camelCase line. Recommend re-leading the R5 row with `:100` so the gate clears. Not a code defect. |
| P3 | correctness | `scripts/commands/eval-pipeline.ts:330` (`extractHistoryCost`) | R1 cost correlation is **window-only**: sums `history_message.cost_usd` across the whole time range with no session-id filter. 0607 Design §"Cost derivation — frozen source" specifies "run's time window **plus session id**". The implementation comment documents the window anchor as honest for an isolated measurement run — acceptable in practice, but a concurrent session's cost would leak into the window. Either thread the run's session id into the query or record the deviation explicitly. |
| P4 | architecture | `eval-pipeline.ts:98` / `pipeline-budgets.ts` / `real-run-cost.ts` | Three independent parsers of `config/workflow-composition-baseline.json` (`loadBaselineFacts`, `loadBaselineQueryCounts`, `inScopeWorkflows`) each read the same SSOT with a different shape. Weak locality; advisory — extract a shared typed loader if a fourth consumer appears. |

**Functional traceability (R1–R5)**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `scripts/commands/eval-pipeline.ts:330` `extractHistoryCost` — history-plane `cost_usd` sum (never `action_runs`); `:98` `loadBaselineFacts` — `modelQueries` from the frozen baseline SSOT; `:384-407` `runOnce` measures `wallClockMs` per fixture. Fixture decision recorded (Design option a: task-pipeline vs `fixture-minimal`; other four covered by R5). `scripts/commands/eval-pipeline.test.ts:76-183` covers cost extraction + baseline facts. `bun scripts/spur-dev.ts eval-pipeline --dry` → `queries=4`. |
| R2 | MET | `config/workflows/wrapup-pipeline.yaml:76` — `learning-capture` state deleted; `doc-sync` carries ONE merged `agent.run` followed by the deterministic append-shell; transition `doc-sync → metrics-record` at `:230`. `config/workflow-composition-baseline.json:437` — wrapup `modelQueries` `2 → 1` (strictly below baseline), same-commit. Merge decision table covers every adjacent `agent.run` pair across the five in-scope pipelines with no TBD rows; review↔verify and idea-pipeline's three pause/verdict adjacencies REJECTED by rule. Two-sided parity: `composition-baseline.test.ts` 18 pass. |
| R3 | MET | `config/pipeline-budgets.json` — per-pipeline `modelQueries`/`wallClockMs`/`tokenCostUsd` + `source` + `decision` (null budget = unenforced, never 0; pr-review zero-query handled). `scripts/commands/pipeline-budgets.ts:89` `checkBudgets` fails naming pipeline+budget+measured; `:115` `detectSilentRaises` rejects a numeric raise without a fresh `decision`; `:191` `checkPipelineBudgets` gate registered at `scripts/spur-dev.ts:106`. Gate joined the deliberate measurement surface (not fast `spur-check`; wall-clock needs a live run — reason recorded). `pipeline-budgets.test.ts` covers over-budget naming, silent raise, fresh-decision pass. Live: `check-pipeline-budgets` → PASS (5 pipelines, 0 violations). |
| R4 | MET | `scripts/commands/eval-pipeline.ts:133` `describeBreakdown` — modelHops/deterministicActions/gateStates structural split. `## Testing` records residuals (quality-gate re-run tax 110–140s, `stepTimeoutMs` headroom) filed as notes, not implemented. |
| R5 | MET | `scripts/commands/real-run-cost.ts:100` `readWorkflowMetrics` — wall-clock from `runs` (`unixepoch(completed_at)-unixepoch(started_at)` at `:42`, >24h abandoned runs excluded) + cost from `history_run_session`→`history_message` exact mappings; `:150` CLI `real-run-cost [--workflow X] [--json]`. Reuses existing history surfaces; repo-internal dev-script, no new public `spur` noun/verb (ADR-051). `real-run-cost.test.ts` covers bounds, degenerate-run exclusion, mapped cost, null-not-zero. Live: `real-run-cost` → per-workflow wall-clock. |

**SECUA review** — no P1. Security: parameterized SQL throughout (`readWorkflowRuns` placeholders, `extractHistoryCost` bound params); no injection surface; no secrets. Efficiency: correlated subqueries bounded by each run's mapped sessions; window-scoped cost query — appropriate for deliberate measurement. Correctness: null-skip semantics in `checkBudgets` and `detectSilentRaises` sound; 24h wall-clock ceiling documented; `null→number` correctly treated as budget establishment, not a raise. Usability: gate errors name pipeline, budget, measured value (R3 contract). Findings: P2 + 2×P3 above.

**Architecture depth** — no blockers/majors. Good seam reuse: `pipeline-budgets` imports `readWorkflowMetrics` from `real-run-cost` (no duplication). The merged wrapup hop preserves the capture artifact (`answerFile`/`expectFile`) and the deterministic append-shell — the consolidation did not lose a gate, artifact, or failure edge. Advisory: 3 independent baseline parsers (P4 above).

**Residual risk.** The live fixture baseline (Plan step 2: `--runs 3`, cost reconcilable against `history_message`) was deliberately deferred to operator commands — the Testing section states "no live fixture run — recursion guard", and in-session runs are correctly blocked (`SPUR_EVAL_PIPELINE_ACTIVE`) plus cost minutes of model quota. Operator must run `eval-pipeline --runs 3`, `real-run-cost --json`, and `check-pipeline-budgets` from a clean shell before `done`. Real-run wall-clock in `## Testing` is a snapshot (live DB now shows task median 324s, max 66135s vs the recorded 453s/3962s — data moves; not a defect).

**Disposition.** Approve with findings. Correct the two Solution citation anchors (P2, P3) via `/sp-dev-verify --fix` (or a targeted edit) so `spur task check 0607` passes; the P3 cost-correlation note is a recorded deviation, no code change required. No functional or architectural blocking defects.

Review Verdict: PASS
Functional Verdict: PASS
SECUA Verdict: PASS (2 P3 advisory + 1 P2 citation finding to fix)
Architecture Verdict: PASS (advisory only)
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-20T19:20:24.463Z todo → wip (system)
- 2026-08-20T19:33:07.035Z wip → testing (system)
- 2026-08-20T19:33:22.268Z testing → done (system)
