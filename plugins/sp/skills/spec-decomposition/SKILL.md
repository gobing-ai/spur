---
name: spec-decomposition
description: The decomposition competency — turn a validated feature (with acceptance criteria) into a well-formed task batch that passes the task-batch.schema.json gate, mapping scenarios to tasks, choosing template variants, and sizing by the granularity standard. The deep skill the spine dispatches before execution; runs feature/spec → task batch. Use when decomposing a feature into tasks, breaking work into subtasks, sizing tasks, or producing the batch JSON for spur task batch-create. Triggers on "decompose this", "break into tasks", "decompose the feature", "task batch", "create tasks from this feature", "split this work", "decomposition".
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - technique
  competency: decomposition
  openclaw:
    emoji: "🧩"
---

# spec-decomposition — the decomposition competency

Turn a validated feature (Goal, Scope, acceptance criteria) into a **well-formed task batch** that
the CLI accepts. This is the deep competency the orchestration spine (`sp:spur-dev`) dispatches
**before** execution — it owns *how to decompose well* (scenario→task mapping, sizing, variant
selection), distinct from the spine which decides *when* to decompose and runs the gate.

Decomposition is a precondition of execution: a task must be decomposed before
`sp:code-implementation` can build it. This skill produces the batch JSON; the CLI's
`task-batch.schema.json` gate validates it; `spur task batch-create` lands it atomically (all-or-nothing).

## When to use

- **Feature → tasks** — a feature with acceptance criteria exists; produce its task batch.
- **Break down work** — split a large requirement into dependency-ordered, right-sized subtasks.
- **Size a task** — decide whether a task is one deliverable or should split (the granularity standard).
- **The planning half's decompose step** — the spine dispatches here after `feature check` passes.

Do **not** use this skill for:

- **Authoring the feature / acceptance criteria** — that is the spine's planning half + the AC style
  guide (`sp:spur-dev`'s `ac-style-guide.md`), which this skill *consumes*.
- **Implementing / testing / reviewing a task** — those are `sp:code-implementation`,
  `sp:code-testing`, `sp:code-verification`.
- **Driving the lifecycle / running the gate** — that is the spine, `sp:spur-dev`.

## Behavior

This skill behaves as a **technique**: given a feature's AC, it maps each `@core` scenario to a task
(one R-number = one task spine), sizes each by the granularity standard, selects the template variant,
orders by dependency, and emits the batch JSON — then hands it to the CLI gate. It writes **nothing**
directly: `task-batch.schema.json` validates and `spur task batch-create --file <json>` writes
atomically (a single schema violation rejects the whole batch).

Full procedure: **[references/decomposition.md](references/decomposition.md)** — the
`task-batch.schema.json` contract, template-variant selection, scenario-to-task mapping, the
granularity knobs (min/target/force-split hours), and parent/umbrella-task conventions.

## The gate

```bash
spur task batch-create --file decomposition.json   # bare JSON array; atomic, all-or-nothing
```

Validate locally against `apps/cli/schemas/task-batch.schema.json` (runtime SSOT: the Zod
`taskBatchSchema`) before invoking the CLI — a single violation rejects the entire batch. The gate is
the only proof the decomposition is well-formed; never hand-write task files to bypass it.

## Gotchas

1. **Decomposition precedes execution.** A task must be decomposed and batch-created before
   `sp:code-implementation` runs. This skill's output is the input to the execution half.
2. **Batch-create is atomic.** One schema violation rejects everything — validate locally first.
3. **AC titles are the traceability key.** Map tasks to AC by scenario title (R-prefix stripped on
   match); a renamed scenario after batch-create breaks coverage.
4. **Size by the standard, not by feel.** The granularity knobs in `decomposition.md` set the
   min/target/force-split bounds — apply them rather than guessing task size.

## See also

- **`sp:spur-dev`** — the spine that dispatches this competency at the decompose step and runs the
  `batch-create` gate; owns the AC style guide this skill consumes.
- **`sp:code-implementation`** — builds the tasks this skill produces (decomposition is its precondition).

## Platform Notes

### Claude Code

Invoked by the spine's planning half (the decompose step), or directly via
`Skill(skill="sp:spec-decomposition", args="<feature-id>")`. Validate the batch JSON and run
`spur task batch-create` via the Bash tool.

### Codex / OpenClaw / OpenCode / Antigravity

Invoke this skill directly for decomposition technique; run `spur task batch-create` via the Bash
tool. The skill is the SSOT for the method; the CLI gate is the validator.

---

**Template type**: technique
**Purpose**: Turn a validated feature with AC into a well-formed, schema-gated task batch — scenario→task mapping, sizing, variant selection — the deep skill the spine dispatches before execution
