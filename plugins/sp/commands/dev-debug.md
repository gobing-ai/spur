---
description: "Systematic debugging protocol — reproduce, isolate, diagnose root cause, apply minimal fix, and verify with regression tests"
role: coder
argument-hint: "\"<symptom | failing command>\" [--scope <path>] [--task [<wbs>]] [--agent <inline|auto|name>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Debug

Wraps the **sp:sys-debugging** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `"<symptom \| failing command>"` | Symptom or failing command to diagnose. | required |
| `--scope` `<path>` | Scope the reproduction/isolation to a path. | cwd |
| `--task` `[<wbs>]` | Attach findings to a task. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing diagnosis. | omit |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-debug "<symptom | failing command>" [--scope <path>] [--task [<wbs>]] [--agent <inline|auto|name>]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:sys-debugging", args="$ARGUMENTS")`
