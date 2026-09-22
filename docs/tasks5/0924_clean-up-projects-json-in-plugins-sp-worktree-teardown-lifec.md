---
schema_version: 1
name: Clean up projects.json in plugins/sp worktree teardown lifecycles
status: done
template: feature-impl
created_at: 2026-09-22T18:13:57.831Z
updated_at: "2026-09-22T18:41:37.427Z"
feature_id: K3
priority: P2
tags:
  - plugins/sp
  - worktree
  - teardown
  - governance
estimate_hours: 2

dependencies: ["0923"]
---

## 0924. Clean up projects.json in plugins/sp worktree teardown lifecycles

### Background

When slash commands run with --worktree (dev-run, dev-runall, dev-refineall, dev-verifyall), worktrees are created and may run spur serve. In execution-batch.md WT-4, worktrees are removed with git worktree remove, but projects.json was never updated.plugins/sp must be enhanced so worktree teardown explicitly cleans up projects.json.

### Requirements

- [x] R1. Update execution-batch.md WT-4 create-mode teardown to remove the worktree from ~/.config/spur/projects.json upon merge or deletion.
- [x] R2. Review plugins/sp worktree patterns and scripts to ensure all worktree deletion paths deregister projects.json entries.
- [x] R3. Add or update contract tests in plugins/sp verifying worktree teardown registry cleanup.

### Acceptance Criteria

- [x] AC4 — Cleanup projects.json on worktree removal across plugins/sp (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### WHAT
Enhance WT-4 and WT-5 in execution-batch.md and worktree references to include spur projects remove <worktree-path> or spur projects clean during worktree teardown.

#### WHY
Closes the lifecycle gap where worktree deletion left zombie entries in projects.json.

#### WHERE
plugins/sp/skills/spur-dev/references/execution-batch.md, plugins/sp/skills/branch-workflow/references/worktree-patterns.md, and plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts.

#### IMPLEMENTATION DETAILS
1. In WT-4 create-mode script, add spur projects remove "$WT_PATH" (or bun run apps/cli/src/index.ts projects clean) right after process cleanup and before/after git worktree remove.
2. Pin the requirement in execution-batch-contract.test.ts.
3. Update worktree-patterns.md to document project deregistration alongside worktree removal.

### WHAT
Enhance WT-4 and WT-5 in execution-batch.md and worktree references to include spur projects remove <worktree-path> or spur projects clean during worktree teardown.

### WHY
Closes the lifecycle gap where worktree deletion left zombie entries in projects.json.

### WHERE
plugins/sp/skills/spur-dev/references/execution-batch.md, plugins/sp/skills/branch-workflow/references/worktree-patterns.md, and plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts.

### IMPLEMENTATION DETAILS
1. In WT-4 create-mode script, add spur projects remove "$WT_PATH" (or bun run apps/cli/src/index.ts projects clean) right after process cleanup and before/after git worktree remove.
2. Pin the requirement in execution-batch-contract.test.ts.
3. Update worktree-patterns.md to document project deregistration alongside worktree removal.

### Plan

- [x] 1. Review plugins/sp references, skills, and commands for worktree creation and removal seams.
- [x] 2. Update WT-4 in plugins/sp/skills/spur-dev/references/execution-batch.md to execute projects cleanup.
- [x] 3. Update branch-workflow worktree references to document projects registry cleanup.
- [x] 4. Add static contract pin in plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts.

### Solution

- plugins/sp/skills/spur-dev/references/execution-batch.md:746: added WT-4c teardown step invoking `spur projects remove "$WT_PATH" || spur projects clean` following worktree removal.
- plugins/sp/skills/spur-dev/references/execution-batch.md:833: updated WT-5 discard instructions to run `spur projects remove <worktree-path>`.
- plugins/sp/skills/branch-workflow/references/worktree-patterns.md:49, :87: added `spur projects remove` in removal and disk space reclamation instructions.
- plugins/sp/skills/branch-workflow/SKILL.md:84: documented deregistration from projects.json on worktree cleanup.
- plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:95: added static contract pins verifying WT-4 and WT-5 projects.json deregistration.

### Testing

- Commands run:
  - `bun test plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`: 13 passed, 0 failed.
  - `bun run lint`: 1057 files checked, 0 errors, 0 warnings; typecheck all workspaces passed.
  - `bun run test-pre-check`: 47 rules passed, 0 violations.
- Outcomes:
  - AC4 verified: worktree teardown paths in `execution-batch.md` (WT-4, WT-5) and `branch-workflow` documentation explicitly deregister worktree paths from `~/.config/spur/projects.json`, backed by static contract test pins.

### Review

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Correctness | plugins/sp/skills/spur-dev/references/execution-batch.md:746 | Verified worktree removal teardown deregisters entries from ~/.config/spur/projects.json across plugins/sp |

- Findings: None (P1-P4 clean).
- SECUA: Security (least privilege, non-destructive registry cleanup), Error-handling (fallback to spur projects clean or graceful ignore on unregistered paths), Correctness (consistent worktree lifecycle cleanup), Architecture (aligned with ADR-091 and multi-project registry invariants).
- Disposition: Approved.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-22T18:38:57.145Z todo → wip (system)
- 2026-09-22T18:41:15.974Z wip → testing (system)
- 2026-09-22T18:41:37.427Z testing → done (system)
