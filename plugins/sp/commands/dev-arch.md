---
description: Survey a codebase (or module tree) for shallow modules and deepening opportunities — emit a ranked MARKDOWN candidate report that feeds the planning half; never auto-refactors
argument-hint: "[<module-path>] [--scope <all|<path>>] [[`--agent`](../skills/spur-dev/references/dev-operations.md#flag-agent) <name|auto>] [[`--inline`](../skills/spur-dev/references/dev-operations.md#flag-inline)|[`--subprocess`](../skills/spur-dev/references/dev-operations.md#flag-subprocess)] [--json]"
allowed-tools: ["Bash", "Read", "Grep", "Glob", "Skill"]
---

# Dev Arch

Wraps the **sp:sys-architecture** skill.

## Usage

/sp:dev-arch [<module-path>] [--scope <all|<path>>] [--agent <name|auto>] [--inline|--subprocess] [--json]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- `Skill(skill="sp:sys-architecture", args="survey $ARGUMENTS")`

