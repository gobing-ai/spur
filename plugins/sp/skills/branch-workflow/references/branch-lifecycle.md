---
name: branch-lifecycle
description: "Full branch lifecycle with per-phase git commands, branch-naming conventions, and merge-strategy guidance."
see_also:
  - branch-workflow
---

# Branch Lifecycle — Full Reference

## Naming conventions

| Type | Prefix | Example |
|------|--------|---------|
| Feature | `feature/` | `feature/oauth-callback-handler` |
| Bug fix | `fix/` | `fix/null-check-login-session` |
| Refactor | `refactor/` | `refactor/extract-auth-middleware` |
| Documentation | `docs/` | `docs/api-endpoint-guide` |
| Chore | `chore/` | `chore/update-dependencies` |

Slug rules: lowercase, hyphenated, ≤50 chars, derived from task title. No WBS numbers in branch names — they're neither stable nor descriptive.

## Per-phase commands

### Create

```bash
git checkout main && git pull --rebase    # Start from latest main
git checkout -b feature/my-feature        # Create and switch
```

### Commit

```bash
git add <files>                           # Stage one concern at a time
git commit -m "feat(auth): add OAuth callback handler"  # Conventional commit
```

### Self-review

Run `sp:code-review` pre-commit checklist. Fix issues. Amend or add follow-up commits.

### Push

```bash
git push -u origin feature/my-feature     # First push sets upstream
```

### Merge

```bash
git checkout main && git pull --rebase    # Update main
git merge --no-ff feature/my-feature      # Merge with history preservation
git push                                  # Push the merge commit
```

**Merge strategy:** `--no-ff` (no fast-forward) always — it preserves the feature branch as a visible unit in history, making it easy to revert the entire feature if needed. Squash merges lose per-commit granularity; rebase merges rewrite history. `--no-ff` is the safe default.

### Cleanup

```bash
git branch -d feature/my-feature          # Delete local (safe — refuses if unmerged)
git push origin --delete feature/my-feature  # Delete remote
```

## Worktree integration

See [worktree-patterns.md](worktree-patterns.md) for the full parallel-branch workflow.
