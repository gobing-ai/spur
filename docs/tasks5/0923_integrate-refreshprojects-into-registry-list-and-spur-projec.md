---
schema_version: 1
name: Integrate refreshProjects into registry list and spur projects CLI
status: todo
template: feature-impl
created_at: 2026-09-22T18:13:57.830Z
updated_at: "2026-09-22T18:16:06.697Z"
feature_id: K3
priority: P2
tags:
  - projects
  - cli
  - auto-heal
estimate_hours: 2

dependencies: ["0922"]
---

## 0923. Integrate refreshProjects into registry list and spur projects CLI

### Background

The refreshProjects logic must be wired into regular operations so that ~/.config/spur/projects.json stays fresh without manual editing. Calling it during ProjectRegistry.list ensures self-healing on every project list query or board switcher load. An explicit spur projects clean command gives operators a direct CLI tool to purge stale entries and report terminated processes.

### Requirements

- [ ] R1. Call refreshProjects during ProjectRegistry.list so any project query self-heals stale entries.
- [ ] R2. Add spur projects clean (and refresh alias) command to apps/cli with --json support.
- [ ] R3. Update CLI documentation and references for the clean and refresh commands.

### Acceptance Criteria

- [ ] AC3 — Automatic refresh on project listing and explicit CLI verb (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

### WHAT
Wire ProjectRegistry.list to call refreshProjects(), and register spur projects clean and refresh in apps/cli/src/commands/projects.ts.

### WHY
Ensures automated maintenance whenever projects are listed and provides an operator verb for on-demand cleanup.

### WHERE
packages/app/src/services/project-registry.ts, apps/cli/src/commands/projects.ts, and plugins/sp/skills/spur-cli/references/projects.md.

### IMPLEMENTATION DETAILS
1. Update ProjectRegistry.list() to call this.refreshProjects() instead of just healStale().
2. Add clean and refresh command definitions to projectsCmd in apps/cli/src/commands/projects.ts supporting --json and standard envelopes.
3. Add test coverage in apps/cli/tests/commands/projects.test.ts.

### Plan

- [ ] 1. Wire refreshProjects into ProjectRegistry.list in packages/app/src/services/project-registry.ts.
- [ ] 2. Register projects clean and refresh command in apps/cli/src/commands/projects.ts.
- [ ] 3. Update plugins/sp/skills/spur-cli/references/projects.md with the new CLI verbs.
- [ ] 4. Write CLI tests in apps/cli/tests/commands/projects.test.ts.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
