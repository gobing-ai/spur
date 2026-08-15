---
description: Fan out independent tasks or investigations in parallel via subagents — choose the right pattern and synthesize results
role: planner
argument-hint: "--tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <inline|auto|name>] [--json]"
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

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-parallel --tasks <selector> [--feature <id>] [--mode <fan-out|review-panel|investigation>] [--agent <inline|auto|name>] [--json]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface) before choosing native subagents or `spur agent run`.
- `Skill(skill="sp:parallel-execution", args="$ARGUMENTS")`
