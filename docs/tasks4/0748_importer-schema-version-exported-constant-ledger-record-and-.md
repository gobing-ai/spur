---
schema_version: 1
name: "Importer schema version: exported constant, ledger record, and mismatch check"
status: done
template: feature-impl
created_at: 2026-09-03T16:45:42.303Z
updated_at: "2026-09-03T18:38:19.295Z"
feature_id: E92
priority: P1
tags: ["history", "schema", "guard"]
---

## 0748. Importer schema version: exported constant, ledger record, and mismatch check

### Background

The importer exports no `SCHEMA_VERSION` or `schemaVersion`. Its barrel (`@gobing-ai/ts-llm-jsonl-importer` `src/index.ts`) exports errors, hashing, the importer entry point, the DAO helpers, mappers, the OpenCode importer, redaction, `HISTORY_IMPORT_SCHEMA_SQL`, and the source registry — and nothing that states which schema a given database was built with. Verified against the current tree on 2026-09-03.

That absence is what made the E91 failure invisible: `node_modules` holds importer `0.4.51` while the root catalog pins `^0.4.54`, and `0.4.51`'s bundled schema SQL contains no `history_skill_call` at all (`grep -c history_skill_call` over its `dist/schema-sql.js` returns `0`). The only symptom was `no such table: history_skill_call` 43.9 seconds into a rollup refresh. A version the database could report would have made the mismatch a one-line diagnosis.

The mechanism that hides it: `applyHistoryImportSchema` (`@gobing-ai/ts-llm-jsonl-importer` `src/jsonl-importer-dao.ts` line 123) splits `HISTORY_IMPORT_SCHEMA_SQL` on `;` and `exec`s each statement, and every statement is `CREATE TABLE IF NOT EXISTS`. Against an existing database a schema change is a silent no-op — no error, no signal, no drift report. A recorded version is the only way to notice.

Spur's own migration ledger is `__spur_cli_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`, created and driven by `applyCliMigrations` at `packages/domain/src/migrations.ts:966-1010`. It records identity, not payload — which is exactly enough to record a version if the version is part of the id.

### Requirements

- [x] R1. The importer exports a schema version constant that changes whenever its schema changes, and a test fails when the schema changes without a version bump.
- [x] R2. Applying the importer schema inside Spur records the applied version in Spur's migration ledger as a versioned step.
- [x] R3. A recorded version older than the installed one fails a check with both versions and a remediation, rather than surfacing as a runtime error mid-refresh.
- [x] R4. A database whose recorded version is older is detected and reported; it is not silently treated as current.

### Acceptance Criteria

```gherkin
Feature: History schema DDL ownership repatriation

  @core
  Scenario: R3 — The importer exports a schema version that changes with its schema
    Given the importer package's static schema SQL
    When the schema SQL is modified
    Then the exported HISTORY_IMPORT_SCHEMA_VERSION differs from its previous value
    And a test fails if the schema SQL changes without the version changing.


  @core
  Scenario: R4 — Applying the importer schema records its version in the Spur migration ledger
    Given a database at a prior schema state
    When the history schema is applied
    Then the importer schema SQL runs as a versioned migration step
    And the applied HISTORY_IMPORT_SCHEMA_VERSION is recorded in the migration ledger
    And no history table structure is created as an implicit side effect of running an import.


  @core
  Scenario: R5 — A schema version mismatch fails a check rather than a refresh
    Given a database whose recorded importer schema version differs from the installed package's version
    When the project check runs
    Then the check fails naming the recorded version and the installed version
    And the failure occurs before any rollup refresh or import is attempted.


  @edge
  Scenario: R9 — A database created by an older importer version is detected, not silently degraded
    Given a database created by an importer version predating a table or column the current version defines
    When the schema version check runs
    Then the drift is reported naming the missing structure
    And the failure names the remediation rather than surfacing as a missing-table query error.


```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:17:32.053Z

**A separate schema counter, or the package version? — The package version.** A second number that must be kept in step with the package version is one more thing to forget, and the failure mode of forgetting is silent. `HISTORY_IMPORT_SCHEMA_VERSION` is the package version, guarded by the bump-or-fail test.

**Where is the version recorded? — In `__spur_cli_migrations`, encoded in the id as `importer_schema@<version>`.** The ledger has only `(id TEXT PRIMARY KEY, applied_at INTEGER)`, so there is no column to hold a payload. Encoding it in the id satisfies AC R4 literally, adds no table, and gets idempotency from the primary key. Rejected alternative: a new `history_schema_state` table — a Spur-owned table recording an importer-owned fact, which is the ownership smell E92 exists to remove.

**Which "project check" does AC R5 mean? — The `spur-check` chain.** There is no database doctor surface today; `spur-check` is `link-check → transition-shim-check → script-contract-check → lint → tests`. `importer-schema-check` is inserted before `lint`, matching the existing internal-command pattern in `scripts/commands/`. This deliberately avoids adding a public `spur` noun/verb, which would require separate operator consent.

**Does this replace E91 task 0738's run-time abort? — No.** This check fires at development/CI time against `.spur/spur.db`; 0738's abort fires inside the refresh path on whatever database it is handed. A database that goes stale between checks is only catchable at run time. Both stay.

**Is the E91 failure reproducible as a test case? — Yes.** Importer `0.4.51`'s bundled schema contains no `history_skill_call` (verified: `grep -c` over its `dist/schema-sql.js` returns `0`), so R4's older-version scenario has a real, checked-in instance rather than a synthetic one.

**Deferred: cross-database version reconciliation.** Nothing here handles a database whose recorded version is *newer* than the installed package (a downgrade). It is reported as a mismatch with both versions, which is correct but generic. A downgrade-specific remediation is deferred; owner: whoever first downgrades the importer deliberately.

### Design

**WHAT.** The importer declares a schema version constant; Spur records the version it applied in the existing migration ledger; a project-level check compares recorded against installed and fails with both values plus a remediation.

**WHY.** `CREATE TABLE IF NOT EXISTS` makes upstream schema drift undetectable by construction. Only a recorded version turns a silent no-op into a diagnosable state. ADR-104 assigns the schema to the importer, so the version is the importer's to declare; Spur knows what it applied to a given database, so the record is Spur's to keep. Neither half works alone.

**WHERE.** Upstream: `@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts` (constant), `src/index.ts` (export), plus a bump-or-fail test. Downstream: `packages/domain/src/analytics/importer-schema-version.ts` (new), `packages/domain/src/migrations.ts` (ledger step), `scripts/commands/importer-schema-check.ts` (new), `package.json` `scripts` (chain wiring), `packages/domain/tests/dao/migrations.test.ts`.

**Frozen names**

| Name | Where | Kind |
| --- | --- | --- |
| `HISTORY_IMPORT_SCHEMA_VERSION` | importer `src/schema-sql.ts`, re-exported from `src/index.ts` | `string`, the importer package's own semver |
| `IMPORTER_SCHEMA_LEDGER_PREFIX` | `packages/domain/src/analytics/importer-schema-version.ts` | `'importer_schema@'` |
| `readRecordedImporterSchemaVersion(db)` | same file | returns `string \| null` |
| `checkImporterSchemaVersion(db)` | same file | returns a drift verdict; never throws on a clean database |
| `ImporterSchemaVersionDrift` | same file | `interface` with `recorded`, `installed`, `missingTables`, `remediation` |
| `0032_spur_cli_importer_schema_version` | `packages/domain/src/migrations.ts` + `drizzle/0032_spur_cli_importer_schema_version.sql` | next free prefix; `0031` is the current max |
| `importer-schema-check` | root `package.json` script, inserted in the `spur-check` chain before `lint` | internal self-development command |

**Precedence and algorithm**

1. **The version is the importer package's own version string.** Do not invent a separate schema counter: a second number that must be kept in step with the package version is one more thing to forget. `HISTORY_IMPORT_SCHEMA_VERSION` is set to the package's `version` and the bump-or-fail test enforces that a change to `HISTORY_IMPORT_SCHEMA_SQL` is accompanied by a change to the constant.
2. **Bump-or-fail is a hash-pinned test.** The test stores a hash of `HISTORY_IMPORT_SCHEMA_SQL` alongside the version it belongs to; changing the SQL without changing the version fails. A version constant a developer forgets to bump is *worse* than no version, because it makes a stale database confidently report itself current — the test is what makes the constant trustworthy.
3. **The ledger record rides the existing table, not a new one.** `__spur_cli_migrations` has only `(id, applied_at)`, so encode the version in the id: `importer_schema@<version>`. Reading it is `SELECT id FROM "__spur_cli_migrations" WHERE id LIKE 'importer_schema@%'`. This satisfies AC R4's "recorded in the migration ledger" with zero new tables, and re-application is idempotent for free because `id` is the primary key. Migration `0032` writes the row for the currently installed version and the ledger step re-writes it whenever the applied version changes.
4. **Where the schema is applied is also where it is recorded.** `applyCliMigrations` already provisions the importer schema in-line for the `0009` and `0024`/`0025` guards (`packages/domain/src/migrations.ts:993-1009`). The versioned step goes in the same place, so no import path can create history tables without recording the version it used. AC R4's last clause — "no history table structure is created as an implicit side effect of running an import" — is satisfied by routing all provisioning through this step.
5. **Fail at check time, not mid-refresh.** `bun run importer-schema-check` reads `.spur/spur.db`, compares recorded against `HISTORY_IMPORT_SCHEMA_VERSION`, and on mismatch prints both versions, the missing tables or columns it can name, and the remediation (`bun install` to resync the workspace off the stale `node_modules` copy). It runs in the `spur-check` chain before `lint`, so it fires before any test or refresh.
6. **This check and E91's abort are both required.** E91 task 0738 R18 consumes `HISTORY_IMPORT_SCHEMA_VERSION` for a run-time pre-write abort. This check is earlier and cheaper, so the common case never reaches the abort; but a database that only becomes stale between checks still needs the abort. They catch the same fault at different moments — neither replaces the other.

**Anti-patterns**

- **Do not add a new Spur-owned table to hold the version.** The ledger already exists, is already the record of what was applied, and its primary key gives idempotency for free.
- **Do not make the check throw from inside the refresh path.** AC R5 requires the failure "before any rollup refresh or import is attempted"; a check that only fires mid-refresh is the bug, not the fix.
- **Do not derive the version by hashing the schema at run time instead of declaring it.** A hash tells you two databases differ; it cannot tell you which is older or what the remediation is.
- **Do not add a public `spur` noun or verb for this.** Public-surface changes need explicit operator consent with design context; an internal check belongs in `scripts/commands` (ADR-065 / harness surface governance).
- **Do not skip the resync.** The whole task is unverifiable while `node_modules` holds `0.4.51`; a green check against a stale tree proves nothing.

**Handoff to dependents**

E91 task 0738 imports `HISTORY_IMPORT_SCHEMA_VERSION` from the importer barrel and `readRecordedImporterSchemaVersion` from `packages/domain/src/analytics/importer-schema-version.ts` for its R18 pre-write abort. Both names are frozen above; 0738 must not re-derive either. 0747 shares this task's upstream publish — **one release carries both**, and this task owns the version bump.

Authority: ADR-104; `docs/design/history-incremental-materialization.md` section 11 (D9).

### Plan

1. **R1a (constant).** Add `HISTORY_IMPORT_SCHEMA_VERSION` to the importer's `src/schema-sql.ts`, set to the package version, and export it from the barrel.
2. **R1b (bump-or-fail).** Add an upstream test pinning a hash of `HISTORY_IMPORT_SCHEMA_SQL` to the version it belongs to. Test intent: prove the constant cannot silently fall behind the SQL — the failure mode being defended against is a stale database confidently reporting itself current.
3. **R2 (ledger step).** Add migration `0032_spur_cli_importer_schema_version` plus its drizzle file, and extend `applyCliMigrations` to write `importer_schema@<HISTORY_IMPORT_SCHEMA_VERSION>` into `__spur_cli_migrations` at the same point it provisions the importer schema. Test intent: applying the schema to a database at a prior state must leave exactly one `importer_schema@%` row carrying the installed version, and re-running must be a no-op.
4. **R3 (check).** Implement `checkImporterSchemaVersion` and `readRecordedImporterSchemaVersion` in `packages/domain/src/analytics/importer-schema-version.ts`; wrap them in `scripts/commands/importer-schema-check.ts`; wire `importer-schema-check` into the `spur-check` chain before `lint`. Test intent: a mismatched database must produce a verdict naming both versions and a remediation, and a clean database must produce no verdict — the check must not be noisy or it will be removed.
5. **R4 (older-version detection).** Assert that a database whose recorded version predates a table the current schema defines is reported as drift naming the missing structure, not treated as current. Use `history_skill_call` as the concrete case: it is exactly the table `0.4.51` lacks. Test intent: reproduce the real E91 failure and prove the check now catches it before the refresh does.
6. **Release and resync.** Publish one importer version carrying this task's and 0747's changes, then `bun install` to move the workspace off `0.4.51`, then `bun run spur-check` and `bun run test`.

### Solution

Exported importer schema version from @gobing-ai/ts-llm-jsonl-importer, recorded version in Spur migration ledger, and added pre-lint check.

| File | Rationale |
| --- | --- |
| `packages/domain/src/migrations.ts:942` | Add migration 0033 to record applied importer schema version in migration ledger |
| `scripts/commands/importer-schema-check.ts:16` | Add project check verifying database schema version matches installed package |
| `packages/domain/tests/analytics/importer-schema-version.test.ts:48` | Add tests verifying recorded version and mismatch detection |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R3 — The importer exports a schema version that changes with its schema | MET | packages/llm-jsonl-importer exports HISTORY_IMPORT_SCHEMA_VERSION; tests/schema-version.test.ts pins hash of HISTORY_IMPORT_SCHEMA_SQL to version. |
| R4 — Applying the importer schema records its version in the Spur migration ledger | MET | packages/domain/src/migrations.ts: migration 0033_spur_cli_importer_schema_version records importer_schema@0.4.55 in __spur_cli_migrations; verified in packages/domain/tests/analytics/importer-schema-version.test.ts. |
| R5 — A schema version mismatch fails a check rather than a refresh | MET | scripts/commands/importer-schema-check.ts runs before lint in spur-check chain; verified in scripts/commands/importer-schema-check.test.ts. |
| R9 — A database created by an older importer version is detected, not silently degraded | MET | packages/domain/tests/analytics/importer-schema-version.test.ts: checkImporterSchemaVersion detects 0.4.51 DB, identifies missing history_skill_call table, and formats remediation. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur-check | — |  |

### References

- Parent feature: `docs/features/E92_history-schema-ddl-ownership-repatriation.md`
- `docs/00_ADR.md` — ADR-104 (importer/Spur DDL authority split)
- `docs/design/history-incremental-materialization.md` — section 11 (D9, DDL authority)
- Spur migration ledger and runner: `packages/domain/src/migrations.ts:966-1010`; current max migration id `0031_spur_cli_history_board_tool_stats_columns`
- Upstream schema apply: `@gobing-ai/ts-llm-jsonl-importer` `src/jsonl-importer-dao.ts` line 123; schema SQL `src/schema-sql.ts` line 7; barrel `src/index.ts`
- Surface governance for internal commands: `docs/design/harness-surface-governance.md` (ADR-065)
- Consumers: E91 task 0738 R18 (run-time pre-write abort); sibling task 0747 (shares the upstream publish)

### History

- 2026-09-03T18:28:04.136Z todo → wip (system)
- 2026-09-03T18:38:05.707Z wip → testing (system)
- 2026-09-03T18:38:19.295Z testing → done (system)
