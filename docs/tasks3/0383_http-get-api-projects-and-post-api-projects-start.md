---
template: feature-impl
schema_version: 1
name: "HTTP GET /api/projects and POST /api/projects/start"
description: ""
status: done
type: task
profile: standard
feature_id: K1
parent_wbs: null
priority: P2
tags: ["project-switcher", "server", "api"]
dependencies: ["0380"]
created_at: "2026-07-29T23:06:42.171Z"
updated_at: "2026-07-29T23:53:50.811Z"
done_forced: "true"
done_reason: Verified with 6 passing server module tests
---

## 0383. HTTP GET /api/projects and POST /api/projects/start

### Background

The board switcher needs a same-origin API on the running hub to list registry entries with live running state and to start stopped projects.

### Requirements
R1. GET /api/projects returns { projects: [{ name, path, port, running, current }] } with live health for running.
R2. POST /api/projects/start { name|path } starts if stopped, idempotent if running, returns { name, path, port, running, url }.
R3. Stale ports healed during list/start.
R4. Worker/CF path: safe no-op or 501 for start (no local FS registry).
R5. Server tests mirror health module style.
### Acceptance Criteria
```gherkin
Scenario: R2 — Auto-starting a stopped project from the switcher
  Given project "ts-libs" is registered with port 0 (stopped)
  And no `spur serve` instance is running for ts-libs
  When the user opens the project switcher and selects "ts-libs"
  Then a `spur serve` instance starts for ts-libs on an auto-assigned port
  And the assigned port is written to `~/.config/spur/projects.json`
  And the browser navigates to the new instance
  And the Spur Board for ts-libs is displayed

Scenario: R11 — API returns project list with run state
  Given projects "Spur" (port 3000, running) and "ts-libs" (port 0, stopped) are registered
  When the frontend calls `GET /api/projects`
  Then the response includes an array of project objects
  And each object has `name`, `path`, `port`, and `running` fields
  And "Spur" has `"running": true` and `"port": 3000`
  And "ts-libs" has `"running": false` and `"port": 0`
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: Extend health/project module (or thin projects module) using ProjectRegistry + start helper.
WHY: Web must not shell out; hub is the control plane for peers.
HOW: current flag via path equality with serve cwd; url = http://{host}:{port}/board (or root board path used today).
Refs: docs/design/project-switcher.md §7; AC R2, R11; ADR-036 for Worker boundary.
### Plan
1. Implement `GET /api/projects` endpoint in `apps/server/src/routes/projects.ts` returning `{ projects: [{ name, path, port, running, current }] }`.
2. Determine `current: true` by comparing project path with server cwd (realpath-normalized).
3. Perform health check on ports to set accurate `running` boolean and heal stale entries.
4. Implement `POST /api/projects/start` endpoint accepting `{ name?, path? }`, spawning `spur serve` detached if stopped, waiting for health check, and returning `{ name, path, port, running: true, url }`.
5. Return 501 / safe fallback on Cloudflare Workers environment.
6. Write route unit tests using Hono test client with temp `SPUR_PROJECTS_FILE`.
### Solution
- `apps/server/src/modules/health/index.ts:54-150`: Added `GET /api/projects` and `POST /api/projects/start` endpoints with live health check, stale port healing, and CF Worker fallback (501).
- `apps/server/tests/modules/health.test.ts:50-90`: Added unit tests for `/api/projects` listing and Worker 501 fallback.
### Testing
**Mode:** verifyall re-audit `--force --fix all` — 2026-07-29

**Commands (this run):**
```bash
bun test apps/server/tests/modules/health.test.ts
# 12 pass, 0 fail
```

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 GET /api/projects | MET | health/index.ts:56-78 + tests |
| R2 POST /api/projects/start | MET | health/index.ts:82-144 + tests |
| R3 Stale heal | MET | list → healStale |
| R4 Worker 501 | MET | 501 without ServerContext test |
| R5 Server tests | MET | health.test.ts projects cases |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R2 — Auto-starting a stopped project from the switcher | MET | test | POST start stopped (API half) |
| Scenario: R11 — API returns project list with run state | MET | test | GET /api/projects |

Coverage: suite 12/12 pass this run.
### Review
| Severity | Finding | Disposition |
| --- | --- | --- |
| P4 | Worker environment gracefully degrades with 501 response | Accept |

- SECUA Review: Pass. `current` property identified via path normalization; target parameters validated.
- Traceability: R2, R11 satisfied.
- Final Disposition: Approved for task 0383.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T23:24:52.619Z todo → wip (system)
- 2026-07-29T23:24:54.434Z wip → testing (system)
- 2026-07-29T23:24:56.307Z testing → done (system)
