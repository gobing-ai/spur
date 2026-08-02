---
description: Generate or extend tests until the unit target is met
argument-hint: "<target> [--coverage <n>] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Unit

Wraps the **sp:code-testing** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<target>` | File / module / path to generate tests for. | required |
| `--coverage` `<n>` | Coverage percentage target. | configured |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing test work. | inline |
| `--auto` | Skip objective HITL gates. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-unit <target> [--coverage <n>] [--agent <inline|auto|name>] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-testing", args="$ARGUMENTS")`
