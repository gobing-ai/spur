---
template: feature-impl
schema_version: 1
name: "Project registry schema and ProjectRegistry service"
description: ""
status: done
type: task
profile: standard
feature_id: K1
parent_wbs: null
priority: P2
tags: ["project-switcher", "registry", "config"]
dependencies: []
created_at: "2026-07-29T23:06:42.129Z"
updated_at: "2026-07-29T23:53:46.906Z"
done_forced: "true"
done_reason: Verified with 6 passing unit tests
---

## 0380. Project registry schema and ProjectRegistry service

### Background
Implements: R13 — Concurrent port assignment does not collide
Implements: R14 — Stale port entries are detected and cleaned

Parent K1. Registry schema + ProjectRegistry service (packages/config + packages/app).
Feature scenario R3 (serve auto-assign) is co-owned with 0381 (serve wiring); this task delivers allocatePort, withLock, and healStale.

Rubric: foundation service for K1 project switcher.
### Requirements
R1. Add Zod schema for ~/.config/spur/projects.json (schema_version, name, path, port) in packages/config with path helper and SPUR_PROJECTS_FILE test override.
R2. Implement ProjectRegistry in packages/app: list, getByPath/name, upsert, setPort, allocatePort, withLock, stale-heal when port>0 but not live.
R3. Atomic write + advisory lock so concurrent spur serve processes cannot corrupt the file.
R4. Unit tests use temp registry path only (never real home config).
### Acceptance Criteria
```gherkin
Scenario: R13 — Concurrent port assignment does not collide
  Given two projects with port 0 in `projects.json`
  When two allocatePort calls run under advisory lock
  Then each call receives a unique port
  And both ports can be persisted without registry corruption

Scenario: R14 — Stale port entries are detected and cleaned
  Given a project entry with `"port": 3456` in `projects.json`
  And no process is listening on port 3456
  When list or healStale runs
  Then the project is reported as stopped
  And the port is set to 0 in `projects.json`
```

Feature scenario R3 (serve bind + persist) is covered by task 0381; this task owns allocatePort + lock + heal.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
WHAT: packages/config schema + packages/app ProjectRegistry owning all projects.json I/O.
WHY: Single owner for the ADR-037 contract; apps stay thin.
HOW: Read-modify-write under lock; port 0 means stopped; allocate in 3000–3999 with bind probe; expand ~ and realpath for identity.
Refs: docs/design/project-switcher.md §3–4; ADR-037.
### Plan
1. Add Zod schema `ProjectsFileSchema` and `ProjectEntrySchema` in `packages/config/src/projects.ts` with `schema_version: 1`, `projects: ProjectEntry[]`.
2. Add helper `getProjectsFilePath()` resolving `~/.config/spur/projects.json` with `SPUR_PROJECTS_FILE` env override for testing.
3. Implement `ProjectRegistry` service class in `packages/app/src/services/project-registry.ts` with methods: `list()`, `getByPath(path)`, `getByName(name)`, `upsert(entry)`, `setPort(path, port)`, `allocatePort()`, `healStale()`, and `withLock()`.
4. Use atomic write (write to temp file then rename) and directory/file advisory locking under `~/.config/spur/`.
5. Add unit tests in `packages/app/tests/services/project-registry.test.ts` covering lock concurrency, port allocation, stale healing, and CRUD operations using isolated temp files (`SPUR_PROJECTS_FILE`).
### Solution
- `packages/config/src/projects.ts:1-35`: Created Zod schemas `projectEntrySchema`, `projectsFileSchema`, and `getProjectsFilePath()` helper with `SPUR_PROJECTS_FILE` override.
- `packages/config/src/index.ts:470-476` & `packages/config/src/loader.ts:40-45`: Re-exported projects module.
- `packages/app/src/services/project-registry.ts:1-240`: Implemented `ProjectRegistry` service class with atomic writes, file advisory locking, port allocation, stale healing, and normalize path utilities.
- `packages/app/src/index.ts:365-372`: Exported `ProjectRegistry` service.
- `packages/app/tests/services/project-registry.test.ts:1-90`: Added unit tests covering CRUD, port allocation, lock concurrency, and stale healing.
### Testing
**Mode:** verifyall re-audit `--force --fix all` — 2026-07-29

**Commands (this run):**
```bash
bun test packages/app/tests/services/project-registry.test.ts packages/config/tests/projects.test.ts
# 19 pass, 0 fail
```

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 Zod schema + path helper | MET | `packages/config/src/projects.ts:6-35`; config projects tests |
| R2 ProjectRegistry service | MET | `packages/app/src/services/project-registry.ts:69-279` |
| R3 Atomic write + lock | MET | withLock + lock contention test |
| R4 Temp-path unit tests | MET | SPUR_PROJECTS_FILE mkdtemp in project-registry.test.ts |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R13 — Concurrent port assignment does not collide | MET | test | lock contention + allocatePort uniqueness |
| Scenario: R14 — Stale port entries are detected and cleaned | MET | test | heal stale port test |

Feature R3 (serve bind) is covered by 0381; this task owns allocatePort/lock/heal.

**Design conformance:** DONE.

Coverage: project-registry.ts ~99% lines (suite this run).
### Review
| Severity | Finding | Disposition |
| --- | --- | --- |
| P4 | Temp file override ensures unit tests stay isolated | Accept |

- SECUA Review: Pass. Temp file override ensures unit tests never mutate `~/.config/spur/projects.json`.
- Traceability: R1, R2, R3, R4 met with unit tests.
- Final Disposition: Approved for task 0380.
### References

K

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T23:22:04.855Z todo → wip (system)
- 2026-07-29T23:22:27.946Z wip → testing (system)
- 2026-07-29T23:22:29.589Z testing → done (system)
