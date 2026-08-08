---
name: worktree-patterns
description: "Git worktree patterns — when to use worktrees, creation/cleanup, parallel-branch strategies, and disk-space awareness."
see_also:
  - branch-workflow
  - branch-lifecycle
---

# Git Worktree Patterns

A git worktree gives you an isolated working directory linked to the same repository. Each worktree has its own checked-out branch — no stashing, no `git switch` churn.

## When to use worktrees

| Scenario | Worktree? | Why |
|----------|-----------|-----|
| Two parallel features | ✅ Yes | Switch instantly between isolated directories |
| Hotfix while feature in progress | ✅ Yes | Fix on main worktree, feature stays untouched |
| Review in progress | ✅ Yes | Keep review branch available while starting new work |
| Single-branch workflow | ❌ No | Overhead of managing extra directory isn't worth it |
| CI/CD | ❌ No | Ephemeral checkouts already handle isolation |
| Disk-constrained (<2GB free) | ❌ No | Each worktree costs ~500MB–2GB |

## Commands

### Create

```bash
git worktree add ../project-hotfix hotfix/critical-fix
cd ../project-hotfix && bun install --frozen-lockfile
```

The worktree directory is created alongside the main project. Name it `<project>-<branch>` for clarity.

A fresh worktree has no `node_modules` (gitignored), so the first `bun test` or typecheck fails on the first workspace import. Run `bun install --frozen-lockfile` immediately after creation so the worktree matches `bun.lock`.

### List

```bash
git worktree list
```

Shows all worktrees with their branches and paths.

### Remove (when done)

```bash
git worktree remove ../project-hotfix
```

### Prune (clean up stale references)

```bash
git worktree prune
```

Removes references to worktrees whose directories were manually deleted.

## Parallel-branch strategy

When running two branches in parallel:

```
~/projects/my-project/           (main branch, feature A work in progress)
~/projects/my-project-feature-b/ (feature B in isolated worktree)
```

1. Create feature B worktree.
2. Work on feature B in its isolated directory.
3. Commit and push from the worktree.
4. When switching back to feature A: `cd ~/projects/my-project` — no stash, no switch.
5. Remove worktree when feature B is merged.

## Disk-space awareness

Each worktree is a full checkout (~500MB–2GB depending on project size). Check disk space before creating:

```bash
df -h .   # Check available space
```

After removing a worktree, run `git worktree prune` and `git gc` to reclaim space:

```bash
git worktree remove ../old-worktree
git worktree prune
git gc --aggressive
```

## `spur` on PATH is not this checkout

`spur` (`~/.bun/bin/spur`) resolves to a *published* bundle in `~/node_modules/`, not to the repo you are standing in and not to the worktree. `resolveSpurBin()` propagates whichever binary you entered through into `vars.spurBin`, which the `task-lifecycle.yaml` guards run as `$spurBin task check` — so one wrong entry point silently gate-checks against the published bundle.

Inside a worktree, and in the monorepo whenever CLI behavior is under test, invoke the tree's own source:

```bash
cd "<worktree>" && bun apps/cli/src/index.ts task check <wbs> --json
```

Confirm isolation by making a distinctive change in the worktree and checking that the command reflects it.
