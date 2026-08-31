---
schema_version: 1
name: "Recover task attribution from imported agent sessions"
status: wip
template: issue
created_at: 2026-08-30T18:44:01.803Z
updated_at: "2026-08-31T03:03:34.181Z"
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

Direct task↔session attribution recovered at import (feature E6, R1–R9). Additive end to end: a new authority table, a pure classifier, bounded reads, a unioned task-only selector, and import wiring that degrades reports instead of failing imports. No transcript parser (R1) — attribution reads only the normalized `history_message` / `history_tool_call` contract tables.

#### Change map

**Domain — schema**

- `packages/domain/src/migrations.ts:171` — `HISTORY_TASK_SESSION_SCHEMA_SQL`: table `history_task_session (wbs, source, session_id, exactness, mechanism, evidence_kind, evidence_ref, resolved_at)` with `PRIMARY KEY (wbs, source, session_id)` + `idx_history_task_session_source_session (source, session_id)`; composed into `CLI_SCHEMA_SQL`; migration `0028_spur_cli_history_task_session` appended (migrations.ts:828).
- `drizzle/0028_spur_cli_history_task_session.sql` — folder-load copy of the same standalone DDL.

**Domain — DAO**

- `packages/domain/src/dao/task-session-dao.ts:52` — `TaskSessionDao`: `insert` returns `'created' | 'present'`; idempotent under the primary key; exact-over-estimated precedence (estimated never shadows exact, exact upgrades in place); `hasLink` (dry-run preview), `listByWbs`, `listBySession`, `deleteAll`; missing-table → [] guards. Types `TaskSessionExactness` / `TaskSessionMechanism` / `TaskSessionEvidenceKind` live here.

**Domain — classifier + bounded reads (ADR-011 raw SQL)**

- `packages/domain/src/analytics/task-attribution.ts:92` — pure `classifyTaskAttribution(records) → {candidates, skipped, ambiguous}` (R3): allowlisted syntax only — line-anchored task-scoped `/sp[:_-]dev` invocations and structured `spur task <verb> <wbs>` (also in tool `args_raw`); four-digit operand shape with lookarounds excludes dates/versions/paths; plain prose counted skipped (user records only); extractor disagreement counted ambiguous — neither ever links. Deterministic, so dry-run and write share decisions. `evidenceRef = <file basename>#<line>`, 200-char cap.
- `task-attribution.ts:155` / `:187` — `listAttributionSessions` (`all` / `changed`-since scopes, placeholder session ids excluded, `ATTRIBUTION_SESSION_LIMIT`-bounded) and `loadAttributionEvidence` (allowlist-prefiltered user/tool rows, `ATTRIBUTION_EVIDENCE_LIMIT`-bounded); missing-table → [].
- Exports via `dao/index.ts` and `analytics/index.ts`.

**Domain — read path**

- `packages/domain/src/analytics/forensic-query.ts:216` — task-only selector now unions the run chain (`task_run_links` → `history_run_session`) with `history_task_session` (R5); task+run keeps intersection semantics through the run chain only. R2 structural invariant intact (no corpus query unbounded; verified by scan test).

**App — composition + import wiring**

- `packages/app/src/services/task-attribution.ts:33` — `attributeSessions({db, source, sessionIds, isKnownWbs, resolvedAt, dryRun}) → TaskAttributionSummary`: locator-validates every candidate (R3), previews via `hasLink` when `dryRun` (R4), counts idempotent writes as `linksAlreadyPresent`.
- `packages/app/src/services/history-service.ts:438` / `:456` — attribution runs after the source import succeeds, in write and dry-run mode; `full`/dry-run scope `all` (source-local full re-import repairs consolidated history), incremental scope `changed` (`imported_at >= import start`); no task locator in context → `attribution: null` (skip, never guess); failure → `attributionError` + `attribution-failed` warning (history-service.ts:850), never a failed import. `HistoryImportResult` extended additively (`attribution?`, `attributionError?`) so existing call sites are unaffected; `FanOutResult.attribution` always present (summed across sources).
- `packages/app/src/index.ts` — re-exports `attributeSessions` / `AttributeSessionsInput`.

**CLI**

- `apps/cli/src/commands/history.ts:498` / `:527` — one `attribution: sessions=… links-created=… links-present=… skipped=… ambiguous=…` line in fan-out and daily text output; JSON output inherits the fields via the existing result spread.

**Docs**

- `docs/04_DESIGN.md` — `history_task_session` table row after `history_run_session`; analyze `--task` selector text now states the two mapping authorities (run chain + direct attribution).
- `docs/design/history-data-processing.md` — new §2.3 "Task Attribution from Imported Sessions (task 0722)"; Q9 row notes the unioned task-only selection.

#### Rationale (key rejections)

- Rejected transcript parsing / sibling-store reads (R1): the normalized contract tables already carry `content_text` and `args_raw`; attribution is a pure function over them.
- Reestimated-not-exact writes: even deterministic syntax is retrospective evidence at import; `exact` stays reserved for the invoke boundary, and precedence keeps one row per key.
- Rejected widening `task+run` selection: intersection through the real run chain is the R5 contract; the union belongs to the task-only path where evidence is direct.

#### Verification

- `packages/domain`: 96 pass (classifier 13, DAO+evidence reads 8, forensic-query 26 incl. selector-union + R2 structural-invariant scan, migrations 49 incl. 0028 id + drizzle folder-load).
- `packages/app`: 46 pass (attribution composition + HistoryService wiring incl. `attribution-failed` degradation, 8 new).
- `apps/cli`: 35 pass (history command incl. updated `FanOutResult` mocks).
- `bun run typecheck`: all workspaces exit 0.
- A6 full-import repair intentionally NOT run — the verify stage owns it.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

## Review Report — 0722

**Scope:** working-tree diff vs HEAD 054b038f0 (20 non-corpus files; uncommitted)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Evidence chain:** proof digest sha256:746d54b2edcadb0ac2548f3808d1563e8c6398193bcdaa46efac41e3a6cd9d04; fresh this turn — bun test domain 96 pass / app 46 pass / cli 35 pass, `bun run typecheck` all workspaces exit 0.

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | minor | correctness | CLI renders the `attribution:` line in fan-out/daily text output, but no CLI test asserts the rendered line — mocks only gained the `attribution` field for type compliance. R6 text-exposure is wired yet unasserted at CLI level. | `apps/cli/tests/commands/history.test.ts:475` (mocks), `apps/cli/src/commands/history.ts:498` |
| 2 | minor | functional | Incremental `'changed'`-scope attribution has no HistoryService-level test; scope SQL is unit-tested in domain, but the service branch selecting `changed` for incremental imports is only covered implicitly. | `packages/app/src/services/history-service.ts:440`, `packages/domain/tests/dao/task-session-dao.test.ts:116` |
| 3 | minor | correctness | Dry-run forces scope `'all'` even in incremental mode, so an incremental dry-run previews more links than a subsequent incremental write (scope `'changed'`) would create. Honest counts, but preview/real can diverge in that mode. | `packages/app/src/services/history-service.ts:440` |
| 4 | advisory | efficiency | Per-session evidence load + per-candidate insert is an N+1 shape (≤5000 sessions × ~2 queries per source). Bounded and import-time only; batch if import latency ever matters. | `packages/app/src/services/task-attribution.ts:33` |
| 5 | advisory | hygiene | `.gitignore` drops `!/.spur/agents/.gitkeep` — unrelated to the 0722 change map; likely a local runtime artifact riding the diff. Exclude or document at commit time. | `.gitignore:140` |
| 6 | advisory | correctness | A standalone 4-digit year (e.g. `2026`) on an allowlisted slash-command line becomes a candidate, is locator-rejected, and lands in `skippedEvidence` — never links, but slightly muddies the plain-mention counter semantics. | `packages/domain/src/analytics/task-attribution.ts:66` |

No blocker or major findings.

#### Functional Traceability

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | Attribution reads only normalized `history_message`/`history_tool_call` (`packages/domain/src/analytics/task-attribution.ts:155,:187`); no worktree enumeration, sibling-db reads, or new parser anywhere in the diff; discovery/`--file`/`--root` untouched. |
| R2 | MET | `history_task_session` PK `(wbs, source, session_id)` (`packages/domain/src/migrations.ts:171`, migration `0028` at :828 + `drizzle/0028_*.sql`); multi-task per session; idempotent insert with exact-over-estimated precedence (`packages/domain/src/dao/task-session-dao.ts:52`); bounded 200-char basename#line locator, no transcript content. |
| R3 | MET | Pure allowlisted classifier (`packages/domain/src/analytics/task-attribution.ts:92`): line-anchored `/sp[:_-]dev*` + structured `spur task <verb> <wbs>`; plain mentions/pasted specs → skipped, extractor conflict → ambiguous (fixtures in `packages/domain/tests/analytics/task-attribution.test.ts`); every candidate locator-validated (`packages/app/src/services/task-attribution.ts:47`); links always `estimated`. |
| R4 | MET | Attribution runs after import success, write + dry-run (`packages/app/src/services/history-service.ts:438`); full/dry-run = `all`, incremental = `changed` since import start; dry-run previews via `hasLink`; idempotency proven (`packages/app/tests/services/task-attribution.test.ts:94`). |
| R5 | MET | Task-only selector unions run chain + direct authority (`packages/domain/src/analytics/forensic-query.ts:216`); task+run keeps intersection through the run chain only (:166, first branch); union + non-widening asserted (`packages/domain/tests/analytics/forensic-query.test.ts:572,:583`). |
| R6 | MET | Counters exposed in fan-out/daily text and JSON spread (`apps/cli/src/commands/history.ts:498,:527`); docs updated (`docs/04_DESIGN.md` table row + selector text; `docs/design/history-data-processing.md` §2.3 + Q9); no new public noun/verb. Minor: CLI line rendering unasserted (finding 1). |
| R7 | MET (readiness) | Verify stage owns execution per assignment. Readiness: full re-import evaluates all discovered sessions post-import, degradation path proven (`attribution-failed`, `packages/app/src/services/history-service.ts:850`; test `task-attribution.test.ts:181`), repair + idempotency tests at `task-attribution.test.ts:155,:94`. Not executed here. |

#### SECUA

- **Security:** all SQL parameterized; evidence_ref bounded/capped, basename only — no transcript content persisted (privacy contract held). No injection surface (constant LIKE patterns).
- **Correctness:** classifier deterministic (tested); DAO idempotency/precedence enforced at the write path, not callers; failures degrade to `attributionError` + warning, never a failed import (tested).
- **Efficiency:** bounded reads — `ATTRIBUTION_SESSION_LIMIT=5000`, `ATTRIBUTION_EVIDENCE_LIMIT=500`, LIKE prefilters, indexed `(source, session_id)`, PK-prefix WBS lookup; R2 structural invariant intact (selector scan test).
- **Usability:** single honest counter line; `attribution: null` skip when no locator; failed attribution visibly reported.

#### Architecture

Good seams: pure classifier (no I/O) in domain; DAO owns invariants; app layer owns side-effect composition + locator validation; CLI renders only. Additive extension of `HistoryImportResult`/`FanOutResult` preserves existing call sites (typecheck clean). Advisory N+1 only (finding 4).

**Next:** hand to verify stage for R7 (A6 full dry-run + write import, twice, provenance + before/after counts, assert 0703–0712 non-empty under `history analyze --task`); optionally fold findings 1–2 into the verify pass or a fast-follow.

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

- 2026-08-31T02:48:31.754Z todo → wip (system)
