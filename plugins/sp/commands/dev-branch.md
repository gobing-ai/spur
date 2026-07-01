---
description: Branch lifecycle management — create branches, isolate work in git worktrees, merge prep, and cleanup
argument-hint: "<action> [name] [--worktree] [--agent <name|auto>]"
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---

# Dev Branch

Wraps the **sp:branch-workflow** skill.

Manage the git branch lifecycle: create feature branches, optionally isolate work in git worktrees for parallel development, commit atomically, self-review before merge, and clean up after merge.

## When to use

- Starting new work — "create a branch for this feature."
- Switching between parallel features — "create a worktree for the hotfix."
- Preparing to merge — "finish this branch and merge to main."
- The operator says "start a branch", "create a worktree", or "finish this branch."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `action` | `create` — new branch. `finish` — merge prep + merge + cleanup. `cleanup` — delete merged branch + prune worktrees. | (required) |
| `name` | Branch slug (for `create`) or worktree path (for `cleanup`) | (derived from task title for `create`) |
| `--worktree` | Create an isolated git worktree for the branch (only with `create`) | off |
| `--agent <name\|auto>` | Spawn under a specific agent | (current session) |

## Behavior

Thin wrapper: delegates to `sp:branch-workflow` which owns the branch lifecycle (create → worktree → commit → self-review → merge → cleanup). Git commands are executed inline; no subprocess spawn needed.

## Implementation

```
Skill(skill="sp:branch-workflow", args="<action> <name>")
```

## See Also

- **sp:branch-workflow** — the backing competency skill (branch lifecycle, worktree patterns).
- **sp:code-review** — pre-merge self-review workflow.
- **/sp:dev-gitmsg** — conventional commit message generation.
