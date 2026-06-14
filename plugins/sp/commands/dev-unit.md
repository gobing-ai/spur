---
description: Run unit tests for a task — extend or generate tests until the coverage target is met
argument-hint: "<wbs> [--coverage <pct>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Unit

Wraps the **sp:spur-dev** skill (execution half — test phase).

Run or extend unit tests for a task. The test phase of the execution pipeline: measure
coverage, identify gaps, generate targeted tests, re-run until the coverage target is met.
Delegates test generation to the skill; the skill delegates deterministic measurement to
CLI tools.

## When to use

- A task needs test coverage ("add tests for 0042").
- The pipeline's test phase needs focused attention.
- Coverage gap surfacing and targeted test extension.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--coverage <pct>` | Coverage target percentage | (project default) |

## Behavior

Thin wrapper: coverage measurement, gap analysis, test generation, and re-run loop are
all owned by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="unit $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `unit` operation directly.
