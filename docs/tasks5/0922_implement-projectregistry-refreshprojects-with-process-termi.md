---
schema_version: 1
name: Implement ProjectRegistry.refreshProjects with process termination
status: todo
template: feature-impl
created_at: 2026-09-22T18:13:57.826Z
updated_at: "2026-09-22T18:13:57.834Z"
feature_id: K3
priority: P2
tags:
  - projects
  - registry
  - cleanup
  - process
estimate_hours: 2

---

## 0922. Implement ProjectRegistry.refreshProjects with process termination

### Background

When git worktrees created via slash commands (--worktree) are deleted or merged, their registered paths in ~/.config/spur/projects.json remain as orphaned ghost entries. If spur serve was running, the process can remain active on the listening port even after the directory is gone. ProjectRegistry needs a dedicated refreshProjects method to prune missing directories and terminate processes on occupied ports.

### Requirements

- [ ] R1. Implement refreshProjects on ProjectRegistry in packages/app to verify project directory existence and remove non-existent entries atomically.
- [ ] R2. When removing a non-existent project entry whose port > 0, verify port occupancy, discover the listening process ID, and terminate the process cleanly.

### Acceptance Criteria

- [ ] AC1 — Purge non-existent project directories from registry (req: R1)
- [ ] AC2 — Terminate lingering processes on occupied ports for purged projects (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

### WHAT
Add refreshProjects(options?: { terminateProcesses?: boolean }): Promise<RefreshProjectsResult> to ProjectRegistry in packages/app/src/services/project-registry.ts.

### WHY
Provides the core business logic for purging deleted project directories and killing lingering serve processes before they cause port collisions.

### WHERE
packages/app/src/services/project-registry.ts and packages/app/tests/services/project-registry.test.ts.

### IMPLEMENTATION DETAILS
1. Under withLock, read projects.json.
2. For each project, check existsSync(normalizeProjectPath(entry.path)).
3. For missing paths with port > 0, probe isPortLive(entry.port). If live, discover PID via lsof -t -iTCP:${port} -sTCP:LISTEN (or fuser fallback), guard against self/parent PID, send SIGTERM, wait up to 2s, and SIGKILL if still live.
4. Remove missing entries and atomically save data.

### Plan

- [ ] 1. Add port listener PID resolution helper in project-registry.ts (filtering self and parent).
- [ ] 2. Implement process termination sequence (SIGTERM, bounded wait, SIGKILL fallback).
- [ ] 3. Implement refreshProjects method with atomic locking and directory existence validation.
- [ ] 4. Write unit tests in packages/app/tests/services/project-registry.test.ts verifying missing path removal and process termination.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
