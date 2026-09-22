---
schema_version: 1
name: Integrate refreshProjects into registry list and spur projects CLI
status: done
template: feature-impl
created_at: 2026-09-22T18:13:57.830Z
updated_at: "2026-09-22T18:38:48.864Z"
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

- [x] R1. Call refreshProjects during ProjectRegistry.list so any project query self-heals stale entries.
- [x] R2. Add spur projects clean (and refresh alias) command to apps/cli with --json support.
- [x] R3. Update CLI documentation and references for the clean and refresh commands.

### Acceptance Criteria

- [x] AC3 — Automatic refresh on project listing and explicit CLI verb (req: R1, R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

#### WHAT
Wire ProjectRegistry.list to call refreshProjects(), and register spur projects clean and refresh in apps/cli/src/commands/projects.ts.

#### WHY
Ensures automated maintenance whenever projects are listed and provides an operator verb for on-demand cleanup.

#### WHERE
packages/app/src/services/project-registry.ts, apps/cli/src/commands/projects.ts, and plugins/sp/skills/spur-cli/references/projects.md.

#### IMPLEMENTATION DETAILS
1. Update ProjectRegistry.list() to call this.refreshProjects() instead of just healStale().
2. Add clean and refresh command definitions to projectsCmd in apps/cli/src/commands/projects.ts supporting --json and standard envelopes.
3. Add test coverage in apps/cli/tests/commands/projects.test.ts.

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

- [x] 1. Wire refreshProjects into ProjectRegistry.list in packages/app/src/services/project-registry.ts.
- [x] 2. Register projects clean and refresh command in apps/cli/src/commands/projects.ts.
- [x] 3. Update plugins/sp/skills/spur-cli/references/projects.md with the new CLI verbs.
- [x] 4. Write CLI tests in apps/cli/tests/commands/projects.test.ts.

### Solution

- packages/app/src/services/project-registry.ts:392: updated `ProjectRegistry.list()` to invoke `await this.refreshProjects()` before `healStale()`, ensuring any listing query self-heals stale directories and lingering processes.
- packages/app/src/services/project-registry.ts:18: augmented `RefreshProjectsResult` with `purgedProjects` and `terminatedProcesses` convenience properties for CLI consistency.
- apps/cli/src/commands/projects.ts:99: registered `spur projects clean` with alias `refresh`, supporting `--no-terminate-processes`, `--json`, and `--json-envelope`.
- plugins/sp/skills/spur-cli/references/projects.md:21: documented `clean` / `refresh` in Verb map and updated Registry behavior documentation.
- apps/cli/tests/commands/projects.test.ts:564: added tests verifying `clean --json`, `refresh` text output, process termination reporting, and `--json-envelope`.
- packages/app/tests/services/project-registry.test.ts:170: added test verifying `list()` purges non-existent project directories automatically.

### Testing

- Commands run:
  - `bun test tests/services/project-registry.test.ts` in `packages/app`: 28 pass, 0 fail.
  - `bun test tests/commands/projects.test.ts` in `apps/cli`: 20 pass, 0 fail.
  - `bun run lint`: 1057 files checked, 0 errors, 0 warnings; typecheck all workspaces passed.
  - `bun run test-pre-check`: 47 rules passed, 0 violations.
- Outcomes:
  - AC3 verified: `ProjectRegistry.list()` automatically purges non-existent project directories, and `spur projects clean` (and `refresh`) provides an explicit CLI interface with `--json` / `--json-envelope` support.

### Review

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Correctness | apps/cli/src/commands/projects.ts:99 | Full implementation of clean and refresh alias with envelope compatibility and self-healing list |

- Findings: None (P1-P4 clean).
- SECUA: Security (PID termination safely avoids self/parent), Error-handling (graceful envelope reporting on error with internal error code), Correctness (atomic directory pruning and process cleanup on list and clean), Usability (clear human output and standard machine envelope), Architecture (clean separation between apps/cli transport and packages/app domain services).
- Disposition: Approved.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-22T18:34:22.686Z todo → wip (system)
- 2026-09-22T18:38:13.230Z wip → testing (system)
- 2026-09-22T18:38:48.864Z testing → done (system)
