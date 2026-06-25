---
description: Generate changelog from git commits
argument-hint: "[output-file] [--since <tag|commit>] [--until <tag|commit>] [--version <version>]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Changelog

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-changelog) for the authoritative reference.

Generate concise, user-friendly changelogs from git commits. Translates technical commits into customer-facing release notes.

## When to use

- Preparing a release — "generate the changelog for v1.2."
- After a wave of changes lands.
- The operator says "changelog" or "what changed since last release."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `output-file` | Output file path (positional, optional) | append to `CHANGELOG.md` |
| `--since <ref>` | Start reference — tag or commit | (most recent tag) |
| `--until <ref>` | End reference — tag or commit | HEAD |
| `--version <ver>` | Version number for the header | auto-detect from latest tag |

## Behavior

Inline procedure (no skill delegation). Three phases:

### Phase 1 — Gather Context

```bash
git log --oneline <since>..<until>
git diff --stat <since>..<until>
git tag --sort=-version:refname | head -1
```

Resolve `--since`: if not given, use the most recent tag (`git describe --tags --abbrev=0`). If no tags exist, use the repo root commit. Resolve `--version`: if not given, strip the leading `v` from the latest tag.

### Phase 2 — Analyze and Categorize

1. Scan commits in the specified range.
2. Categorize changes by conventional commit type.
3. Filter internal-only noise (pure refactors, chores, tests) — keep only user-facing changes.
4. Translate technical commit messages to user-friendly descriptions.

### Phase 3 — Generate and Write

Format as markdown and write to the output file:

```markdown
## [version] - YYYY-MM-DD

### New Features
- **Feature Name**: User-facing description

### Improvements
- **Improvement**: Customer benefit

### Bug Fixes
- Fixed issue description

### Breaking Changes
- Breaking change with migration notes

### Security
- Security fix description
```

If no `output-file` is given, append to `CHANGELOG.md`. If the file doesn't exist, create it.

## Categories and Commit Mapping

| Conventional Commit | Category |
|---------------------|----------|
| `feat` | New Features |
| `refactor`, `perf` | Improvements |
| `fix` | Bug Fixes |
| `feat!`, `BREAKING CHANGE` | Breaking Changes |
| `security` | Security |

## Error Handling

| Error | Resolution |
|-------|------------|
| Not a git repository | Run from the project root |
| Invalid tag or commit | Verify with `git tag -l` or `git log --oneline` |
| No commits in range | Check `--since` / `--until` values |
| Empty changelog | No user-facing commits in the range — print a note, don't write an empty file |

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-changelog). No `Skill()` delegation.

**Arguments received:** `$ARGUMENTS`. Parse per the Arguments table above.

## Platform Notes

- **Claude Code:** native — `Bash`/`Read`/`Write` tools work directly.
- **Other platforms:** Run the git commands and formatting manually per the procedure above.
