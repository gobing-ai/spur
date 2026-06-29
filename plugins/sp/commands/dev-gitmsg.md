---
description: Generate conventional commit message(s) from staged changes via per-file summarization, optionally commit
argument-hint: "[--commit] [--squash] [--scope <path>]"
allowed-tools: ["Bash", "Read"]
---

# Dev Gitmsg

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) for the authoritative reference.

Read staged changes, summarize each changed file in one sentence, group the files by concern, and
generate a conventional commit message (`type(scope): summary`) per group. By default, prints the
message(s) **and** a ready-to-copy `git commit -m "..."` line. A staging that spans several concerns
yields one message per group plus a split recommendation; `--squash` collapses them into one.

## When to use

- Before committing, when a good message isn't obvious from the diff.
- The operator says "write a commit message" or "what should this commit say."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--scope <path>` | Limit diff analysis to a path | (all staged changes) |
| `--commit` | Execute `git commit` with the generated message. Without this flag, the command is read-only — prints the message for manual review. On a multi-group staging (without `--squash`), `--commit` **refuses** and prints the split guidance instead. | off |
| `--squash` | Collapse all concerns into one combined message (dominant type/scope, per-file body bullets). Makes `--commit` proceed on a mixed staging. No-op on a single-concern diff. | off |

## Behavior

Inline procedure (no skill delegation):

1. **Outline.** Run `git diff --cached --stat` (add `-- <path>` when `--scope` is given) to see the shape of the change. If empty, report "no staged changes" and stop.
2. **Capture the full diff to a temp file** so the analysis reads from disk rather than a huge inline blob:
   ```bash
   TEMP_FILE="/tmp/gitdiff_$(date +%s)"
   git diff --cached > "$TEMP_FILE" 2>&1      # add `-- <path>` when --scope is given
   echo "Diff saved to $TEMP_FILE"
   ```
3. **Summarize per file.** Read `$TEMP_FILE` and write one sentence describing what changed in each file (the *what* and the *why*, not a line count).
4. **Group by concern.** Cluster the per-file sentences into groups, each a single coherent concern. For each group derive:
   - **type** — `feat` (new functionality), `fix` (bug fix), `refactor` (restructuring), `docs` (documentation only), `chore` (build/config/tooling), `perf`, `test`, `style`.
   - **scope** — the affected module/package (`cli`, `domain`, `server`, `web`, `app`, …); use `--scope` if given.
   - **message** — `<type>(<scope>): <summary>` with an optional body (bullets from the group's per-file sentences, only when the change is non-obvious). Summary: imperative mood, ≤72 chars, lowercase first word, no period.
5. **Resolve groups → output:**
   - **One group:** print the message + the copy-paste `git commit -m` line. With `--commit`, execute it.
   - **Multiple groups (default):** print one message per group, then a split recommendation (stage per concern with `git add -p`/per-path and re-run). With `--commit` (no `--squash`), **do not commit** — explain why and print the split guidance. `git commit` would land all staged files as one commit, which can't honor per-group messages.
   - **`--squash`:** collapse every group into one combined message — dominant type/scope, body listing the per-file sentences. With `--commit --squash`, commit all staged files as that one message.
6. **Always** print the full copy-paste-ready command line for the resolved message:
   ```
   git commit -m "<subject>

   <body>"
   ```
   Then, if `--commit` is set (and the group/`--squash` rule above permits), execute it via `Bash`.
7. **Clean up.** `rm "$TEMP_FILE"` once the message is generated — leave no `/tmp` diff residue.

## Implementation

Implements the inline procedure defined in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg). No `Skill()` delegation.

**Arguments received:** `$ARGUMENTS`. Parse per the Arguments table above.

## Platform Notes

- **Claude Code:** native — `Bash` tool works directly.
- **Other platforms:** Run the git commands and message generation manually per the procedure above.
