---
template: feature-impl
schema_version: 1
name: "Verify checkpoint and ledger correctness under real append-only growth"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-06T23:09:54.097Z"
updated_at: "2026-08-06T23:18:10.503Z"
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

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

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
