---
name: "W1: Planning events — PlanningEventMap, DAOs and DB migration"
description: "W1: Planning events — PlanningEventMap, DAOs and DB migration"
status: Done
created_at: 2026-06-13T01:08:18.982Z
updated_at: 2026-06-14T16:29:55.754Z
folder: docs/tasks
type: task
feature-id: F4
priority: P0
tags: ["rd3-migration","wave-1"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0053. "W1: Planning events — PlanningEventMap, DAOs and DB migration"

### Background

Design §2.5/§7, X04/A15/D06. Event emission is step 8 of the write sequence; SQLite stays derived-only.


### Requirements

R1. PlanningEventMap typed map (6 events §7) in packages/app.
R2. drizzle/0003_spur_cli_planning.sql: planning_events + task_run_links (+_spur_cli_ marker) composed into CLI_SCHEMA_SQL.
R3. PlanningEventDao/TaskRunLinkDao.
R4. Rebuild-from-corpus test proves derived-only.


### Q&A



### Design

Authority: design §7 (envelope `{event, entity{kind,id}, at, from?, to?, run_id?, data?}`; exactly six
planning events; one emitter = write-service step 8; no `*.deleted`), §2.5 (tables: `planning_events`,
`task_run_links`; rebuild rule), delivery doc §5.1/5.2 names (`PlanningEventMap`, `PlanningEventDao`,
`TaskRunLinkDao`, `PLANNING_SCHEMA_SQL`). DB stays derived-only: deleting it loses no planning state.


### Solution

1. `packages/app/src/services/planning-events.ts`: typed `PlanningEventMap` + emitter over the ts-infra
   EventBus; persistence subscriber writes `planning_events` rows.
2. `drizzle/0003_spur_cli_planning.sql` (with the `_spur_cli_` marker): both tables per design §2.5;
   `packages/domain` schema files + `PLANNING_SCHEMA_SQL` composed into `CLI_SCHEMA_SQL`
   (migrations.ts pattern, same as history/workflow schemas).
3. `PlanningEventDao` / `TaskRunLinkDao` in `packages/domain/src/dao/` following existing DAO style;
   in-memory SQLite tests.
4. Rebuild function: corpus `## History` sections → equivalent `planning_events` rows; test proves
   derived-only (drop DB, rebuild, compare). Gate: `bun run check`; `spur migrate` applies 0003 cleanly.


### Plan

- [x] `PlanningEventMap` typed map over the 6 planning events (`packages/app/src/services/planning-events.ts`)
- [x] `BusPlanningEventEmitter` — persist-then-publish, wired as the step-8 emitter port of `PlanningWriteService`
- [x] `PLANNING_SCHEMA_SQL` derived from `defineTable` (`packages/domain/src/schema/planning.ts`); composed into `CLI_SCHEMA_SQL`
- [x] `drizzle/0003_spur_cli_planning.sql` (`_spur_cli_` marker) + `0003_spur_cli_planning` migration entry
- [x] `PlanningEventDao` / `TaskRunLinkDao` (`packages/domain/src/dao/`), exported from `dao/index.ts`
- [x] Rebuild-from-corpus (`packages/domain/src/planning/rebuild-events.ts`): `## History` lines → events
- [x] Tests: emitter emit+persist; DAO round-trips; rebuild drop-DB-rebuild-compare derived-only proof; migration-0003 table creation


### Review

**SECU verdict: PASS** (verified 2026-06-14 via `/rd3:dev-verify 0053 --force --fix all`)

**S — Security:** No network, no secrets, no injection surface. `PlanningEventDao.insert` and
`TaskRunLinkDao.insert` use parameterized SQL (`?`/`?n` placeholders); list/count queries are
parameterized. `BusPlanningEventEmitter` persists before publishing, so no event is lost if a
subscriber throws.

**E — Error handling:** DAO read methods (`listByEntity`/`listAll`/`countByEntity`,
`listByWbs`/`listByRun`) tolerate a not-yet-migrated table by swallowing **only** the specific
`no such table` error and rethrowing all others — matches the optional-engine-table pattern. The
emitter does not swallow persistence failures (durable-first is intentional).

**C — Correctness / architecture:**
- R1 ✓ `PlanningEventMap` (`planning-events.ts:18`) keys the 6 `PlanningEventName`s
  (`planning-write-service.ts:80-86`); `BusPlanningEventEmitter` (`planning-events.ts:26`) is the
  single step-8 emitter, wired through `PlanningWriteService.emitter` (`planning-write-service.ts:339`).
- R2 ✓ `PLANNING_SCHEMA_SQL` is **derived** from `defineTable` (`schema/planning.ts:31`, ADR-011),
  composed into `CLI_SCHEMA_SQL` (`migrations.ts:43`) and registered as the incremental
  `0003_spur_cli_planning` (`migrations.ts:71`). `drizzle/0003_spur_cli_planning.sql` carries the
  `_spur_cli_` marker and is byte-aligned with the derived DDL (same columns/order). Fresh `spur
  migrate` creates both `planning_events` and `task_run_links`.
- R3 ✓ `PlanningEventDao` / `TaskRunLinkDao` (`packages/domain/src/dao/`), exported `dao/index.ts:6,9`,
  100% line+func coverage.
- R4 ✓ Rebuild path (`planning/rebuild-events.ts`) parses the **canonical** `## History` bullet line
  (`- {ts} {from} → {to} ({actor})`) — the exact format `PlanningWriteService.appendHistoryLine`
  emits — into events; migration-seed bullets are skipped. The derived-only test
  (`rebuild-events.test.ts`) inserts from a corpus that includes a seed line, drops the table,
  rebuilds, and compares semantic fields row-by-row (3 events from 4 lines).

**U — Usability:** DAO method names are explicit (`listByEntity`/`listByRun`); inputs typed via
`Create*Input` interfaces.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | History-line format mismatch: the rebuilder's `HISTORY_LINE_RE` parsed a **pipe-table** form (`\| ts \| from → to \| actor \|`) that **nothing in the codebase writes**. The only transition-history writer is `PlanningWriteService.appendHistoryLine` (`planning-write-service.ts:375`), which emits a **bullet** line `- {ts} {from} → {to} ({actor})`. R4's derived-only proof was therefore vacuous — the test fed the parser its own synthetic format rather than the real corpus format (R8 anti-pattern). No later task (0054-0070) owns this reconciliation, so it was not deferrable. | Correctness | `rebuild-events.ts:24` | P2 | **FIXED** — `HISTORY_LINE_RE` rewritten to match the canonical bullet line; tests now use the real write-service format and additionally assert the M8 migration-seed bullet (`- Migrated from legacy format (...)`) is skipped. Rebuild proof is now genuine. |

No P1 findings; the one P2 above is fixed. Gate re-run green after the fix.

**Gate:** `bun run lint` clean (249 files; 7 workspaces typecheck OK) · `bun run test` 1023 pass / 0 fail · fresh `spur migrate` creates `planning_events` + `task_run_links`.


### Testing

Verified 2026-06-14. All tests genuine (real assertions, no empty files).

- `packages/app/tests/services/planning-events.test.ts` — 3 tests: `BusPlanningEventEmitter` emits
  to the bus AND persists to `planning_events`; subscriber receives the envelope; multiple events
  accumulate. 12 expect() calls. PASS.
- `packages/domain/tests/planning/rebuild-events.test.ts` — 7 tests: `parseHistoryLine` (valid +
  null cases), `historyEntryToEvent`, `extractHistoryEvents` (multi-line, feature kind, empty),
  **drop-DB-rebuild-compare derived-only proof**, and migration-0003 table creation. PASS.
- `packages/domain/tests/dao/planning-event-dao.test.ts` + `task-run-link-dao.test.ts` — DAO
  insert/list/count round-trips against in-memory SQLite. PASS.

Coverage on 0053 files: `planning-event-dao.ts`, `task-run-link-dao.ts`, `rebuild-events.ts` all
100% line + function. Full suite: 1023 pass / 0 fail.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


