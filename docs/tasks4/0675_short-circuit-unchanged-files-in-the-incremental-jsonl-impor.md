---
schema_version: 1
name: "Short-circuit unchanged files in the incremental JSONL importer and batch its checkpoint reads"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.911Z
updated_at: "2026-08-26T05:39:24.000Z"
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
- [ ] R1. Record file identity (size and modification time at minimum) in `history_import_checkpoint` alongside `last_imported_line`, via an additive schema change in the importer's schema SQL plus a Spur migration at `max(prefix)+1`.
- [ ] R2. In incremental mode, skip reading a file entirely when its recorded identity is unchanged — no `readLines` call, no per-line work.
- [ ] R3. A file whose size or modification time differs from its checkpoint entry is still read from its checkpoint line onward, and every record after that line is imported exactly once.
- [ ] R4. Do not skip on modification time alone: a file rewritten in place within one mtime tick whose size also matches must not be silently dropped. Name the residual risk and the chosen mitigation explicitly.
- [ ] R5. Replace the per-file `readCheckpoint` `SELECT` with a bounded number of queries per source, independent of file count.
- [ ] R6. Full mode (`--mode full`) and `force-file` keep their current read-everything semantics — the short-circuit is incremental-only.
- [ ] R7. Record the before/after wall-clock for a no-op import as evidence, using the source-local binary and its printed provenance header per the monorepo contract.
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

**Where the change lands.** `@gobing-ai/ts-llm-jsonl-importer` in `~/xprojects/ts-libs`, not a Spur workaround — AGENTS.md is explicit that ts-libs facades are the place to fix importer behavior. Spur's part is the migration for the two additive columns and the dependency bump.

**Identity, not content hashing.** Hashing every file to prove it is unchanged costs the same read the short-circuit is trying to avoid. `(size, mtimeMs)` is the standard cheap proxy — it is what build tools and rsync use by default — and `fileSystem.stat` is already in the `FileSystem` port (`importer.ts:549` uses it for roots). The residual risk is R4's in-place rewrite within one mtime tick at identical size, which is vanishingly rare for append-only JSONL logs; a `--mode full` run is the escape hatch and should be named as such in the docs rather than defended with a hash.

**Why not store the line count instead.** Line count is only knowable by reading the file, which defeats the purpose.

**Batching the checkpoint read.** `readCheckpoint` per file is an N-query pattern over a table already keyed `(source, source_file)`. One `SELECT source_file, last_imported_line, size, mtime FROM history_import_checkpoint WHERE source = ?` per source, materialized into a `Map`, is the whole change — the table is 17,781 rows total, so a per-source load is trivially bounded.

**Schema shape.** Two nullable columns (`source_size`, `source_mtime_ms`) added to `history_import_checkpoint`. Nullable matters: existing rows carry no identity, so the first run after the migration must fall through to the current read-everything path and populate them. That makes the migration self-healing and needs no backfill.

**Reversibility.** Ignoring the two columns restores current behavior; no data rewrite.

### Plan

1. Reproduce and record the baseline: two back-to-back no-op imports with the source-local binary, capturing wall-clock, file counts, and the provenance header.
2. In ts-libs, add `source_size` and `source_mtime_ms` (nullable) to the importer's checkpoint schema SQL and to the checkpoint DAO read/upsert paths.
3. Replace the per-file `readCheckpoint` with a per-source batched load into a `Map`.
4. Add the file-level short-circuit in the `for (const file of files)` loop: `stat` the file, compare against the map entry, skip when both identity fields match and are non-null.
5. Preserve full/`force-file` semantics; assert the short-circuit is incremental-only.
6. Unit tests: unchanged file is not read; changed size is read; changed mtime is read; null identity falls through; full mode always reads; batched lookup issues one query per source.
7. Publish the importer, `bun update` the dependent Spur workspaces, and add the Spur migration at `max(prefix)+1`.
8. Re-measure the no-op import and record the delta; run `bun run lint`, `bun run test`, `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
