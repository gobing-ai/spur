---
description: Create a new task from a description — single-task creation via spur task create
argument-hint: "\"<description>\" [--feature <id>] [--template <variant>] [--parent <wbs>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev New Task

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#13-new-task) for the authoritative reference.

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

Inline procedure (no skill delegation):

1. **Intake:** clarify the task scope with the operator:
   - What is the task trying to accomplish? (Refine the description if vague.)
   - Which feature does it belong to? (Use `--feature` if given; ask if not.)
   - What template variant fits? (Use `--template` if given; default to `feature-impl` when `--feature` is set, `default` otherwise.)
   - Is this a sub-task? (Use `--parent` if given; ask if the description implies nesting.)
2. **Create:** run `spur task create "<title>" --feature <id> --template <variant> --parent <wbs> --json` (omit `--feature`/`--parent` if not applicable).
3. **Report:** print the new task's WBS and file path.

For batch task creation from a decomposed feature, use `dev-plan` instead.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#13-new-task). No `Skill()` delegation.

**Arguments received:** `$ARGUMENTS`. Parse per the Arguments table above.

## Platform Notes

- **Claude Code:** native — `Bash`/`Read`/`Write` tools work directly.
- **Other platforms:** Run the `spur` CLI commands manually per the procedure above.
