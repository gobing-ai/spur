---
schema_version: 1
name: "History schema trust gate: dependency drift, source-table assertion, and version-mismatch abort"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:03.962Z
updated_at: "2026-09-03T17:27:15.159Z"
feature_id: E91
priority: P1
tags: ["history", "schema", "guard"]
dependencies: ["0748"]
---

## 0738. History schema trust gate: dependency drift, source-table assertion, and version-mismatch abort

### Background
The E91 investigation found `refreshHistoryRollups` (`packages/app/src/services/history-analysis-service.ts:44`) failing after 43.9 s with `no such table: history_skill_call`. Root cause was not a schema gap: the DDL exists at `@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts` line 89, but `node_modules` held 0.4.51 while the root catalog pinned `^0.4.54` for the importer, `ts-db`, and `ts-ai-runner`. `bun install` was never re-run after the catalog bump.

**Still live as of 2026-09-03.** `node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json` reports `0.4.51`, and `grep -c history_skill_call` over its `dist/schema-sql.js` returns `0` — the installed build cannot create the table at all. R1's resync is the first action of this task and every later assertion is meaningless until it runs.

Nothing in the project check could see this. The importer exports no schema version, and Spur's migration ledger (`__spur_cli_migrations`, `packages/domain/src/migrations.ts:966`) records nothing about the importer schema it depends on. This task makes the failure impossible to reach silently: the refresh must be able to vouch for the schema it is about to write against, before it writes anything.
### Requirements
- [ ] R1. Resync the workspace to the lockfile and verify `refreshHistoryRollups` completes without a `no such table` error, writing a new `history_board_rollup_meta` version and a non-zero `history_board_skill_5m` row count.
- [ ] R2. A schema guard in the test suite asserts every table name read by the rollup refresh path exists in the schema produced by applying both the Spur migrations and the importer schema, failing with the offending table name.
- [ ] R3. A dependency drift guard in `spur-check` compares every installed `@gobing-ai/ts-*` version against its locked version and fails naming each mismatch.
- [ ] R4. A rollup refresh requested against a database whose recorded importer schema version does not match the installed package aborts before writing any rollup row, naming recorded version, installed version, and remediation, leaving existing rollups readable and unmodified.
- [ ] R5. A migration-ordering test asserts every migration this feature introduces uses the next four-digit prefix and has a corresponding domain registry entry, and that applying the set to a populated database succeeds without data loss.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R1 — Rollup refresh completes against the locked importer schema
    Given a workspace resolved to the importer version pinned in the lockfile
    And a history import has applied the importer schema to the database
    When refreshHistoryRollups runs to completion through the source-local CLI
    Then it exits without a "no such table" error
    And history_board_rollup_meta records a new history version
    And history_board_skill_5m contains a non-zero row count for a corpus that has skill calls.


  @core
  Scenario: R2 — Every rollup source table is asserted against the importer-applied schema
    Given the set of table names read by the rollup refresh path
    When the schema guard runs as part of the test suite
    Then every referenced source table exists in the schema produced by applying both the Spur migrations and the importer schema
    And the guard fails naming the offending table when a referenced table is absent from that combined schema.


  @core
  Scenario: R13 — Schema changes ship as ordered migrations
    Given new columns, tables, and indexes introduced by this feature
    When the migration set is applied to a database at the previous schema version
    Then each change is delivered by a drizzle migration using the next four-digit prefix
    And a corresponding entry exists in the domain migration registry
    And applying the set to an existing populated database succeeds without data loss.


  @core
  Scenario: R17 — Installed workspace dependencies match the lockfile at check time
    Given a lockfile pinning the @gobing-ai/ts-* package versions
    When the dependency drift guard runs as part of the project check
    Then every installed @gobing-ai/ts-* version equals its locked version
    And the guard fails naming each package whose installed version differs.


  @core
  Scenario: R18 — Rollup refresh refuses to run against a schema it cannot vouch for
    Given the schema version guard delivered by the DDL ownership feature
    When a rollup refresh is requested against a database whose recorded importer schema version does not match the installed package
    Then the refresh aborts before writing any rollup row
    And the abort message names the recorded version, the installed version, and the remediation
    And previously materialized rollups are left readable and unmodified.


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:26:51.127Z

**Is the dependency skew still live? — Yes, verified 2026-09-03.** Installed `@gobing-ai/ts-llm-jsonl-importer` is `0.4.51`; the root catalog pins `^0.4.54`; `ts-db` and `ts-ai-runner` are skewed identically. The installed build's bundled schema SQL contains no `history_skill_call` at all. R1's resync must run before any other assertion in this task means anything.

**Three guards or one? — Three.** Install-time drift catches the observed fault cheaply and early; test-time source-table assertion catches a rollup referencing a table no schema creates, independent of package ownership; run-time version abort is the only one protecting a production refresh on a machine where the first two never ran. Each has a reachable failure the others miss.

**Where does the run-time check go — inside or before the write transaction? — Before.** AC R18 requires "aborts before writing any rollup row" and "previously materialized rollups are left readable and unmodified". A rollback after a truncate satisfies neither cleanly and throws away a 43.9 s rebuild. The comparison runs at the top of `refreshHistoryRollups`, before `replaceHistoryBoardRollups` is reached.

**How is the rollup source-table set enumerated? — Parsed from the refresh SQL and cross-checked against an exported constant.** A hand-maintained list would have passed through the original failure without noticing. The test asserts the parsed `FROM`/`JOIN` set equals `ROLLUP_SOURCE_TABLES`, so the constant cannot silently drift, and then asserts each name exists in the combined applied schema.

**Does this task add a migration? — No.** `0031` is the current maximum and `0032` is reserved by task 0748. R5 asserts the ordering rule over migrations added by this feature's *other* tasks (0739, 0740, 0741, 0743), which take `0033` onward.

**Does the drift guard become a public `spur` command? — No.** It is an internal self-development command in `scripts/commands`, wired into the `spur-check` chain. A public noun/verb would need explicit operator consent with design context.

**Deferred: drift detection for non-`@gobing-ai` dependencies.** R3 is scoped to `@gobing-ai/ts-*` because that is the family with the lockstep-bump hazard. Widening it to every workspace dependency is deferred; owner: whoever hits the same skew outside the family.
### Design
**WHAT.** Three independent guards — install-time dependency drift, test-time source-table assertion, run-time schema-version abort — plus the migration-ordering test that keeps this feature's own DDL honest.

**WHY.** They fail at different moments against different inputs, and any one alone leaves a reachable path to a silent wrong answer. The run-time abort is the only one that protects a production refresh; the other two shorten the feedback loop so it rarely fires. Collapsing them into one guard would trade three cheap checks for one that fires too late.

**WHERE.** `scripts/commands/dependency-drift-check.ts` (new), root `package.json` `scripts`, `packages/domain/src/analytics/history-board-rollup.ts` (source-table constant), `packages/domain/tests/analytics/history-board-rollup.test.ts`, `packages/domain/tests/dao/migrations.test.ts`, `packages/app/src/services/history-analysis-service.ts:44` (pre-write abort).

**Frozen names**

| Name | Where | Kind |
| --- | --- | --- |
| `ROLLUP_SOURCE_TABLES` | `packages/domain/src/analytics/history-board-rollup.ts` | `readonly string[]` — every table the refresh statements read |
| `dependency-drift-check` | root `package.json` script, inserted in the `spur-check` chain before `lint` | internal self-development command |
| `scripts/commands/dependency-drift-check.ts` | new file | implementation |
| `HISTORY_IMPORT_SCHEMA_VERSION` | imported from `@gobing-ai/ts-llm-jsonl-importer` | **owned by task 0748** — import it, never redeclare |
| `readRecordedImporterSchemaVersion` | imported from `packages/domain/src/analytics/importer-schema-version.ts` | **owned by task 0748** |
| `HistorySchemaVersionMismatchError` | `packages/app/src/services/history-analysis-service.ts` | thrown by the pre-write abort |

**Migration prefixes.** `0031` is the current maximum in both `packages/domain/src/migrations.ts` and `drizzle/`. Task 0748 reserves `0032`. This feature's later tasks take `0033` onward; **0738 itself introduces no migration** — R5 only asserts the ordering rule over whatever the feature's other tasks add.

**Precedence and algorithm**

1. **R1 first, and it is a prerequisite, not a step.** `bun install`, then re-import, then run `refreshHistoryRollups` through the source-local CLI (`bun run apps/cli/src/index.ts …` or `apps/cli/spur.js`, never a possibly stale global `spur`). Record the binary's provenance before the run, per the project's real-data validation rule. Evidence required: no `no such table` error, a new `history_board_rollup_meta.history_version`, and a non-zero `history_board_skill_5m` row count.
2. **R2 enumerates from the module, not by hand.** Export `ROLLUP_SOURCE_TABLES` from the rollup module and add a test that (a) parses the refresh statements' SQL for `FROM` / `JOIN` targets and asserts the parsed set equals the constant — so the constant cannot drift from the code — and (b) asserts each name exists in a database built by applying both `applyHistoryImportSchema` and `applyCliMigrations`, failing with the offending table name. A hand-maintained list would have passed happily through the original failure.
3. **R3 compares installed against locked, not against `package.json`.** Read each `node_modules/@gobing-ai/ts-*/package.json` `version` and compare to the resolution in `bun.lock`. Comparing against the catalog range would accept `0.4.51` for `^0.4.54`… it would not, but it also would not catch a lockfile that itself disagrees with what is installed, which is the observed fault. Report every mismatch, not the first.
4. **R4 aborts before the first write, and the abort is transactional-by-construction.** The comparison runs at the top of `refreshHistoryRollups`, before `replaceHistoryBoardRollups` (`packages/domain/src/analytics/history-board-rollup.ts:295`) touches anything. Existing rollups stay readable because nothing was truncated. The message names recorded version, installed version, and the remediation.
5. **R5 asserts ordering over the feature's own migrations.** Every new migration uses the next four-digit prefix, has a matching `drizzle/<id>.sql`, has a `CLI_MIGRATIONS` entry with the identical id, and the whole set applies to a populated database without data loss.

**Anti-patterns**

- **Do not assert anything before the resync.** Every R2/R4/R5 assertion run against the `0.4.51` tree is measuring the wrong schema.
- **Do not hand-maintain the rollup source-table list.** The parse-and-compare test in step 2 is the whole point; a literal list reproduces the original failure exactly.
- **Do not put the version comparison inside the rollup write transaction.** "Aborts before writing any rollup row" means the check precedes the truncate, not that a rollback undoes it — a rollback of a 43.9 s rebuild is not the same guarantee.
- **Do not redeclare `HISTORY_IMPORT_SCHEMA_VERSION` locally.** It is task 0748's export; a second copy is a second thing to forget to bump.
- **Do not add a public `spur` noun/verb for the drift guard.** Internal checks belong in `scripts/commands` per harness surface governance; a public surface needs separate operator consent.
- **Do not use a global `spur` binary for R1's evidence.** Real-data history validation must run through the source-local CLI with recorded provenance.

**Handoff to dependents**

Task 0741 (incremental refresh engine) reads `ROLLUP_SOURCE_TABLES` to decide which sources a bucket depends on, and must extend that constant rather than introduce a parallel list. Task 0743 (marts + read routing) may assume `HistorySchemaVersionMismatchError` already fires before any write, so neither downstream task re-checks the schema version.

**Dependency:** R4 blocks on task 0748 delivering `HISTORY_IMPORT_SCHEMA_VERSION` and `readRecordedImporterSchemaVersion`. R1/R2/R3/R5 do not; start there.

Authority: ADR-103 (D1), ADR-104, ADR-105; `docs/design/history-incremental-materialization.md` sections 3 and 11.
### Plan
1. **R1 (resync + evidence).** Record `node_modules` versions for the three `@gobing-ai/ts-*` packages, run `bun install`, record them again, re-run the history import, then run `refreshHistoryRollups` through the source-local CLI with recorded binary provenance. Capture wall time, the new `history_board_rollup_meta.history_version`, and the `history_board_skill_5m` row count. Test intent: this is the reproduction closing the original defect — its evidence is the before/after version pair plus a non-zero skill rollup, not a green test.
2. **R2a (constant).** Export `ROLLUP_SOURCE_TABLES` from `packages/domain/src/analytics/history-board-rollup.ts`.
3. **R2b (guard).** Add a domain test parsing the refresh statements for `FROM`/`JOIN` targets, asserting the parsed set equals `ROLLUP_SOURCE_TABLES`, then asserting each name exists in a database built from `applyHistoryImportSchema` + `applyCliMigrations`. Test intent: catch a rollup referencing a table no schema creates, whichever package owns it — and catch the constant drifting from the SQL.
4. **R3 (drift guard).** Implement `scripts/commands/dependency-drift-check.ts` comparing installed `@gobing-ai/ts-*` versions against `bun.lock` resolutions, reporting every mismatch; wire `dependency-drift-check` into the `spur-check` chain before `lint`. Test intent: reproduce the 0.4.51-vs-0.4.54 skew as a failing check.
5. **R4 (pre-write abort).** After task 0748 lands, compare `readRecordedImporterSchemaVersion(db)` against `HISTORY_IMPORT_SCHEMA_VERSION` at the top of `refreshHistoryRollups` and throw `HistorySchemaVersionMismatchError` naming both versions and the remediation. Test intent: assert the abort fires before any truncate and that pre-existing rollup rows are still readable and byte-identical afterwards — an abort that clears the tables first is the failure this guard exists to prevent.
6. **R5 (migration ordering).** Assert every migration this feature introduces uses the next four-digit prefix, has a matching `drizzle/<id>.sql` and an identically-named `CLI_MIGRATIONS` entry, and that applying the set to a populated database preserves row counts on every pre-existing table.
7. Run `bun run spur-check` and the domain + app test suites.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- `docs/00_ADR.md` — ADR-103 (D1, materialized-only read path), ADR-104 (DDL authority split), ADR-105 (three-axis ownership)
- `docs/design/history-incremental-materialization.md` — sections 3 and 11
- Refresh entry point: `packages/app/src/services/history-analysis-service.ts:44`; write side `packages/domain/src/analytics/history-board-rollup.ts:295` with its truncate list at `packages/domain/src/analytics/history-board-rollup.ts:303`
- Migration ledger and runner: `packages/domain/src/migrations.ts:966`; board rollup DDL `packages/domain/src/migrations.ts:419-630`; current max migration `0031_spur_cli_history_board_tool_stats_columns`
- Upstream schema: `@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts` line 89 (`history_skill_call`), `src/jsonl-importer-dao.ts` line 123 (`applyHistoryImportSchema`)
- Surface governance for internal commands: `docs/design/harness-surface-governance.md` (ADR-065)
- Prerequisite: task 0748 (exports `HISTORY_IMPORT_SCHEMA_VERSION` and `readRecordedImporterSchemaVersion`)
### History
