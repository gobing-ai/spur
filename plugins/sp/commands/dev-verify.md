---
description: Verify a task against its requirements — traceability check that all acceptance criteria are satisfied
argument-hint: "<wbs>"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Verify

Wraps the **sp:spur-dev** skill (execution half — verification phase).

Verify that a task's implementation satisfies all its acceptance criteria. The verification
phase of the execution pipeline: requirements traceability, scenario-coverage mapping,
section-completeness check. Produces a pass/fail verdict with per-criterion evidence.

## When to use

- A task is marked done and needs acceptance verification.
- The pipeline's verify phase needs focused attention.
- The operator says "verify this" or "check the requirements."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |

## Behavior

Thin wrapper: AC extraction, evidence gathering, traceability mapping, and verdict are all
owned by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="verify $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `verify` operation directly.
