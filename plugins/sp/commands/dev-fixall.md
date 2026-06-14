---
description: Fix all lint, type, and test errors systematically across the working tree
argument-hint: "[--scope <path>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Fixall

Wraps the **sp:spur-dev** skill (fix cycle).

Run the full fix cycle: lint → typecheck → test, collecting all failures, then fix each
systematically. Re-runs the gates after each fix batch. Stops when all three gates are
green.

## When to use

- After a batch of changes, the lint/type/test gates are red.
- Pre-commit cleanup — "fix everything before I commit."
- The operator says "fix all errors" or "clean up the build."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--scope <path>` | Limit fixes to a file or directory | (entire working tree) |

## Behavior

Thin wrapper: error collection, categorization, fix application, and re-run loop are all
owned by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="fixall $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `fixall` operation directly.
