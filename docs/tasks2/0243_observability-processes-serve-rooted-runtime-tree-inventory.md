---
template: feature-impl
schema_version: 1
name: "Observability Processes: serve-rooted runtime tree inventory"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-12T07:33:24.696Z"
updated_at: "2026-07-12T07:40:15.968Z"
---

## 0243. Observability Processes: serve-rooted runtime tree inventory

### Background
## Why

Observability → Processes is empty for most operators. It only lists `SupervisorService`
team agents via `GET /api/team/processes`, which exist only after `SPUR_TEAM_AUTOSTART` or
`spur team start`. That matches G2 team supervision but fails as a daily “what is Spur
running?” surface.

## Current behavior (code)

- Web: `apps/web/src/modules/observability/ProcessListTab.tsx` → `GET /api/team/processes`
- Server: `apps/server/src/modules/team/index.ts` maps `supervisor.list()` only
- Registry: `packages/app/src/services/supervisor-service.ts` tracks supervised agents only
- Empty UX explicitly points at `SPUR_TEAM_AUTOSTART` / `spur team start`

## Goal

Refactor Processes into a **read-only inventory of the spur serve process and all OS
descendants**, with core metrics and a light Spur overlay (supervisor agent labels).
Team control APIs (`/api/team/*` start/stop/stdin/stream) stay unchanged.

## Source decisions

Brainstorm: `docs/plans/2026-07-12-observability-processes-runtime-tree-brainstorm.md`
(Approach 1 ⭐). Related features: **J** (board module), **G2** (team supervision control plane).
### Requirements
- [ ] R1. `ProcessInventoryService` (or equivalent) in `packages/app` builds a serve-rooted process inventory: OS walk of descendants of `process.pid` plus overlay from `SupervisorService.list()` (match by pid → `source=supervisor`, `label`/`agentId`). Root row is `source=serve`.
- [ ] R2. Platform support: **macOS + Linux** via `ps` (or equivalent) with a tested stdout parser and golden fixtures. Unsupported OS returns a structured error (fail loud), not a silent empty list.
- [ ] R3. New read API: `GET /api/observability/processes` returns a flat list of rows with at least: `pid`, `ppid`, `depth` (or enough parent links for indent), `source` (`serve` | `supervisor` | `descendant`), optional `agentId`/`label`, `command` (may be truncated), `status`, `rssBytes` (or documented unit), duration/elapsed (and/or `startedAt` when available), plus `rootPid` and `capturedAt` at the envelope. **Do not** break or overload `GET /api/team/processes`.
- [ ] R4. v1 columns **exclude** threads and %CPU (follow-up). No host-wide scan of shell `spur` CLIs outside the serve tree (follow-up). No new ProcessExecutor live registry in ts-runtime (overlay only existing supervisor data).
- [ ] R5. `ProcessListTab` consumes the new endpoint: table (not “no supervised processes” empty when serve is up), shows ≥1 root row when serve is reachable, polls on an interval (~2–5s) and cancels on unmount. Read-only — no start/stop/attach controls in this task.
- [ ] R6. Tests: parser fixtures (macOS + Linux sample `ps` output); service unit tests with a fake process inspector; web tab tests for rows / loading / error / empty-of-children-but-root-present; server route smoke if pattern exists nearby.
- [ ] R7. Docs surface: same-commit note in `docs/04_DESIGN.md` (or design satellite) for the new endpoint shape (T3). Reference brainstorm path in References.
### Acceptance Criteria
```gherkin
Feature: Serve-rooted process inventory on Observability Processes

  @core
  Scenario: R1 Serve root is always listed when Board reaches a live server
    Given spur serve is running and the Observability Processes tab is open
    When the tab loads process inventory
    Then at least one row for the serve process is shown with source serve

  @core
  Scenario: R2 Descendant processes appear without team autostart
    Given spur serve has one or more child processes and SPUR_TEAM_AUTOSTART is unset
    When GET /api/observability/processes is requested
    Then the response includes the serve root and those descendants with pid, ppid, command, and memory

  @core
  Scenario: R3 Supervised agents are labeled in the inventory
    Given a supervised team agent is running under serve
    When the process inventory is built
    Then the agent process row has source supervisor and its agentId label
    And GET /api/team/processes still lists the supervised entry for control clients

  @core
  Scenario: R4 Processes tab is not blank solely because team autostart is off
    Given no supervised agents are running
    When the operator opens Observability → Processes
    Then the UI does not show only the SPUR_TEAM_AUTOSTART empty message
    And the serve process row is visible

  @core
  Scenario: R5 Unsupported platform fails loud
    Given the process inspector cannot run on the host OS
    When GET /api/observability/processes is requested
    Then the API returns a structured error (not an empty success list)

  @edge
  Scenario: R6 Poll refresh updates the table without leaking requests
    Given the Processes tab is mounted
    When the poll interval elapses
    Then the table refetches inventory
    And unmounting the tab cancels in-flight work
```
### Q&A

| Q | A |
| --- | --- |
| Primary show? | Serve-rooted runtime tree (not host-wide, not team-only) |
| Discovery? | OS walk + registry overlay |
| API? | New `/api/observability/processes` |
| Columns? | Core ops set (no threads/CPU v1) |
| ProcessExecutor? | Overlay existing supervisor only |
| Refresh/controls? | Poll; read-only tab |
| Platforms? | macOS + Linux |
| Approach? | ProcessInventoryService + flat rows |


Task AC scenarios are **new capability** beyond feature J’s original shell/events/inbox AC
and beyond G2’s “supervised list only” Process List. L4 DD-09 subset warnings vs feature J
are expected until J (or a child feature) AC is extended. Implement against this task’s AC.
### Design
## Chosen approach

**ProcessInventoryService + flat rows** (brainstorm Approach 1).

| Concern | Decision |
| --- | --- |
| Population | OS tree from serve PID + Supervisor overlay |
| API | New `GET /api/observability/processes`; team routes unchanged |
| Layering | Inventory logic in `packages/app`; server is thin transport (ADR-021) |
| UI | Rewrite `ProcessListTab` to table + poll; read-only |
| Platforms | macOS + Linux; fail loud else |
| Out of v1 | Host CLI scan, threads/CPU, ts-runtime process table, attach UI |

## Impacted surfaces

- `packages/app` — new inventory service + process inspector port/adapter
- `apps/server` — mount observability processes route; wire supervisor + inspector
- `apps/web` — `ProcessListTab.tsx` (+ tests under `apps/web/tests/modules/observability/`)
- `docs/04_DESIGN.md` — endpoint surface (T3)
- **Non-impact:** `/api/team/*` control semantics; G2 attach/stdin

## Invariants

1. Observe ≠ control: inventory never replaces team start/stop/stream.
2. Success list is never empty when serve itself is the root (root always included).
3. Parser failures and unsupported OS are errors, not silent [].
4. No deep imports across workspace packages; use `@gobing-ai/*`.

## Key risks

- `ps` column differences macOS vs Linux → fixture-driven parser tests.
- RSS units (KB vs pages) → normalize to bytes in the DTO and document.
- Short-lived children may miss a poll window — acceptable for v1.
### Plan
1. [ ] Add process inspector port + macOS/Linux `ps` adapter with golden fixtures
2. [ ] Implement `ProcessInventoryService` (tree walk from root pid + supervisor overlay)
3. [ ] Mount `GET /api/observability/processes` on server; wire deps from context
4. [ ] Rewrite `ProcessListTab` (table columns, poll, loading/error, root-always UX)
5. [ ] Unit/integration/web tests per R6
6. [ ] Update `docs/04_DESIGN.md` surface note; link brainstorm in task References
7. [ ] `bun run lint` + targeted tests green before done
### Solution
| File:line | What / why |
| --- | --- |
| `packages/app/src/services/process-inspector.ts:40-135` | `ps` parser + platform port; fail-loud unsupported OS |
| `packages/app/src/services/process-inventory-service.ts:62-163` | Serve-rooted tree + supervisor overlay → inventory DTO |
| `packages/app/src/index.ts` | Export inventory/inspector public API |
| `apps/server/src/modules/observability/index.ts:12-30` | `GET /api/observability/processes` (200 / 501 / 500) |
| `apps/server/src/modules/registry.ts:24-33` | Register observability builtin module |
| `apps/server/src/context.ts` (`processInventory`) | Lazy inventory wired to `ps` + `supervisor().list()` |
| `apps/web/src/modules/observability/ProcessListTab.tsx:1-209` | Table + 3s poll over new endpoint; core columns |
| `docs/04_DESIGN.md` §7.8a | Surface contract for the new API |

**Why:** Daily-useful Processes tab without team autostart; G2 `/api/team/*` control plane unchanged. ProcessExecutor live registry deferred.
### Testing
**Commands (this turn)**

```
bun test packages/app/tests/services/process-inspector.test.ts \
  packages/app/tests/services/process-inventory-service.test.ts \
  apps/server/tests/modules/observability/index.test.ts \
  apps/server/tests/modules/registry.test.ts \
  apps/server/tests/context.test.ts \
  apps/web/tests/modules/observability/components.test.tsx
→ 82 pass, 0 fail
```

Coverage: unit suites for inventory + inspector at 100% line on those files in the targeted run; full monorepo coverage gate not re-run (scoped verification).

**Per-requirement traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 ProcessInventoryService tree + overlay | MET | `process-inventory-service.ts:62-163`; test overlays supervisor by pid |
| R2 macOS+Linux ps parser / fail loud | MET | `process-inspector.ts:40-135`; fixtures + win32 throws |
| R3 GET /api/observability/processes | MET | `observability/index.ts:18-28`; team routes untouched |
| R4 exclusions (no threads/CPU/host scan/registry) | MET | Design + DTO fields; no threads/CPU columns in UI |
| R5 ProcessListTab table + poll | MET | `ProcessListTab.tsx:28-76`; web tests root without team empty-state |
| R6 tests | MET | 82 pass targeted suite above |
| R7 docs/04_DESIGN §7.8a | MET | `docs/04_DESIGN.md` process inventory surface |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 Serve root always listed | MET | test | `process-inventory-service.test.ts` root; `context.test.ts` live snapshot includes serve |
| R2 Descendants without autostart | MET | test | inventory tree filter excludes siblings; includes children |
| R3 Supervised agents labeled | MET | test | overlay sets source=supervisor + agentId |
| R4 Tab not blank without autostart | MET | test | web: serve root without supervised empty copy |
| R5 Unsupported platform fails loud | MET | test | API 501 UNSUPPORTED_PLATFORM |
| R6 Poll refresh / unmount cancel | MET | static-ref | `ProcessListTab.tsx:68-76` interval + AbortController cleanup |

**Design conformance:** Approach 1 DONE (app service, flat rows, new API, read-only poll UI).
### Review
**Disposition:** PASS — ship task 0243 scope.

| Priority | Finding | Status |
| --- | --- | --- |
| P1 | None | — |
| P2 | None | — |
| P3 | None | — |
| P4 | Host-wide shell `spur` CLIs invisible by design; threads/%CPU deferred; ProcessExecutor registry overlay deferred | OPEN → follow-up |

**SECUA (summary):** no secrets/injection in process listing path; parser fails loud; observe≠control preserved; residual risk is `ps` drift on exotic hosts (fixtures cover macOS/Linux samples).
### References
- Feature **J** — Observabilities board module
- Feature **G2** — Team process supervision (control plane; unchanged)
- Brainstorm: `docs/plans/2026-07-12-observability-processes-runtime-tree-brainstorm.md`
- Prior: task 0210 Process List tab; `SupervisorService`; `ProcessListTab.tsx`
- System-events audit note: CLI-driven work is outside serve bus (host scan = follow-up)
### History
- 2026-07-12T07:39:24.843Z todo → wip (system)
- 2026-07-12T07:39:39.912Z wip → testing (system)
- 2026-07-12T07:40:15.968Z testing → done (system)
