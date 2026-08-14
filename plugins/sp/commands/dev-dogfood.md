---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
role: reviewer
argument-hint: "<testee> [--agent <inline|auto|name>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill"]
---

# Dev Dogfood

Wraps the **sp:dogfood-testing** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<testee>` | Skill / command / CLI to exercise end-to-end. | required |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing dogfood work. | inline |
| `--max-retry` `<n>` | Max auto-fix retries per stage. | 3 |
| `--save` | Compatibility no-op; saving is now default. Retained until evidenced retirement. | off |
| `--task` | Record outcomes against a task. | omitted |
| `--chain-follow` | Follow the testee's chained follow-ups. | off |
| `--full` | Full report verbosity (all sections). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-dogfood <testee> [--agent <inline|auto|name>] [--max-retry <n>] [--save] [--task] [--chain-follow] [--full]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")`

