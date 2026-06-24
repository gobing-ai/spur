---
description: Generate a changelog from git commits between two refs
argument-hint: "[--from <ref>] [--to <ref>] [--format <style>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Changelog

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-changelog) for the authoritative reference.

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

Inline procedure (no skill delegation):

1. Resolve `--from`: if not given, use the most recent tag (`git describe --tags --abbrev=0`). If no tags exist, use the repo root commit.
2. Run `git log --oneline <from>..<to>`.
3. Parse each commit's conventional-commit prefix (`feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `test`, `style`, `ci`, `build`). Commits without a recognized prefix go under `Other`.
4. Group commits by type; within each group, list one bullet per commit: `- <summary> (<short-hash>)`.
5. Format as markdown:
   - `keepachangelog` (default): `## [<version>] - <date>` header, then `### Added` / `### Fixed` / `### Changed` / `### Removed` / `### Other` sections mapped from conventional-commit types.
   - `simple`: flat bulleted list grouped by type heading (`### feat`, `### fix`, …).
6. Print the changelog to stdout — never mutate `CHANGELOG.md` directly.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-changelog). No `Skill()` delegation.

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` substitution and `Bash` tool work directly.
- **Other platforms:** `$ARGUMENTS` is Claude-specific. Run the git commands and formatting manually per the procedure above.
