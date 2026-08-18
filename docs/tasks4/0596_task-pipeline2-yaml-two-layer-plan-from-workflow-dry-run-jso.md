---
schema_version: 1
name: "task-pipeline2.yaml: two-layer plan from workflow --dry-run --json + residual-sweep stage"
status: todo
template: brainstorm
created_at: 2026-08-18T22:01:30.009Z
updated_at: "2026-08-18T22:31:55.801Z"
feature_id: I6
dependencies: ["0595"]
---

## 0596. task-pipeline2.yaml: two-layer plan from workflow --dry-run --json + residual-sweep stage

### Background

`wayfinder:prototype` — ticket on map **[I6]** (Spur harness self-improvement program).
**Blocked on [0595]** (the eval suite must exist and hold a baseline before a rival pipeline is authored).

**Can a two-layer execution plan and a residual-sweep stage be added to the task pipeline using only
what `spur workflow` already exposes — and does the result beat the baseline?**

`spur workflow run` **already ships** `--dry-run` ("Validate and walk transitions without executing
actions"), `--json`, a run-start plan preview suppressible with `--no-plan`, and
`--detail minimal|invocation|full`. The transparency gap is **consumption**, not capability: no
`/sp:dev-*` turns that plan into the coding agent's todo list. Confirm this before designing anything.

1. **`config/workflows/task-pipeline2.yaml`** — a new file beside the live one. `config/workflows/` is
   the tracked SSOT; `.spur/workflows/` symlinks to it. Never edit `task-pipeline.yaml` in place, never
   hand-`cp` into `apps/cli/config/`. Both pipelines stay runnable throughout.
2. **The two-layer plan.** Layer 1: the pipeline's stages. Layer 2: the steps within the active stage.
   Sourced from `workflow run --dry-run --json`, rendered into the coding agent's todo list at run
   start and refreshed at stage boundaries — so the operator sees what is about to happen and what is
   happening now, instead of a wall of ids.
3. **The residual-sweep stage.** Wire the operator's manual fallback into the pipeline after verify:
   *"anything remaining in this task? get it done before we commit."* Today the operator types this by
   hand after every `/sp:dev-verify` and `/sp:dev-verifyall`. It catches what the verdict misses, which
   means it is a real gate that currently depends on the operator remembering it. Decide: a stage in
   the FSM, or a step inside verify? State why. Its batch form (`--feature`) must work too.
4. **A parity run** against [0595]'s comparator, reported against the baseline.
5. **The generalization path to the rest of the `dev-*` family.** The operator's ask was *"for the
   whole spur-dev related `plugins/sp/commands/dev-*.md`"*, not one pipeline. Some entry points run a
   workflow and can source a plan from `--dry-run --json` (`/sp:dev-plan` → `planning-pipeline.yaml`,
   `/sp:dev-idea` → `idea-pipeline.yaml`, `/sp:dev-runall`, `/sp:dev-verifyall`). Others are skill
   dispatches with no FSM at all (`/sp:dev-review`, `/sp:dev-simplify`, `/sp:dev-fixall`) and have no
   dry-run source to plan from. State the pattern for both classes: what a two-layer plan means for a
   command with no workflow behind it, and whether that is worth doing or is a scope cut.

Wire these, do not paraphrase them into something weaker. This is the exact fallback typed by hand
today after `/sp:dev-verify` / `/sp:dev-verifyall`:

```text
## for one task case
Anything remained in current task? if any, you should get all of them done before we commit all the changes in next step

## for one feature case
Anything remained in these tasks for current feature? if any, you should get all of them done before we commit all the changes in next step
```

The point is not the wording but the position: it runs **after** a PASS verdict and **before** commit,
and it catches what the verdict's per-requirement traceability structurally cannot. Any redesign must
preserve that position.

Whether the operator's actual daily loop — strong model plans, normal model implements
(`/sp:dev-run --auto --next`), strong model verifies (`/sp:dev-verify --auto --next --force --focus all
--fix all`), then the manual residual sweep — is expressible as **one** workflow with declared
per-stage executor tiers, or whether it is irreducibly three sessions. This is the largest open item in
the map's fog; answering it is worth as much as the YAML.

Promoting `task-pipeline2.yaml` over `task-pipeline.yaml`. Promotion needs the bar from open question 1.
Touching `spur task` (feature F92, concurrent agent).

### Requirements

- R1 — Confirm empirically that `spur workflow run --dry-run --json` already yields a walkable step plan with no engine change, before designing any new mechanism.
- R2 — Author `config/workflows/task-pipeline2.yaml` as a new file beside the live pipeline; `task-pipeline.yaml` is unmodified and both remain runnable.
- R3 — Render a two-layer plan (pipeline stages; steps within the active stage) into the coding agent's todo list at run start, refreshed at stage boundaries, sourced from the dry-run plan.
- R4 — Add the residual-sweep stage that runs after a PASS verdict and before commit, in both single-task and `--feature` batch forms, preserving the operator's verbatim prompts quoted in Background; state whether it is an FSM stage or a step inside verify, and why.
- R5 — Run the new pipeline through 0595's comparator and report the result against the recorded baseline.
- R6 — Answer whether the operator's three-session loop (strong-model plan, normal-model implement, strong-model verify, manual residual sweep) is expressible as one workflow with declared per-stage executor tiers, or is irreducibly multi-session.
- R7 — State how the two-layer plan generalizes to the rest of the `dev-*` family: the workflow-backed entry points that can source a plan from `--dry-run --json`, and the skill-dispatch commands that have no FSM to plan from — including whether the latter is worth doing or is a scope cut.

### Acceptance Criteria

```gherkin
Feature: task-pipeline2 two-layer plan and residual sweep

  Scenario: R1 — the existing dry-run is verified before anything is designed
    Given spur workflow run advertises --dry-run and --json
    When the dry run is executed against task-pipeline.yaml
    Then a walkable step plan is produced without executing actions

  Scenario: R2 — the live pipeline is untouched
    Given task-pipeline2.yaml has been authored
    When the working tree is inspected
    Then config/workflows/task-pipeline.yaml is unmodified
    And both pipelines are runnable

  Scenario: R3 — the operator sees stages and current steps, not ids
    Given a run of task-pipeline2.yaml starts
    When the plan is rendered
    Then the agent todo list shows the pipeline stages and the active stage's steps
    And it is refreshed at each stage boundary

  Scenario: R4 — the residual sweep runs without the operator remembering it
    Given a task has reached verify
    When the pipeline continues
    Then a residual-sweep stage runs after the PASS verdict and before commit
    And it asks whether anything remains, in the operator's stated terms
    And the batch form covers every task under the feature

  Scenario: R5 — the new pipeline is measured, not asserted
    Given the 0595 comparator and its baseline
    When task-pipeline2.yaml is run through it
    Then a parity result against the baseline is reported

  Scenario: R6 — the multi-session question is answered
    Given the operator's plan/implement/verify/sweep loop
    When the pipeline's expressive limits are assessed
    Then the answer states whether declared per-stage executor tiers can collapse it into one workflow

  Scenario: R7 — the pattern is stated for commands with no workflow behind them
    Given some /sp:dev-* commands dispatch a skill and run no FSM
    When the generalization path is written
    Then it states what a two-layer plan means for those commands
    And it states whether that is worth doing or is a scope cut
```

### Q&A

**Closed at charting / in Design.**

- New workflow behavior lands as a **parallel file**, never an in-place edit (operator, 2026-08-18).
- No new `spur workflow` flag — the existing `--dry-run --json` surface is the source, or the task stops.
- Residual-sweep **position** is fixed (after PASS verify, before commit); mechanism is the implementer's, with written justification.
- Batch form sweeps **per task**, not once per feature.
- Todo-list refresh cadence is **stage boundaries only**.

**Deferred to the operator (map open question 1, owner: operator).**
The promotion bar for replacing `task-pipeline.yaml`. This task does not promote anything.

**Open, resolvable by the implementer.**

- Whether the workflow engine can bind an executor tier per stage (R6). If it cannot, name the missing
  mechanism precisely — that becomes a graduated feature, and "no" is a complete answer.
- Whether skill-dispatch commands with no FSM can carry a meaningful two-layer plan at all (R7).
  A reasoned scope cut is an acceptable outcome; silence is not.

**Blocked-on note.** `dependencies: ["0595"]`. Do not start the parity run (R5) before [0595]'s
baseline artifact exists. R1–R4 and R7 are workable earlier if the operator releases the block, but
R5 is not.

### Design

**WHAT.** A new workflow definition plus the driver change that renders its plan. Ships code and YAML.

**WHY.** Two operator asks share one mechanism: seeing the plan before execution, and never losing the
residual sweep to forgetfulness. Both are stage-boundary concerns in the same pipeline.

**WHERE — frozen targets.**

| Piece | Location |
| --- | --- |
| New pipeline | `config/workflows/task-pipeline2.yaml` (**new file**) |
| Live pipeline | `config/workflows/task-pipeline.yaml` — **read-only, unmodified** |
| Runtime path | `.spur/workflows/` is a **symlink** to `config/workflows/`; never hand-`cp` into `apps/cli/config/` |
| Inline driver | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` (130 lines) |
| Execution contract | `plugins/sp/skills/spur-dev/references/execution-workflow.md` (354 lines) |
| Dry-run source | `apps/cli/src/commands/workflow.ts` — `--dry-run`, `--json`, `--no-plan`, `--detail` |

**No new CLI surface.** `spur workflow run` already exposes `--dry-run`, `--json`, a run-start plan
preview, and `--detail minimal|invocation|full`. R1 exists to *prove* the plan is derivable from those
before anything is designed. If it is not, stop and raise an ADR-051 consent item — **do not add a
flag.**

**Two-layer plan — frozen shape.** Layer 1 = the pipeline's stages in order with the active one
marked. Layer 2 = the current stage's steps. Rendered into the host agent's todo list at run start and
refreshed at each stage transition — not per step, which would thrash the list. Source of truth is the
dry-run walk, so the plan cannot drift from the FSM.

**Residual sweep — frozen position, open mechanism.** Position is fixed: **after** a PASS verify
verdict, **before** commit. Mechanism (own FSM stage vs step inside verify) is the implementer's call,
decided and *justified in writing*. It must exist in both the single-task and `--feature` batch forms;
in batch, it runs per task, not once for the feature — a per-feature sweep would let one task's residue
hide behind another's clean result.

**Executor tiering (R6).** The operator's real loop today is three sessions on different models:
strong-model plan → normal-model implement (`/sp:dev-run --auto --next`) → strong-model verify
(`/sp:dev-verify --auto --next --force --focus all --fix all`) → manual residual sweep. R6 asks whether
`task-pipeline2.yaml` can declare per-stage executor tiers and collapse that into one run. Consult
`plugins/sp/references/roles.md` (the Layer-1 role→tier table: `scribe`/`coder`/`reviewer`/`planner`)
— the vocabulary already exists; the question is whether the pipeline can bind a stage to a tier.
Answering "no, and here is the missing mechanism" is a complete answer.

**Anti-patterns — do not do these.**

- Do not edit `task-pipeline.yaml`. Both pipelines stay runnable for the whole task.
- Do not `cp` workflows into `apps/cli/config/` — that tree is a gitignored `build:bundle` artifact.
- Do not add a `spur workflow` flag; the dry-run surface is sufficient or the task stops (R1).
- Do not paraphrase the residual-sweep prompts into a softer check. The position and the
  "get all of them done before we commit" obligation are the point.
- Do not promote `task-pipeline2.yaml` or switch any command's default to it.
- Do not refresh the todo list per step. Stage boundaries only.
- Do not touch `spur task` (feature F92, concurrent agent in this tree).

**Cross-task — what this assumes from [0595].** The `eval-pipeline` command, the fixture set location,
and the baseline artifact path, all stable. This task does **not** re-own or modify the comparator; if
the record shape is wrong for parity, raise it rather than editing it. R5's parity run is read-only
against [0595]'s output.

### Plan

- [ ] Run `spur workflow run config/workflows/task-pipeline.yaml --dry-run --json` and confirm it yields a walkable stage+step plan with no engine change; if not, stop and raise an ADR-051 consent item (R1)
- [ ] Copy `task-pipeline.yaml` to `task-pipeline2.yaml` as the starting point; confirm both validate via `spur workflow validate` (R2)
- [ ] Confirm `.spur/workflows/` resolves to `config/workflows/` and that both pipelines run from the runtime path (R2)
- [ ] Implement layer-1 plan rendering (stages, active marked) into the host todo list at run start (R3)
- [ ] Implement layer-2 rendering (current stage's steps) and refresh on stage transition only (R3)
- [ ] Decide FSM-stage vs step-inside-verify for the residual sweep; write the justification into the task (R4)
- [ ] Add the residual sweep after PASS verify / before commit, using the verbatim prompts from Background (R4)
- [ ] Make the sweep run per task in the `--feature` batch form, not once per feature (R4)
- [ ] Run `eval-pipeline` against both pipelines; report parity against the baseline (R5)
- [ ] Read `plugins/sp/references/roles.md`; determine whether a stage can bind an executor tier (R6)
- [ ] Answer R6 in writing: one workflow with declared tiers, or irreducibly multi-session plus the missing mechanism (R6)
- [ ] Classify each `/sp:dev-*` entry point as workflow-backed or skill-dispatch; state the plan pattern for each class (R7)
- [ ] State whether a two-layer plan for skill-dispatch commands is worth doing or is a scope cut (R7)
- [ ] Verification: `git diff --stat config/workflows/task-pipeline.yaml` is empty; `spur workflow validate` green on both; `bun run lint` + `bun run test` green

### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References

- Map: [I6](../features/I6_spur-harness-self-improvement-program-dev-spine-cost-event-5w1h-ssot-run-record-consolidation-and-board-module-boundaries.md)
- Depends on: [0595] (eval suite — comparator, fixtures, baseline)
- ADR-051 — CLI surface consent gate (why no new `spur workflow` flag lands here)
- `AGENTS.md` § Stack & layout — the monorepo path model: `config/workflows/` is SSOT, `.spur/workflows/` is a symlink, `apps/cli/config/` is a build artifact
- `docs/04_DESIGN.md` §2.3 — monorepo path model detail
- `plugins/sp/references/roles.md` — the Layer-1 role→tier table (R6 input)
- `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `execution-workflow.md` — the driver this task extends
- CLI: `spur workflow run --dry-run --json --detail`, `spur workflow validate`

### History
