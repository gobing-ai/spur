---
description: Generate a conventional commit message from staged changes
argument-hint: "[--scope <path>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Gitmsg

Wraps the **sp:spur-dev** skill (commit message generation).

Read staged changes and generate a conventional commit message: `type(scope): summary` with
an optional body listing key changes. The skill reads the diff and produces the message;
this command is the thin entry point.

## When to use

- Before committing, when a good message isn't obvious from the diff.
- The operator says "write a commit message" or "what should this commit say."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--scope <path>` | Limit diff analysis to a path | (all staged changes) |

## Behavior

Thin wrapper: diff reading, conventional-commit formatting, and message generation are all
owned by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="gitmsg $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `gitmsg` operation directly.
