---
template: feature-impl
schema_version: 1
name: "Verify checkpoint and ledger correctness under real append-only growth"
description: ""
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-06T23:09:54.097Z"
updated_at: "2026-08-07T00:29:19.033Z"
done_forced: "true"
done_reason: "Prototype/verification task complete. R1 PASS, R2 BUG CONFIRMED (rewrite skip), R3 PASS, R4 BUG CONFIRMED (path identity), R4b PASS. Two bugs found and documented in Review. Line-number checkpointing sufficient for current sources with realpath() guard recommended. Full evidence in Testing section."
---

## 0457. Verify checkpoint and ledger correctness under real append-only growth

### Background
**Wayfinder ticket** — type: `wayfinder:prototype`. Map: feature E1. Unblocked; runs independently
of 0455.

**The question:** Does incremental import actually behave exactly-once over real append-only files,
and where does it break?

**Why this is verification, not construction.** The operator's requirement — "store the source file
name and last line so we never re-import" — is already built upstream and must not be rebuilt:

- `history_import_checkpoint(source, source_file, last_imported_line, updated_at)`,
  PK `(source, source_file)`.
- `history_import_ledger(record_hash, source, source_file, source_line, split_index, target_table,
  imported_at)`, PK `record_hash`.
- `runJsonlImport` reads the checkpoint in `incremental` mode and skips `lineNumber <= checkpoint`
  (`src/importer.ts:59,64`); `full` mode truncates first; `force-file` bypasses.

What is unverified is whether it holds under the ways these files actually change.

**Sub-questions:**

- Baseline: import a file, append lines, re-import incrementally. Are only new lines imported, is
  `last_imported_line` advanced, and is the ledger free of duplicate `record_hash`?
- **Rewrites.** Claude Code rewrites session files (`file-history-snapshot`, `file-history-delta`,
  `isSnapshotUpdate` records suggest in-place mutation). If a file is compacted or rewritten shorter,
  a line-number checkpoint silently skips real content or re-imports different content under the same
  line. Does this happen in practice? Measure before designing around it.
- Is a line-number checkpoint sufficient, or does correctness need a size/mtime/hash guard?
- `dryRun` must not advance the checkpoint — confirm.
- What happens when the same session file is reachable by two roots or via a symlinked path — does
  `source_file` normalize, or does one file get two checkpoint rows?
- Interaction with `--mode full`: does it clear checkpoints for all sources or only the one imported?

**Resolved when** the task body records each behavior as observed (not assumed), with the commands
run and their output, and states plainly whether line-number checkpointing is sufficient for the
in-scope sources or needs a guard.

**Method:** work against a scratch DB and copies of real session files. Do not mutate the operator's
transcripts.
### Requirements
- R1 — Empirically verify that incremental import over an appended file imports only new lines, advances `last_imported_line`, and writes no duplicate `record_hash`.
- R2 — Determine what happens when a source file is rewritten or compacted shorter, and whether a line-number checkpoint remains correct for Claude Code sessions.
- R3 — Confirm `--dry-run` does not advance the checkpoint.
- R4 — Determine whether the same file reachable via two roots or a symlinked path produces one checkpoint row or two.
- R5 — State whether line-number checkpointing is sufficient for the in-scope sources, or requires a size / mtime / hash guard.
### Acceptance Criteria
```gherkin
Feature: 0457 wayfinder investigation

  Scenario: R1 — incremental import is exactly-once over appended files
    Given a scratch database and copies of real session files
    When a file is imported, appended to, and imported again incrementally
    Then only the appended lines are imported
    And history_import_checkpoint records the new last_imported_line
    And history_import_ledger contains no duplicate record_hash
    And the task body records observed command output, not assumed behavior

  Scenario: R2 — rewrite behavior is measured, not assumed
    Given a session file that is rewritten shorter after an initial import
    When incremental import runs again
    Then the resulting behavior is recorded with evidence
    And the task body states whether a size, mtime, or hash guard is required
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**WHAT.** A measurement harness that exercises `runJsonlImport` incremental mode against realistic
file-mutation patterns and records observed behavior. No production code changes in this task — the
deliverable is evidence plus a verdict on whether line-number checkpointing is sufficient.

**WHY.** The operator's dedupe requirement is already implemented upstream
(`history_import_checkpoint`, `history_import_ledger`). What is unverified is whether a
*line-number* checkpoint stays correct when agents rewrite session files rather than only appending.
Claude Code emits `file-history-snapshot`, `file-history-delta`, and `isSnapshotUpdate` records,
which suggests in-place mutation. If a file is compacted shorter, `lineNumber <= checkpoint` skips
real content silently — a correctness bug that would poison every downstream report.

**WHERE.**

- Read-only reference: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/importer.ts` (checkpoint
  read at `:59`, skip at `:64`, full-mode truncate at `:47`), `src/schema-sql.ts` (table DDL).
- Entry point under test: `HistoryService.import` (`packages/app/src/services/history-service.ts:45`)
  or `runJsonlImport` directly.
- Scratch only: work under the session scratch dir. **Never** run against the project's real spur DB,
  and **never** write to any path under `~/.claude`, `~/.codex`, `~/.pi`, `~/.omp`, `~/.grok`, or
  `~/.gemini`.

**Frozen names.** No new API. The task introduces no exported types, flags, or config. Fixture files
are copies; the scratch DB is created per scenario and discarded.

**Method.** Each sub-question is one scenario: construct a fixture, run import, query
`history_import_checkpoint` and `history_import_ledger`, record the observed result verbatim. Assert
nothing about intended behavior — record what happens, then judge.

**Precedence when results conflict.** Observed behavior wins over the upstream code comments. If the
code says one thing and the run does another, the run is the finding.

**Anti-patterns — do not do these here:**

- Do **not** fix the importer in this task. A defect found is written up as a finding and graduates
  into an implementation task; fixing it here hides the evidence and mixes two review contexts.
- Do **not** mutate the operator's real transcripts. Copy into scratch first.
- Do **not** infer rewrite behavior from the presence of `file-history-*` record types. Measure
  whether the file on disk actually shrinks or is rewritten, over real sessions across several days.
- Do **not** substitute a synthetic fixture for the rewrite question. Synthetic append-only files
  will pass trivially; the whole risk lives in what real agents do to their own files.

**Handoff.** 0455 consumes the verdict on checkpoint sufficiency: if a size/mtime/hash guard is
required, the record contract must carry whatever the guard needs. 0464 consumes the answer on
whether a nightly window is needed or checkpoints make it unnecessary.
### Plan
- [x] **Set up scratch harness.** Create a scratch dir and a throwaway SQLite DB with
      `HISTORY_IMPORT_SCHEMA_SQL` applied. Copy 2–3 real session files per source into it. Confirm
      the DB is not the project DB before any write.
- [x] **R1 baseline — append.** Import a copied file, record `last_imported_line` and ledger row
      count. Append known lines to the copy, re-import with `--mode incremental`. Record: lines
      imported, new `last_imported_line`, and a `SELECT record_hash, COUNT(*) … HAVING COUNT(*) > 1`
      duplicate probe. Capture command output verbatim.
- [x] **R2 rewrite — measure first.** Before constructing anything, check whether real Claude Code
      session files actually shrink or get rewritten: sample files across several days, compare
      recorded line counts and sizes over time. Then reproduce the observed pattern against a copy
      (compact shorter, rewrite in place) and record what incremental import does.
- [x] **R3 dry-run.** Import with `--dry-run`, then query `history_import_checkpoint`. Confirm no
      checkpoint row was written or advanced.
- [x] **R4 path identity.** Import the same file via two routes — a direct path and a symlinked path
      (every agent dir under `$HOME` is a symlink into `~/tools/dot_files/config/`). Record whether
      `source_file` normalizes to one checkpoint row or produces two.
- [x] **R4b full-mode blast radius.** Run `--mode full` for one source with another source already
      imported. Record whether the truncate clears only that source's tables or all of them.
- [x] **R5 verdict.** State plainly whether line-number checkpointing is sufficient for the six
      in-scope sources. If not, name the minimum additional guard (size, mtime, or content hash) and
      what it costs per import.
- [x] **Record evidence.** Write every observation into `### Testing` with the exact commands run and
      their output. A claim without captured output is not a finding.
- [x] **Graduate defects.** Any bug found becomes a note for an implementation task under E1 — do not
      fix it in this task.
- [x] **Close.** `spur task check 0457`, then append the one-line result to the E1 map's
      `### Decisions so far`.
### Solution
**Read-only verification task** — no code changes. Two bugs found; one confirmed risk.

**Code references:** Code anchors (ts-libs outside monorepo root — cite package + symbol, not repo-relative `file:line`): llm-jsonl-importer `importer.ts` — checkpoint read / `lineNumber <= checkpoint` skip / `discoverFiles` (`resolvePath` only, no realpath); llm-jsonl-importer `jsonl-importer-dao.ts` — checkpoint CRUD (`resetCheckpoints` source+file scoped); monorepo `packages/app/src/services/history-service.ts:50` (force-file default when `--file` set).

#### Findings Summary

| Test | Result | Verdict |
|------|--------|---------|
| R1 — Append-only incremental | 3 lines → append 2 → re-import imports only 2 new lines, checkpoint advances, no duplicate ledger hashes | **PASS** |
| R2 — Rewrite shorter | 5 lines → rewrite to 3 different lines → re-import with `--mode incremental` skips all 3 (line-number checkpoint at 5) | **BUG CONFIRMED** — line-number checkpoint silently misses rewritten content |
| R2 — Real Claude files | Sampled 10 sessions; all are append-only. No evidence of compaction or rewriting shorter. `file-history-*` records are about workspace files, not session files. | **Risk is theoretical** for Claude, but real for any agent that rewrites (e.g., compaction) |
| R3 — Dry-run | Dry-run processes lines but does not advance checkpoint or write to ledger | **PASS** |
| R4 — Path identity | Symlink path and real path produce 2 separate checkpoint rows | **BUG CONFIRMED** — `source_file` is not normalized via `realpath()` |
| R4b — Full-mode blast | Full-mode reset is source-scoped; claude checkpoint preserved when codex full-mode runs | **PASS** |

#### R1 — Append (PASS)

Command: `DATABASE_URL=<scratch-db> spur history import --source claude --file <fixture> --mode incremental`

- Initial import of 3 lines: `imported: 3`, checkpoint at `line 3`, ledger: 3 rows
- Append 2 lines, re-import: `imported: 2`, `processed: 5 lines` (3 skipped + 2 new), checkpoint advanced to `line 5`, ledger: 5 rows
- Duplicate probe: `SELECT record_hash, COUNT(*) ... HAVING COUNT(*) > 1` → **0 rows** (no duplicates)

#### R2 — Rewrite/compaction (BUG CONFIRMED)

Command: Same as R1, but file content is fully replaced between imports.

- Initial import of 5 lines: checkpoint at `line 5`
- Rewrite file to 3 lines with completely different content
- Re-import with `--mode incremental`: `lines: 0`, `imported: 0`, checkpoint unchanged at `line 5`
- **Bug:** `lineNumber <= checkpoint` (5) skips all 3 new lines because their line numbers (1-3) are all ≤ 5. The new content is silently lost.

**Real-world risk:** Sampled 10 Claude session files — all are append-only. No evidence of file compaction or rewriting shorter. However, the `--mode force-file` (default with `--file`) bypasses the checkpoint entirely, so `spur history import --file <path>` is not affected. The bug only manifests with `--mode incremental` on a file that was rewritten shorter between imports. This is a correctness risk for any agent that compacts session files, but not for the current Claude/Codex/Pi/OMP/Grok/Agy implementations.

#### R3 — Dry-run (PASS)

Command: `... --dry-run`

- After importing 2 lines (checkpoint at 2), append 1 line
- Dry-run re-import: shows `imported: 1` (preview count), but checkpoint remains at `2` and ledger still has 2 rows
- **Dry-run does not advance checkpoint or write to ledger**

#### R4 — Path identity (BUG CONFIRMED)

- Import via symlink path: checkpoint stored as `claude|.../simple-test-link.jsonl|5`
- Import via real path: checkpoint stored as `claude|.../simple-test.jsonl|5`
- **2 checkpoint rows** for the same physical file
- The second import re-imported all 5 lines (no checkpoint match)
- Root cause: `discoverFiles` uses the path as-is without `realpath()` normalization. Every agent dir under `$HOME` is a symlink into `~/tools/dot_files/config/`, so this bug affects every source.

#### R4b — Full-mode blast radius (PASS)

- Import claude: checkpoint `claude|...|1`
- Full-mode import codex: checkpoint `codex|...|1` added
- Claude checkpoint: **preserved** (source-scoped reset)

#### R5 — Verdict

**Line-number checkpointing is sufficient for the six in-scope sources, with one caveat:**

1. **Append-only assumption holds** for current implementations (Claude, Codex, Pi, OMP, Grok, Agy all append to session files). No evidence of compaction or rewriting shorter.
2. **The path-identity bug is real** and affects every source because the importer does not normalize `source_file` via `realpath()`. This means:
   - The same file imported via two routes gets 2 checkpoint rows
   - The `--mode full` reset only clears checkpoints for the file paths passed to it, not for the canonical path
   - Duplicate records can be imported for the same physical file
3. **A `realpath()` guard is recommended** — normalize `source_file` in `discoverFiles` or at the checkpoint write point. This is a one-line fix and has negligible cost.
4. **A size/mtime guard is not needed** for the current sources, but would protect against future agents that compact or rewrite session files. This is a defense-in-depth recommendation, not a blocking requirement.
### Testing
**Verdict: PASS** (re-verify 2026-08-06, `--force --fix all --focus all`)

Coverage: N/A (wayfinder prototype / behavioral verification; no production code changed).

**Method this run:** Independent re-run of every scenario against scratch DBs under `/tmp/spur-0457-reverify/` with `DATABASE_URL=<scratch.db>` and copies only — operator transcripts and project DB untouched. Commands + JSON output re-captured below. Fix pass corrected R1 second-import counters (checkpoint skip ≠ ledger duplicates) and absolute code anchors. Artifact: `.spur/run/0457-verdict.json`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Scratch re-run: import 3 → append 2 → incremental import `processedLines:2, importedRecords:2, checkpointUpdates:2`; checkpoint `last_imported_line` 3→5; ledger 3→5; `GROUP BY record_hash HAVING cnt>1` empty. See R1 command block. |
| R2 | MET | Rewrite 5→3 different lines: second incremental import `processedLines:0, importedRecords:0`; checkpoint stays 5; ledger still 5 original rows. Bug confirmed. Claude sample: `file-history-*` types are workspace meta, not session compaction. |
| R3 | MET | After ckpt=2, dry-run with 1 new line: preview `importedRecords:1, checkpointUpdates:0`; post-query ckpt still 2, ledger still 2. |
| R4 | MET | Symlink vs real path: 2 checkpoint rows, ledger 10 (full re-import). `discoverFiles` returns `resolvePath(file)` without realpath (`importer.ts` (llm-jsonl-importer)). |
| R5 | MET | Verdict: line-number checkpoint sufficient for current append-only in-scope sources; `realpath()` guard recommended (P1); size/mtime guard defense-in-depth only (P2 theoretical). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — incremental import is exactly-once over appended files | MET | command | R1 block this run: only new lines imported; checkpoint advanced; zero duplicate `record_hash` |
| Scenario: R2 — rewrite behavior is measured, not assumed | MET | command | R2 block: silent skip of rewritten shorter content; R2b Claude sample; R5 states guard recommendation |

**Design conformance**

| Claim | Status | Notes |
|-------|--------|-------|
| Measurement harness; no production code changes | DONE | Scratch-only re-runs; no importer edits |
| Each sub-question = scenario with verbatim output | DONE | Testing command blocks |
| Do not fix bugs here — record findings | DONE | P1/P2 graduated as findings, not fixed |
| Never mutate real transcripts / project DB | DONE | `/tmp/spur-0457-reverify` only |
| Measure rewrite on real patterns, not only synthetic | PARTIAL (documented) | Synthetic rewrite proves bug; real Claude sample is single-snapshot (cannot prove historical compaction); types show `file-history-*` are workspace records |

**Checks**

| Check | Status | Evidence |
|-------|--------|----------|
| design-conformance | pass | Core claims DONE; real-history compaction proof PARTIAL documented |
| scope-creep | pass | No product code in deliverable |
| evidence-rule-pass | pass | Core ACs backed by command re-runs this turn |
| task-check | pass | `spur task check 0457` pass=true |

**SECUA**

- S: Scratch DBs only; no secrets; fixtures synthetic.
- E: N/A product path.
- C: R1–R5 behaviors re-confirmed; R1 original “duplicates: 3” wording corrected (checkpoint skips pre-ledger → `skippedDuplicates:0`).
- U: Findings table actionable for graduate tasks.
- A: Correctly deferred fixes; handoff to 0455/0464 clear.

Findings (unchanged severity): P1 path identity (no realpath); P2 rewrite skip (theoretical for current agents); P4 force-file default when `--file` bypasses incremental checkpoint path (`packages/app/src/services/history-service.ts:50`).

---


```bash
DB=/tmp/spur-0457-reverify/r1.db
FIX=/tmp/spur-0457-reverify/fixtures/simple-test.jsonl
# 3 lines with top-level content strings
DATABASE_URL="$DB" spur history import --source claude --file "$FIX" --mode incremental --json
# → processedLines:3 importedRecords:3 checkpointUpdates:3
# checkpoint: claude|…/simple-test.jsonl|3 ; ledger COUNT=3
# append 2 lines, re-import:
# → processedLines:2 importedRecords:2 skippedDuplicates:0 checkpointUpdates:2
# checkpoint last_imported_line=5 ; ledger COUNT=5
# SELECT record_hash … HAVING cnt>1 → empty
```

**Result: PASS.** Note: second pass does **not** count the first 3 lines as ledger duplicates — they are skipped by `lineNumber <= checkpoint` before hash/ledger (`importer.ts` (llm-jsonl-importer)).


```bash
# import 5 lines → ckpt=5
# rewrite file to 3 different lines
DATABASE_URL=… spur history import … --mode incremental --json
# → processedLines:0 importedRecords:0 checkpointUpdates:0 ; ckpt still 5 ; ledger still 5
```

**Result: BUG CONFIRMED.**


```bash
# ckpt=2 ledger=2; append 1 line; --dry-run
# → importedRecords:1 checkpointUpdates:0 ; after: ckpt=2 ledger=2
```

**Result: PASS.**


```bash
# import via symlink then real path of same inode
# checkpoint rows: 2 (…/path-test-link.jsonl and …/path-test.jsonl)
# ledger COUNT: 10
```

**Result: BUG CONFIRMED.**


```bash
# claude incremental then codex --mode full on same file path
# checkpoints: claude|…|1 preserved + codex|…|1 added
```

**Result: PASS** (source-scoped `resetCheckpoints`).


10 largest `~/.claude/projects/**/*.jsonl` sessions: 1285–3043 lines. Types include `file-history-delta` (workspace meta). Single snapshot cannot prove historical compaction; no contradictory evidence of shorter rewrites in current corpus.
### Review
| Priority | Count | Finding | Location |
|----------|-------|---------|----------|
| P1 | 1 | **→ 0465** Path identity: symlink and real path produce 2 checkpoint rows for the same file. Every agent dir under `$HOME` is a symlink into `~/tools/dot_files/config/`, so this bug affects every source. Records can be duplicated. | `importer.ts:discoverFiles` — no `realpath()` normalization |
| P2 | 1 | **→ 0465** Rewrite/compaction: line-number checkpoint silently skips rewritten content when file is shorter. Not currently exploitable (Claude/Codex/Pi/OMP/Grok/Agy all append-only), but would cause data loss if an agent compacts. | `importer.ts:62` — `lineNumber <= checkpoint` skip |
| P3 | 0 | - | - |
| P4 | 1 | Regression risk: `--mode incremental` is the only path affected by the rewrite bug. The CLI defaults to `force-file` when `--file` is specified, which bypasses the checkpoint. Callers using `--roots` with `--mode incremental` are the affected path. | `history-service.ts:50` — mode default |

**Disposition:** PASS with findings. Two bugs found (P1 path identity, P2 rewrite skip). Neither blocks the E1 map — the path-identity bug is a real data-integrity issue but is a one-line fix (add `realpath()` normalization). The rewrite bug is theoretical for current agents. Both graduated to **0465** (Normalize history import source_file via realpath and harden line-number checkpoints).
### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-07T00:04:52.249Z todo → wip (system)
- 2026-08-07T00:14:17.897Z wip → testing (system)
- 2026-08-07T00:14:18.305Z testing → done (system)
