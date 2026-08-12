---
template: issue
schema_version: 1
name: "Fix legacy database startup when history_message is absent"
description: ""
status: done
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T22:30:24.831Z"
updated_at: "2026-08-11T23:59:40.854Z"
---

## 0520. Fix legacy database startup when history_message is absent

### Background
`spur serve` in `/Users/robin/xprojects/knowledge-kit` fails during startup with
`SQLiteError: no such table: main.history_message`. The project database has CLI migrations
`0000` through `0008` journaled but no importer-owned forensic tables; Spur 0.3.43 then attempts
`0009_spur_cli_history_message_run_idx` before the server can start.
### Requirements
- [ ] **R1 — Upgrade legacy databases.** Applying current CLI migrations to a database with `0000`–`0008`
      already journaled and no `history_message` table creates the importer schema and the run selector index.
- [ ] **R2 — Preserve fresh/idempotent behavior.** Fresh databases and repeat migration runs remain green.
- [ ] **R3 — Cover both migration sources.** Embedded migrations and migrations loaded from `drizzle/` handle
      the legacy state consistently.
### Acceptance Criteria
```gherkin
Feature: Safe history index migration

  @core
  Scenario: Legacy database without importer tables starts successfully
    Given a database has CLI migrations 0000 through 0008 journaled
    And history_message does not exist
    When current CLI migrations are applied
    Then the importer schema is created
    And idx_history_message_provenance_run indexes provenance and run_id
    And a second migration pass applies nothing
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
Make migration `0009` self-contained by composing the package-owned `HISTORY_IMPORT_SCHEMA_SQL` before its
index DDL. Reuse that composition for folder-loaded `0009` rather than copying the external package schema into
`drizzle/`. No new migration or public surface is needed because affected databases cannot advance past `0009`.
### Plan
- [ ] Add a regression fixture matching the observed journaled database with no `history_message`.
- [ ] Confirm it fails at `0009` before the production edit.
- [ ] Compose importer schema into embedded and folder-loaded `0009`.
- [ ] Run the focused migration tests and reproduce startup against a disposable copy of the affected database.
### Root Cause
`packages/domain/src/migrations.ts:233` registers `0009` as a bare index statement. Earlier databases have
`0000` permanently journaled from before `HISTORY_IMPORT_SCHEMA_SQL` joined the mutable foundation, so that
foundation is never re-applied and `history_message` is absent. The existing legacy-upgrade test at
`packages/domain/tests/dao/migrations.test.ts:123` hid the defect by fabricating `history_message` in its legacy
foundation fixture.
### Solution
- `packages/domain/src/migrations.ts:253-263` — before pending migration `0009`, provision the package-owned
  importer schema only when `history_message` is absent; existing legacy history schemas remain untouched.
- `packages/domain/src/migrations.ts:307-313` — add the narrow SQLite table-existence probe used by that guard.
- `packages/domain/tests/dao/migrations.test.ts:332-375` — reproduce a database with `0000`–`0008` journaled
  and no forensic tables, then cover embedded and folder-loaded schema creation, index shape, and idempotency.
### Testing
Verdict: PASS (re-verified 2026-08-11 via /sp:dev-verify --force; evidence re-run this session unless marked prior-run)

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Guard at `packages/domain/src/migrations.ts:256-263`; embedded regression `packages/domain/tests/dao/migrations.test.ts:332-356`; live repro this run: disposable copy of `knowledge-kit/.spur/spur.db` (journal exactly 0000–0008, `history_message` ABSENT) → first pass applied 0009, importer schema created |
| R2 | MET | Idempotency asserted at `packages/domain/tests/dao/migrations.test.ts:354`; live repro this run: second pass applied 0; focused suite `bun test packages/domain/tests/dao/migrations.test.ts` — 38 pass / 0 fail (this run) |
| R3 | MET | Single guard in `applyCliMigrations` (`packages/domain/src/migrations.ts:256-263`) covers both embedded and folder-loaded migrations; folder-loaded regression `packages/domain/tests/dao/migrations.test.ts:358-375` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: Legacy database without importer tables starts successfully | MET | command | This run: `applyCliMigrations` against a disposable copy of the affected `knowledge-kit/.spur/spur.db` — precondition journal exactly 0000–0008 with `history_message` ABSENT; first pass applied 1 (0009); `history_message` + `history_tool_call` + all `history_etl_*` + ledger/checkpoint tables created; `PRAGMA index_info(idx_history_message_provenance_run)` = `provenance,run_id`; second pass applied 0. The startup failure was the 0009 migration error, so the migration-level repro exercises the exact defect surface; serve smoke (`spur serve` port 4399, `/api/health` HTTP 200) verified prior run. |

**Design Conformance** — pass: 3/3 claims DONE (self-contained 0009 composing package-owned `HISTORY_IMPORT_SCHEMA_SQL`; folder-loaded 0009 reuses the same applier guard, no schema copy into `drizzle/`; no new migration id or public surface — `tableExists` is module-private). All line anchors re-read this run.

**Checks**

- Coverage: 100% lines for `packages/domain/src/migrations.ts` in the focused run (this run).
- Focused: `bun test packages/domain/tests/dao/migrations.test.ts` — 38 pass, 0 fail, 106 expects (this run).
- Importer schema idempotency confirmed at the resolved `@gobing-ai/ts-llm-jsonl-importer@0.4.27` — every CREATE is IF NOT EXISTS (`schema-sql.js:84` `history_message`), so partially-provisioned legacy importer states replay safely.
- `spur task check 0520 --strict-core --json` — pass: true, no missing sections (this run).
- Prior full gate (at fix commit 2ae93dea): `bun run spur-check` PASS — 4,871 tests, 0 fail; `bun run test-cf` PASS; `bun run build` PASS; `spur task check --corpus` PASS.
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings. The fix is migration-local, parameterizes the SQLite catalog lookup, reuses package-owned idempotent schema, and adds no dependency or public surface. |

Residual risk: installed Spur 0.3.43 remains affected until the fixed CLI is linked or released; the source change itself is verified against a copy of the observed database.
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-08-11T22:31:39.024Z backlog → todo (system)
- 2026-08-11T22:35:18.522Z todo → wip (system)
- 2026-08-11T22:40:07.838Z wip → testing (system)
- 2026-08-11T23:59:40.854Z testing → done (system)
