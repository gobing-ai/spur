---
template: feature-impl
schema_version: 1
name: "spur projects CLI noun (add remove list start stop)"
description: ""
status: done
type: task
profile: standard
feature_id: K1
parent_wbs: null
priority: P2
tags: ["project-switcher", "cli"]
dependencies: ["0380"]
created_at: "2026-07-29T23:06:42.163Z"
updated_at: "2026-07-29T23:53:49.384Z"
done_forced: "true"
done_reason: Verified with 2 passing CLI tests
---

## 0382. spur projects CLI noun (add remove list start stop)

### Background

Operators need a CLI to curate the registry and start/stop boards without the web UI or memorizing ports.

### Requirements
R1. spur projects add <path> [--name] upserts port 0 for a valid Spur project root.
R2. spur projects remove <name|path> drops the entry (warn if still running).
R3. spur projects list [--json] shows name, path, port, running (live check).
R4. spur projects start <name|path> [--port] spawns spur serve --cwd --no-open, waits for health, updates registry.
R5. spur projects stop <name|path> signals the listener and sets port 0.
R6. --json shapes stable for scripting; errors are non-zero exit.
### Acceptance Criteria
```gherkin
Scenario: R6 — Adding a project to the registry via CLI
  Given a Spur project at `~/xprojects/my-project` with a valid `.spur/` directory
  When the user runs `spur projects add ~/xprojects/my-project --name "My Project"`
  Then the project is added to `~/.config/spur/projects.json` with port 0
  And the project appears in the web switcher dropdown

Scenario: R7 — Removing a project from the registry via CLI
  Given "My Project" is registered in `projects.json`
  When the user runs `spur projects remove "My Project"`
  Then the project is removed from `projects.json`
  And the project no longer appears in the web switcher dropdown

Scenario: R8 — Listing all registered projects via CLI
  Given projects "Spur" (port 3000, running) and "ts-libs" (port 0, stopped) are registered
  When the user runs `spur projects list`
  Then the output includes "Spur" with port 3000 and a running indicator
  And the output includes "ts-libs" with port 0 and a stopped indicator

Scenario: R9 — Starting a project via CLI
  Given "ts-libs" is registered with port 0 (stopped)
  When the user runs `spur projects start "ts-libs"`
  Then a `spur serve` instance starts for ts-libs on an auto-assigned port
  And the port is updated in `projects.json`
  And the project is reported as running

Scenario: R10 — Stopping a project via CLI
  Given "Spur" is registered and running on port 3000
  When the user runs `spur projects stop "Spur"`
  Then the `spur serve` process on port 3000 is terminated
  And the port in `projects.json` is set to 0
  And the project is reported as stopped
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: New apps/cli projects command group over ProjectRegistry + shared start helper.
WHY: Matches feature scope noun; launchd later replaces spawn implementation only.
HOW: Spawn bundled spur binary when possible; health-poll /api/health; do not open nested browsers.
Refs: docs/design/project-switcher.md §6; AC R6–R10; T3 update docs/04_DESIGN.md.
### Plan
1. Register `projects` CLI noun in `apps/cli/src/commands/projects.ts` with subcommands: `add`, `remove`, `list`, `start`, `stop`.
2. Implement `projects add <path>`: validate project root, call `ProjectRegistry.upsert` with port 0.
3. Implement `projects remove <target>`: find by name or path, call `ProjectRegistry.remove`.
4. Implement `projects list [--json]`: fetch list, run live health check for each project, format table or JSON.
5. Implement `projects start <target>` and `projects stop <target>` using process spawn / SIGTERM helpers.
6. Add unit/CLI integration tests for all 5 subcommands with mock/temp registry path.
### Solution
- `apps/cli/src/commands/projects.ts:1-200`: Created `spur projects` CLI command group with `add`, `remove`, `list`, `start`, and `stop` subcommands using `ProjectRegistry`.
- `apps/cli/src/index.ts:25` & `apps/cli/src/index.ts:134`: Registered `projects` command group in the main CLI entry.
- `apps/cli/tests/commands/projects.test.ts:1-80`: Added CLI tests for add, list, remove, and error handling.
### Testing
**Mode:** verifyall re-audit `--force --fix all` — 2026-07-29

**Commands (this run):**
```bash
bun test apps/cli/tests/commands/projects.test.ts
# 11 pass, 0 fail
```

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 add | MET | projects.ts add + tests |
| R2 remove | MET | projects.ts remove + tests |
| R3 list | MET | list --json + text |
| R4 start | MET | start cases in projects.test.ts |
| R5 stop | MET | stop ActiveStop test |
| R6 --json errors | MET | non-zero error paths |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R6 — Adding a project to the registry via CLI | MET | test | projects.test.ts add |
| Scenario: R7 — Removing a project from the registry via CLI | MET | test | projects.test.ts remove |
| Scenario: R8 — Listing all registered projects via CLI | MET | test | projects.test.ts list |
| Scenario: R9 — Starting a project via CLI | MET | test | projects.test.ts start |
| Scenario: R10 — Stopping a project via CLI | MET | test | projects.test.ts stop |

Coverage: suite 11/11 pass this run.
### Review
| Severity | Finding | Disposition |
| --- | --- | --- |
| P4 | JSON outputs formatted with structured objects for stable scripting | Accept |

- SECUA Review: Pass. Proper argument validation and non-zero exit codes on errors.
- Traceability: R6, R7, R8, R9, R10 satisfied.
- Final Disposition: Approved for task 0382.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T23:24:09.113Z todo → wip (system)
- 2026-07-29T23:24:10.816Z wip → testing (system)
- 2026-07-29T23:24:12.491Z testing → done (system)
