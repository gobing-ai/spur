---
description: Create a new task from a description — single-task creation via spur task create
argument-hint: "\"<description>\" [--feature <id>] [--template <variant>] [--parent <wbs>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev New Task

Wraps the **sp:spur-dev** skill (task creation).

Create a single task file from a description. Intake Q&A for scope, then `spur task create`
with the appropriate template variant and feature linkage. For batch task creation from a
decomposed feature, use `dev-plan` instead.

## When to use

- A standalone task needs creation ("create a task for the config migration").
- Quick, single-task additions not part of a planned feature decomposition.
- The operator says "new task" or "create a task."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `description` | Task description (required, positional) | (required) |
| `--feature <id>` | Link the task to a feature | (none) |
| `--template <variant>` | Template variant: `default`, `feature-impl`, `issue`, `review`, `meta` | `default` |
| `--parent <wbs>` | Parent task WBS for sub-tasks | (none) |

## Behavior

Thin wrapper: intake, template selection, and `spur task create` invocation are all owned
by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="new-task $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `new-task` operation directly.
