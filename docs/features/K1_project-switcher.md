---
schema_version: 1
id: "K1"
name: "Project switcher"
status: done
priority: P2
tags: []
created_at: "2026-07-29T22:49:06.406Z"
updated_at: "2026-07-29T23:57:27.012Z"
---

# K1: Project switcher

## Goal
Enable seamless multi-project workflows through a project switcher in the Spur Board
top-left corner. Users discover, switch between, and auto-start Spur projects from a
single browser tab without remembering port numbers or managing terminal windows per
project.
## Scope
- In:
  - `~/.config/spur/projects.json` registry tracking project name, path, port, and run state
  - `spur projects` CLI noun: `add`, `remove`, `list`, `start`, `stop`
  - Auto-assigned port on first `spur serve` when port is 0 (OS-assigned free port)
  - Graceful shutdown port reset (set to 0) on intentional stop and process death
  - Web frontend project-switcher UI component: dropdown on top-left project name click
  - Running/stopped state indicators per project in the dropdown menu
  - Auto-start on selecting a stopped project; navigate on selecting a running one
  - `/api/projects` endpoint for the frontend to query and switch projects
  - Concurrent port assignment safety (file-lock on `projects.json` writes)
  - Design accommodates future launchd service model (clean port lifecycle)
- Out:
  - launchd/.plist integration (deferred to future stage)
  - Single-server multi-project mount model (separate architectural decision)
  - Cross-project data aggregation or unified dashboards
## Acceptance Criteria
```gherkin
Feature: Project switcher

@core
Scenario: R1 — Switching between running projects
  Given projects "Spur" (port 3000) and "Superskill" (port 5678) are both running
  And the Spur Board is open for "Spur"
  When the user clicks the project name in the top-left corner
  Then a dropdown menu appears listing both projects
  And each project shows a "running" indicator
  And the user selects "Superskill" from the dropdown
  And the browser navigates to `http://localhost:5678`
  And the Superskill board is displayed

@core
Scenario: R2 — Auto-starting a stopped project from the switcher
  Given project "ts-libs" is registered with port 0 (stopped)
  And no `spur serve` instance is running for ts-libs
  When the user opens the project switcher and selects "ts-libs"
  Then a `spur serve` instance starts for ts-libs on an auto-assigned port
  And the assigned port is written to `~/.config/spur/projects.json`
  And the browser navigates to the new instance
  And the Spur Board for ts-libs is displayed

@core
Scenario: R3 — Port is auto-assigned when serving a project with port 0
  Given a project entry with `"port": 0` in `projects.json`
  When `spur serve` starts for that project
  Then an OS-assigned free port is allocated
  And the allocated port is persisted to `projects.json` before the server begins listening
  And the server starts listening on that port

@core
Scenario: R4 — Port is reset to 0 on graceful shutdown
  Given a running project with `"port": 5678` in `projects.json`
  When the `spur serve` process receives SIGTERM or SIGINT
  Then the process shuts down cleanly
  And the port in `projects.json` is set to 0

@core
Scenario: R5 — Port is reset to 0 on unexpected process death
  Given a running project with `"port": 5678` in `projects.json`
  When the `spur serve` process is killed (SIGKILL) or crashes
  Then the port in `projects.json` is set to 0 on next discovery of that project
  And the project is reported as stopped

@core
Scenario: R6 — Adding a project to the registry via CLI
  Given a Spur project at `~/xprojects/my-project` with a valid `.spur/` directory
  When the user runs `spur projects add ~/xprojects/my-project --name "My Project"`
  Then the project is added to `~/.config/spur/projects.json` with port 0
  And the project appears in the web switcher dropdown

@core
Scenario: R7 — Removing a project from the registry via CLI
  Given "My Project" is registered in `projects.json`
  When the user runs `spur projects remove "My Project"`
  Then the project is removed from `projects.json`
  And the project no longer appears in the web switcher dropdown

@core
Scenario: R8 — Listing all registered projects via CLI
  Given projects "Spur" (port 3000, running) and "ts-libs" (port 0, stopped) are registered
  When the user runs `spur projects list`
  Then the output includes "Spur" with port 3000 and a running indicator
  And the output includes "ts-libs" with port 0 and a stopped indicator

@core
Scenario: R9 — Starting a project via CLI
  Given "ts-libs" is registered with port 0 (stopped)
  When the user runs `spur projects start "ts-libs"`
  Then a `spur serve` instance starts for ts-libs on an auto-assigned port
  And the port is updated in `projects.json`
  And the project is reported as running

@core
Scenario: R10 — Stopping a project via CLI
  Given "Spur" is registered and running on port 3000
  When the user runs `spur projects stop "Spur"`
  Then the `spur serve` process on port 3000 is terminated
  And the port in `projects.json` is set to 0
  And the project is reported as stopped

@core
Scenario: R11 — API returns project list with run state
  Given projects "Spur" (port 3000, running) and "ts-libs" (port 0, stopped) are registered
  When the frontend calls `GET /api/projects`
  Then the response includes an array of project objects
  And each object has `name`, `path`, `port`, and `running` fields
  And "Spur" has `"running": true` and `"port": 3000`
  And "ts-libs" has `"running": false` and `"port": 0`

@core
Scenario: R12 — Project switcher shows running and stopped indicators
  Given projects "Spur" (running) and "ts-libs" (stopped) are registered
  When the user opens the project switcher dropdown
  Then "Spur" displays a running indicator (e.g., green dot)
  And "ts-libs" displays a stopped indicator (e.g., grey dot)

@edge
Scenario: R13 — Concurrent port assignment does not collide
  Given two projects with port 0 in `projects.json`
  When two `spur serve` instances start simultaneously
  Then each instance receives a unique port
  And both ports are correctly persisted in `projects.json`

@edge
Scenario: R14 — Stale port entries are detected and cleaned
  Given a project entry with `"port": 3456` in `projects.json`
  And no process is listening on port 3456
  When the project switcher or CLI checks project states
  Then the project is reported as stopped
  And the port is set to 0 in `projects.json`
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0380 | Project registry schema and ProjectRegistry service | done |
| 0381 | spur serve auto-register port and deregister on stop | done |
| 0382 | spur projects CLI noun (add remove list start stop) | done |
| 0383 | HTTP GET /api/projects and POST /api/projects/start | done |
| 0384 | Board ProjectSwitcher UI in LeftSidebar | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-07-29T23:10:14.187Z moved K → L (system)
- 2026-07-29T23:10:17.239Z moved L → K1 (system)
- 2026-07-29T23:26:53.003Z backlog → active (system)
- 2026-07-29T23:26:56.788Z active → verifying (system)
- 2026-07-29T23:57:27.012Z verifying → done (system)
