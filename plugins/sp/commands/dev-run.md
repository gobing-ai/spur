---
description: Run a task through the execution pipeline — precheck → implement → test → review → approve(HITL) → verify → record → done
argument-hint: "<wbs> [--auto]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Run

Wraps the **sp:spur-dev** skill (execution half).

Pick a task and run it through `config/workflows/task-pipeline.yaml`. The pipeline drives
the full work loop: precheck, implement, test, review, HITL approval, verification, and
record. The skill monitors the run, surfaces HITL gates to the operator, and handles
continuation.

## When to use

- A task is ready to execute ("run 0042").
- Continuing a paused pipeline run.
- The operator says "run this task" or "execute the task."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--auto` | Skip the HITL approval gate | (pauses for approval) |

## Behavior

Thin wrapper: task selection, pipeline invocation via `spur workflow run`, HITL surfacing,
and continuation logic are all owned by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="run $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `run` operation directly.
