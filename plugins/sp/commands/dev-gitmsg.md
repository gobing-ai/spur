---
description: Generate a conventional commit message from staged changes
argument-hint: "[--scope <path>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Gitmsg

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-gitmsg) for the authoritative reference.

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

Inline procedure (no skill delegation):

1. Run `git diff --cached` (add `-- <path>` when `--scope` is given). If the diff is empty, report "no staged changes" and stop.
2. Analyze the diff: identify changed files, the nature of changes, and the primary scope.
3. Determine the commit type from the dominant change: `feat` (new functionality), `fix` (bug fix), `refactor` (restructuring), `docs` (documentation only), `chore` (build/config/tooling), `perf`, `test`, `style`.
4. Determine the scope from the affected module/package (e.g. `cli`, `domain`, `server`, `web`, `app`). Use `--scope` if given.
5. Generate the message: `<type>(<scope>): <summary>` with an optional body (bullet list of key changes, only if the diff is non-obvious). Summary: imperative mood, ≤72 chars, lowercase first word, no period.
6. Print the message to stdout — never run `git commit`.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#10-gitmsg). No `Skill()` delegation.

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` substitution and `Bash` tool work directly.
- **Other platforms:** `$ARGUMENTS` is Claude-specific. Run the git commands and message generation manually per the procedure above.
