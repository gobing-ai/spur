---
description: Implement a single task — the pipeline's implement step; write the code that satisfies the task's requirements
argument-hint: "<wbs> [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Implement

Wraps the **sp:spur-dev** skill (execution half — implement phase).

Implement a single task: read its `## Requirements` / `## Design` / `## Plan`, write the code that
satisfies them, and follow the task's plan steps. This is the **implement step the pipeline calls** —
it is NOT the pipeline driver. `/sp:dev-run` drives the whole pipeline; `/sp:dev-implement` does the
one implement stage inside it. Keeping them distinct breaks the recursion where the pipeline's
`implement` state used to call `/sp:dev-run` (the command that launched it).

## When to use

- The pipeline's implement phase (called from `task-pipeline.yaml`).
- A focused "just write the code for this task" request, without driving test/review/verify.
- The operator says "implement 0042."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--auto` | Skip confirmations (pipeline / CI use) | off |

## Behavior

Thin wrapper: reading the task spec, writing code per the Design/Plan, and following the plan
checklist are owned by the skill. Does not run tests, review, or verify — those are separate
pipeline steps (`/sp:dev-unit`, `/sp:dev-review`, `/sp:dev-verify`).

## Implementation

Delegates to **sp:spur-dev** skill (implement operation):

```
Skill(skill="sp:spur-dev", args="implement $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's implement operation directly.
