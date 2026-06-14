---
description: Refine task requirements via structured Q&A — clarify scope, elicit missing details, tighten acceptance criteria
argument-hint: "<wbs>"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Refine

Wraps the **sp:spur-dev** skill (task refinement).

Refine a task's requirements through structured Q&A. Read the task's current state, identify
ambiguities and gaps in the acceptance criteria, and ask targeted questions to tighten the
spec. Updates the task's sections via `spur task update --section` after each Q&A round.

## When to use

- A task's requirements are vague or incomplete.
- Pre-planning refinement before decomposition.
- The operator says "refine this task" or "tighten the requirements."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |

## Behavior

Thin wrapper: task reading, gap analysis, Q&A, and section updates are all owned by the
skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `refine` operation directly.
