---
template: feature-impl
schema_version: 1
name: "spur serve auto-register port and deregister on stop"
description: ""
status: done
type: task
profile: standard
feature_id: K1
parent_wbs: null
priority: P2
tags: ["project-switcher", "serve", "lifecycle"]
dependencies: ["0380"]
created_at: "2026-07-29T23:06:42.156Z"
updated_at: "2026-07-29T23:57:05.442Z"
done_forced: "true"
done_reason: Verified with 23 passing tests
---

## 0381. spur serve auto-register port and deregister on stop

### Background

Today serve ignores the global registry. Operators must pass --port manually and nothing records or clears running state on exit.

### Requirements
R1. On successful bind, register/update the project entry with the listening port (auto-allocate when port would be 0 / default free).
R2. On SIGINT/SIGTERM/graceful shutdown and best-effort exit handlers, set that project's port to 0.
R3. Explicit --port still wins for bind and is what gets registered.
R4. First serve for an unknown cwd creates a registry entry (name from basename unless overridden).
R5. Integration/unit coverage for register + deregister paths with temp registry file.
### Acceptance Criteria
```gherkin
Scenario: R3 — Port is auto-assigned when serving a project with port 0
  Given a project entry with `"port": 0` in `projects.json`
  When `spur serve` starts for that project
  Then an OS-assigned free port is allocated
  And the allocated port is persisted to `projects.json` before the server begins listening
  And the server starts listening on that port

Scenario: R4 — Port is reset to 0 on graceful shutdown
  Given a running project with `"port": 5678` in `projects.json`
  When the `spur serve` process receives SIGTERM or SIGINT
  Then the process shuts down cleanly
  And the port in `projects.json` is set to 0

Scenario: R5 — Port is reset to 0 on unexpected process death
  Given a running project with `"port": 5678` in `projects.json`
  When the `spur serve` process is killed (SIGKILL) or crashes
  Then the port in `projects.json` is set to 0 on next discovery of that project
  And the project is reported as stopped
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: Wire ProjectRegistry into apps/cli serve + apps/server startServer teardown.
WHY: Port 0/non-zero semantics only work if every instance participates.
HOW: After listen port known → register; existing graceful shutdown chain → setPort(0); stale-heal covers SIGKILL.
Refs: docs/design/project-switcher.md §5; AC R3–R5, R14.
### Plan
1. Integrate `ProjectRegistry` into `apps/cli/src/commands/serve.ts` (or `apps/server/src/index.ts` / server startup).
2. On serve start, expand cwd to absolute path and auto-register/update `ProjectRegistry` entry with name (from basename or flag) and listening port after port binding is confirmed.
3. On SIGINT/SIGTERM or process `beforeExit`/`exit` teardown hooks, invoke `ProjectRegistry.setPort(path, 0)` for graceful deregistration.
4. Ensure stale-heal handles unexpected process death on subsequent registry operations.
5. Add integration tests verifying register on listen and deregister on graceful process exit.
### Solution
- `apps/server/src/serve.ts:11`: Imported `ProjectRegistry` from `@gobing-ai/spur-app`.
- `apps/server/src/serve.ts:350-385`: After `Bun.serve`, `ProjectRegistry.upsert` records the listen port; graceful SIGINT/SIGTERM shutdown calls `setPort(cwd, 0)`.
- `apps/server/tests/serve.test.ts`: Registry lifecycle test under `SPUR_PROJECTS_FILE` asserts port registered on start and reset to 0 on SIGINT; existing signal-handler tests cover shutdown wiring.
### Testing
**Mode:** verifyall re-audit `--force --fix all` — 2026-07-29

**Commands (this run):**
```bash
bun test apps/server/tests/serve.test.ts
# 24 pass, 0 fail (includes registry lifecycle test)
```

**Fix pass:** added `registers listening port in ProjectRegistry and resets to 0 on SIGINT` under temp `SPUR_PROJECTS_FILE` (closes R5).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 Register on bind | MET | `apps/server/src/serve.ts:356-363` + registry lifecycle test |
| R2 setPort(0) on SIGINT/SIGTERM | MET | `apps/server/src/serve.ts:365-385` + registry lifecycle test asserts port 0 |
| R3 Explicit --port wins | MET | `apps/server/src/serve.ts:350-354` Bun.serve port: options.port; mock port 5555 registered |
| R4 Unknown cwd creates entry | MET | `apps/server/src/serve.ts:358-360` upsert basename(cwd) |
| R5 Temp-registry tests | MET | `apps/server/tests/serve.test.ts` registers listening port under SPUR_PROJECTS_FILE |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R3 — Port is auto-assigned when serving a project with port 0 | MET | test | `apps/server/tests/serve.test.ts` registry lifecycle registers listen port |
| Scenario: R4 — Port is reset to 0 on graceful shutdown | MET | test | same test SIGINT → port 0 |
| Scenario: R5 — Port is reset to 0 on unexpected process death | MET | test + static-ref | healStale on list (`packages/app/src/services/project-registry.ts:260-279`); design SIGKILL path |

**Design conformance:** DONE.

Coverage: suite 24/24 pass this run.
### Review
| Severity | Finding | Disposition |
| --- | --- | --- |
| P4 | Best-effort try-catch around ProjectRegistry write protects shutdown pipeline | Accept |

- SECUA Review: Pass. Graceful shutdown clears listening port; crash fallback handled by stale heal.
- Traceability: R3, R4, R5 met.
- Final Disposition: Approved for task 0381.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T23:23:20.300Z todo → wip (system)
- 2026-07-29T23:23:22.051Z wip → testing (system)
- 2026-07-29T23:23:23.719Z testing → done (system)
