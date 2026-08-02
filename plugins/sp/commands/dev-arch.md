---
description: Survey a codebase (or module tree) for shallow modules and deepening opportunities — emit a ranked MARKDOWN candidate report that feeds the planning half; never auto-refactors
argument-hint: "[<module-path>] [--scope <all|path>] [--agent <inline|auto|name>] [--json]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Arch

Wraps the **sp:sys-architecture** skill.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<module-path>]` | Module path to scope the architecture survey. | omitted (whole repo) |
| `--scope` `<all\|path>` | Limit the survey to a path or expand to the whole repo. | all |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing survey work. | inline |
| `--json` | Emit structured JSON instead of markdown. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-arch [<module-path>] [--scope <all|path>] [--agent <inline|auto|name>] [--json]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:sys-architecture", args="survey $ARGUMENTS")`

