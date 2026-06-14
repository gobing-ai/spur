---
description: Plan a feature from a description — intake → feature create → AC generation → feature check gate → decomposition → batch-create
argument-hint: "\"<description>\" [--feature <id>] [--parent <feature-id>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Plan

Wraps the **sp:spur-dev** skill (planning half).

Convert a feature description into a validated feature file with BDD acceptance criteria
and a decomposed, CLI-validated task batch. The planning-half pipeline: intake →
`spur feature create` → AC generation → `spur feature check` gate loop → decomposition →
`task-batch.schema.json` gate → `spur task batch-create`. Every write is CLI-gated; no
corpus mutation occurs until each gate passes.

## When to use

- A feature description arrives and needs structured planning.
- A feature exists but needs decomposition into tasks.
- The operator says "plan this" or "create tasks for this feature."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `description` | Feature description (required, positional) | (required) |
| `--feature <id>` | Plan tasks for an existing feature instead of creating one | (creates new) |
| `--parent <feature-id>` | Parent feature for hierarchical ID allocation | (top-level) |

## Behavior

Thin wrapper: intake Q&A, feature creation/selection, AC generation, the two CLI gates,
and decomposition are all owned by the skill. This command parameterizes the planning-half
entry point.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="plan $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `plan` operation directly and pass the description/flags as
  arguments in chat.
