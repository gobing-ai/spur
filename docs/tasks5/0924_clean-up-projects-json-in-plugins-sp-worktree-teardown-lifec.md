---
schema_version: 1
name: Clean up projects.json in plugins/sp worktree teardown lifecycles
status: todo
template: feature-impl
created_at: 2026-09-22T18:13:57.831Z
updated_at: "2026-09-22T18:16:07.007Z"
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

- [ ] R1. Update execution-batch.md WT-4 create-mode teardown to remove the worktree from ~/.config/spur/projects.json upon merge or deletion.
- [ ] R2. Review plugins/sp worktree patterns and scripts to ensure all worktree deletion paths deregister projects.json entries.
- [ ] R3. Add or update contract tests in plugins/sp verifying worktree teardown registry cleanup.

### Acceptance Criteria

- [ ] AC4 — Cleanup projects.json on worktree removal across plugins/sp (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

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

- [ ] 1. Review plugins/sp references, skills, and commands for worktree creation and removal seams.
- [ ] 2. Update WT-4 in plugins/sp/skills/spur-dev/references/execution-batch.md to execute projects cleanup.
- [ ] 3. Update branch-workflow worktree references to document projects registry cleanup.
- [ ] 4. Add static contract pin in plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
