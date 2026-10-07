---
description: Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results
role: planner
argument-hint: "--tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <inline|auto|name>] [--json] [--defer-gate]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Parallel

Wraps the **sp:parallel-execution** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--tasks` `<selector>` | Task selector to fan out. | required |
| `--feature` `<id>` | Restrict the selector to a feature. | omitted |
| `--mode` `<fan-out\|review-panel\|investigation>` | Fan-out pattern. | fan-out |
| `--agent` `<inline\|auto\|name>` | Who runs each dispatched slice. Parallel fan-out is dispatch, so explicit `--agent inline` runs the batch **sequentially in the host session** with a printed notice (zero dispatch); omit keeps the default fan-out semantics; `auto` tier-resolves an executor; a name pins that executor. | omit |
| `--json` | Emit structured JSON. | off |
| `--defer-gate` | Opt-in parallel-batch gate policy (task 1111): each task's `test` hop runs the light tier and writes `DEFERRED`; the batch runs one integrated full gate on the base ref before the feature sync. Requires `--mode parallel`; default off. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-parallel --tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <inline|auto|name>] [--json] [--defer-gate]

## Implementation

- **Publish the visible batch plan first (1105):** as the batch orchestrator, publish `A Prepare
  batch` (A1–A4) and `Z Batch report` before the first task, then one letter per task from
  `batch-plan.mjs waves` after freeze/order and digit children from `batch-plan.mjs task-children` at
  task start — [execution-batch.md](../skills/spur-dev/references/execution-batch.md#27-visible-batch-plan-1105-r3)
  § 2.7 Visible batch plan.
- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface) before choosing native subagents or `spur agent run`.
- `Skill(skill="sp:parallel-execution", args="$ARGUMENTS")`
