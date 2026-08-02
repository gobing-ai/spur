---
description: Simplify code for clarity without changing behavior — reduce complexity in recent changes (or a given scope), preserving behavior exactly
argument-hint: "[<path-or-scope>] [--scope <recent|all|path>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]"
allowed-tools: ["Bash", "Read", "Edit", "Skill"]
---

# Dev Simplify

Wraps the **sp:code-simplification** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<path-or-scope>]` | Path or scope to simplify. | recent |
| `--scope` `<recent\|all\|path>` | Scope of the simplification pass. | recent |
| `--check` `<cmd>` | Validation command to iterate against. | project gate |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing simplification. | inline |
| `--auto` | Skip objective HITL gates. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-simplify [<path-or-scope>] [--scope <recent|all|path>] [--check <cmd>] [--agent <inline|auto|name>] [--auto]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:code-simplification", args="$ARGUMENTS")`

