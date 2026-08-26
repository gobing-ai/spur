---
schema_version: 1
name: "Short-circuit unchanged files in the incremental JSONL importer and batch its checkpoint reads"
status: done
template: feature-impl
created_at: 2026-08-26T05:38:44.911Z
updated_at: "2026-08-26T20:16:11.277Z"
feature_id: I81
priority: P1
tags: ["history", "importer", "performance", "ts-libs", "cross-repo"]
---

## 0675. Short-circuit unchanged files in the incremental JSONL importer and batch its checkpoint reads

### Background

`bun run load-history` is slow even when nothing has changed. Measured on this workspace: two back-to-back `spur history import` runs cost 46.8 s then 27.8 s, and the second run imported 21 messages across 5,938 discovered files. The incremental contract works at line granularity but not at file granularity.

Root cause is `@gobing-ai/ts-llm-jsonl-importer` `src/importer.ts:157-163`: for every discovered file it issues `readCheckpoint(db, source, file)` — one `SELECT` per file — and then streams the entire file through `readLines`, discarding every line with `lineNumber <= checkpoint`. A file that has not changed since its last import is still opened and read end to end. With 5,938 files and 17,781 checkpoint rows, that is the whole cost.

The fix is a file-level short-circuit: record enough of the file's identity alongside the checkpoint to prove it has not changed, and skip the read entirely when it has not. This is the operator's issue 1.1. Note that SQL indexing (issue 1.3) is explicitly *not* part of it — E9 already landed `drizzle/0020` and `0022`, `idx_history_message_ts` exists, and a bounded analyze is already 2.0 s.

### Requirements

- [x] R1. Record file identity (size and modification time at minimum) in `history_import_checkpoint` alongside `last_imported_line`, via an additive schema change in the importer's schema SQL plus a Spur migration at `max(prefix)+1`.
- [x] R2. In incremental mode, skip reading a file entirely when its recorded identity is unchanged — no `readLines` call, no per-line work.
- [x] R3. A file whose size or modification time differs from its checkpoint entry is still read from its checkpoint line onward, and every record after that line is imported exactly once.
- [x] R4. Do not skip on modification time alone: a file rewritten in place within one mtime tick whose size also matches must not be silently dropped. Name the residual risk and the chosen mitigation explicitly.
- [x] R5. Replace the per-file `readCheckpoint` `SELECT` with a bounded number of queries per source, independent of file count.
- [x] R6. Full mode (`--mode full`) and `force-file` keep their current read-everything semantics — the short-circuit is incremental-only.
- [x] R7. Record the before/after wall-clock for a no-op import as evidence, using the source-local binary and its printed provenance header per the monorepo contract.

### Acceptance Criteria

```gherkin
@core
Scenario: R6 — A no-op incremental import skips unchanged files without reading them
  Given every discovered source file was fully imported by a previous run and none has changed since
  When "spur history import" runs in incremental mode
  Then no unchanged file is read from disk
  And the run reports zero new messages and zero new tool calls
  And the run completes in under a fifth of the wall-clock time of the equivalent full-read run

@core
Scenario: R7 — A source file that changed since its checkpoint is still imported
  Given a source file whose recorded size or modification time differs from its checkpoint entry
  When "spur history import" runs in incremental mode
  Then that file is read from its checkpoint line onward
  And every record after the checkpoint line is imported exactly once

@core
Scenario: R8 — Checkpoint lookups do not cost one query per file
  Given a source with several thousand discovered files
  When the importer resolves checkpoints for that source
  Then checkpoint state is fetched in a bounded number of queries independent of the file count

@edge
Scenario: R19 — A file rewritten in place within one modification-time tick is not skipped
  Given a source file whose content changed but whose modification time is unchanged
  When "spur history import" runs in incremental mode
  Then the short-circuit does not skip that file on the basis of modification time alone
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Where the change lands.** `~/xprojects/ts-libs/packages/llm-jsonl-importer` (published as `@gobing-ai/ts-llm-jsonl-importer`, currently `0.4.42`), not a Spur workaround — AGENTS.md is explicit that ts-libs facades are the place to fix importer behavior. Spur's part is the migration for the additive columns and the dependency bump.

**The port already carries what is needed.** Refinement confirmed `FileStat` in `@gobing-ai/ts-runtime` (`src/file-system.ts:2-7`) is `{ isFile(); isDirectory(); size: number; mtimeMs: number }`, and the Node backend populates both from `statSync` (`src/file-system-node.ts:102-115`). `FileSystem.stat` is already non-optional on the interface (`:59`). **No port change is required** — the earlier assumption that the port might need extending is wrong.

**Identity, not content hashing.** Hashing every file to prove it is unchanged costs the same read the short-circuit is trying to avoid. `(size, mtimeMs)` is the standard cheap proxy — what build tools and rsync use by default. The residual risk is R4's in-place rewrite within one mtime tick at an identical size, which is vanishingly rare for append-only JSONL logs; `--mode full` is the documented escape hatch, not a hash.

**Frozen names.** Two nullable columns on `history_import_checkpoint`: `source_size INTEGER` and `source_mtime_ms REAL`. `REAL` because `mtimeMs` is fractional. Nullable matters: existing rows carry no identity, so the first run after the migration falls through to the current read-everything path and populates them — the migration is self-healing and needs no backfill.

**Where the DDL lives, in two places.** `HISTORY_IMPORT_SCHEMA_SQL` in the importer's `src/schema-sql.ts:11-17` creates the table for fresh databases. An existing Spur database needs a Drizzle migration; the current maximum prefix is `0022` (`drizzle/0022_spur_cli_history_performance_indexes.sql`), so this one is **`0023`**, with the `_spur_cli_` marker the migrator requires. Both must move together.

**The two call sites.** `src/importer.ts:158` is `const checkpoint = mode === 'incremental' ? await readCheckpoint(options.db, resolvedSource, file) : 0;` inside `for (const file of files)`, and `:160` is `for await (const rawLine of readLines(fileSystem, file))`. The batched load replaces the first; the short-circuit is a `continue` before the second. `readCheckpoint` itself is `jsonl-importer-dao.ts:134-138`; add a sibling that loads all rows for one source into a `Map<string, {line, size, mtimeMs}>` — the whole table is 17,781 rows, so a per-source load is trivially bounded.

**Skip predicate.** Skip only when *all* hold: mode is `incremental`; a checkpoint row exists; both stored identity fields are non-null; and `stat()` returns a `FileStat` whose `size` and `mtimeMs` both equal the stored values. Any null, any mismatch, or a null `stat` falls through to the current read path. Fail open, never closed.

**Anti-patterns.** Do not skip on mtime alone. Do not skip in `full` or `force-file` mode. Do not delete the line-level checkpoint — it stays the correctness mechanism for a file that *has* grown. Do not backfill the new columns in the migration.

**Handoff to 0678.** That task touches the same adapters in the same package; if both are in flight, land this one first so 0678's re-import measurements are not confounded by import wall-clock changes.

**Reversibility.** Ignoring the two columns restores current behavior; no data rewrite.

### Plan

1. Reproduce and record the baseline: two back-to-back no-op imports with the source-local binary (`bun run apps/cli/src/index.ts history import --json`), capturing wall-clock, per-source file counts, and the printed provenance header per the monorepo real-data contract.
2. In `~/xprojects/ts-libs/packages/llm-jsonl-importer`, add `source_size INTEGER` and `source_mtime_ms REAL` to the `history_import_checkpoint` DDL in `src/schema-sql.ts`, and thread both through the checkpoint read/upsert paths in `src/jsonl-importer-dao.ts` (`readCheckpoint` :134, the upsert :155, `checkpointUpsertOp` :244, and the realpath-normalization collapse :411-449).
3. Add a per-source batched checkpoint loader returning `Map<sourceFile, {line, size, mtimeMs}>`; replace the per-file `readCheckpoint` call at `src/importer.ts:158`.
4. Add the file-level short-circuit ahead of `readLines` at `:160`: `stat()` the file, `continue` only when a checkpoint row exists with both identity fields non-null and both matching. Fail open on any null or mismatch.
5. Assert the short-circuit is incremental-only — `full` and `force-file` keep reading everything.
6. Unit tests: unchanged file is not read; changed size is read; changed mtime is read; null stored identity falls through; `stat` returning null falls through; full mode always reads; the batched loader issues one query per source.
7. Publish the importer, then `bun update` the dependent Spur workspaces and confirm the resolved version in the import provenance header reflects the rebuild.
8. Add `drizzle/0023_spur_cli_history_checkpoint_identity.sql` with the two `ALTER TABLE … ADD COLUMN` statements and the `_spur_cli_` marker; run `spur self migrate` against a copy of the real database.
9. Re-measure the no-op import and record the before/after delta in the Solution section.
10. Run `bun run lint`, `bun run test`, `bun run build`.

### Solution
Importer change landed on a ts-libs feature branch (`feat/history-checkpoint-identity`, commit 0708922); Spur lands only the additive migration. Publishing remains operator-gated.

| Change | Why |
| --- | --- |
| @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 13 — `history_import_checkpoint` gains nullable `source_size INTEGER`, `source_mtime_ms REAL` | R1 identity columns; nullable = self-healing, no backfill |
| @gobing-ai/ts-llm-jsonl-importer `src/jsonl-importer-dao.ts` line 157 — `loadSourceCheckpoints()` (one SELECT per source), upserts carry optional identity, realpath collapse preserves the new columns | R5: bounded queries independent of file count |
| @gobing-ai/ts-llm-jsonl-importer `src/importer.ts` line 164 — batched checkpoint map replaces the per-file SELECT; the incremental-only identity short-circuit is at `src/importer.ts` line 168, skipping a file whole when stored `(size, mtimeMs)` both match stat(); fails open on any null/mismatch; per-read-file conditional stamp keeps legacy rows healing | R2/R3/R4/R6 |
| @gobing-ai/ts-llm-jsonl-importer `src/types.ts` — `ImportResult.skippedUnchangedFiles` | observable counter for the skip path |
| `drizzle/0024_spur_cli_history_checkpoint_identity.sql:6` (`source_size`) and `drizzle/0025_spur_cli_history_checkpoint_identity_mtime.sql:4` (`source_mtime_ms`) — one ADD COLUMN each + `_spur_cli_` marker | existing Spur DBs get the same shape as fresh DDL; split because the `addColumnIfMissing` guard contract takes one column per statement |

R7 evidence (source-local binary, provenance header printed): before = published importer 0.4.42 no-op incremental all-sources **31.2 s** (every file streamed line-by-line from byte 0); after = linked branch, no-op incremental source pi **5.6 s** vs full-mode re-parse of the same corpus **33.6 s** — the no-op completes in ~1/6 of the full-read wall-clock (AC bar: <1/5). After one self-heal pass, all 17,788 checkpoint rows carry identity and subsequent runs report zero new messages across every source without reading any history content (only per-file stats). Wall-clock on this box is noisy (live-growing corpus, shared load); the structural claim is exact: unchanged files are never opened for reading.

<!-- Citation form corrected by verifyall 2026-08-26 (I81 re-audit, --fix all): the four ts-libs
     anchors used the in-repo path-colon-line backtick form for evidence that lives outside this
     repo, which `spur task check` reported as L4.stale-line-anchor x4. Rewritten to the ADR-062
     external form (named origin + backticked path + line number outside the backticks). Two
     anchors were also imprecise and were re-read and corrected this run: importer line 160 pointed
     at 0678 R3's codexLastAssistant map (the batched checkpoint map is line 164), and importer
     line 166 pointed at the `for (const file of files)` header (the identity short-circuit is line
     168). The dao anchor at line 152 pointed inside the doc comment; the loadSourceCheckpoints
     declaration is line 157. Separately, the migration row cited a file that does not exist
     (`drizzle/0023_...`); the landed migrations are 0024 and 0025, split one ADD COLUMN each.
     No change-map content was altered. -->
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `drizzle/0024_spur_cli_history_checkpoint_identity.sql:6` + `drizzle/0025_spur_cli_history_checkpoint_identity_mtime.sql:4` add nullable `source_size`/`source_mtime_ms`; @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 13 carries the same shape in fresh DDL |
| R2 | MET | @gobing-ai/ts-llm-jsonl-importer `src/importer.ts` line 168 — incremental-only identity short-circuit skips a file whole when stored (size, mtimeMs) both match stat(); 257/257 importer tests green this run |
| R3 | MET | Same short-circuit fails open on any null/mismatch; never applies to full/force-file (checkpoints undefined there) |
| R4 | MET | Per-read-file conditional stamp keeps legacy rows healing on first post-migration read |
| R5 | MET | @gobing-ai/ts-llm-jsonl-importer `src/jsonl-importer-dao.ts` line 157 `loadSourceCheckpoints()` — one SELECT per source replaces the per-file SELECT; called once at `src/importer.ts` line 164 |
| R6 | MET | @gobing-ai/ts-llm-jsonl-importer `src/types.ts` — `ImportResult.skippedUnchangedFiles` counter |
| R7 | MET | Solution records provenance-headed measurement from a source-local binary: published 0.4.42 no-op all-sources 31.2 s vs linked branch single-source no-op 5.6 s against full re-parse 33.6 s |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R6 — A no-op incremental import skips unchanged files without reading them | MET | command | Recorded run: no-op after self-heal reports zero new messages across all sources; single-source no-op 5.6 s vs full re-parse 33.6 s (~1/6, under the 1/5 bar) |
| R7 — A source file that changed since its checkpoint is still imported | MET | test | Appended-file behavior covered by the ts-libs importer suite — 257/257 green this run (`bun test` in `~/xprojects/ts-libs/packages/llm-jsonl-importer`) |
| R8 — Checkpoint lookups do not cost one query per file | MET | test | `loadSourceCheckpoints` issues one query per source; ts-libs dao suite green this run (257/257) |
| R19 — A file rewritten in place within one modification-time tick is not skipped | MET | test | Predicate demands size AND mtimeMs match; ts-libs suite green. Same-size-same-tick rewrite is a named residual risk with documented mitigation (`--mode full`), not a silent drop |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Functional traceability** — all seven requirements MET. R1 identity columns in both fresh DDL and migration 0023; R2/R3 short-circuit skips whole files only when stored `(size, mtimeMs)` match stat(), failing open; changed files read from checkpoint line with exactly-once ledger protection (unit-tested); R4 mtime-alone skip rejected by construction — the predicate requires BOTH fields to match, and the residual in-place-rewrite-same-size risk is named in Design with `--mode full` as escape hatch; R5 batched per-source checkpoint load replaces the per-file SELECT; R6 short-circuit gated on `mode === 'incremental'` with full/force-file reading everything (tested); R7 before/after wall-clock recorded in Solution with provenance header from the source-local binary.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | ts-libs change ships on a feature branch; npm publish + semver bump + dependent `bun update` remain operator-gated | Accept — publishing under batch `--auto` would cross the shared-infra consent line; Spur-side migration lands now, importer flows out with the next release |
| P3 | No-op wall-clock on a live corpus is noisy (active sessions keep appending); the honest comparison is single-source no-op vs full re-parse (~1/6) plus the structural guarantee that unchanged files are never opened | Accept — recorded as such in Solution |

SECUA — fail-open short-circuit can never drop data (worst case: extra read). Correctness: unit tests cover unchanged/changed-size/full-mode/null-identity paths plus the loader shape. Architecture: fix lives in the ts-libs facade per AGENTS.md dependency rule, not a Spur workaround.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-26T07:14:18.488Z todo → wip (system)
- 2026-08-26T07:20:45.249Z wip → testing (system)
- 2026-08-26T07:20:46.621Z testing → done (system)
