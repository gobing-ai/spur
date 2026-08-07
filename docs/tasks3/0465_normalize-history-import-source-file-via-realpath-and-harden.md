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
updated_at: "2026-08-07T00:27:55.140Z"
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
- R1 — Normalize every `source_file` used for checkpoint/ledger keys through filesystem `realpath` (or equivalent) so symlink and real paths collapse to one checkpoint row.
- R2 — Prove with a scratch-DB test: import via symlink then real path of the same inode → exactly one checkpoint row and no full re-import of already-seen content.
- R3 — Decide and document the minimum rewrite guard (size, mtime, and/or content hash) for incremental mode when file length drops below `last_imported_line`; implement or explicitly defer with a tracked follow-up if out of scope.
- R4 — Keep dry-run non-mutating and full-mode source-scoped reset behavior (0457 R3/R4b regressions).
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

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**WHAT.** Upstream fix in `@gobing-ai/ts-llm-jsonl-importer` (and Spur wiring only if needed): realpath-normalize `source_file` at discover/write-checkpoint time; optional size/mtime/hash guard when file shrinks under incremental mode.

**WHERE.** llm-jsonl-importer `discoverFiles` / checkpoint write path, dao checkpoint CRUD, package tests. Spur monorepo only if CLI/service defaults need a flag.

**OUT.** Do not redesign the forensic record contract (0455). Do not expand source definitions (omp/grok) here unless required to run tests.
### Plan
- [ ] Reproduce 0457 R4 path-identity failure in a package unit/integration test.
- [ ] Add realpath (or FileSystem.realPath) normalization for source_file keys.
- [ ] Re-run path-identity scenario → one checkpoint row.
- [ ] Specify rewrite guard; implement or open a slim follow-up with explicit deferral.
- [ ] Regression: dry-run + full-mode source scope.
- [ ] Package tests green; link-smoke from Spur if needed.
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
