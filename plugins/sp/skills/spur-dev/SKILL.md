---
name: spur-dev
description: The fat daily-workflow umbrella skill for the Spur planning+execution pipeline. Converts vague feature descriptions into CLI-validated feature files with BDD acceptance criteria, decomposes them into task batches, and runs tasks through the execution pipeline with HITL gating. Delegates every deterministic step to CLI verbs; contains zero validation logic. Triggers on "plan a feature", "decompose this", "run the task", "execute task", "dev workflow", "create tasks from this", "run pipeline", or operating the full spur planning lifecycle.
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

# Spur Dev — The Daily-Workflow Umbrella Skill

`sp:spur-dev` is the fat skill that drives the full planning-to-execution workflow. It converts
vague intent into shipped work: plan a feature with BDD acceptance criteria, decompose it into
tasks validated by the CLI, then run those tasks through the execution pipeline with human-in-the-loop
gates. Every write to the corpus goes through a CLI verb that validates before writing — the
skill knows *how to think*; the CLI knows *what is valid*.

The two halves are a **sanctioned future split seam** (design §12.1, risk R4). Today they are one
skill because they share vocabulary, gates, and the same CLI surface. When size hurts, split at the
half boundary — each half's full procedure already lives in its own reference file and owns its
complete workflow independently.

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
| Intake | planning | — (prompt work) | [planning-workflow.md](references/planning-workflow.md) |
| Feature create + AC | planning | `spur feature create` | [planning-workflow.md](references/planning-workflow.md) · [ac-style-guide.md](references/ac-style-guide.md) |
| Feature check gate | planning | `spur feature check` | [planning-workflow.md](references/planning-workflow.md) |
| Decomposition | planning | `task-batch.schema.json` | [decomposition.md](references/decomposition.md) |
| Batch-create gate | planning | `spur task batch-create` | [planning-workflow.md](references/planning-workflow.md) |
| Design doc | planning | — (prompt work; §4.5/T9) | [planning-workflow.md](references/planning-workflow.md) |
| Refine | planning | `spur task update --section` | [planning-workflow.md](references/planning-workflow.md) |
| Task selection | execution | `spur task list` | [execution-workflow.md](references/execution-workflow.md) |
| Pipeline run | execution | `spur workflow run` | [execution-workflow.md](references/execution-workflow.md) |
| Implement / test / review / verify | execution | `sp:dev-*` operations | [dev-operations.md](references/dev-operations.md) |
| Continue | execution | `spur feature update` / `refresh` | [execution-workflow.md](references/execution-workflow.md) |
| All writes (both halves) | — | CLI-gated section editing | [cross-cutting.md](references/cross-cutting.md) |

## When to use

Use this skill for:

- **Planning a feature** — a description arrives; produce a feature file with AC and
  decomposed tasks.
- **Running a task** — pick a task, run it through the pipeline, handle HITL gates.
- **Continuing interrupted work** — resume a paused pipeline run.
- **Batch task creation** — decompose a feature into tasks and land them atomically.

Do **not** use this skill for:

- Looking up task/feature verbs or conventions — use the `sp:spur-tasks` /
  `sp:spur-features` companion skills.
- Gate-level constraint checking — use `sp:spur-rules`.
- Workflow authoring/tuning — use `sp:spur-workflows`.
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
- [references/cross-cutting.md](references/cross-cutting.md) — CLI-gated writes, the section-editing
  body-only format, the section-status matrix, check-before-write. Shared by both halves.

**Supporting detail:**

- [references/decomposition.md](references/decomposition.md) — the `task-batch.schema.json`
  contract, template-variant selection, scenario-to-task mapping conventions.
- [references/ac-style-guide.md](references/ac-style-guide.md) — BDD scenario authoring:
  R-numbering, the two AC tiers, scenario-title stability, Gherkin template usage.
- [references/dev-operations.md](references/dev-operations.md) — the per-operation catalog: what
  each `/sp:dev-*` operation does (unit/review/verify/run/refine/plan/...). The SSOT for operation
  definitions; the execution workflow links here rather than restating them.
- [references/unit-testing.md](references/unit-testing.md) — the `unit` operation procedure
  (language-agnostic spine): file-focused vs task-scoped workflows, gap categorization,
  coverage-vs-quality rules, escalation. Per-stack mechanics (commands, coverage parsing, idioms,
  gotchas) live in [references/stacks/](references/stacks/) adapters (bun-ts, python, go). Backs
  `dev-operations.md §1`.

**Config & companions:**

- `config/workflows/task-pipeline.yaml` — the execution pipeline definition.
- `config/workflows/planning-pipeline.yaml` — the front-half state machine.
- `config/templates/bdd/gherkin.md` — the BDD scenario template.
- **`sp:spur-plan`** — thin YAML front-end for the planning pipeline. The SSOT narrative for all
  dev-* operations lives here in sp:spur-dev.

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
