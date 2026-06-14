---
description: Review code for a task — SECU framework review across security, error-handling, conventions, and untested paths
argument-hint: "<wbs> [--focus <lens>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Review

Wraps the **sp:spur-dev** skill (execution half — review phase).

Review code changes for a task using the SECU framework (Security, Error-handling,
Conventions, Untested paths). The review phase of the execution pipeline: analyze the
diff, produce ranked findings, and feed them into the pipeline's fix loop.

## When to use

- A task's implementation is complete and needs review.
- A focused security or architecture audit of task changes.
- The operator says "review this" or "check the code."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--focus <lens>` | Review lens: `security`, `architecture`, `conventions`, or `all` | `all` |

## Behavior

Thin wrapper: diff scope, SECU analysis, findings ranking, and reporting are all owned by
the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="review $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `review` operation directly.
