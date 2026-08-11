---
name: spur-dev
description: "The thin orchestration spine for the planning→execution lifecycle: intake, feature-check/batch-create gates, the execution pipeline (precheck→implement→test→review→verify→record→done), HITL gating. Dispatches competency skills; never inlines them. Triggers: \"run the pipeline\", \"drive this task\", \"plan a feature end to end\", \"continue the pipeline run\", or operating the full lifecycle."
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
| -------------- | ------------------ |
| Design / ADR judgment (shape a task) | `sp:sys-architecture` |
| Feature/spec → task batch | `sp:spec-decomposition` |
| Implement to spec | `sp:code-implementation` |
| Coverage / test extension | `sp:code-testing` |
| Review (multi-dimensional) | `sp:code-verification` + `sp:functional-review` + `sp:code-improvement` |
| Test-first discipline (composed in) | `sp:test-driven-development` |

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
  → design doc (conditional: seam heuristic; opt out with --skip-design) → docs/design/<slug>.md + 04 index
  → refine (per task, just-in-time, before execution)
```

Full procedure: **[references/planning-workflow.md](references/planning-workflow.md)**.

**Execution half** — one task through the pipeline:

```
pick task (spur task list --json)
  → interactive omit/inline: read task-pipeline.yaml → drive actions + guards in host session
  → explicit/headless executor: spur workflow run .spur/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'
  → on HITL pause: surface to operator; resume the selected driver from the paused state
```

The pipeline (`kind: state-machine`) runs the work loop:

```
precheck → implement → test → review → approve(HITL) → verify → record → done
```

Full procedure: **[references/execution-workflow.md](references/execution-workflow.md)**.
Host-session procedure: **[references/inline-pipeline-driver.md](references/inline-pipeline-driver.md)**.

## Step routing

Each step delegates to a CLI verb and is documented in exactly one reference file. Read the
reference for the half you're operating; do not duplicate its content here.

| Step | Half | CLI gate | Reference |
| ------ | ------ | ---------- | ----------- |
| Intake | planning | — (prompt work) | [planning-workflow.md](references/planning-workflow.md) · [product-planning.md](references/product-planning.md) |
| Feature create + AC | planning | `spur feature create` | [planning-workflow.md](references/planning-workflow.md) · [ac-style-guide.md](references/ac-style-guide.md) |
| Feature check gate | planning | `spur feature check` | [planning-workflow.md](references/planning-workflow.md) |
| Decomposition (dispatch) | planning | `task-batch.schema.json` | `sp:spec-decomposition` competency — the spine dispatches, does not inline |
| Batch-create gate | planning | `spur task batch-create` | [planning-workflow.md](references/planning-workflow.md) |
| Design doc | planning | — (prompt work; §4.5/T9) | [planning-workflow.md](references/planning-workflow.md) |
| Refine | planning | `spur task update --section` | [planning-workflow.md](references/planning-workflow.md) |
| Batch refine | planning | `sp:dev-refineall` → per-task `refine` | [dev-operations.md](references/dev-operations.md) § refineall · [planning-workflow.md](references/planning-workflow.md) |
| Task selection | execution | `spur task list` | [execution-workflow.md](references/execution-workflow.md) |
| Pipeline run | execution | inline YAML driver or `spur workflow run` | [execution-workflow.md](references/execution-workflow.md) · [inline-pipeline-driver.md](references/inline-pipeline-driver.md) |
| Implement (dispatch) | execution | `sp:code-implementation` | competency skill — the spine dispatches, does not inline |
| Test (dispatch) | execution | `sp:code-testing` | competency skill — the spine dispatches, does not inline |
| Review / verify (dispatch) | execution | `sp:dev-review` → `sp:code-verification` + `sp:functional-review` + `sp:code-improvement` | competency skills — the spine dispatches, does not inline |
| Operation catalog | execution | `sp:dev-*` operations | [dev-operations.md](references/dev-operations.md) (spine dispatch table) |
| Continue | execution | `spur feature update` / `refresh` | [execution-workflow.md](references/execution-workflow.md) |
| Batch run | execution | `sp:super-planner` + `spur workflow run` | [execution-batch.md](references/execution-batch.md) |
| Parallel fan-out | execution | `sp:parallel-execution` decision framework | [execution-batch.md](references/execution-batch.md) |
| All writes (both halves) | — | CLI-gated section editing | [cross-cutting.md](references/cross-cutting.md) · [section-batching.md](references/section-batching.md) |

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

**Every reference file and its step is listed once, in [Step routing](#step-routing) above — this
section adds what that table has no room for: per-file content summaries and items with no single
step (glossary, config companions).** Read Step routing to find "which file for step X"; read below
for "what's actually in file Y" or for resources that sit outside the step sequence.

- [references/glossary.md](references/glossary.md) — sp's own vocabulary: spine, competency, facade,
  corpus, gate, verdict, noun/verb, half, HITL, WBS, section-write contract — canonical term +
  Avoid list. Owns term definitions only; `cross-cutting.md` owns the process rules that use them.
- [references/flag-glossary.md](references/flag-glossary.md) — the shared-flag glossary (one
  canonical entry per flag used by two or more `/sp:dev-*` commands) and the `--next` chain
  contract. Moved verbatim from `dev-operations.md` (task 0408) so command files can deep-link
  flag entries while this spine reads the operation catalog linearly.
- [references/gate-checklists.md](references/gate-checklists.md) — checkbox checklists for the
  five gates (feature-check, batch-create, precheck, review, verify). Each checklist is a
  `- [ ]` list of prerequisites an agent verifies before entering the gate.
- [references/section-batching.md](references/section-batching.md) — first-write protocol for
  staging Solution, Testing, and Review together before one task check.
- [references/ac-style-guide.md](references/ac-style-guide.md) — BDD scenario authoring:
  R-numbering, the two AC tiers, scenario-title stability, Gherkin template usage.
- [references/feature-link-helper.md](references/feature-link-helper.md) — opt-in,
  strictness-triggered helper to resolve a deferred `feature_id` edge: LLM-judge match against
  existing features (prefer existing; create only as last resort; confirm before apply); single-task
  mode + batch-sweep mode. Invoke only when the operator opts into `--strict` rigor or explicitly
  asks to link a task to a feature — NEVER gate-time, NEVER automatic.

**Competency skills the spine dispatches to** (what each owns beyond the Step-routing row):

- **`sp:code-implementation`** owns `implementation-patterns.md`, `debugging.md`.
- **`sp:code-testing`** owns `unit-testing.md` and the per-stack adapters (`stacks/`).
- **`sp:spec-decomposition`** owns the granularity standard (scenario→task sizing).
- **`sp:functional-review`** owns requirements traceability (R{n} → file:line evidence, per-requirement MET/PARTIAL/UNMET, FunctionalVerdict artifact). Phase 8b gate.
- **`sp:code-improvement`** owns architectural deepening (5 signals: shallow module, tight coupling, wrong seam, weak locality, poor test surface; severity blocker/major/minor/advisory).

- **`sp:test-driven-development`** — the test-first discipline `code-implementation` and `code-testing` compose with.

**Config & companions (no single pipeline step owns these):**

- `.spur/workflows/task-pipeline.yaml` — the execution pipeline definition.
- `.spur/workflows/planning-pipeline.yaml` — the front-half state machine.
- `.spur/templates/bdd/gherkin.md` — the BDD scenario template.

## Platform Notes

### Claude Code

`spur` CLI via the Bash tool. The `sp:dev-*` slash commands are the primary entry points;
invoke the skill directly via `Skill(skill="sp:spur-dev", args="plan <description>")` for
planning, `args="run <wbs>"` for execution, `args="unit <target>"` for test generation,
or `args="refine <wbs>"` for task refinement, or `args="refineall --feature <id> --auto"` for
batch refine under a feature (add `--depth ready` for implement-ready freeze). Use `spur agent run`
for isolated LLM invocations within pipeline steps.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via the Bash tool; parse `--json` output. Invoke this skill directly for
the workflow logic — the skill is the SSOT; commands and subagents are thin wrappers.
