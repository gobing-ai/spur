---
schema_version: 1
name: "Source-to-table registry replacing hardcoded table lists, with an ownership conformance test"
status: done
template: feature-impl
created_at: 2026-09-03T16:45:42.330Z
updated_at: "2026-09-03T20:05:57.590Z"
feature_id: E92
priority: P2
tags: ["history", "schema", "registry"]
---

## 0749. Source-to-table registry replacing hardcoded table lists, with an ownership conformance test

### Background

`packages/domain/src/analytics/history-reset.ts:14` declares `HISTORY_RESET_TABLES`, an explicit list of **29** `history_*` tables in four groups: 3 normalized import outputs plus 2 Spur session tables, 10 `history_etl_*` landing tables, 12 derived analytics tables (`history_daily_stats` + 11 `history_board_*`), and 2 importer bookkeeping tables.

**Premise corrected against the current tree (2026-09-03).** This task's original Background said the file "hardcodes ten `history_*` table names" at lines 22-30. That is wrong on both counts, and two further facts change the shape of the work:

1. The list is 29 entries starting at line 14; the ten `history_etl_*` names are one group within it.
2. The explicit list is **deliberate**, not an oversight. Its docstring: *"Kept explicit (not scraped from `sqlite_master` at runtime) so a reset only ever wipes a consciously listed table; `resetHistoryTables` reports any unlisted `history_*` table it finds instead of deleting it."* `HistoryResetResult.unknown` exists to carry that drift signal. **Runtime discovery over `sqlite_master` is therefore not an acceptable implementation of R1** — it would delete the safety property along with the duplication.
3. `SOURCE_DEFINITIONS` is **already exported** from the importer barrel (`@gobing-ai/ts-llm-jsonl-importer` `src/index.ts`), and each definition carries `targetTable: \`history_etl_${source}\``. The`history_etl_*` half of the registry can be derived today with no upstream change. What is *not* exported is the typed-table list: `TYPED_TABLE_COLUMNS`is module-private (`src/jsonl-importer-dao.ts` line 21).
4. The 10 hardcoded `history_etl_*` names currently **match** the 10 members of `LlmJsonlSource` exactly. There is no live drift; the hazard is prospective — nothing keeps the two in step, so adding a source upstream silently leaves its landing table behind on the next reset.

More broadly, ADR-105's three-axis ownership rule — table DDL by layer, columns by value producer, indexes by query consumer — is a document. Documents do not fail builds. The eight Spur migrations that touch importer-owned tables (`0024`/`0025`/`0026` ALTER; `0009`/`0020`/`0022`/`0029`/`0030` INDEX) were all written by people who had not read a rule that did not yet exist; the next one will be too.

### Requirements

- [x] R1. The importer exports the source-to-table registry; Spur consumes it instead of a hardcoded table list, and adding a source upstream requires no Spur change for reset to cover its tables.
- [x] R2. A conformance test fails when a Spur migration creates a table the ownership rule assigns to the importer, or when a Spur migration adds a column to an importer-owned table without a recorded exception.

### Acceptance Criteria

```gherkin
Feature: History schema DDL ownership repatriation

  @core
  Scenario: R6 — Raw landing table names come from the importer, not a hardcoded list
    Given the importer's source definitions determining every history_etl_* target table
    When Spur enumerates raw landing tables for reset
    Then the table names are read from the importer's exported registry
    And adding a new source upstream requires no change to Spur's reset code
    And a reset covers every table the importer can create.


  @core
  Scenario: R8 — Ownership is enforced, not merely documented
    Given the three-axis ownership rule assigning table DDL, fact columns, and indexes to owners
    When a Spur migration adds a column to an importer-owned table
    Then a check fails identifying the table, the column, and the owner the rule assigns
    And index creation on importer-owned tables is permitted without failing that check.


```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:17:33.374Z

**Can the registry be built by scraping `sqlite_master`? — No.** `history-reset.ts`'s docstring rejects runtime discovery explicitly and gives the reason: a reset must only ever wipe a consciously listed table, and unlisted `history_*` tables are reported through `HistoryResetResult.unknown` as a drift signal rather than deleted. The registry is assembled from static upstream declarations; the safety property is preserved verbatim. The task's original Background did not record this and has been corrected.

**How much of the registry already exists? — The `history_etl_*` half.** `SOURCE_DEFINITIONS` is already exported from the importer barrel and each definition carries its `targetTable`. The missing piece is the typed-table list (`TYPED_TABLE_COLUMNS`, module-private). The upstream change is therefore one promoted export plus one assembled constant, not a new subsystem.

**Is there live drift today? — No.** The 10 hardcoded `history_etl_*` names match the 10 members of `LlmJsonlSource` exactly. R1 is prospective insurance, and the task is honest about that: its value is the no-Spur-change proof in step 3, not a bug fix.

**Does the Spur half of the list become dynamic too? — No.** Axis one assigns those 14 tables to Spur, which creates them; enumerating them from the database would reintroduce the "wipe whatever we find" hazard the docstring was written to prevent.

**Why is the exception list only three entries? — Because indexes are permitted by the rule, not by exception.** `0009`/`0020`/`0022`/`0029`/`0030` are `CREATE INDEX` on importer-owned tables, which axis three assigns to Spur; the test permits them unconditionally. Only the three ALTER migrations (`0024`/`0025`/`0026`) need recording, and task 0747 retires them.

**Deferred: extending conformance beyond migrations.** The test is scoped to `CLI_MIGRATIONS` because that is where all eight historical violations occurred. Runtime `db.exec` DDL elsewhere in Spur is not covered. Deferred until a violation appears outside migrations; owner: whoever finds one.

### Design

**WHAT.** Replace the importer-owned half of `HISTORY_RESET_TABLES` with a registry exported by the importer, keep the Spur-owned half an explicit literal, and add a test that fails when a Spur migration violates ADR-105's ownership axes.

**WHY.** The importer creates its tables — three typed, two bookkeeping, and one `history_etl_*` per source — so only the importer can enumerate them correctly. A copy in Spur is a promise to remember. The conformance test is what turns ADR-105 from prose into a build failure.

**WHERE.** Upstream `@gobing-ai/ts-llm-jsonl-importer`: `src/jsonl-importer-dao.ts` (export the typed list), `src/sources.ts` or a new `src/tables.ts` (assemble the registry), `src/index.ts` (barrel). Downstream Spur: `packages/domain/src/analytics/history-reset.ts`, and a new `packages/domain/tests/dao/ownership-conformance.test.ts`.

**Frozen names**

| Name | Where | Kind |
| --- | --- | --- |
| `IMPORTER_OWNED_TABLES` | importer, exported from `src/index.ts` | `readonly string[]` — the 3 typed + 2 bookkeeping + every `SOURCE_DEFINITIONS[*].targetTable` |
| `TYPED_HISTORY_TABLES` | importer `src/jsonl-importer-dao.ts` | `readonly string[]` — promotes the keys of the module-private `TYPED_TABLE_COLUMNS` to the public surface |
| `SPUR_OWNED_HISTORY_TABLES` | `packages/domain/src/analytics/history-reset.ts` | `readonly string[]` — the 14 Spur-owned names, still an explicit literal |
| `HISTORY_RESET_TABLES` | same file | unchanged name and type; now `[...IMPORTER_OWNED_TABLES, ...SPUR_OWNED_HISTORY_TABLES]` |
| `OWNERSHIP_EXCEPTIONS` | `packages/domain/tests/dao/ownership-conformance.test.ts` | recorded, reviewed allow-list keyed by migration id |

The 29-entry split is exact and checkable: importer-owned = 3 typed (`history_message`, `history_tool_call`, `history_skill_call`) + 10 `history_etl_*` + 2 bookkeeping (`history_import_checkpoint`, `history_import_ledger`) = **15**; Spur-owned = `history_run_session`, `history_task_session`, `history_daily_stats`, and 11 `history_board_*` = **14**. 15 + 14 = 29, matching today's list exactly. **A change in that total is a review signal, not a rounding error.**

**Precedence and algorithm**

1. **Registry, not discovery.** `IMPORTER_OWNED_TABLES` is assembled at module load from static declarations — the typed-table keys and `SOURCE_DEFINITIONS` — never from `sqlite_master`. The safety property in `history-reset.ts`'s docstring survives verbatim: a reset still only ever wipes a consciously declared table.
2. **The `unknown` drift signal survives unchanged.** `resetHistoryTables` must keep reporting any unlisted `history_*` table it finds instead of deleting it, and `HistoryResetResult.unknown` keeps its meaning. Sourcing part of the list from upstream narrows what lands in `unknown`; it must not silence it.
3. **Only the importer half moves.** The 14 Spur-owned names stay a literal in `history-reset.ts`. Spur creates those tables, so Spur enumerating them is correct under axis one — replacing them with anything dynamic would be the same mistake in the other direction.
4. **R1's proof is an upstream-only change.** Add a source definition upstream in a test fixture and assert Spur's reset covers its landing table with no Spur edit. That is the only evidence that the copy is actually gone.
5. **The conformance test reads migration declarations, not a live database.** `CLI_MIGRATIONS` in `packages/domain/src/migrations.ts` is a static array of `{ id, sql, addColumnIfMissing? }`. The test parses each entry's SQL for `CREATE TABLE` and `ALTER TABLE ... ADD COLUMN` targets and fails when the target is in `IMPORTER_OWNED_TABLES` and the migration id is not in `OWNERSHIP_EXCEPTIONS`. `CREATE INDEX` is permitted unconditionally — axis three assigns indexes to the query consumer, which is Spur.
6. **Seed the exception list with today's real violations, and only those.** `0024`, `0025`, and `0026` add columns to importer-owned tables; they are grandfathered with a comment pointing at task 0747, which repatriates the columns. `0009`/`0020`/`0022`/`0029`/`0030` are `CREATE INDEX` and need no exception at all — rule 5 permits them by construction. Once 0747 lands, the three ALTER exceptions become the visible remaining debt.

**Anti-patterns**

- **Do not scrape `sqlite_master`.** The existing docstring rejects this explicitly and gives the reason; an implementation that does it anyway is a regression dressed as a simplification.
- **Do not delete or weaken the `unknown` reporting.** It is the drift detector, and the registry does not replace it.
- **Do not make the Spur half dynamic too.** Axis one puts those 14 tables under Spur; enumerating them from the database would reintroduce the "wipe whatever we find" hazard.
- **Do not write a conformance test with no escape hatch.** A test that cannot be excepted gets disabled the first time it is inconvenient, and then it protects nothing. The exception list is what keeps it alive — but each entry carries a comment naming why and what retires it.
- **Do not blanket-except index migrations.** They are permitted by the rule itself, not by exception; putting them in the allow-list would hide the fact that the rule already allows them.
- **Do not re-derive the ownership split by hand.** The 15/14 = 29 arithmetic above is the checked ground truth; any implementation that produces a different total has found a real discrepancy and must stop.

**Handoff to dependents**

Nothing in E91 or E92 consumes this task's output, and it has no prerequisites: `SOURCE_DEFINITIONS` is already exported, so the upstream change here is additive and independent. It does touch the same importer package as its two siblings in this feature, so if their release has not yet been cut, fold this export into it rather than publishing twice; if it has, cut a release for `IMPORTER_OWNED_TABLES` alone. Either order works.

Authority: ADR-105; `docs/design/history-incremental-materialization.md` section 11 (D9).

### Plan

1. **R1a (upstream export).** Promote the keys of `TYPED_TABLE_COLUMNS` to an exported `TYPED_HISTORY_TABLES`, assemble `IMPORTER_OWNED_TABLES` from those plus the two bookkeeping tables plus every `SOURCE_DEFINITIONS[*].targetTable`, and export it from the barrel. Test intent: the assembled list must equal the 15 importer-owned names in today's `HISTORY_RESET_TABLES` — a mismatch means the ownership split in the design is wrong, not the test.
2. **R1b (downstream consume).** Rewrite `history-reset.ts` as `SPUR_OWNED_HISTORY_TABLES` (the 14 literals) plus `IMPORTER_OWNED_TABLES`, delete the importer names from the literal, and keep the docstring's explicit-list rationale and the `unknown` drift reporting intact.
3. **R1c (no-Spur-change proof).** Add a test that registers an extra source definition upstream and asserts Spur's reset covers its `history_etl_*` table with no edit to Spur code. Test intent: this is the only assertion that distinguishes "consumes a registry" from "copied the registry once".
4. **R1d (regression).** Assert `HISTORY_RESET_TABLES` still contains exactly the same 29 names as before the change, and that `resetHistoryTables` still returns unlisted `history_*` tables in `unknown` rather than clearing them.
5. **R2a (conformance test).** Add `packages/domain/tests/dao/ownership-conformance.test.ts` parsing `CLI_MIGRATIONS` for `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` targets, failing on an importer-owned target without a recorded exception, and permitting `CREATE INDEX` unconditionally. Test intent: encode ADR-105 axes one and two as a build failure; axis three is encoded as the index permission.
6. **R2b (seed exceptions).** Record `0024`, `0025`, `0026` in `OWNERSHIP_EXCEPTIONS`, each with a comment naming task 0747 as what retires it. Assert the list is exactly those three — a fourth entry appearing means someone added a violation.
7. Run `bun run test` and `bun run spur-check`.

### Solution

Replaced hardcoded importer tables in history-reset with IMPORTER_OWNED_TABLES registry and added ownership conformance test.

| File | Rationale |
| --- | --- |
| `packages/domain/src/analytics/history-reset.ts:37` | Compose reset table list from importer-owned and Spur-owned tables |
| `packages/domain/tests/dao/ownership-conformance.test.ts:47` | Add ownership conformance tests over migration DDL and table registry |

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R6 | MET | `packages/domain/src/analytics/history-reset.ts:37` — `HISTORY_RESET_TABLES = [...IMPORTER_OWNED_TABLES, ...SPUR_OWNED_HISTORY_TABLES]`; registry exported from the importer barrel: @gobing-ai/ts-llm-jsonl-importer `src/index.ts` — `IMPORTER_OWNED_TABLES` and `TYPED_HISTORY_TABLES`; installed 0.4.55. No-Spur-change proof: test `R1c: upstream-added source landing table automatically covered without Spur edit` at `packages/domain/tests/dao/ownership-conformance.test.ts:158`; regression tests `:116` (29 = 15 importer + 14 Spur) and `:122` (exact names). Suite ran fresh: 7 pass, 0 fail. |
| R8 | MET | `packages/domain/tests/dao/ownership-conformance.test.ts:55` — fails on any `CLI_MIGRATIONS` CREATE TABLE / ALTER TABLE ADD COLUMN targeting an importer-owned table without a recorded exception; `:46` bounds `OWNERSHIP_EXCEPTIONS` to exactly the 3 grandfathered migrations (`0024`/`0025`/`0026`, retired by 0747); `:97` permits CREATE INDEX unconditionally (axis three). Suite ran fresh: 7 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Raw landing table names come from the importer, not a hardcoded list | MET | test | `packages/domain/tests/dao/ownership-conformance.test.ts:158` (R1c no-Spur-edit coverage), `:116`, `:122` — 7 pass, 0 fail (fresh); composition at `packages/domain/src/analytics/history-reset.ts:37` |
| Scenario: R8 — Ownership is enforced, not merely documented | MET | test | `packages/domain/tests/dao/ownership-conformance.test.ts:55` (violation fails), `:46` (exceptions = 3), `:97` (indexes permitted) — 7 pass, 0 fail (fresh) |
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
- `docs/00_ADR.md` — ADR-105 (three-axis ownership rule: table DDL by layer, columns by value producer, indexes by query consumer)
- `docs/design/history-incremental-materialization.md` — section 11 (D9, DDL authority)
- `packages/domain/src/analytics/history-reset.ts:14` — `HISTORY_RESET_TABLES` (29 entries) and its explicit-list rationale; `HistoryResetResult.unknown` at the same file
- `packages/domain/src/migrations.ts` — `CLI_MIGRATIONS`; the ALTER violations at lines 890-912 (`0024`/`0025`/`0026`) and the permitted index migrations `0009`/`0020`/`0022`/`0029`/`0030`
- Upstream registry: `@gobing-ai/ts-llm-jsonl-importer` `src/sources.ts` line 155 (`SOURCE_DEFINITIONS`, already exported), `src/jsonl-importer-dao.ts` line 21 (`TYPED_TABLE_COLUMNS`, currently module-private)
- Sibling: task 0747 (repatriates the three ALTER columns that seed the exception list)

### History

- 2026-09-03T18:38:59.019Z todo → wip (system)
- 2026-09-03T18:44:00.445Z wip → testing (system)
- 2026-09-03T18:44:14.752Z testing → done (system)
