---
schema_version: 1
name: "Import ledger retention to reduce database size without affecting board reads"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.254Z
updated_at: "2026-09-03T17:45:55.287Z"
feature_id: E91
priority: P3
tags: ["history", "storage", "retention"]
---

## 0746. Import ledger retention to reduce database size without affecting board reads

### Background
Measured at freeze time, against the live 4.20 GB database (1,026,057 pages of 4,096 bytes, freelist 0):

| Object | Size |
| --- | --- |
| `history_message` | 1,708 MB |
| `history_import_ledger` | 650 MB |
| `history_tool_call` | 310 MB |
| `sqlite_autoindex_history_import_ledger_1` | 181 MB |
| `sqlite_autoindex_history_message_1` | 142 MB |
| nine `history_message` / `history_tool_call` indexes | 438 MB |

The ledger plus its primary-key index is 831 MB, **20.7% of the database** — the AC's "substantial share", now a number. For scale, all message text in the corpus is 857 MB.

Three premises in the original decomposition need correcting, and they change what this task is.

**Retention already exists.** `packages/domain/src/retention.ts` defines `runRetention` at line 48, `purgeLedger` at line 78 issuing `DELETE FROM history_import_ledger WHERE imported_at < ?`, a 180-day `LEDGER_RETENTION_DAYS` window at line 26, and it is already wired into the daily pipeline at `packages/app/src/services/history-service.ts:882` with tests at `packages/domain/tests/retention.test.ts`. This task does not add retention; retention is here.

**The existing age window is structurally ineffective for this table.** Ledger `imported_at` spans 2026-08-31 to 2026-09-03 — three days, for a corpus whose messages span 275 days back to 2025-08-08. `imported_at` records when the row was *imported*, not how old the data is, so a full re-import resets the entire table to "today" and a 180-day window never fires. Age retention is a correct backstop for an abandoned database; it is not a size lever for an actively imported one.

**There are currently zero safely purgeable ledger rows.** The ledger holds 2,285,677 rows: 1,791,462 targeting `history_message` and 494,215 targeting `history_tool_call`, which are exactly the row counts of those two tables. It is a 1:1 index of live target rows, and each row is load-bearing for the importer, which reads it three ways. `ledgerExistingHashes` in `@gobing-ai/ts-llm-jsonl-importer` `src/jsonl-importer-dao.ts` line 386 is the import dedup short-circuit, and losing a row there costs only rework because the target insert is `ON CONFLICT(record_hash) DO NOTHING`. The other two are not forgiving: `reconcileFullImport` at line 592 deletes target rows whose ledger entry is absent from the desired set, so a purged ledger row strands its target row permanently beyond reconciliation; and `readOpenCodeExistingEntries` at line 711 drives the OpenCode forced-import supersede, so a purged ledger row leaves superseded rows in place. Purging more aggressively by age would break both.

So the lever that satisfies this task is compaction, not deletion — which is why the requirement says "retention **or** compaction".
### Requirements
- [ ] R1. A retention or compaction policy is applied to the import ledger.
- [ ] R2. Database size is measurably reduced, recorded before and after.
- [ ] R3. Every History board query returns results identical to those before the reduction.
- [ ] R4. Import correctness is unaffected: a re-import after compaction still short-circuits correctly for already-imported files.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @edge
  Scenario: R15 — Import ledger retention reduces database size without affecting board reads
    Given an import ledger occupying a substantial share of database size
    When the retention or compaction policy is applied
    Then database size is measurably reduced
    And every History board query returns results identical to those before the reduction.


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:45:55.286Z

**Why not just purge the ledger harder?** Because the measurement says there is nothing to purge. Ledger rows number exactly 1,791,462 plus 494,215 — the row counts of `history_message` and `history_tool_call` — so every row shadows a live target row, and two of the importer's three ledger consumers delete target rows based on ledger contents. Purging would trade 831 MB for stranded rows and a broken supersede path.

**Why is the 180-day window kept if it never fires?** It is the correct backstop for a database that stops being imported into, and removing it would be a regression for that case. It is retained and simply is not the lever.

**Why `VACUUM` rather than `VACUUM INTO` plus a swap?** `VACUUM INTO` produces a second file that something must atomically move into place while no reader holds the original open. This code runs inside a daily pipeline with no safe place to perform that swap; plain `VACUUM` does the equivalent work in place under a lock SQLite manages itself.

**Why gate on estimated reclaim rather than always running?** A multi-minute exclusive lock that reclaims one percent is a worse outcome than not running. The threshold makes the cost proportional to the benefit, and every skip records why.

**The 181 MB primary-key index is real and is not addressed here.** `record_hash TEXT PRIMARY KEY` on a rowid table stores every hash twice. A `WITHOUT ROWID` ledger would reclaim most of that, but the table's DDL belongs to `@gobing-ai/ts-llm-jsonl-importer` under the ownership rule, so it is an upstream change with a lockstep family bump, not an E91 change. Deferred with that owner named.

**Deferred:** narrowing `source_file` from a repeated absolute path to a reference. Same owner, same reason, larger blast radius.
### Design
**WHAT.** Add an explicit database compaction pass that repacks the file, gate it so it runs only when it will reclaim enough to be worth its cost, and record database size before and after.

**WHY.** Every ledger row is currently load-bearing, so deleting rows is not available. What is available is the space the file wastes on partially filled pages. The ledger's 2.29 million rows arrive interleaved across eight sources over many import runs, which is the access pattern that leaves B-tree pages least full; `VACUUM` rewrites the file with pages packed, reclaiming that slack without changing a single row. It provably cannot change a query result, and it cannot affect import correctness, which is what makes it the right answer to R3 and R4 rather than merely a passing one.

**WHERE — frozen names.**

| Name | Kind | Location |
| --- | --- | --- |
| `compactDatabase` | function `(db, opts) => Promise<CompactionResult>` | `packages/domain/src/retention.ts` |
| `CompactionResult` | interface `{ ran: boolean; skippedReason?: string; bytesBefore: number; bytesAfter: number }` | same file |
| `COMPACTION_MIN_RECLAIM_RATIO` | const, the estimated reclaimable fraction below which compaction is skipped | same file |
| `COMPACTION_MIN_INTERVAL_DAYS` | const, the minimum spacing between compaction runs | same file |
| `estimateReclaimableBytes` | function using `dbstat` to sum page slack | same file |
| `compaction` | new field on `RetentionResult` carrying the `CompactionResult` | same file |

`historyBoardDatabaseBytes` at `packages/domain/src/analytics/history-board-rollup.ts:1181` already returns `page_count * page_size` and is reused for the before and after measurements rather than reimplemented. `dbstat` is available in this project's `bun:sqlite` build, verified during refinement, but `estimateReclaimableBytes` still degrades to reporting zero reclaimable — and therefore skipping — if the virtual table is missing, because `dbstat` is a compile-time-optional module and a hard dependency on it would turn a missing feature into a crash in the daily pipeline.

**Gating precedence, evaluated in this order.** `VACUUM` takes an exclusive lock for minutes and needs free disk space roughly equal to the database size, so it must never run as an unconditional daily step:

1. Skip if a compaction ran within `COMPACTION_MIN_INTERVAL_DAYS`.
2. Skip if `estimateReclaimableBytes` is below `COMPACTION_MIN_RECLAIM_RATIO` of the current size.
3. Skip if free disk space on the database's filesystem is below the database size plus a margin. Running out of space mid-`VACUUM` is the one way this operation can hurt, and checking beforehand is cheap.
4. Otherwise run `VACUUM`, measure after, and record both numbers with the skip reason field absent.

Every skip records a reason. A compaction pass that silently does nothing is indistinguishable from one that is broken.

**Where it is invoked.** `runRetention` gains the compaction call after its four existing purges, so the free pages those purges create are reclaimed in the same pass, and so compaction inherits the same best-effort isolation the purges have — a compaction failure records `ran: false` and never aborts the daily run. No new public `spur` noun or verb is added: the gating makes the automatic path safe, and adding a public command surface would need operator consent with design context that nothing here requires.

**Anti-patterns — do not do these.**

- Do not lower `LEDGER_RETENTION_DAYS` to reclaim space. It would strand target rows beyond `reconcileFullImport`'s reach and break OpenCode's supersede path, and the measured data shows it would purge nothing anyway.
- Do not run `VACUUM` unconditionally in the daily pipeline. The lock and the disk requirement are real.
- Do not use `VACUUM INTO`. It writes a second file and requires an atomic swap this code has no safe place to perform.
- Do not switch the database to `PRAGMA auto_vacuum = FULL`. It moves the cost into every write and fragments differently; incremental auto-vacuum would need a full `VACUUM` to enable anyway.
- Do not change `history_import_ledger`'s columns, types, or `WITHOUT ROWID`-ness. That table's DDL belongs to `@gobing-ai/ts-llm-jsonl-importer` under the ownership rule; its 181 MB primary-key index is a real cost and a legitimate upstream question, but it is not this task's to change.
- Do not report the reclaimed amount as a projection. R2 requires recorded before and after values from an actual run.

**Handoff to dependents.** Nothing in E91 or E92 consumes this task's output, and it has no prerequisites: it touches `packages/domain/src/retention.ts` and nothing any other task in either feature edits. It is ordered last only so its measurement reflects the finished system, including the free pages that task 0741's repeated per-bucket deletes will produce.

Authority: ADR-104 and ADR-105 (why the ledger's DDL stays upstream); design section 9 (D7).
### Plan
1. Add `CompactionResult`, `COMPACTION_MIN_RECLAIM_RATIO`, `COMPACTION_MIN_INTERVAL_DAYS`, and `estimateReclaimableBytes` to `packages/domain/src/retention.ts`. Test intent: with `dbstat` absent the estimate returns zero and the caller skips rather than throwing; with it present the estimate is non-negative and bounded by the database size.
2. Implement `compactDatabase` with the four gating conditions in order, each recording its own skip reason. Test intent: each condition independently produces a skip with its own reason string, and only the all-clear case runs `VACUUM`.
3. Add the free-disk-space precondition. Test intent: a simulated insufficient-space condition skips rather than attempting the operation.
4. Extend `RetentionResult` with the `compaction` field and call `compactDatabase` from `runRetention` after the existing purges, inside the same best-effort isolation. Test intent: a thrown compaction error yields `ran: false` and the surrounding retention result is otherwise unaffected.
5. Assert board-read invariance across a compaction. Test intent: a fixed matrix of History board queries returns identical results before and after `VACUUM`, run as an automated test rather than by inspection.
6. Assert import correctness across a compaction. Test intent: a re-import after compaction still short-circuits on already-imported files via the checkpoint, `ledgerExistingHashes` still finds every retained hash, and a full-mode reconciliation reports zero stale rows.
7. Record database size before and after on the real corpus using the source-local CLI, with binary and importer provenance. Test intent: the recorded numbers are from an actual run, and the per-object `dbstat` breakdown is recorded alongside so the reclaimed space can be attributed.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- Design satellite: `docs/design/history-incremental-materialization.md` section 9 (D7)
- ADR-104 (importer and Spur DDL authority split), ADR-105 (three-axis ownership): `docs/00_ADR.md`
- Existing retention, its windows, and its best-effort contract: `packages/domain/src/retention.ts`
- Daily-pipeline wiring: `packages/app/src/services/history-service.ts:882`
- Existing retention tests to extend: `packages/domain/tests/retention.test.ts`
- Database-size helper reused for before and after: `packages/domain/src/analytics/history-board-rollup.ts:1181`
- Ledger consumers that make rows load-bearing: `@gobing-ai/ts-llm-jsonl-importer` `src/jsonl-importer-dao.ts` lines 386, 592, and 711
- Ledger listed as importer-owned in the reset table set: `packages/domain/src/analytics/history-reset.ts:48`
### History
