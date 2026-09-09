---
doc: 02_ROADMAP
owns: WHEN — phases, current vs deferred, sequencing
authority: derived
version: 1.11.0
derived_from: [01_PRD, 00_ADR]
owner: Robin Min
updated_at: 2026-09-09
read_before: placing work in a phase
edit_rules: 99 §6.3
sync: [T5, T6]
---

# 02 Roadmap — Spur

Phase commitments and exits only. Current feature state lives in the [generated index](features/INDEX.md);
implementation and verification history stays in task records. Existing phase identities are retained.

## Phase 0 — Re-Foundation _(done)_

Foundation established: Bun workspaces, released shared engines, thin CLI/server/web transports
and the oRPC seam (ADR-001–009).

**Exit:** clean project checks and Workers checks; core commands work end-to-end.

## Phase 1 — Hardening _(current)_

Make existing capabilities reliable before expanding scope.

- [x] Published engines and semver consumption; local rule gates and DB-path tests established.
- [ ] Finish error/exit/JSON-contract hardening and clean-clone verification.
- [ ] Complete release-history cleanup.

Execution deadline and queue-ownership work is tracked in [execution deadlines](design/execution-deadlines.md)
and the [feature index](features/INDEX.md).

**Exit:** clean-clone build, self-hosted gates and verified history/coverage paths.

## Phase 1.5 — Planning Layer (rd3 migration) _(current — waves done, board cutover done)_

Move planning operations to Spur (ADR-020–023).

- [x] Collective design; task and feature tooling; Board cutover; pipelines and plugin wrappers.
- [ ] Retire remaining legacy capability implementations after verifying their replacements.

**Exit:** daily use of the Spur Board and task CLI; legacy executable surface frozen.
Detailed decomposition and state: [feature index](features/INDEX.md).

### Phase 1.5 — Server-Side Adjustment (server/web re-foundation) _(current — implementing; core waves shipped)_

Provide the server/API and web foundation required by the planning Board.

- [x] Runtime prerequisite, server/module foundation, web shell, task/feature API and Kanban cutover.
- [ ] Complete the deferred planning live-update work after its prerequisites.

**Exit (reached 2026-07-04):** the local server launches the task/feature-backed Board, replacing
the generated Kanban file. Current contracts: [server/web design](design/server-side-adjustment-design.md).

## Phase 2 — Agent Execution & Run Model

Make agent runs locally captured, inspectable and addressable.

- [x] Agent execution, occupant identity, pinned waits and snapshot-then-follow coordination.
- [~] Run inspection through workflow/rule traces; full events/gates/artifact depth remains.
- [ ] Complete the run model and verify redaction at every persistence boundary.

Executor availability contracts: [executor availability](design/executor-availability.md).

**Exit:** execute, capture and inspect a run locally; peers address it without terminal scraping.

## Phase 3 — Workflow & Constraint Depth

Complete workflow and constraint depth on the shared engines.

- [x] Essential gates and explicit corpus audits ([contract](design/essential-workflow-checks.md)).
- [ ] Complete advanced evaluators/fixers/SARIF and workflow parallel/decision/resume depth.
- [ ] Link constraint findings to runs.

Task creation/readiness follows the planning workflow contract; its delivery state stays in the
[feature index](features/INDEX.md), with [design](design/task-creation-readiness.md).

**Exit:** rule/workflow engines meet the required capability bar on the current base.

## Phase 4 — Inspection Surface & Analytics

Make local runs and analytics inspectable through the browser.

- [ ] Complete run/history/analytics read procedures and dashboards against feature acceptance.
- [ ] Extract forecasting/windowing only when at least two consumers justify it.

Existing slices: [History Board](design/history-board-module.md) and
[observability](design/observability-module-refactor.md).

**Exit:** inspect runs, constraints and analytics without leaving local-first defaults.

## Phase 5+ — Extension Substrate (later)

Extension work is deferred until a real plugin consumer needs it (ADR-012 amendment).
The previous SDK/discovery/server-mount slices were removed; they are not current shipped
capabilities. Reactivate the harness registry only with the first primitive migration; sequence
that migration after its SDK/discovery/server prerequisites. Runtime sandboxing remains out of scope.

**Exit before scheduling:** confirmed consumer, accepted scope and bounded extension design.
Current seam: architecture §11; historical choices: ADR-012.

## Deferred / under review

Asset SSOT, remote/multi-tenant execution and desktop/mobile require scope reconfirmation in
[01 PRD](01_PRD.md). Feature/task records own individual dispositions.
