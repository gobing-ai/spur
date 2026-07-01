# Design — End-to-end Workflow System for System Development

Owning task: [`0167`](../tasks2/0167_sp-plugin-hands-off-ready-idea-to-feature-flow-post-executio.md).
Surface index row: [`04_DESIGN.md §0`](../04_DESIGN.md). Feature: `I` (sp plugin hands-off ready).

## Purpose

This is the all-in-one design document for Spur's system-development workflow system: the existing
workflow set, the new 0167 idea/wrap-up workflows, the command wrappers that invoke them, the HITL
and auto-routing contract, the checkpoint/memory artifacts, and the structural tests that keep the
system aligned.

The system is pipeline-based. Each pipeline owns one lifecycle phase and is implemented as a
`spur workflow` state-machine YAML file. Skills perform phase work; workflows orchestrate phase order;
CLI verbs perform validated corpus writes.

## Path Model

Workflow paths have two valid forms in this repository:

| Path | Role | Rule |
|---|---|---|
| `.spur/workflows/<name>.yaml` | Project-facing workflow root used by operators, plugin commands, and seeded local config | Prefer this path in command examples and wrapper command docs. |
| `config/workflows/<name>.yaml` | Physical repo source for this checkout; `.spur/workflows` is a symlink to it | Edit either path only when you understand they are the same inode in this repo. Do not copy between them. |

Implementation and validation may use either path. Plugin command examples should use
`.spur/workflows/*` because it is the stable project-local surface after `spur init`. Repository
tests may validate `config/workflows/*` directly because that is the committed physical source.

## System Principles

1. **Orchestration is configuration.** Workflow YAMLs own phase order. Skills do not become pipeline
   controllers.
2. **Every corpus write is CLI-gated.** Task and feature mutations go through `spur task` /
   `spur feature`. Direct writes are allowed only for working memory under `.spur/memory/`.
3. **Pipelines own phases, not entities.** Entity lifecycle legality remains in
   `feature-lifecycle.yaml` and `task-lifecycle.yaml`.
4. **No nested state machines.** A pipeline may invoke another workflow through a command wrapper
   only at a phase boundary; it must not inline another pipeline's state graph.
5. **Design before decomposition.** Brainstorm always records a design summary. The heavier
   `sp:sys-architecture` step runs unless the design signal or an explicit flag bypasses it.
6. **Doc-sync after implementation.** Post-execution doc drift repair is wrap-up work, not initial
   design work.
7. **HITL is explicit.** Objective gates can be routed around in auto mode before entering a
   `hitl.confirm` state. Taste and irreversible gates still pause.
8. **Checkpoint all long-running phases.** Existing and future pipelines write resumable checkpoints
   after gates and phase transitions.

## Workflow Inventory

| Workflow | Path | Phase | Entry point | Terminal states | Status |
|---|---|---|---|---|---|
| `basic.yaml` | `.spur/workflows/basic.yaml` | Generic implement/check/fix loop | direct `spur workflow run` | `done`, `failed` | existing |
| `feature-lifecycle.yaml` | `.spur/workflows/feature-lifecycle.yaml` | Feature status FSM | `spur feature update` | `done`, `cancelled` | existing |
| `task-lifecycle.yaml` | `.spur/workflows/task-lifecycle.yaml` | Task status FSM | `spur task update` | `done`, `cancelled` | existing |
| `planning-pipeline.yaml` | `.spur/workflows/planning-pipeline.yaml` | Planning/design from known slug | `/sp:dev-plan` | `handoff`, `cancelled` | existing |
| `task-pipeline.yaml` | `.spur/workflows/task-pipeline.yaml` | Single-task execution | `/sp:dev-run` | `done`, `failed` | existing |
| `feature-dev.yaml` | `.spur/workflows/feature-dev.yaml` | Feature umbrella execution | `/sp:dev-runall --feature` | `done`, `failed` | existing |
| `idea-pipeline.yaml` | `.spur/workflows/idea-pipeline.yaml` | Idea to feature + AC + task batch | `/sp:dev-idea` | `handoff`, `cancelled` | new in 0167 |
| `wrapup-pipeline.yaml` | `.spur/workflows/wrapup-pipeline.yaml` | Post-execution wrap-up | `/sp:dev-wrap`, `/sp:dev-wrapall` | `done`, `skipped` | new in 0167 |

No new `*-lifecycle.yaml` files are added by 0167. Persistent entity lifecycle remains in the two
existing lifecycle workflows.

## Lifecycle Contracts

### Feature Lifecycle

```
backlog -> active -> verifying -> done
      \        \          \         \
       --------> blocked -> cancelled
```

Required guards:

| Transition | Guard |
|---|---|
| `backlog -> active` | always |
| `active -> verifying` | `spur feature check <id>` |
| `verifying -> done` | `spur feature check <id> --strict` |

Wrap-up must advance a feature idempotently through legal edges only. For `dev-wrapall --feature <id>`:

1. If `backlog`, run `backlog -> active`.
2. Run or confirm the normal feature check for `active -> verifying`.
3. Run strict feature check for `verifying -> done`.
4. Never attempt `backlog|active -> done` directly.

### Task Lifecycle

```
backlog -> todo -> wip -> testing -> done
      \      \      \        \        \
       -------> blocked -----> cancelled
```

Task execution pipelines may move the task through execution states. Wrap-up does not mutate task
status; it consumes completed tasks unless an explicit `--status` filter selects tasks for
analysis-only wrap-up.

## Existing Pipeline Contracts

### `planning-pipeline.yaml`

Purpose: front-half planning from a known slug or task idea to a design handoff.

State contract:

```
start -> phasing -> feature-id -> design-gen -> design-approval -> handoff
```

Rules:

- `phasing` may be auto-routed when `profile=auto`.
- `design-gen` produces a `docs/design/<slug>.md` satellite when requested by the seam heuristic.
- `design-approval` is a taste gate. Auto mode may skip objective routing into the gate only when
  prior approval is already encoded; otherwise it pauses.
- The pipeline stops at handoff. It does not execute tasks.

### `task-pipeline.yaml`

Purpose: run one task through implementation, testing, review, verification, record, and done.

State contract:

```
precheck -> implement -> test -> review -> approve -> verify -> record -> done
          \                                                    \
           -------------------------- failed -------------------
```

Rules:

- `precheck` runs `spur task check <wbs>` before implementation.
- `implement`, `test`, `review`, and `verify` dispatch existing `sp` competency skills through
  `agent.run`.
- `approve` is the human review gate; `profile=auto` can route around it only by objective verdict.
- `verify` must produce a task verdict.
- `record` records the verdict and solution through `spur task record`.
- `done` is reached only after a PASS verdict and legal task transition.

### `feature-dev.yaml`

Purpose: umbrella feature execution from brainstorm/plan through task execution and feature verify.

State contract:

```
brainstorm -> plan -> execute-tasks -> feature-verify -> done
                                      \-> failed
```

Rules:

- It is the full-loop workflow. Unlike `idea-pipeline.yaml`, it continues past task creation.
- It delegates task execution to the task pipeline through command/workflow invocation at the
  execution phase boundary.
- `feature-verify` runs `spur feature check <featureId> --strict`.

### `basic.yaml`

Purpose: generic implement/check/fix loop for simple non-corpus work.

State contract:

```
implement -> check -> done
              \-> fix -> check
```

Rules:

- It is not the standard task lifecycle path for `sp` task execution.
- It remains a canonical minimal workflow example for schema and action-shape authors.

## New 0167 Pipeline Contracts

### `idea-pipeline.yaml`

Purpose: unified entry from a vague idea to a feature, acceptance criteria, and executable task batch.

Command wrapper:

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml \
  --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip"}'
```

State contract:

```
start
  -> discovery
  -> feature-create
  -> ac-generate
  -> feature-check
  -> system-design
  -> design-approval
  -> decompose
  -> batch-create
  -> handoff
```

Required actions:

| State | Action |
|---|---|
| `discovery` | Dispatch `sp:brainstorm`; write a brainstorm artifact and emit `needs_design`. |
| `feature-create` | Use `spur feature create` or select an existing feature id. |
| `ac-generate` | Generate AC using `ac-style-guide.md`; write through `spur feature update`. |
| `feature-check` | Run `spur feature check <id> --strict`; objective gate. |
| `system-design` | Dispatch `sp:sys-architecture` when design is required; create ADR/architecture/design artifacts through constitution rules. |
| `design-approval` | HITL taste gate; not auto-clicked by `--auto`. |
| `decompose` | Dispatch `sp:spec-decomposition` with brainstorm/design context. |
| `batch-create` | Validate and create tasks through `spur task batch-create`; objective gate. |
| `handoff` | Output feature id, task WBS list, and next command. No task execution. |

Routing rules:

- Brainstorm always records a design summary.
- `--design` forces `system-design`.
- `--skip-design` skips `system-design` but not the brainstorm design summary.
- With neither flag, `needs_design=true` runs `system-design`; `needs_design=false` routes directly
  from `feature-check` to `decompose`.
- Ties run design.
- `--auto` routes around objective gates (`feature-check`, `batch-create`) when the required checks
  pass. It does not bypass `design-approval` unless an explicit prior approval is represented in the
  workflow vars.

### `wrapup-pipeline.yaml`

Purpose: post-execution wrap-up for one task or a batch.

Command wrappers:

```bash
spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars '{"tasks":["0167"],"profile":"interactive|auto"}'

spur workflow run .spur/workflows/wrapup-pipeline.yaml \
  --vars '{"tasks":["0167","0168"],"feature":"I","profile":"auto"}'
```

State contract:

```
start
  -> task-resolve
  -> doc-sync
  -> learning-capture
  -> metrics-record
  -> feature-transition
  -> branch-cleanup
  -> done
```

Required actions:

| State | Action |
|---|---|
| `task-resolve` | Resolve explicit tasks or wrapper-selected task list; reject empty selection. |
| `doc-sync` | Dispatch `sp:doc-evolve` once for the batch. |
| `learning-capture` | Append working learnings to `.spur/memory/learnings.md`. |
| `metrics-record` | Append one JSONL row per task to `.spur/memory/wrapup-metrics.jsonl`. |
| `feature-transition` | If `feature` is set, advance through legal feature lifecycle edges only. |
| `branch-cleanup` | If `merge=true`, dispatch `sp:branch-workflow` behind an irreversible HITL gate. |
| `done` | Output wrap-up summary and next action. |

Rules:

- Project-level doc-sync runs once per batch.
- Learning capture aggregates the batch, then writes task-specific entries.
- Metrics are append-only and machine-readable.
- Branch cleanup always pauses unless the operator explicitly confirms the irreversible action.
- Task statuses are not mutated.

## Design Step Routing

The system has two related design mechanisms:

| Mechanism | Pipeline | Input | Output | Default |
|---|---|---|---|---|
| Brainstorm design summary | `idea-pipeline.yaml` discovery | vague idea | short design summary in brainstorm artifact | always |
| System architecture step | `idea-pipeline.yaml` system-design | feature + AC + brainstorm signal | ADR entries, architecture updates, design satellites | run unless confidently trivial |
| Design satellite generation | `planning-pipeline.yaml` design-gen | known slug/task | `docs/design/<slug>.md` | controlled by `dev-plan --design/--auto` |

`needs_design` criteria:

| Signal | Criteria |
|---|---|
| `true` | multiple subsystems, schema/config/DTO change, new module/package/service, new transport/boundary, new dependency, cross-cutting convention |
| `false` | single-module fix, docs/chores, boundary-preserving refactor, existing pattern with no architectural impact |

Flag truth table:

| Flags | Signal | Route |
|---|---|---|
| `--design` | ignored | run `system-design` |
| `--skip-design` | ignored | skip `system-design`; keep brainstorm summary |
| neither | `true` | run `system-design` |
| neither | `false` | skip `system-design` |

## HITL And Auto Mode

Gate taxonomy:

| Gate | Pipeline | Decision type | Auto route allowed |
|---|---|---|---|
| `feature-check` | idea | objective schema/check result | yes |
| `design-approval` | idea/planning | taste/architecture approval | no by default |
| `batch-create` | idea | objective schema/check result | yes |
| `approve` | task | objective if review verdict is PASS; taste otherwise | conditional |
| `branch-cleanup` | wrapup | irreversible | no |

Auto-decision principles:

1. Schema-valid -> auto-approve.
2. Gate-passed -> auto-continue.
3. Tests-green -> auto-continue.
4. Verdict-PASS -> auto-continue.
5. Taste-decision -> surface to human.
6. Irreversible action -> surface to human.
7. Error -> stop.

Implementation rule: `--auto` sets `profile=auto`. YAML transitions must route around an
auto-resolvable HITL state before entry. The workflow engine does not auto-dismiss `hitl.confirm`.

## Command Surface

| Command | Workflow | Required flags/options | Contract |
|---|---|---|---|
| `/sp:dev-plan` | `.spur/workflows/planning-pipeline.yaml` | `--design`, `--auto` | Known idea/slug to design handoff. |
| `/sp:dev-run` | `.spur/workflows/task-pipeline.yaml` | `<wbs>`, `--auto`, `--wrap` | One task through execution; optional wrap-up after done. |
| `/sp:dev-runall` | `.spur/workflows/task-pipeline.yaml` per selected task | `--feature`, `--auto`, `--wrap` | Batch execution with dependency/topology handling in the wrapper. |
| `/sp:dev-idea` | `.spur/workflows/idea-pipeline.yaml` | `<idea>`, `--auto`, `--design`, `--skip-design` | Vague idea to feature + task batch handoff. |
| `/sp:dev-wrap` | `.spur/workflows/wrapup-pipeline.yaml` | `<wbs>`, `--auto`, `--merge` | Single-task wrap-up. |
| `/sp:dev-wrapall` | `.spur/workflows/wrapup-pipeline.yaml` | `--since`, `--feature`, `--status`, `--auto`, `--merge` | Batch wrap-up. |

Wrapper duties:

- Build `--vars` JSON.
- Resolve task selections for batch commands.
- Prefer `.spur/workflows/<name>.yaml` in operator-facing command text.
- Pass `profile=auto` when `--auto` is set.
- Surface paused run ids and `spur workflow continue <run-id>` instructions.
- Never directly mutate task/feature files.

## Memory And Telemetry Artifacts

| Artifact | Format | Writer | Purpose | Corpus-gated |
|---|---|---|---|---|
| `.spur/memory/learnings.md` | Markdown | `wrapup-pipeline.yaml` | Working learnings grouped by date/task | no |
| `.spur/memory/wrapup-metrics.jsonl` | JSONL | `wrapup-pipeline.yaml` | Per-task wrap-up telemetry | no |
| `.spur/memory/sessions/<session>.md` | Markdown + YAML frontmatter | all long-running pipelines | Resume checkpoint | no |

Checkpoint frontmatter:

```yaml
session_id: "2026-07-01-0167"
workflow: "task-pipeline"
run_id: "wf_..."
task_wbs: "0167"
feature_id: "I"
phase: "verify"
last_gate: "review-approved"
timestamp: "2026-07-01T18:30:00Z"
next_action: "run verification"
```

Write checkpoints after:

- every HITL gate decision;
- every phase transition in `planning-pipeline`, `task-pipeline`, `feature-dev`, `idea-pipeline`,
  and `wrapup-pipeline`;
- every terminal state.

Read checkpoints when:

- `/sp:dev-run --continue` or `/sp:dev-runall --continue` is used;
- the operator asks to resume a task or feature;
- a workflow run is paused and later continued.

## Documentation Boundaries

| Operation | When | Writes |
|---|---|---|
| Initial system design | before decomposition/code | `docs/00_ADR.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/*` as needed |
| Post-implementation doc sync | after task/feature execution | drift repairs in docs, lessons in `docs/99_PROJECT_CONSTITUTION.md §8` |
| Working learning capture | during wrap-up | `.spur/memory/learnings.md` |

The initial design step is allowed to create or update design artifacts. The wrap-up doc-sync step is
allowed to repair drift and promote lessons. Neither step writes task or feature corpus files directly.

## Workflow YAML Contract

All workflow files in this system use:

| Field | Required value |
|---|---|
| `$schema` | `@gobing-ai/spur/schemas/state-machine-workflow.schema.json` |
| `kind` | `state-machine` |
| `initialState` | existing state id |
| `states[].id` | unique state id |
| `transitions[]` | explicit `from`, `to`, and guard |
| LLM action kind | `agent.run` |
| Shell action kind | `shell` |
| HITL action kind | `hitl.confirm` |
| Dry-run-safe notes | `note` |

Validation commands:

```bash
bun run apps/cli/src/index.ts workflow validate .spur/workflows/idea-pipeline.yaml --json
bun run apps/cli/src/index.ts workflow validate .spur/workflows/wrapup-pipeline.yaml --json
```

Repository-local CI or tests may validate `config/workflows/*.yaml` directly.

## Structural Invariants

Task 0167 extends `plugins/sp/tests/skill-structure.test.ts` without renumbering existing R29.

| Invariant | Coverage |
|---|---|
| R30 | `dev-idea`, `dev-wrap`, and `dev-wrapall` command docs exist, have valid frontmatter, and delegate to the correct workflows. |
| R31 | `gate-checklists.md` exists and is linked from `plugins/sp/skills/spur-dev/SKILL.md`. |
| R32 | `dev-operations.md` registers `idea`, `wrap`, and `wrapall`. |
| R33 | `cross-cutting.md` contains auto-decision, iron laws, design approval, learning log, checkpoint, and pipeline alignment sections. |
| R34 | `idea-pipeline.yaml` and `wrapup-pipeline.yaml` exist and validate against the state-machine schema. |
| R35 | `sp:brainstorm` documents the design approval gate and `needs_design` signal. |

Additional invariants for future workflow additions:

- Every new pipeline has exactly one owning phase.
- Every new pipeline is listed in this document and in the relevant plugin README/reference.
- Every new workflow validates with `spur workflow validate`.
- Any new HITL gate is classified as objective, taste, irreversible, or error.
- Any new working-memory artifact lives under `.spur/memory/` and has a documented format.

## Implementation Sequence For 0167

1. Add cross-cutting references: auto-decision principles, iron laws, pipeline alignment, learning log,
   session checkpoints, gate checklists.
2. Enhance `sp:brainstorm` to emit the design summary and `needs_design` contract.
3. Add `wrapup-pipeline.yaml`, `dev-wrap`, `dev-wrapall`, and `--wrap` integration.
4. Add `idea-pipeline.yaml` and `dev-idea`.
5. Add checkpoint write/read actions to existing and new workflows.
6. Register new operations in `dev-operations.md` and plugin README.
7. Add R30-R35 structural tests.
8. Validate workflows, run plugin tests, then run the project gate.

## Acceptance Trace

| Acceptance | Design coverage |
|---|---|
| AC1 | R30-R35 invariants section |
| AC2 | workflow validation contract |
| AC3 | `idea-pipeline.yaml` contract |
| AC4 | `wrapup-pipeline.yaml` contract and memory artifacts |
| AC5 | lifecycle contracts |
| AC6 | HITL and auto mode |
| AC7 | checkpoint contract |
| AC8 | path model, command surface, registration invariants |
