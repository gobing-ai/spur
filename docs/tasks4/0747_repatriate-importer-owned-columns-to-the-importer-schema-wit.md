---
schema_version: 1
name: "Repatriate importer-owned columns to the importer schema without rewriting applied migrations"
status: done
template: feature-impl
created_at: 2026-09-03T16:45:42.218Z
updated_at: "2026-09-03T19:53:04.121Z"
feature_id: E92
priority: P1
tags: ["history", "schema", "ownership"]
---

## 0747. Repatriate importer-owned columns to the importer schema without rewriting applied migrations

### Background

Three Spur migrations add columns to importer-owned tables that only the importer can populate.

`0024` and `0025` (`packages/domain/src/migrations.ts:890-901`) add `source_size` and `source_mtime_ms` to `history_import_checkpoint`; the migration comment reads "0675: file identity for the incremental import short-circuit (ts-libs importer)" — Spur patching a table it does not own so an upstream feature can work.

`0026` (`packages/domain/src/migrations.ts:902-912`) adds `duration_source` to `history_message`. The column is written by Spur's post-import ETL pass `deriveAssistantDurations` (`packages/domain/src/analytics/assistant-duration.ts:47`), invoked from `packages/app/src/services/history-service.ts:528`. That function's own docstring already names the correct destination: "The importer is the correct long-term home for a real measurement, but it lives upstream ... and changing it costs a lockstep family bump plus a publish." E92 pays that cost once for the whole band.

**Ground truth checked against the current tree (2026-09-03) — two of this task's original premises were wrong and are corrected here:**

1. The importer **already defines** `source_size` and `source_mtime_ms` in `HISTORY_IMPORT_SCHEMA_SQL` (`@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts` lines 12-13, comment `0675 R1`), in both the installed `0.4.51` and the pinned `0.4.54`. Spur's runner already journals `0024`/`0025` **without executing** when `history_import_checkpoint` is absent (`packages/domain/src/migrations.ts:999-1009`, comment: "the importer seeds the checkpoint table with both identity columns already in place"). R1's DDL work is therefore **already done**; what is missing is the assertion that proves it and keeps it true.
2. `duration_source` is **not** derived at read time. It is a write-time ETL pass over the landed corpus using `LAG(ts) OVER (PARTITION BY source, session_id ORDER BY seq)`. R2 is therefore a relocation of an ETL step across the package boundary, not a read-path removal.

The failure class this closes: the importer creates its tables with `CREATE TABLE IF NOT EXISTS` (`applyHistoryImportSchema`, `src/jsonl-importer-dao.ts` line 123), so against an existing database a new upstream column is silently never applied. Spur's `addColumnIfMissing` guard has been papering over that, one migration per column.

### Requirements

- [x] R1. `source_size` and `source_mtime_ms` are defined by the importer's own schema; Spur's migrations for them become no-ops on a database where the importer already applied them.
- [x] R2. `duration_source` is defined by the importer and written at import from the record the importer already parsed; Spur stops deriving it at read time.
- [x] R3. Applied migration files are not edited or renumbered; convergence happens through new migrations plus upstream DDL.
- [x] R4. A database migrated through the old path and one created fresh through the new path converge to the same schema, asserted by comparing the resulting table definitions.

### Acceptance Criteria

```gherkin
Feature: History schema DDL ownership repatriation

  @core
  Scenario: R1 — Importer checkpoint identity columns are defined by the importer
    Given the file-identity columns source_size and source_mtime_ms that back the importer's incremental short-circuit
    When the importer schema is applied to an empty database
    Then history_import_checkpoint carries both columns without any Spur migration running
    And the incremental short-circuit works against a database built from the importer schema alone.


  @core
  Scenario: R2 — Assistant duration provenance is written at import, not derived at read time
    Given assistant steps whose duration is either provider-reported or computed as a timestamp delta
    When the corpus is imported
    Then history_message.duration_source is populated by the importer at write time
    And no read path recomputes duration provenance
    And a derived duration is never reported as provider-measured.


  @core
  Scenario: R7 — Repatriation does not rewrite applied migration history
    Given migrations 0018, 0024, 0025, and 0026 already applied to production databases
    When the repatriated schema is applied to those databases
    Then every previously applied migration remains in the ledger
    And each becomes a guarded no-op rather than being edited or removed
    And no column is dropped, duplicated, or re-typed.


  @edge
  Scenario: R10 — Upstream and downstream schemas converge to the same shape
    Given a database built by applying the importer schema alone
    And a database built by applying the importer schema plus the full Spur migration set
    When the resolved table structures for the importer-owned tables are compared
    Then both carry the same columns with the same types
    And any difference is limited to consumer-owned indexes.

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:17:30.770Z

**Does the importer need new DDL for `source_size` / `source_mtime_ms`? — No.** Verified against the current tree: both columns are already in `HISTORY_IMPORT_SCHEMA_SQL` (`src/schema-sql.ts` lines 12-13) in `0.4.51` and `0.4.54`, and Spur's runner already journals `0024`/`0025` without executing on importer-seeded databases (`packages/domain/src/migrations.ts:999-1009`). R1 is reduced to an assertion. The task's original Background claimed otherwise and has been corrected.

**Is `duration_source` derived at read time? — No.** It is written by a post-import ETL pass (`deriveAssistantDurations`), not by any query path. R2 is a cross-package relocation of that pass, not the removal of a read-time computation. Background corrected.

**Does the whole derivation move upstream, or only the DDL? — The whole pass moves.** AC R2 requires the column to be "populated by the importer at write time"; leaving the producer in Spur would leave the column co-written by two packages, which is exactly the ambiguity ADR-105 axis two exists to remove. The function is self-contained (one `DbAdapter`, one windowed query, two constants), so the move is mechanical and its existing test suite is the regression proof.

**Do we introduce a `'provider'` value to disambiguate `NULL`? — No, deferred.** `NULL` currently conflates "provider-reported" with "no duration at all". Making it explicit would require backfilling every provider-reported row in a 4.2 GB database, and no AC in E92 asks for it. Revisit only if a consumer needs to distinguish the two; owner: whoever raises that consumer requirement.

**One upstream publish or two? — One.** 0747 and 0748 both change the importer. Cutting two releases doubles the resync cost and creates a window where the schema changed but the version constant did not. 0748 owns the bump.

### Design

**WHAT.** Move the DDL authority for `history_import_checkpoint.source_size` / `.source_mtime_ms` and `history_message.duration_source` to the importer package, and move the ETL pass that writes `duration_source` with it. Spur keeps its applied migrations as guarded no-ops and gains a convergence assertion.

**WHY.** ADR-105 axis two: a column is owned by the party that can populate it at write time. File identity and duration provenance are both produced during import; recovering either downstream is guesswork over data the importer already had. ADR-104 fixes the split; this task is the first half of making it true in code.

**WHERE.** Upstream `@gobing-ai/ts-llm-jsonl-importer`: `src/schema-sql.ts`, `src/jsonl-importer-dao.ts`, `src/index.ts`, plus a new `src/assistant-duration.ts`. Downstream Spur: `packages/domain/src/analytics/assistant-duration.ts` (deleted), `packages/domain/src/analytics/index.ts`, `packages/app/src/services/history-service.ts:528`, `packages/domain/tests/dao/migrations.test.ts`.

**Frozen names**

| Name | Where | Kind |
| --- | --- | --- |
| `deriveAssistantDurations` | importer `src/assistant-duration.ts` | moved function, signature unchanged |
| `DURATION_SOURCE_DERIVED` | importer `src/assistant-duration.ts` | moved constant, value stays `'derived'` |
| `DERIVED_DURATION_CEILING_MS` | importer `src/assistant-duration.ts` | moved constant, value stays `30 * 60 * 1000` |
| `DeriveAssistantDurationsResult` | importer `src/assistant-duration.ts` | moved interface, fields unchanged |
| `duration_source` | importer `src/schema-sql.ts` `history_message` block | new column in the static DDL |
| `0032_spur_cli_importer_schema_version` | reserved by task 0748 | do **not** reuse this prefix here |

This task adds **no** new Spur migration. If implementation discovers one is unavoidable, the next free prefix is `0032` and it collides with 0748 — coordinate before taking it.

**Precedence and algorithm**

1. **`source_size` / `source_mtime_ms` — assert, do not add.** The upstream DDL already carries them. The work is a test asserting that a database built from `applyHistoryImportSchema` alone has both columns and that the incremental short-circuit works against it, plus the convergence assertion in R4. `0024`/`0025` stay exactly as they are.
2. **`duration_source` — relocate DDL and producer together.** Add the column to the importer's `history_message` block in `HISTORY_IMPORT_SCHEMA_SQL`; move `assistant-duration.ts` upstream verbatim (the SQL, the ceiling, the non-positive-delta rule, the `AND duration_ms IS NULL` idempotency guard); re-export from the importer barrel; have `history-service.ts:528` import it from `@gobing-ai/ts-llm-jsonl-importer` instead of `@gobing-ai/domain`; delete the Spur copy and repoint its test.
3. **Provenance encoding is unchanged.** `NULL` = provider-reported or absent; `'derived'` = timestamp delta. Do **not** introduce a `'provider'` value: no AC requires it, and it would force a full-corpus backfill of a 4.2 GB database. `forensic-query.ts:926` (`SUM(m.duration_source IS 'derived')`) must keep working byte-identically.
4. **Migrations converge forward.** `0024`/`0025`/`0026` have already run on the operator's database. Editing them would put applied history at odds with the files — a worse failure than the duplication being removed. They stay; the guards already make them no-ops on any database the importer seeded.
5. **R4 is the proof obligation.** Build database A from `applyHistoryImportSchema` alone and database B from `applyHistoryImportSchema` + `applyCliMigrations`, then compare `PRAGMA table_info` for `history_import_checkpoint`, `history_message`, `history_tool_call`, and `history_skill_call`. Column names and declared types must match exactly; the only permitted difference is Spur-owned indexes (axis three).

**Anti-patterns**

- **Do not edit or renumber `0024`/`0025`/`0026`.** R3 exists precisely to forbid this. Convergence is forward-only.
- **Do not leave two copies of `deriveAssistantDurations`.** A re-export shim in Spur that keeps the old implementation alive means the two can diverge; delete the Spur file in the same change.
- **Do not change the derivation's semantics while relocating it.** No new ceiling, no zero-fill for non-positive deltas (0680 R6: absent is not zero), no dropping the `duration_ms IS NULL` guard. A relocation that silently becomes a behavior change is unreviewable.
- **Do not add `duration_source` via a new Spur migration.** That would recreate exactly the ownership violation this task removes.
- **Do not assume the installed importer is current.** `node_modules` holds `0.4.51`, the catalog pins `^0.4.54`, and `0.4.51`'s dist has no `history_skill_call` at all. Resync before asserting anything about upstream DDL.

**Handoff to dependents**

Nothing in E91 or E92 lists 0747 as a dependency, so it may run first or in parallel. It does share the upstream publish with 0748: **publish one importer version carrying both 0747's and 0748's changes**, and let 0748 own the version bump and the `HISTORY_IMPORT_SCHEMA_VERSION` value. Do not cut two releases.

Authority: ADR-104, ADR-105; `docs/design/history-incremental-materialization.md` section 11 (D9).

### Plan

1. **R1 (assert, no DDL change).** Add a test building a database from `applyHistoryImportSchema` alone and asserting `history_import_checkpoint` carries `source_size` and `source_mtime_ms`, and that an incremental import short-circuits on an unchanged file against that database. Test intent: prove the upstream DDL is the source of truth so a future upstream deletion fails here rather than in production.
2. **R2a (upstream DDL).** Add `duration_source TEXT` to the `history_message` block of `HISTORY_IMPORT_SCHEMA_SQL`.
3. **R2b (upstream producer).** Move `deriveAssistantDurations` and its two constants into the importer as `src/assistant-duration.ts`, export from the barrel, and port `packages/domain/tests/analytics/assistant-duration.test.ts` alongside it unchanged. Test intent: the six existing cases (derive, provider-wins, no-predecessor, non-positive delta, over-ceiling, idempotent re-run) must pass verbatim after the move — that is what proves it is a relocation and not a rewrite.
4. **R2c (downstream repoint).** Delete `packages/domain/src/analytics/assistant-duration.ts`, drop its re-export from `packages/domain/src/analytics/index.ts:27-28`, and repoint `packages/app/src/services/history-service.ts:528` at the importer barrel. Confirm `forensic-query.ts:926` still compiles and returns the same shape.
5. **R3 (no rewrites).** Assert that `0024`, `0025`, and `0026` are byte-unchanged and still journaled, and that each is a no-op against a database seeded by the importer schema. Test intent: R3 is a negative requirement, so the only evidence is an assertion that the files and the ledger both still contain them.
6. **R4 (convergence).** Compare `PRAGMA table_info` for the four importer-owned tables between a schema-only database and a schema-plus-migrations database; assert identical column names and declared types, differences permitted only in indexes.
7. **Release.** Coordinate a single importer publish with task 0748, resync the Spur workspace off `0.4.51`, then run `bun run spur-check` and `bun run test`.

### Solution

Repatriated importer-owned column DDL and ETL pass to `@gobing-ai/ts-llm-jsonl-importer`.

| File | Rationale |
| --- | --- |
| `packages/app/src/services/history-service.ts:528` | Invoke deriveAssistantDurations from @gobing-ai/ts-llm-jsonl-importer |
| `packages/domain/tests/dao/migrations.test.ts:800` | Verify history schema migrations and upstream DDL convergence |

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/tests/dao/migrations.test.ts:788` — builds a DB from `applyHistoryImportSchema` alone, asserts `history_import_checkpoint.source_size` (INTEGER) and `.source_mtime_ms` (REAL), and writes/reads an incremental checkpoint row; ran fresh this run (`cd packages/domain && bun test tests/dao/migrations.test.ts` → 53 pass, 0 fail). |
| R2 | MET | `packages/domain/tests/dao/migrations.test.ts:823` — `history_message.duration_source TEXT` comes from importer DDL. Producer relocated upstream: Spur copy `packages/domain/src/analytics/assistant-duration.ts` deleted, `packages/app/src/services/history-service.ts:71` imports `deriveAssistantDurations` from `@gobing-ai/ts-llm-jsonl-importer` and `:528` invokes it; installed importer 0.4.55 dist carries `assistant-duration.js` and the barrel export. Ported suite passes fresh this run: @gobing-ai/ts-llm-jsonl-importer `tests/assistant-duration.test.ts` — 6 pass, 0 fail. No read path recomputes provenance (`packages/domain/src/analytics/forensic-query.ts:926` still reads the column byte-identically). |
| R7 | MET | `packages/domain/tests/dao/migrations.test.ts:834` — `0024`/`0025`/`0026` remain defined in `CLI_MIGRATIONS` unmodified, apply as guarded no-ops over an importer-seeded DB, and are journaled in `__spur_cli_migrations`; no column dropped, duplicated, or re-typed (convergence test at :863). |
| R10 | MET | `packages/domain/tests/dao/migrations.test.ts:863` — `PRAGMA table_info` compared across `history_import_checkpoint`, `history_message`, `history_tool_call`, `history_skill_call` between importer-schema-only and importer-schema-plus-CLI-migrations DBs; column names and declared types match exactly. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Importer checkpoint identity columns are defined by the importer | MET | test | `packages/domain/tests/dao/migrations.test.ts:788` — fresh run 53 pass, 0 fail |
| Scenario: R2 — Assistant duration provenance is written at import, not derived at read time | MET | test | `packages/domain/tests/dao/migrations.test.ts:823` + @gobing-ai/ts-llm-jsonl-importer `tests/assistant-duration.test.ts` — 6 pass, 0 fail (fresh) |
| Scenario: R7 — Repatriation does not rewrite applied migration history | MET | test | `packages/domain/tests/dao/migrations.test.ts:834` — fresh run 53 pass, 0 fail |
| Scenario: R10 — Upstream and downstream schemas converge to the same shape | MET | test | `packages/domain/tests/dao/migrations.test.ts:863` — fresh run 53 pass, 0 fail |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- Parent feature: `docs/features/E92_history-schema-ddl-ownership-repatriation.md`
- `docs/00_ADR.md` — ADR-104 (importer/Spur DDL authority split), ADR-105 (three-axis ownership rule)
- `docs/design/history-incremental-materialization.md` — section 11 (D9, DDL authority)
- Spur migrations `0024`/`0025`/`0026`: `packages/domain/src/migrations.ts:890-912`; runner guards at `packages/domain/src/migrations.ts:999-1013`
- ETL pass being relocated: `packages/domain/src/analytics/assistant-duration.ts:47`; call site `packages/app/src/services/history-service.ts:528`; consumer `packages/domain/src/analytics/forensic-query.ts:926`
- Upstream DDL: `@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts` lines 7-17 (checkpoint), line 29 (`history_message`); `src/jsonl-importer-dao.ts` line 123 (`applyHistoryImportSchema`)
- Sibling: task 0748 (shares the upstream publish and owns the version bump)

### History

- 2026-09-03T18:25:27.568Z todo → wip (system)
- 2026-09-03T18:26:30.241Z wip → testing (system)
- 2026-09-03T18:26:41.111Z testing → done (system)
