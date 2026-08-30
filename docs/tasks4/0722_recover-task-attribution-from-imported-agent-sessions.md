---
schema_version: 1
name: "Recover task attribution from imported agent sessions"
status: todo
template: issue
created_at: 2026-08-30T18:44:01.803Z
updated_at: "2026-08-30T18:45:36.420Z"
feature_id: E6
dependencies: ["0557", "0558", "0638"]
---

## 0722. Recover task attribution from imported agent sessions

### Background

Feature A6 exposed a gap between transcript import and task attribution. The coding-agent JSONL was
not lost or skipped: source-local import found the user-home files, and the consolidated database
contains 3,390 A6-referencing messages across 79 sessions. However, none of those rows carries
`task_wbs` or `run_id`, and tasks 0703–0712 have no surviving `task_run_links → history_run_session`
chain. Consequently `history analyze --task <wbs>` returns zero sessions even though their
conversation content is present.

The repair belongs in the Spur history-import composition, not Git worktree discovery. Agent
transcript roots are source-owned and global to the user; `.spur/spur.db` is project/worktree-local
operational state. Import must recover evidence-backed task↔session attribution from normalized
transcripts without depending on a worktree database that may already have been removed.

### Requirements

- [ ] **R1 — Preserve importer ownership and discovery.** Keep the existing source registry and
      user-home JSONL roots authoritative. Do not enumerate Git worktrees, read sibling
      `.spur/spur.db` files, copy run stores, or add another transcript parser in Spur. Explicit
      `--file`/`--root` behavior remains caller-directed.
- [ ] **R2 — Add a direct many-to-many task↔session authority.** Persist evidence-backed links from
      `(source, session_id)` to every operated task WBS, including multiple tasks per session. Do not
      synthesize workflow run IDs and do not promote the single-valued `history_message.task_wbs`
      column into an authority. Links are idempotent and retain confidence/mechanism plus a bounded
      evidence locator for audit.
- [ ] **R3 — Attribute only operational evidence.** Accept deterministic signals such as an explicit
      task-scoped `/sp:dev-*` invocation, a structured `spur task <verb> <wbs>` operation, canonical
      task-file/checkpoint ownership metadata, or equivalent source-native structured metadata.
      Validate every candidate through the task locator. Plain four-digit prose, feature rosters,
      pasted specifications, requirements, and conflicting candidates never create a link.
      Transcript-derived links are labeled inferred/estimated, never exact.
- [ ] **R4 — Integrate attribution into existing import modes.** Incremental import attributes the
      sessions it imports or updates; full import re-evaluates the discovered source sessions so an
      ordinary source-local full re-import repairs already-consolidated history. Dry-run uses the
      same classifier and previews counts without writes. A second identical run creates zero
      duplicate links.
- [ ] **R5 — Make task-scoped analysis use both authorities.** `--task` matches sessions linked by
      either the existing `task_run_links → history_run_session` chain or the new direct
      task↔session relation. Other selectors still compose with `AND`; a simultaneous `--run` and
      `--task` must not widen either scope. Unresolved/ambiguous links never match.
- [ ] **R6 — Report and document attribution honestly.** History-import JSON/text results expose
      sessions evaluated, links created/already present, and skipped/ambiguous evidence counts,
      without persisting transcript content again. Update the history data-processing and selector
      authority contracts; add no new public noun or verb.
- [ ] **R7 — Repair and prove the A6 case.** With source-local CLI/importer provenance recorded, run
      the appropriate full dry-run and write import over the A6 sources. Tasks 0703–0712 must each
      return at least one evidence-backed session through task-scoped analysis; a second import is
      idempotent. Focused DAO/classifier/service/query/CLI tests and all project gates pass.

### Acceptance Criteria

Covers feature E6 scenarios R8–R10.

```gherkin
Feature: Recover task attribution during history import

  @core
  Scenario: R8 — Imported sessions recover task attribution from operational evidence
    Given an imported session has no surviving task-to-run-to-session mapping
    And its normalized transcript contains deterministic evidence that it operated on tasks 0703 and 0704
    When history import performs task attribution
    Then the session is correlated to both tasks without synthesizing a run
    And task-scoped analysis can query the session through either task

  @core
  Scenario: R9 — Ambiguous transcript references never become task links
    Given a session contains plain WBS mentions, pasted task specifications, or conflicting evidence
    When history import performs task attribution
    Then those references create no task-to-session correlation
    And the skipped and ambiguous evidence counts are reported

  @core
  Scenario: R10 — Full re-import repairs existing attribution idempotently
    Given raw agent JSONL was already imported without task attribution
    When source-local full history import runs twice
    Then the first run creates every evidence-backed task-to-session correlation
    And the second run creates no duplicate correlation
    And no Git worktree or sibling database is required
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-08-30T18:45:30.235Z

**Q: Were the A6 JSONL files skipped?**

No. They are already represented by 3,390 messages across 79 consolidated sessions. The missing
layer is task attribution, not source-file discovery.

**Q: Why not consolidate worktree databases?**

That recovers only worktrees that still exist and couples transcript correctness to cleanup order.
The user-home JSONL is the durable source available after any worktree disappears; import should
derive its own auditable task relation from that source.

**Q: Why not fill `history_message.task_wbs`?**

A session may operate on several tasks, while that column is single-valued per message. Task 0638
also deliberately made `task_run_links` and `history_run_session` the selector authorities because
legacy direct columns are null/untrusted. Add a proper many-to-many relation instead of reviving the
wrong shape.

**Q: Why not fabricate a run per imported session?**

An ambient transcript is not a workflow run. Synthetic IDs would pollute run selectors, provenance,
cost attribution, and operational run history. Task attribution must remain direct when no real run
exists.

**Q: Are transcript-derived links exact?**

No. Even deterministic operational syntax is retrospective evidence, so it is marked
inferred/estimated and remains distinguishable from invoke-boundary exact mappings.

### Design

#### Existing flow and failure seam

`HistoryService.import()` delegates parsing/discovery to
`@gobing-ai/ts-llm-jsonl-importer`, then aligns run-session provenance. Source mappers intentionally
emit null `run_id`/`task_wbs`; `buildMessageWhereClauses()` intentionally resolves `--task` through
`task_run_links → history_run_session`. The A6 transcripts therefore import successfully but remain
outside task-scoped queries when their worktree-local operational links are gone.

#### Minimal authority extension

Add one Spur-owned many-to-many relation, provisionally `history_task_session`, keyed by
`(wbs, source, session_id)`. Store attribution exactness/mechanism, resolution time, and a bounded
evidence locator (kind plus source file/line or normalized record hash); never duplicate message
content. Index both WBS lookup and `(source, session_id)` lookup. The write path owns uniqueness and
exact-over-estimated precedence.

Do not repurpose `task_run_links`, create fake runs, or write task semantics into the generic
upstream importer. The generic importer remains responsible for normalization and file discovery;
Spur's post-import application/domain pass owns corpus-aware task resolution.

#### Evidence classifier

Classify normalized user/tool metadata, not arbitrary substring matches. Candidate extractors must
be allowlisted around task-operating syntax/metadata and validated with the existing task locator.
One session may yield several WBS links. Plain mentions and pasted content are negative fixtures.
The classifier is pure so dry-run and write mode share identical decisions.

#### Import and query integration

- Incremental mode evaluates only sessions affected by the import; full mode evaluates the complete
  discovered source scope, including deduplicated rows already present in `history_message`.
- Persist links only after the source import succeeds. Attribution failure degrades/reports that
  source rather than claiming a clean import.
- Extend `FanOutResult`/per-source output additively with bounded attribution counters.
- For task-only selection, match the union of the established run chain and direct task-session
  links. For task+run selection, retain intersection semantics through the real run chain.
- Keep forensic SQL bounded and indexed; do not materialize the history corpus.

#### Repair proof

Use the source-local CLI and current importer, never the global binary. Capture dry-run/write
provenance and database before/after counts. Re-import the concrete Pi/OMP/Codex/Claude sources that
contain A6 evidence, then assert tasks 0703–0712 are non-empty under `history analyze --task` and the
repeat import writes no additional links.

### Plan

- [ ] Add the direct task-session schema/DAO and idempotent confidence-aware write contract (R2).
- [ ] Implement the pure allowlisted operational-evidence classifier with positive, multi-task,
      plain-mention, pasted-specification, invalid-WBS, and ambiguity fixtures (R3).
- [ ] Run the classifier from incremental/full/dry-run history import with bounded per-source
      counters and failure reporting (R1, R4, R6).
- [ ] Extend shared task-selector SQL to union real-run and direct-session authorities while
      preserving task+run intersection and all other selector filters (R5).
- [ ] Update history data-processing/selector docs and focused domain/app/CLI tests (R5–R6).
- [ ] Perform the source-local A6 full-import repair twice, capture provenance/counts, verify
      0703–0712 task-scoped sessions, then run all project and corpus gates (R7).

### Root Cause

The importer did not skip the A6 source files. A source-local incremental import scanned the
registered user-home roots and the consolidated database contains the relevant normalized content.
Measured after import: 3,390 A6-referencing messages across 79 sessions, with zero rows carrying
`task_wbs` or `run_id` and zero task-run/session joins for 0703–0712.

This is expected from the current implementation: generic source mappers do not know Spur task
semantics and emit null task/run fields; the task selector added by task 0638 deliberately ignores
those legacy columns and joins `task_run_links` to `history_run_session`. Those operational tables
lived in the removed worktree database, so re-importing raw messages alone cannot rebuild the join.
The missing capability is corpus-aware post-import task↔session attribution.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Import composition: `packages/app/src/services/history-service.ts` (`HistoryService.import`,
  `HistoryService.importAll`)
- Current selector authority: `packages/domain/src/analytics/forensic-query.ts`
  (`buildMessageWhereClauses`)
- Existing run-session authority: `packages/domain/src/dao/run-session-dao.ts`
- Existing task-run authority: `packages/domain/src/dao/task-run-link-dao.ts`
- Existing retroactive run correlation: `packages/domain/src/analytics/retro-correlation.ts`
- Import schema/mappers: `@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts`, `src/mappers.ts`
- History contract: `docs/04_DESIGN.md`, `docs/design/history-data-processing.md`
- Prior authority decision: task 0638 R5; run correlation: tasks 0557–0558
- Incident evidence: tasks 0703–0712 and the 2026-08-30 source-local A6 import/analyze probes

### History
