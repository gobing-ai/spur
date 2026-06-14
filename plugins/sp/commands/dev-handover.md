---
description: Generate a structured handover document when blocked — captures goal, progress, blocker, rejected approaches, and next steps
argument-hint: "\"<blocker description>\""
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Handover

Wraps the **sp:spur-dev** skill (handover generation).

When blocked on a task, generate a structured handover document capturing: the goal,
progress so far, the blocker (what is stuck and why), approaches tried and rejected, and
concrete next steps for the next agent. Writes to the task's `## Notes` or a standalone
handover file.

## When to use

- A task is blocked and needs to be handed off.
- Token limits, expertise mismatch, or capacity require work transfer.
- The operator says "hand this off" or "write a handover."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `blocker` | What is blocking progress (required, positional) | (required) |

## Behavior

Thin wrapper: context gathering, blocker documentation, and handover formatting are all
owned by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="handover $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `handover` operation directly.
