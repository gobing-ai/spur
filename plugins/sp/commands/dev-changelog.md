---
description: Generate a changelog from git commits between two refs
argument-hint: "[--from <ref>] [--to <ref>] [--format <style>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Changelog

Wraps the **sp:spur-dev** skill (changelog generation).

Generate a structured changelog from git history between two refs. Groups commits by
conventional-commit type (feat, fix, refactor, docs, chore) and produces a markdown
changelog suitable for `CHANGELOG.md` or release notes.

## When to use

- Preparing a release — "generate the changelog for v1.2."
- After a wave of changes lands.
- The operator says "changelog" or "what changed since last release."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--from <ref>` | Starting ref | (last tag) |
| `--to <ref>` | Ending ref | HEAD |
| `--format <style>` | Output style: `keepachangelog` or `simple` | `keepachangelog` |

## Behavior

Thin wrapper: git log extraction, commit grouping, and markdown formatting are all owned
by the skill.

## Implementation

Delegates to **sp:spur-dev** skill:

```
Skill(skill="sp:spur-dev", args="changelog $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:spur-dev` skill's `changelog` operation directly.
