---
schema_version: 1
name: Implement ProjectRegistry.refreshProjects with process termination
status: done
template: feature-impl
created_at: 2026-09-22T18:13:57.826Z
updated_at: "2026-09-22T18:34:14.551Z"
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

- [x] R1. Implement refreshProjects on ProjectRegistry in packages/app to verify project directory existence and remove non-existent entries atomically.
- [x] R2. When removing a non-existent project entry whose port > 0, verify port occupancy, discover the listening process ID, and terminate the process cleanly.

### Acceptance Criteria

- [x] AC1 — Purge non-existent project directories from registry (req: R1)
- [x] AC2 — Terminate lingering processes on occupied ports for purged projects (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### WHAT
Add refreshProjects(options?: { terminateProcesses?: boolean }): Promise<RefreshProjectsResult> to ProjectRegistry in packages/app/src/services/project-registry.ts.

#### WHY
Provides the core business logic for purging deleted project directories and killing lingering serve processes before they cause port collisions.

#### WHERE
packages/app/src/services/project-registry.ts and packages/app/tests/services/project-registry.test.ts.

#### IMPLEMENTATION DETAILS
1. Under withLock, read projects.json.
2. For each project, check existsSync(normalizeProjectPath(entry.path)).
3. For missing paths with port > 0, probe isPortLive(entry.port). If live, discover PID via lsof -t -iTCP:${port} -sTCP:LISTEN (or fuser fallback), guard against self/parent PID, send SIGTERM, wait up to 2s, and SIGKILL if still live.
4. Remove missing entries and atomically save data.

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

- [x] 1. Add port listener PID resolution helper in project-registry.ts (filtering self and parent).
- [x] 2. Implement process termination sequence (SIGTERM, bounded wait, SIGKILL fallback).
- [x] 3. Implement refreshProjects method with atomic locking and directory existence validation.
- [x] 4. Write unit tests in packages/app/tests/services/project-registry.test.ts verifying missing path removal and process termination.

### Solution

- packages/app/src/services/project-registry.ts:550: implemented `refreshProjects(options?: RefreshProjectsOptions): Promise<RefreshProjectsResult>` to verify project directories exist on disk, remove missing entries under `withLock`, probe occupied ports, and terminate lingering processes (SIGTERM -> bounded wait -> SIGKILL).
- packages/app/src/services/project-registry.ts:50: added `findListeningPid` using `NodeProcessExecutor` (`lsof`/`fuser`), filtering `process.pid` and `process.ppid`. Added test overrides `setProcessHelpersForTests`.
- packages/app/src/index.ts:390: exported new types and helpers (`RefreshProjectsResult`, `RefreshProjectsOptions`, `TerminatedProcessInfo`, `findListeningPid`, `sendSignalToPid`, `setProcessHelpersForTests`).
- packages/app/tests/services/project-registry.test.ts:354: added comprehensive unit tests for `refreshProjects` verifying directory purging, process termination with SIGTERM and SIGKILL escalation, `terminateProcesses: false` flag, and PID filtering.

### Testing

- Commands run:
  - `bun test tests/services/project-registry.test.ts` (packages/app): 27 passed, 0 failed.
  - `bun run lint`: 1057 files checked, 0 errors, 0 warnings.
  - `bun run test-pre-check`: 47 rules passed, 0 violations.
- Outcomes:
  - AC1 verified: missing directory purged from registry while existing project preserved.
  - AC2 verified: lingering process on occupied port terminated cleanly; escalates to SIGKILL on timeout.

### Review

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Correctness | packages/app/src/services/project-registry.ts:550 | All R1/R2 requirements met, clean process termination and atomic lock handling |

- Findings: None (P1-P4 clean).
- SECUA: Security (PID safety guard against self/ppid), Error-handling (graceful fallback between lsof and fuser, bounded wait), Correctness (atomic file locking during directory existence check and removal), Architecture (NodeProcessExecutor seam compliant).
- Disposition: Approved.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-22T18:26:29.958Z todo → wip (system)
- 2026-09-22T18:31:59.835Z wip → testing (system)
- 2026-09-22T18:34:14.551Z testing → done (system)
