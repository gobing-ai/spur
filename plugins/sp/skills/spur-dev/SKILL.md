---
name: spur-dev
description: The thin orchestration spine for the Spur planning→execution lifecycle. Drives the workflow — intake, the feature-check and batch-create gates, the execution pipeline (precheck→implement→test→review→verify→record→done), and HITL gating — and DISPATCHES deep competency skills for the work itself (sp:spec-decomposition, sp:sys-architecture, sp:code-implementation, sp:code-testing, sp:code-verification); it never inlines them. Owns the lifecycle FSM, the gates, and the CLI-gated section-write contract; contains zero validation logic. Triggers on "run the pipeline", "drive this task", "run the task through the pipeline", "execute the dev workflow", "continue the pipeline run", "plan a feature end to end", or operating the full spur planning→execution lifecycle. For the work itself — decompose / design / implement / test / review — the competency skills trigger directly.
license: Apache-2.0
metadata:
  author: spur
  version: "1.1"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - pipeline
  halves:
    - planning
    - execution
  planning_steps:
    - intake
    - feature-create
    - ac-generation
    - feature-check-gate
    - decomposition
    - batch-create-gate
    - design-doc
    - refine
  execution_steps:
    - precheck
    - implement
    - test
    - review
    - approve
    - verify
    - record
    - done
  openclaw:
    emoji: "🔄"
---

# Spur Dev — The Orchestration Spine

`sp:spur-dev` is the **thin orchestration spine** that drives the full planning→execution lifecycle.
It converts vague intent into shipped work by *orchestrating*, not by doing the work itself: it runs
the gates (feature-check, batch-create) and the execution pipeline with human-in-the-loop control,
and **dispatches deep competency skills** for each unit of work — it never inlines them. Every write
to the corpus goes through a CLI verb that validates before writing — the spine knows *how to drive
the lifecycle*; the competency skills know *how to do each job*; the CLI knows *what is valid*.

The skill was decomposed **by function** (ADR-028): design, decomposition, implementation, testing,
and verification each became a standalone competency skill, leaving this spine to orchestrate them.

**The competencies the spine dispatches:**

| Unit of work | Competency skill |
|--------------|------------------|
| Design / ADR judgment (shape a task) | `sp:sys-architecture` |
| Feature/spec → task batch | `sp:spec-decomposition` |
| Implement to spec | `sp:code-implementation` |
| Coverage / test extension | `sp:code-testing` |
| Review / requirements verification | `sp:code-verification` |
| Test-first discipline (composed in) | `sp:spur-tdd` |

CLI verb usage for any `spur` noun lives in the `sp:spur-cli` facade. This spine owns only the
lifecycle, the gates, and the section-write contract (`cross-cutting.md`).

## The two halves at a glance

**Planning half** — vague description → validated, decomposed feature:

```
vague description
  → intake (clarify scope, constraints — prompt work)
  → spur feature create … ; AC authored/generated (spur agent run, bdd templates)
  → GATE: spur feature check   (BDD validator; loop until clean)
  → decomposition (prompt work) → task-batch JSON
  → GATE: task-batch.schema.json + spur task batch-create (atomic: all-or-nothing)
  → design doc (conditional: --design / --auto) → docs/design/<slug>.md + 04 index
  → refine (per task, just-in-time, before execution)
```

Full procedure: **[references/planning-workflow.md](references/planning-workflow.md)**.

**Execution half** — one task through the pipeline:

```
pick task (spur task list --json)
  → spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'
  → on HITL pause: surface to operator → spur workflow continue [run-id] [--yes]
```

The pipeline (`kind: state-machine`) runs the work loop:

```
precheck → implement → test → review → approve(HITL) → verify → record → done
```

Full procedure: **[references/execution-workflow.md](references/execution-workflow.md)**.

## Step routing

Each step delegates to a CLI verb and is documented in exactly one reference file. Read the
reference for the half you're operating; do not duplicate its content here.

| Step | Half | CLI gate | Reference |
|------|------|----------|-----------|
| Intake | planning | — (prompt work) | [planning-workflow.md](references/planning-workflow.md) · [product-planning.md](references/product-planning.md) |
| Feature create + AC | planning | `spur feature create` | [planning-workflow.md](references/planning-workflow.md) · [ac-style-guide.md](references/ac-style-guide.md) |
| Feature check gate | planning | `spur feature check` | [planning-workflow.md](references/planning-workflow.md) |
| Decomposition (dispatch) | planning | `task-batch.schema.json` | `sp:spec-decomposition` competency — the spine dispatches, does not inline |
| Batch-create gate | planning | `spur task batch-create` | [planning-workflow.md](references/planning-workflow.md) |
| Design doc | planning | — (prompt work; §4.5/T9) | [planning-workflow.md](references/planning-workflow.md) |
| Refine | planning | `spur task update --section` | [planning-workflow.md](references/planning-workflow.md) |
| Task selection | execution | `spur task list` | [execution-workflow.md](references/execution-workflow.md) |
| Pipeline run | execution | `spur workflow run` | [execution-workflow.md](references/execution-workflow.md) |
| Implement (dispatch) | execution | `sp:code-implementation` | competency skill — the spine dispatches, does not inline |
| Test (dispatch) | execution | `sp:code-testing` | competency skill — the spine dispatches, does not inline |
| Review / verify (dispatch) | execution | `sp:code-verification` | competency skill — the spine dispatches, does not inline |
| Operation catalog | execution | `sp:dev-*` operations | [dev-operations.md](references/dev-operations.md) (spine dispatch table) |
| Continue | execution | `spur feature update` / `refresh` | [execution-workflow.md](references/execution-workflow.md) |
| Batch run | execution | `sp:super-coder` + `spur workflow run` | [execution-batch.md](references/execution-batch.md) |
| All writes (both halves) | — | CLI-gated section editing | [cross-cutting.md](references/cross-cutting.md) |

## When to use

Use this skill for:

- **Planning a feature** — a description arrives; produce a feature file with AC and
  decomposed tasks.
- **Product-shaped planning** — prioritize roadmap candidates, choose a strategy profile, or produce
  PRD-shaped guidance without adding a separate PM command surface.
- **Running a task** — pick a task, run it through the pipeline, handle HITL gates.
- **Continuing interrupted work** — resume a paused pipeline run.
- **Batch task creation** — decompose a feature into tasks and land them atomically.

Do **not** use this skill for:

- Looking up task/feature/rule/workflow verbs or conventions — use the `sp:spur-cli` facade
  (one reference per noun).
- Gate-level constraint checking — use `sp:spur-cli` (rule noun).
- Workflow authoring/tuning — use `sp:spur-cli` (workflow noun).
- Documentation maintenance — use `sp:doc-evolve`.

## Behavior

This skill behaves as a **pipeline** operator: it converts intent into CLI-validated
artifacts, gates every write, and drives execution workflows. It owns the full planning→done
lifecycle but delegates every deterministic step to CLI verbs. It does not validate — the
CLI does.

## Gotchas

1. **Never skip a gate.** A clean `feature check` is the only proof the AC is valid; a
   passing `batch-create` is the only proof the decomposition is well-formed. Skip either and
   you ship corrupted corpus.
2. **The pipeline, not you, writes results.** `## Testing` and `## Review` sections are
   filled by the pipeline's `record` step. Do not edit them directly during execution.
3. **Check before every write.** Run `spur task check <wbs> --json` to know what sections
   the task needs at its current status. Guessing produces matrix violations.
4. **AC titles are identity keys.** Renaming a scenario after tasks are created breaks
   traceability edges. If you must rename, update the task's scenario references too.
5. **Batch-create is atomic.** A single schema violation rejects the entire batch. Validate
   locally against `task-batch.schema.json` before invoking the CLI.
6. **Two-halves seam.** The planning and execution halves share this skill today but are
   designed to split cleanly. Keep new logic in one half or the other — never straddle the
   seam with cross-half dependencies.

## Additional Resources

**Workflow procedure (read the half you're operating):**

- [references/planning-workflow.md](references/planning-workflow.md) — Steps 1–6: intake →
  feature create → AC → check gate → decomposition → batch-create → refine.
- [references/execution-workflow.md](references/execution-workflow.md) — task selection →
  pipeline run → HITL surfacing → continue; pipeline-stage sequencing and `## Solution` ownership.
- [references/execution-batch.md](references/execution-batch.md) — batch execution: resolve a task
  set, topo-sort by dependencies, run each through `task-pipeline.yaml`, failure policy, batch
  report. Backs `/sp:dev-runall` + the `sp:super-coder` orchestrator.
- [references/cross-cutting.md](references/cross-cutting.md) — CLI-gated writes, the section-editing
  body-only format, the section-status matrix, check-before-write. Shared by the spine and every
  competency skill (the single sanctioned cross-skill dependency).
- [references/product-planning.md](references/product-planning.md) — product-management judgment for
  intake, RICE/MoSCoW prioritization, strategy profiles, PRD-shaped output, and PM handoff rules.

**Competency skills the spine dispatches to (the spine does not inline these):**

- **`sp:code-implementation`** — the `implement` step: task-driven scope, stack pattern selection,
  root-cause debugging, the `## Solution` change-map. Owns `implementation-patterns.md`, `debugging.md`.
- **`sp:code-testing`** — the `test` step: coverage, gap analysis, test extension. Owns
  `unit-testing.md` and the per-stack adapters (`stacks/`).
- **`sp:code-verification`** — the `review`/`verify` steps: SECUA review + requirements traceability.
- **`sp:sys-architecture`** — design/ADR judgment, consulted when a task's shape is unsettled.
- **`sp:spur-tdd`** — the test-first discipline `code-implementation` and `code-testing` compose with.

**Supporting detail:**

- **`sp:spec-decomposition`** — the decomposition competency the spine dispatches at the decompose
  step: the `task-batch.schema.json` contract, template-variant selection, scenario-to-task mapping,
  the granularity standard. The spine runs the `batch-create` gate; the competency produces the batch.
- [references/ac-style-guide.md](references/ac-style-guide.md) — BDD scenario authoring:
  R-numbering, the two AC tiers, scenario-title stability, Gherkin template usage. Shared planning
  convention (authored at feature-create, consumed by `sp:spec-decomposition`).
- [references/dev-operations.md](references/dev-operations.md) — the per-operation catalog: what
  each `/sp:dev-*` operation does (unit/review/verify/run/refine/plan/...). The SSOT for operation
  definitions; the execution workflow links here rather than restating them.
- [references/feature-link-helper.md](references/feature-link-helper.md) — opt-in,
  strictness-triggered helper to resolve a deferred `feature_id` edge: LLM-judge match against
  existing features (prefer existing; create only as last resort; confirm before apply); single-task
  mode + batch-sweep mode. Invoke only when the operator opts into `--strict` rigor or explicitly
  asks to link a task to a feature — NEVER gate-time, NEVER automatic.

**Config & companions:**

- `config/workflows/task-pipeline.yaml` — the execution pipeline definition.
- `config/workflows/planning-pipeline.yaml` — the front-half state machine.
- `config/templates/bdd/gherkin.md` — the BDD scenario template.
- The planning-pipeline workflow is defined in `config/workflows/planning-pipeline.yaml`. The SSOT
  narrative for all dev-* planning operations lives here in sp:spur-dev.

## Platform Notes

### Claude Code

`spur` CLI via the Bash tool. The `sp:dev-*` slash commands are the primary entry points;
invoke the skill directly via `Skill(skill="sp:spur-dev", args="plan <description>")` for
planning, `args="run <wbs>"` for execution, `args="unit <target>"` for test generation,
or `args="refine <wbs>"` for task refinement. Use `spur agent run` for isolated LLM
invocations within pipeline steps.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via the Bash tool; parse `--json` output. Invoke this skill directly for
the workflow logic — the skill is the SSOT; commands and subagents are thin wrappers.

---

**Template type**: technique
**Purpose**: Drive the full Spur planning-to-execution workflow — convert intent into CLI-validated feature files, decomposed task batches, and pipeline-driven execution with HITL gating
