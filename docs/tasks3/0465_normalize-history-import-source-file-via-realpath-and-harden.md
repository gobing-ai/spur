---
template: feature-impl
schema_version: 1
name: "Normalize history import source_file via realpath and harden line-number checkpoints"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-07T00:27:39.582Z"
updated_at: "2026-08-07T01:01:53.429Z"
---

## 0465. Normalize history import source_file via realpath and harden line-number checkpoints

### Background
**Implementation task** graduated from wayfinder prototype **0457** (feature E1).

**Problem (measured):**
1. **P1 path identity** — `discoverFiles` stores `source_file` via `resolvePath` only (no `realpath`). The same physical session file imported via a symlink path and a real path yields **two** `history_import_checkpoint` rows and re-imports all lines (duplicate ledger rows). Every agent dir under `$HOME` is a symlink into `~/tools/dot_files/config/`, so this hits all sources.
2. **P2 rewrite skip** — under `--mode incremental`, `lineNumber <= checkpoint` silently drops content when a file is rewritten shorter with different lines. Not observed on current claude/codex/pi/omp/grok/agy (append-only), but is a data-loss hazard for any future compacting agent.

**Evidence:** task 0457 Testing (scratch re-runs under `/tmp/spur-0457-reverify/`). Do **not** re-open 0457 for the fix — implement here / upstream in `@gobing-ai/ts-llm-jsonl-importer`.

**Placement:** Operator ruling — ts-libs packages are in scope via `bun link`. Prefer fixing the importer facade over a Spur-only workaround.
### Requirements
- [ ] R1. Normalize every `source_file` through filesystem `realpath` at file-discovery time, so symlink and real paths collapse to one checkpoint, ledger, and `record_hash` identity. Fall back to the original path when `FileSystem.realPath` is unavailable or the path does not resolve.
- [ ] R2. Prove with a scratch-DB test that importing via a symlinked path and then the real path of the same file yields exactly one checkpoint row and re-imports no already-seen content.
- [ ] R3. Rule on the rewrite guard in writing rather than in code: 0457 established all six in-scope agents are append-only, so the guard is deferred with a stated reopening condition. No size/mtime/hash guard is implemented in this task.
- [ ] R4. Provide an idempotent migration that rewrites existing `source_file` values to their realpath across `history_import_checkpoint`, `history_import_ledger`, and any contract table present, collapsing duplicate checkpoint rows to the highest `last_imported_line`. Running it twice changes nothing.
- [ ] R5. Preserve the 0457 behaviors that already passed: `--dry-run` does not advance checkpoints, and `--mode full` resets only the imported source's scope.
### Acceptance Criteria
```gherkin
Feature: Checkpoint path identity and rewrite safety

  Scenario: R1 — symlink and real path share one checkpoint
    Given a JSONL file reachable via a symlink and its real path
    When spur history import --mode incremental runs against each path in turn
    Then history_import_checkpoint has exactly one row for that physical file
    And the second import does not re-import already-ledgered lines as new content

  Scenario: R2 — rewrite shorter does not silently lose new content
    Given a file imported to line N then rewritten shorter with different content
    When spur history import --mode incremental runs again
    Then the new content is imported or the run fails loudly with a documented recovery path
    And dry-run still does not advance checkpoints
```
### Q&A
**Closed during specification (2026-08-07):**

- *Does normalizing `source_file` affect anything beyond the checkpoint?* Yes, and this is the task's
  main risk. `record_hash` is `sha256({source, sourceFile, sourceLine, splitIndex, record})`
  (`src/importer.ts:93-99`), so `sourceFile` is inside the hash. Changing its representation changes
  every hash, `ledgerExists()` stops matching, and the whole corpus silently re-imports under new
  hashes while the old rows remain. Hence R4's migration — see `### Design` for the two options and
  why in-place migration is preferred.
- *Where should normalization happen?* Once, at file discovery. Normalizing at write time leaves the
  hash and the checkpoint disagreeing, which is worse than the original bug.
- *Is `FileSystem.realPath` always available?* No — it is optional in the interface
  (`ts-runtime/src/file-system.ts:75`). The Node implementation has it
  (`file-system-node.ts:116`); injected and in-memory test doubles may not. Fall back, never throw,
  and never bypass the injected `FileSystem` to call `node:fs` directly.
- *Should the rewrite guard ship here?* No. 0457's verdict was that line-number checkpointing is
  sufficient for the current agents because all six are append-only; only path identity was a real
  defect. Implementing a guard now is speculative complexity. R3 is satisfied by a reasoned,
  written deferral.

**Ordering with 0466:** none. Both write `source_file`; whichever lands second rebases. The migration
is written to normalize whatever tables it finds, so it covers the contract tables if 0466 landed
first.
### Design
**WHAT.** Normalize every `source_file` through `realpath` before it is used as a checkpoint, ledger,
or hash key, so the same file reached by a symlinked path and its real path collapses to one identity.
Plus an explicit ruling on the rewrite guard.

**WHY.** 0457 R4 proved symlink and real paths produce two checkpoint rows for one file. On this
machine that is not an edge case: **every** agent history dir under `$HOME` is a symlink into
`~/tools/dot_files/config/`, so the ambient path and the resolved path differ for all six sources.

**THE MIGRATION HAZARD — read this before writing code.** `record_hash` is
`sha256({source, sourceFile, sourceLine, splitIndex, record})` (`src/importer.ts:93-99`). `sourceFile`
is *inside the hash*. Changing its representation therefore changes every hash, so:

- `ledgerExists()` stops matching → every already-imported record re-imports under a new hash.
- The previously imported rows stay behind under their old hashes → silent duplication of the entire
  corpus, invisible to `skippedDuplicates` because the dedupe never fires.

This is the whole risk of the task and it must be decided, not discovered. Two options:

1. **Migrate in place (preferred).** A one-time migration that rewrites `source_file` to its realpath
   in `history_import_checkpoint` and `history_import_ledger`, collapsing duplicate checkpoint rows by
   keeping the **highest** `last_imported_line` per `(source, realpath)`. Ledger `record_hash` values
   stay as they are — they remain valid dedupe keys for rows already imported, and new imports of the
   *same* lines will produce different hashes, so also record that hashes are path-representation
   dependent and pre-migration rows are grandfathered.
2. **Accept a one-time full re-import.** Truncate `history_etl_*`, checkpoint, and ledger, then
   re-import from files. Simpler and provably consistent, but throws away import history and is slow
   at current volume (1.5M lines for pi alone).

Choose **(1)** unless the migration proves harder than the re-import. Whichever is chosen, state it in
`### Solution` and make it idempotent — running it twice must not change the result.

**WHERE** — `~/xprojects/ts-libs/packages/llm-jsonl-importer`:

| File | Change |
| --- | --- |
| `src/importer.ts:221-245` | Normalize in `collectFiles`/root resolution, so every downstream use is already canonical |
| `src/importer.ts:93-99` | No change — the hash keeps taking `sourceFile`; it is now canonical by construction |
| `src/jsonl-importer-dao.ts:63-90` | `readCheckpoint` / `writeCheckpoint` / `resetCheckpoints` — keys are canonical |
| `src/jsonl-importer-dao.ts` | New idempotent migration for existing checkpoint + ledger rows |
| `tests/importer.test.ts`, `tests/jsonl-importer-dao.test.ts` | Path-identity and migration coverage |

**Frozen behavior.** Normalize **once**, at file discovery, not at each call site — a single
choke point is the only way to guarantee the hash, the checkpoint, and the ledger all agree.

**`FileSystem.realPath` is optional.** The interface declares `realPath?(path: string): string`
(`ts-runtime/src/file-system.ts:75`); the Node implementation provides it
(`file-system-node.ts:116`) but injected and test filesystems may not. Fall back to the original path
when it is absent — never throw, and never reach around the injected `FileSystem` to
`node:fs.realpathSync` directly, which would break the runtime seam and the in-memory test doubles.
A file that does not exist has no realpath either: fall back rather than fail discovery.

**Rewrite guard — decide, do not leave open.** 0457's verdict was that line-number checkpointing is
sufficient because all six current agents are append-only; only the path-identity defect was real.
So: **defer the guard**, and record the deferral explicitly with the condition that would reopen it
(a source observed to rewrite or truncate a session file in place). Do not implement a size/mtime/hash
guard in this task — it would be speculative complexity against a failure that has not been observed.
R3 is satisfied by a written, reasoned deferral, not by code.

**Anti-patterns:**

- Do **not** normalize at write time only. The hash is computed before the write; a late normalization
  leaves hash and checkpoint disagreeing, which is worse than the bug being fixed.
- Do **not** change what goes into `sha256()`. Removing `sourceFile` from the hash would be a larger,
  separate decision affecting every existing ledger row.
- Do **not** implement the rewrite guard here (see above).
- Do **not** touch the forensic record contract, the two new contract tables, or source definitions.
  Those are task 0466; overlapping them mixes two review contexts.
- Do **not** skip the migration because tests pass on a fresh DB. A fresh DB cannot reproduce the
  hazard — the test must seed pre-migration rows with unnormalized paths.

**Interaction with 0466.** Both tasks write `source_file`. There is no ordering constraint: if 0466
lands first, its new `history_message` / `history_tool_call` rows carry unnormalized paths and are
covered by the same migration; if this lands first, 0466's rows are canonical from the start. Whichever
is second rebases rather than re-deciding. The migration must therefore cover the two contract tables
**if they already exist** — write it to normalize any table it finds, not a hardcoded pair.
### Plan
- [ ] **0. Baseline.** `cd ~/xprojects/ts-libs/packages/llm-jsonl-importer && bun run check` green
      before changes.
- [ ] **1. Reproduce R4 in a test (red first).** Scratch DB; import a fixture via a symlinked path and
      via its real path. Assert the current failure — two `history_import_checkpoint` rows for one
      file. This test must fail before the fix and pass after.
- [ ] **2. Normalize at discovery.** Apply `fileSystem.realPath?.(path) ?? path` in the file-collection
      path (`src/importer.ts:221-245`) so every downstream consumer — hash, checkpoint, ledger —
      receives a canonical path. One choke point only.
- [ ] **3. Fallback coverage.** Test with a `FileSystem` double that does **not** implement `realPath`:
      import must succeed using the original path, not throw. Also cover a non-existent path.
- [ ] **4. Confirm R4 green.** The step-1 test now yields exactly one checkpoint row, and the second
      import imports no new records rather than re-importing the file.
- [ ] **5. Migration for existing rows.** Idempotent migration rewriting `source_file` to realpath in
      `history_import_checkpoint` and `history_import_ledger` — and in any contract table present, if
      0466 has landed. Collapse duplicate checkpoint rows per `(source, realpath)` keeping the highest
      `last_imported_line`.
- [ ] **6. Migration test with seeded pre-migration state.** Seed a DB with unnormalized paths and
      duplicate checkpoint rows, run the migration, assert one row per file with the highest line
      preserved. Run it twice and assert the second run changes nothing.
- [ ] **7. Regressions from 0457.** Re-assert R3 (dry-run does not advance the checkpoint) and R4b
      (`--mode full` resets only the imported source's scope). Both passed before; they must still
      pass.
- [ ] **8. Record the rewrite-guard deferral (R3).** Write the reasoned deferral into `### Solution`:
      all six current agents are append-only per 0457, so the guard is speculative; name the condition
      that would reopen it. No guard code.
- [ ] **9. Gates.** `bun run check` in the importer package. Then from Spur with the package linked:
      `bun run lint`, `bun run test`. No skipped tests.
- [ ] **10. Record.** `### Solution` gets a `path:line` change map plus the migration decision and the
      deferral. `### Testing` gets the commands and their output, including the before/after checkpoint
      row counts.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
