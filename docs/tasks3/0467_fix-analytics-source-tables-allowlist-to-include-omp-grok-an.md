---
template: feature-impl
schema_version: 1
name: "Fix analytics SOURCE_TABLES allowlist to include omp, grok, and agy history ETL tables"
description: ""
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-07T05:02:00.489Z"
updated_at: "2026-08-07T21:45:58.317Z"
---

## 0467. Fix analytics SOURCE_TABLES allowlist to include omp, grok, and agy history ETL tables

### Background
Graduated from the consumption-surface investigation (feature E1). **Standalone bug — no dependencies,
fixable today**, independent of the forensic ETL work.

`SOURCE_TABLES` (`packages/domain/src/analytics/query.ts:8-16`) is a hardcoded compile-time allowlist
of seven history ETL tables: pi, claude, codex, gemini, opencode, antigravity, openclaw. It **omits
`history_etl_omp`, `history_etl_grok`, and `history_etl_agy`** — three of the six sources feature E1
declares in scope.

**Impact is live, not theoretical.** Two consumers read through this allowlist:

- `queryAllEtlRecords` (`packages/domain/src/analytics/query.ts:55-72`) — so `spur history analyze`
  reports totals that silently exclude omp, grok, and agy.
- `loadAllEtlPayloads` (`packages/domain/src/analytics/run-cost.ts:103`) — so workflow run-cost
  attribution under-reports every omp-executed step. `agent.default` is `omp`
  (`config/config.example.yaml`), which makes this the common case, not an edge case.

The allowlist exists for a real reason documented in the file: SQLite cannot parameterize identifiers,
so these names are interpolated into SQL directly and must never derive from user input. **Keep that
invariant** — this is an allowlist extension, not a removal.

A later ticket cuts analyze over to a single `history_message` table, which dissolves the per-source
allowlist entirely. That does not make this fix redundant: it is a wrong-answer bug until then, and
the run-cost path may keep reading ETL tables afterward.
### Requirements
- R1 — Add `history_etl_omp`, `history_etl_grok`, and `history_etl_agy` to the `SOURCE_TABLES` allowlist without weakening the compile-time-constant security invariant that keeps table names out of user input.
- R2 — Tolerate a missing source table in `queryAllEtlRecords`: an allowlisted table the importer has never created must be skipped, not throw. The three added tables are absent from the static importer schema and created only on demand, so the extension introduces this crash unless the guard lands with it. Malformed payloads must still fail loud.
- R3 — Verify `queryAllEtlRecords` returns rows for the added sources, and that the derived `source` string (currently `table.replace('history_etl_', '')`) yields the correct source identifier for each.
- R4 — Verify `loadAllEtlPayloads` picks up the added tables, and record the measured outcome that post-0466 run-cost attribution is still blind to omp-executed steps because those payloads now live in `history_message` — deferring that fix to its own ticket rather than absorbing it here.
- R5 — Add a regression test that fails if a source is added to the importer's schema but not to this allowlist, so the two lists cannot drift apart again silently.
### Acceptance Criteria
```gherkin
Feature: 0467 analytics source allowlist covers every in-scope source

  Scenario: R1 — analyze sees omp, grok, and agy records
    Given a database holding imported records in history_etl_omp, history_etl_grok, and history_etl_agy
    When queryAllEtlRecords runs with no since bound
    Then records from all three tables are returned
    And each record carries the correct source identifier
    And table names remain compile-time constants never derived from user input

  Scenario: R2 — an allowlisted table that was never created does not crash analyze
    Given a database where one allowlisted source table has never been created
    When queryAllEtlRecords runs
    Then the missing table is skipped and the remaining tables are returned
    And a malformed payload in an existing table still raises rather than being skipped

  Scenario: R3 — the derived source identifier is correct per table
    Given rows in each of the added history ETL tables
    When queryAllEtlRecords derives the source string for each row
    Then omp, grok, and agy are produced respectively

  Scenario: R4 — run-cost coverage is measured, not assumed
    Given imported omp history and a workflow action run executed by the omp agent
    When loadAllEtlPayloads runs
    Then the added tables are among those read
    And the measured result records whether omp payloads were found, since post-0466 they are written to history_message

  Scenario: R5 — the allowlist cannot silently drift from the schema again
    Given the importer declares its source definitions with their target tables
    When the drift regression test runs
    Then it fails if any declared source table is absent from SOURCE_TABLES
```
### Q&A
**Closed during implement-ready refinement (2026-08-07):**

- *Does extending `SOURCE_TABLES` actually restore omp/grok/agy coverage for `analyze`?* **No.**
  Verified against the landed 0466 mappers: those three sources now write `history_message` /
  `history_tool_call`, never `history_etl_<source>`. The extension recovers **pre-0466 legacy rows
  only**. The task stays worth doing (legacy rows, missing-table hardening, drift test) but its
  Requirements were rewritten so nobody implements it believing the coverage gap closes here. The
  real fix is task 0474.
- *Do the three added tables exist?* **Not statically.** `HISTORY_IMPORT_SCHEMA_SQL`
  (`ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts`) creates only pi, claude, codex, gemini,
  opencode, antigravity, openclaw. The other three are created on demand by `ensureTargetTables`
  when that source is first imported. Original R2 assumed they were in the static schema; it was
  wrong, and the consequence is a real crash — so R2 became the missing-table guard (R6) rather than
  a confirmation step.
- *Why not make production code derive the allowlist from `SOURCE_DEFINITIONS`?* It would defeat the
  security invariant at `query.ts:4-7` — table names are interpolated into SQL because SQLite cannot
  parameterize identifiers, so they must stay compile-time constants. The drift **test** reads
  `SOURCE_DEFINITIONS`; production code does not.
- *Should this ticket also fix workflow run-cost attribution?* **No — deferred, with an owner
  needed.** `loadAllEtlPayloads` reads only `history_etl_*`, so post-0466 it sees none of the six
  converted sources, and `agent.default` is `omp`. That is a wider regression than this ticket's
  scope and 0474 does not fix it either (0474 rewrites `analyze`, not run-cost). Reopen as its own
  E1 ticket. **Operator decision pending:** file it now, or fold it into 0474's scope.

**Ordering:** none. No `dependencies[]`; independent of 0465/0466/0474. Sequence it before 0474 only
if the legacy-row recovery is wanted; otherwise 0474 supersedes the analyze half of it.
### Design
**WHAT.** Extend the `SOURCE_TABLES` allowlist (`packages/domain/src/analytics/query.ts:8-16`) to the
three missing sources, harden `queryAllEtlRecords` against a table that does not exist, and add a
drift test that binds the allowlist to the importer's own source definitions.

**WHY — and the correction that changes this task's value.** The allowlist genuinely omits
`history_etl_omp`, `history_etl_grok`, `history_etl_agy`. But **verified against the landed code
2026-08-07, extending it does not restore analyze coverage for those three sources**, and the ticket
must not be implemented under the belief that it does:

- Every custom-mapper source routes each split entry to `history_message` / `history_tool_call` via a
  per-entry `targetTable` (`ts-libs/packages/llm-jsonl-importer/src/mappers.ts` — `targetTable:
  'history_message'` / `'history_tool_call'` at every emit site). Task 0466 converted **claude,
  codex, pi, omp, grok, agy** to that path.
- Their `SourceDefinition.targetTable` is still `history_etl_<source>`
  (`src/sources.ts:87,133`), and `ensureTargetTables` (`src/jsonl-importer-dao.ts:104-115`) still
  creates it on demand — but **no row is ever written to it** post-0466.

So `history_etl_omp` / `_grok` / `_agy` are, from 0466 onward, permanently empty tables. Adding them
to the allowlist returns whatever **pre-0466 legacy rows** exist and nothing more. The live
wrong-answer for omp/grok/agy that Background describes is real, but its fix is the
`history_message` read path — task **0474** for `analyze`; run-cost attribution is **not** covered by
this ticket or by 0474 and needs its own decision (see Handoff).

**This task is therefore worth doing for three narrower, still-real outcomes**, and should be scoped
to exactly those:

1. Legacy `history_etl_omp|grok|agy` rows imported before 0466 become visible instead of silently
   dropped.
2. `queryAllEtlRecords` stops being able to crash on a missing table — today it will throw
   `no such table` for any allowlisted table the importer has never created, because unlike
   `loadAllEtlPayloads` (`packages/domain/src/analytics/run-cost.ts:105-110`, which already
   `try/catch continue`s) it has no such guard. Adding three names that are **not** in the static
   `HISTORY_IMPORT_SCHEMA_SQL` (`src/schema-sql.ts` creates only pi, claude, codex, gemini, opencode,
   antigravity, openclaw) introduces that crash unless the guard lands in the same change.
3. The allowlist can no longer drift silently from the importer's source list.

**WHERE.**

| File | Change |
| --- | --- |
| `packages/domain/src/analytics/query.ts:8-16` | Append `history_etl_omp`, `history_etl_grok`, `history_etl_agy` to `SOURCE_TABLES`. Keep `as const` and the `SourceTable` narrowing. |
| `packages/domain/src/analytics/query.ts:55-72` | `queryAllEtlRecords` — wrap the per-table `queryAll` in `try/catch` and `continue` on a missing table, matching the existing `loadAllEtlPayloads` behavior. Do **not** swallow `parsePayload` failures: a malformed payload must still fail loud. |
| `packages/domain/src/analytics/run-cost.ts:103` | No change — `loadAllEtlPayloads` reads `SOURCE_TABLES` and inherits the extension and the existing guard. |
| `packages/domain/tests/analytics/*.test.ts` | Per-table source-identifier coverage, missing-table tolerance, and the drift regression. |

**Frozen names — no new API.** `SOURCE_TABLES`, `SourceTable`, `queryEtlRecords`,
`queryAllEtlRecords`, `parsePayload`, `etlToCostRecord`, `loadAllEtlPayloads` all keep their current
names and signatures. This task adds three array entries, one `try/catch`, and tests. Nothing else.

**The security invariant is load-bearing — preserve it verbatim.** The comment at
`query.ts:4-7` exists because SQLite cannot parameterize identifiers and these names are interpolated
into SQL. The extension must stay a hardcoded `as const` literal array. **Do not** derive
`SOURCE_TABLES` at runtime from `SOURCE_DEFINITIONS`, from a glob of `sqlite_master`, or from any
importer export — that would convert a compile-time allowlist into a runtime-derived identifier and
defeat the invariant. The drift *test* may read `SOURCE_DEFINITIONS`; production code may not.

**Drift test (R5) — bind the two lists in the test, not in production.** Import `SOURCE_DEFINITIONS`
from `@gobing-ai/ts-llm-jsonl-importer` (exported from `src/index.ts:7-13`), map each definition's
`targetTable`, and assert that set is a subset of `SOURCE_TABLES`. That fails the moment a new source
lands in the importer without an allowlist entry, which is precisely how omp/grok/agy were missed.

**Anti-patterns:**

- Do **not** remove or relax the allowlist "because 0474 dissolves it". Until the SQL cut-over lands,
  this is the only path analyze has.
- Do **not** add the three tables to `HISTORY_IMPORT_SCHEMA_SQL` in ts-libs to make them "always
  exist". They are dead tables post-0466; creating them statically for every project makes the dead
  surface permanent. The missing-table guard is the correct fix.
- Do **not** claim in `### Solution` that this restores omp/grok/agy analyze coverage. It restores
  legacy-row coverage only. Overstating it hides the live gap from the next reader.
- Do **not** touch `etlToCostRecord`'s token estimate here — that is 0474 R7's retirement.

**Handoff.**

- **Assumes from deps:** none. No `dependencies[]`; implementable today against the current tree.
- **Leaves for 0474:** the actual omp/grok/agy coverage fix, via `history_message`. 0474 R7 retires
  `queryAllEtlRecords` outright, so keep this change small — it is deliberately short-lived for the
  analyze path.
- **Leaves unowned — surface it, do not absorb it:** workflow run-cost attribution
  (`loadAllEtlPayloads` → `matchEtlPayloads`, `run-cost.ts:103,131`) still reads only
  `history_etl_*`. Post-0466 it sees no claude/codex/pi/omp/grok/agy payloads at all — a wider
  regression than the one this ticket names, and `agent.default` is `omp`. 0474 does not fix it
  either (it rewrites `analyze`, not run-cost). This needs its own ticket under E1; do not silently
  expand this one to cover it.

**ADR: no.** Three literals, one guard, one test. No structural decision.
### Plan
- [ ] **0. Baseline.** `bun run lint` and `bun test packages/domain` green before changes.
- [ ] **1. Missing-table guard first (R6, red before green).** Add a test asserting
      `queryAllEtlRecords` returns rows from existing tables when an allowlisted table is absent from
      the DB. It must fail today (`no such table`), then pass. Landing this **before** step 2 is the
      point — step 2 is what introduces the crash.
- [ ] **2. Extend the allowlist (R1).** Append `history_etl_omp`, `history_etl_grok`,
      `history_etl_agy` to `SOURCE_TABLES` (`packages/domain/src/analytics/query.ts:8-16`), keeping
      `as const` and the security comment untouched.
- [ ] **3. Source-identifier coverage (R3).** Seed one row in each added table; assert
      `queryAllEtlRecords` derives `omp`, `grok`, `agy` respectively from
      `table.replace('history_etl_', '')`.
- [ ] **4. Record the schema finding (R2).** Confirm in code — not from memory — that the three
      tables are absent from `HISTORY_IMPORT_SCHEMA_SQL` and created only on demand by
      `ensureTargetTables`. Write that finding into `### Solution`; it is the justification for
      step 1's guard.
- [ ] **5. Run-cost check (R4).** Assert `loadAllEtlPayloads` includes the added tables. Then verify
      the honest outcome: post-0466 omp payloads live in `history_message`, so run-cost coverage is
      **not** restored. Record that in `### Solution` and confirm the follow-up ticket exists rather
      than fixing it here.
- [ ] **6. Drift regression (R5).** Test-only import of `SOURCE_DEFINITIONS` from
      `@gobing-ai/ts-llm-jsonl-importer`; assert every definition's `targetTable` is present in
      `SOURCE_TABLES`. Confirm it fails when one entry is removed.
- [ ] **7. Gates.** `bun run lint`, `bun run test`, `bun run build`. No skipped tests.
- [ ] **8. Record.** `### Solution` gets the `path:line` change map, the schema finding from step 4,
      and the explicit statement that omp/grok/agy analyze coverage is 0474's, not this ticket's.
### Solution
Extended the compile-time `SOURCE_TABLES` allowlist with the three missing sources, hardened `queryAllEtlRecords` against a missing table, and added a drift regression binding the allowlist to the importer's source definitions. **Scope correction honored:** this recovers pre-0466 legacy `history_etl_*` rows only — it does **not** restore omp/grok/agy coverage for `analyze` or run-cost attribution, because post-0466 those sources write `history_message`/`history_tool_call`. That live gap is task 0474 (analyze) and an unfiled E1 ticket (run-cost).

**Changes**

- `packages/domain/src/analytics/query.ts:8-19` — Appended `history_etl_omp`, `history_etl_grok`, `history_etl_agy` to `SOURCE_TABLES`. Kept `as const` and the `SourceTable` narrowing; the security comment at lines 4-7 is untouched — names remain compile-time constants never derived from user input.
- `packages/domain/src/analytics/query.ts:62-77` — `queryAllEtlRecords`: wrapped the per-table `db.queryAll` in `try/catch continue`, matching the existing `loadAllEtlPayloads` guard (`run-cost.ts:107-111`). A missing table is skipped; `parsePayload` stays **outside** the try so a malformed `payload_json` in an existing table still fails loud. Without this guard, adding three names absent from the static schema would crash every `spur history analyze`.
- `packages/domain/src/analytics/run-cost.ts` — **No change.** `loadAllEtlPayloads` reads `SOURCE_TABLES` and inherits both the extension and its existing missing-table guard.

**Tests** (`packages/domain/tests/analytics/`)

- `query.test.ts` — R2/R6: `queryAllEtlRecords` skips allowlisted-but-absent tables without throwing (fresh DB with only 2 of 10 tables created). R3: seeds one row in each added table, asserts derived `source` is `omp`, `grok`, `agy`. R5: drift regression asserts every `SOURCE_DEFINITIONS` `targetTable` is in `SOURCE_TABLES`, plus a teeth-check proving the assertion fails when an entry is removed.
- `run-cost.test.ts` — R4: `loadAllEtlPayloads` returns payloads seeded in the three added tables.

**Schema finding (R2/R6 justification, plan step 4)**

Confirmed in source — not memory: `history_etl_omp`, `history_etl_grok`, `history_etl_agy` are **absent** from `HISTORY_IMPORT_SCHEMA_SQL` (`ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts` — grep returns no match) and are created **only on demand** by `ensureTargetTables` (`jsonl-importer-dao.ts:104`). The missing-table guard is therefore mandatory, not optional — a fresh project that has never imported those sources would otherwise crash `queryAllEtlRecords`.

**Run-cost finding (R4, plan step 5 — honest outcome)**

`loadAllEtlPayloads` now reads the added tables when present. **But** post-0466, omp/grok/agy (and claude/codex/pi) payloads are written to `history_message`, not `history_etl_<source>`, so run-cost attribution for `agent.default: omp` is **not restored** by this ticket. That is a wider regression than this ticket's scope and 0474 does not fix it either (0474 rewrites `analyze`, not run-cost). **Needs its own E1 ticket** — left unfiled; operator decision pending (see Q&A).

**What this does NOT do**

- Does not restore omp/grok/agy analyze coverage — that is 0474's `history_message` read path.
- Does not fix run-cost attribution for post-0466 sources — deferred, needs its own E1 ticket.
- Does not touch `etlToCostRecord` token estimates — that is 0474 R7.
- Does not add the three tables to the static importer schema — they are dead tables post-0466; the missing-table guard is the correct fix (Design anti-pattern).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `query.ts:16-18` — omp/grok/agy appended; `as const` (`:19`) + `SourceTable` (`:22`) preserved; security comment `:4-7` re-read, names remain compile-time constants |
| R2 | MET | `query.ts:63-77` — `try/catch continue` guard; `parsePayload` (`:79`) outside try (fail-loud). Schema finding verified: omp/grok/agy = 0 matches in `HISTORY_IMPORT_SCHEMA_SQL`. Test: `query.test.ts:350-369` |
| R3 | MET | `query.test.ts:374-401` — derived `source` sorts to `['agy','grok','omp']`; derivation at `query.ts:61` |
| R4 | MET | `run-cost.test.ts:292-305` — `loadAllEtlPayloads` reads added tables; Solution honestly records run-cost coverage **not restored** post-0466, deferred to unfiled E1 ticket |
| R5 | MET | `query.test.ts:409-428` — drift regression + teeth-check; 10/10 `SOURCE_DEFINITIONS` targetTables covered |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — analyze sees omp/grok/agy records | MET | test | `query.test.ts:374-401` + `query.ts:16-18` |
| Scenario: R2 — missing allowlisted table does not crash | MET | test | `query.test.ts:350-369`; `query.ts:63-77` |
| Scenario: R3 — derived source identifier correct | MET | test | `query.test.ts:374-401`; `query.ts:61` |
| Scenario: R4 — run-cost coverage measured, not assumed | MET | test | `run-cost.test.ts:292-305` + Solution `:244` |
| Scenario: R5 — allowlist cannot drift from schema | MET | test | `query.test.ts:409-428` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Dev review (2026-08-07, `--auto`).** Three-dimensional: functional traceability + SECUA + architecture. Diff scope: `packages/domain/src/analytics/query.ts`, `packages/domain/tests/analytics/query.test.ts`, `packages/domain/tests/analytics/run-cost.test.ts` (3 files).

**Functional Verdict: PASS** — all 5 requirements MET with `file:line` evidence.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/domain/src/analytics/query.ts:16-18` — `history_etl_omp`, `history_etl_grok`, `history_etl_agy` appended to `SOURCE_TABLES`; `as const` + `SourceTable` narrowing preserved; security comment at `:4-7` untouched |
| R2 | MET | `query.ts:62-77` — `try/catch continue` wraps `db.queryAll`; `parsePayload` (`:79`) stays **outside** the try so malformed payloads fail loud. Test: `query.test.ts:349-369` (fresh DB, 2 of 10 tables, no throw) |
| R3 | MET | `query.test.ts:373-401` — seeds one row per added table, asserts derived `source` sorts to `['agy','grok','omp']`; derivation at `query.ts:61` |
| R4 | MET | `run-cost.test.ts:292-305` — `loadAllEtlPayloads` returns `['agy-1','grok-1','omp-1']` from seeded added tables; Solution honestly records run-cost coverage is **not restored** post-0466 and defers to its own E1 ticket |
| R5 | MET | `query.test.ts:408-429` — drift regression asserts every `SOURCE_DEFINITIONS` `targetTable` ⊆ `SOURCE_TABLES`, plus teeth-check proving removal fails. Verified live: 10 declared tables, 0 missing |

**Design conformance: DONE.** 3/3 design claims implemented exactly: allowlist extension (frozen names, no API change), missing-table guard matching `loadAllEtlPayloads`, drift test reads `SOURCE_DEFINITIONS` (production does not). No scope creep — diff is exactly the 3 files the Design WHERE-table names.

**P1–P4 findings**

| Pri | Finding | Disposition |
|-----|---------|-------------|
| P1 | None — no blocker findings | N/A — clean |
| P2 | None — security invariant (compile-time `as const` allowlist, no runtime derivation), correctness (fail-loud `parsePayload` outside `try`), efficiency, and usability all clean | N/A |
| P3 | Duplicated `try { queryAll } catch { continue }` guard idiom between `queryAllEtlRecords` (`query.ts:62-77`) and `loadAllEtlPayloads` (`run-cost.ts:107-111`); divergent post-parse handling makes a shared helper a shallow wrapper | Advisory — leave as-is; 0474 R7 retires `queryAllEtlRecords`, making extraction premature. Revisit only if a third consumer appears |
| P4 | Two read paths over `SOURCE_TABLES` with different parse strictness: `queryAllEtlRecords` fails loud, `loadAllEtlPayloads` silently skips. Predates 0467, intentional (analyze = correctness path; run-cost = best-effort) | Noted — the split dissolves when 0474 lands the `history_message` read path. No action this ticket |

**SECUA dimensions:** Security clean (invariant preserved verbatim, `query.ts:4-7`); Correctness clean (fail-loud covered by `query.test.ts:316-344`); Efficiency clean (no new allocation/scan); Usability clean (frozen names, no API change); Architecture → P3/P4 above.

**Residual risk:** none for this ticket's scope. The live omp/grok/agy coverage gap is correctly deferred: analyze → 0474, run-cost → unfiled E1 ticket (Solution `:244`, Q&A `:103-107`). This ticket recovers pre-0466 legacy rows only, as scoped.

**Disposition: PASS** — cleared for `done`. Evidence: analytics suite 90 pass / 0 fail, `query.ts` 100% line coverage; Biome clean on all 4 files; `SOURCE_DEFINITIONS` cross-check (10 declared tables, 0 missing from allowlist).
### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-07T21:40:25.887Z todo → wip (system)
- 2026-08-07T21:45:57.506Z wip → testing (system)
- 2026-08-07T21:45:58.317Z testing → done (system)
