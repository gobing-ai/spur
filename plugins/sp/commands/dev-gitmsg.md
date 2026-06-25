---
description: Generate a conventional commit message from staged changes, optionally commit
argument-hint: "[--commit] [--scope <path>]"
allowed-tools: ["Bash", "Read"]
---

# Dev Gitmsg

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) for the authoritative reference.

Read staged changes and generate a conventional commit message: `type(scope): summary` with
an optional body listing key changes. By default, prints the message **and** a ready-to-copy
`git commit -m "..."` command line. Pass `--commit` to execute the commit directly.

## When to use

- Before committing, when a good message isn't obvious from the diff.
- The operator says "write a commit message" or "what should this commit say."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--scope <path>` | Limit diff analysis to a path | (all staged changes) |
| `--commit` | Execute `git commit` with the generated message. Without this flag, the command is read-only — prints the message for manual review. | off |

## Behavior

Inline procedure (no skill delegation):

1. Run `git diff --cached` (add `-- <path>` when `--scope` is given). If the diff is empty, report "no staged changes" and stop.
2. Analyze the diff: identify changed files, the nature of changes, and the primary scope.
3. Determine the commit type from the dominant change: `feat` (new functionality), `fix` (bug fix), `refactor` (restructuring), `docs` (documentation only), `chore` (build/config/tooling), `perf`, `test`, `style`.
4. Determine the scope from the affected module/package (e.g. `cli`, `domain`, `server`, `web`, `app`). Use `--scope` if given.
5. Generate the message: `<type>(<scope>): <summary>` with an optional body (bullet list of key changes, only if the diff is non-obvious). Summary: imperative mood, ≤72 chars, lowercase first word, no period.
6. **Always** print the full copy-paste-ready command line:
   ```
   git commit -m "<subject>
   
   <body>"
   ```
   Then, if `--commit` is set, execute it via `Bash`. Without `--commit`, stop after printing — the user reviews and copies.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg). No `Skill()` delegation.

**Arguments received:** `$ARGUMENTS`. Parse per the Arguments table above.

## Platform Notes

- **Claude Code:** native — `Bash` tool works directly.
- **Other platforms:** Run the git commands and message generation manually per the procedure above.
