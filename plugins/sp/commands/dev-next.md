---
description: Status-aware router — pick and run the next best /sp:dev-* step for a task or feature frontier
role: planner
argument-hint: "[<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <inline|auto|name>] [--full]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Next

Wraps the **sp:next-router** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<wbs\|feature-id>]` | Task WBS or feature id to advance. | active |
| `--dry-run` | Resolve and print the next step without executing. | off |
| `--once` | Resolve exactly one step and stop. | off |
| `--auto` | Skip objective HITL gates in the dispatched step. | off |
| `--agent` `<inline\|auto\|name>` | Who runs the dispatched model-bearing step. | omit |
| `--full` | When the primary route is `dev-run … --next`, substitute `dev-run <wbs> --mode full` (no `--next`). No effect on other routes (warning W-FULL). | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-next [<wbs|feature-id>] [--dry-run] [--once] [--auto] [--agent <inline|auto|name>] [--full]

## Implementation

- Apply and forward the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:next-router", args="$ARGUMENTS")`
