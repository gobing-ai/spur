---
name: branch-workflow
description: "Branch lifecycle discipline: create, worktree, commit, self-review, merge, cleanup."
disable-model-invocation: true
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - create-branch
    - worktree
    - merge-prep
    - cleanup
see_also:
  - sp:spur-dev
---

# sp:branch-workflow — Branch Lifecycle & Worktrees

The branch-lifecycle discipline: create → worktree (optional) → commit → self-review → merge → cleanup. This skill teaches the agent how to manage git branches cleanly alongside the Spur task lifecycle.

## The branch lifecycle

### 1. Create

```bash
git checkout -b feature/<slug>   # or fix/<slug>, refactor/<slug>
```

Branch naming: `feature/`, `fix/`, `refactor/`, `docs/`, `chore/` — match the conventional commit type. Slug is the task title, lowercased, hyphenated, ≤50 chars.

### 2. Worktree (optional — parallel branches)

A git worktree gives you an isolated working directory for a branch without stashing or switching:

```bash
git worktree add ../<project>-<branch> <branch>
cd ../<project>-<branch>
```

**When to use worktrees:**
- Two parallel features that you switch between frequently
- Hotfix isolation — fix on `main` while feature work stays on its branch
- Review-in-progress — keep the review branch available while starting new work

**When NOT to use:**
- Single-branch workflow (overhead isn't worth it)
- Disk-space constrained environments (each worktree is a full checkout)
- CI/CD environments (ephemeral checkouts already handle this)

### 3. Commit

Atomic, conventional commits. One concern per commit.

```bash
git add <files for one concern>
git commit -m "feat(scope): summary"
```

### 4. Self-review

Run `sp:code-review`'s pre-commit self-review checklist before pushing. Fix findings before requesting review.

### 5. Merge

```bash
git checkout main
git pull --rebase
git merge --no-ff feature/<slug>   # --no-ff preserves the feature branch history
git push
```

### 6. Cleanup

```bash
git branch -d feature/<slug>        # Delete merged branch
git worktree remove ../<project>-feature-<slug>  # Remove worktree if used
git worktree prune                  # Clean up stale worktree references
```

## When to use

- Starting new work on a feature or fix.
- Managing parallel branches with git worktrees.
- Preparing to merge and cleaning up afterward.
- The operator says "start a branch", "create a worktree", or "merge this."

Do **not** use this skill for:
- Task lifecycle management — that is `sp:spur-dev`.
- Commit message generation — that is `/sp:dev-gitmsg`.
- Code review — that is `sp:code-review`.

## References

| Reference | Covers |
|-----------|--------|
| [branch-lifecycle.md](references/branch-lifecycle.md) | Full lifecycle with per-phase git commands, naming conventions, merge strategies |
| [worktree-patterns.md](references/worktree-patterns.md) | Worktree creation, parallel-branch strategies, cleanup, disk-space awareness |

## See also

- **`sp:spur-dev`** — the task lifecycle that runs alongside branch lifecycle.
- **`sp:code-review`** — pre-merge self-review workflow.
