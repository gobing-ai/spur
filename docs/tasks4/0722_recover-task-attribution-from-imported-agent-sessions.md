---
schema_version: 1
name: "Recover task attribution from imported agent sessions"
status: done
template: issue
created_at: 2026-08-30T18:44:01.803Z
updated_at: "2026-08-31T12:48:51.311Z"
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

- [x] **R1 — Preserve importer ownership and discovery.** Keep the existing source registry and
      user-home JSONL roots authoritative. Do not enumerate Git worktrees, read sibling
      `.spur/spur.db` files, copy run stores, or add another transcript parser in Spur. Explicit
      `--file`/`--root` behavior remains caller-directed.
- [x] **R2 — Add a direct many-to-many task↔session authority.** Persist evidence-backed links from
      `(source, session_id)` to every operated task WBS, including multiple tasks per session. Do not
      synthesize workflow run IDs and do not promote the single-valued `history_message.task_wbs`
      column into an authority. Links are idempotent and retain confidence/mechanism plus a bounded
      evidence locator for audit.
- [x] **R3 — Attribute only operational evidence.** Accept deterministic signals such as an explicit
      task-scoped `/sp:dev-*` invocation, a structured `spur task <verb> <wbs>` operation, canonical
      task-file/checkpoint ownership metadata, or equivalent source-native structured metadata.
      Validate every candidate through the task locator. Plain four-digit prose, feature rosters,
      pasted specifications, requirements, and conflicting candidates never create a link.
      Transcript-derived links are labeled inferred/estimated, never exact.
- [x] **R4 — Integrate attribution into existing import modes.** Incremental import attributes the
      sessions it imports or updates; full import re-evaluates the discovered source sessions so an
      ordinary source-local full re-import repairs already-consolidated history. Dry-run uses the
      same classifier and previews counts without writes. A second identical run creates zero
      duplicate links.
- [x] **R5 — Make task-scoped analysis use both authorities.** `--task` matches sessions linked by
      either the existing `task_run_links → history_run_session` chain or the new direct
      task↔session relation. Other selectors still compose with `AND`; a simultaneous `--run` and
      `--task` must not widen either scope. Unresolved/ambiguous links never match.
- [x] **R6 — Report and document attribution honestly.** History-import JSON/text results expose
      sessions evaluated, links created/already present, and skipped/ambiguous evidence counts,
      without persisting transcript content again. Update the history data-processing and selector
      authority contracts; add no new public noun or verb.
- [x] **R7 — Repair and prove the A6 case.** With source-local CLI/importer provenance recorded, run
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

- `packages/domain/src/analytics/task-attribution.ts:109` — pure `classifyTaskAttribution(records) → {candidates, skipped, ambiguous}` (R3): first-party allowlisted syntax only, one extractor per evidence kind (echo rule, run-2 remediation R9) — line-anchored task-scoped `/sp[:_-]dev` invocations in user rows, structured `spur task <verb> <wbs>` **only in tool `args_raw`**; quoted command text in user-kind rows (dispatch prompts, tool-output echoes, pasted prose) never links and is counted skipped; four-digit operand shape with lookarounds excludes dates/versions/paths. Deterministic, so dry-run and write share decisions. `evidenceRef = <file basename>#<line>`, 200-char cap.
- `packages/domain/src/analytics/task-attribution.ts:173` / `:205` — `listAttributionSessions` (`all` / `changed`-since scopes, placeholder session ids excluded, `ATTRIBUTION_SESSION_LIMIT`-bounded) and `loadAttributionEvidence` (allowlist-prefiltered user/tool rows, `ATTRIBUTION_EVIDENCE_LIMIT`-bounded); missing-table → [].
- Exports via `dao/index.ts` and `analytics/index.ts`.

**Domain — read path**

- `packages/domain/src/analytics/forensic-query.ts:214-221` — task-only selector now unions the run chain (`task_run_links` → `history_run_session`) with `history_task_session` (R5); task+run keeps intersection semantics through the run chain only. R2 structural invariant intact (no corpus query unbounded; verified by scan test).

**App — composition + import wiring**

- `packages/app/src/services/task-attribution.ts:39` — `attributeSessions({db, source, sessionIds, isKnownWbs, resolvedAt, dryRun, reconcile?}) → TaskAttributionSummary`: locator-validates every candidate (R3), previews via `hasLink` when `dryRun` (R4), counts idempotent writes as `linksAlreadyPresent`.
- `packages/app/src/services/history-service.ts:438` / `:456` — attribution runs after the source import succeeds, in write and dry-run mode; `full`/dry-run scope `all` (source-local full re-import repairs consolidated history), incremental scope `changed` (`imported_at >= import start`); no task locator in context → `attribution: null` (skip, never guess); failure → `attributionError` + `attribution-failed` warning (history-service.ts:850), never a failed import. `HistoryImportResult` extended additively (`attribution?`, `attributionError?`) so existing call sites are unaffected; `FanOutResult.attribution` always present (summed across sources).
- `packages/app/src/index.ts` — re-exports `attributeSessions` / `AttributeSessionsInput`.

**CLI**

- `apps/cli/src/commands/history.ts:549` / `:578` — one `attribution: sessions=… links-created=… links-present=… skipped=… ambiguous=…` line in fan-out and daily text output; JSON output inherits the fields via the existing result spread.

**Docs**

- `docs/04_DESIGN.md` — `history_task_session` table row after `history_run_session`; analyze `--task` selector text now states the two mapping authorities (run chain + direct attribution).
- `docs/design/history-data-processing.md` — new §2.3 "Task Attribution from Imported Sessions (task 0722)"; Q9 row notes the unioned task-only selection.

#### Remediation run 2 (2026-08-30, verify-fail fix)

Verify for run 1 flagged R3 PARTIAL: the classifier linked `spur-cli`/`user-command` rows that are
**echoes** — quoted `spur task …` strings in dispatch prompts, tool-output transcripts, and pasted
prose (cd09d701#222 class, 5 false links across wbs 0703–0712). Ground truth in `.spur/spur.db`:
every false link is `mechanism='spur-cli', evidence_kind='user-command'`; every genuine link is
`mechanism='slash-command'` — including subagent dispatch-prompt line-2 slash quotes, which the
verify certified as the genuine recovery channel (they must survive for R8).

- **Echo rule (implemented, `packages/domain/src/analytics/task-attribution.ts:109`)** — one
  extractor per evidence kind: user-kind rows link only via a line-anchored task-scoped slash
  invocation; the `spur task <verb> <wbs>` syntax links **only through tool-call `args_raw`**, where
  a genuinely executed operation lands. Quoted command text in user-kind rows never links; it is
  counted `skipped` (`ambiguous` is kept for contract stability and is always 0). Unit tests pin the
  cd09d701#222 grep-echo, dispatch-prompt, frontmatter, and prose classes; the line-anchored slash
  in dispatch prompts is pinned as the deliberate R8 channel. `docs/04_DESIGN.md` (schema row +
  §3.2) and `docs/design/history-data-processing.md` §2.3 document the rule.
- **Bash-evidence channel (R7 root cause) — engine gap, recorded not worked around.** Genuine pi
  bash `spur task` operations persist with `args_raw = NULL`: importer 0.4.48's `maybeArgsRaw`
  keeps tool args only for the todo allowlist, and `piSplit` drops non-todo `call.input` at split
  time (only the one-way `args_digest` survives). The caller-side extension point cannot fix it:
  `fieldTransforms` are per-source, receive only the split record (never the raw JSONL object or
  target-table identity), and an added `args_raw` transform key makes the typed `history_message`
  insert throw (`Typed table "history_message" has unknown columns: args_raw`) — reproduced live
  against a real `runJsonlImport` + derived `getSourceDefinition('pi')` probe. Fix belongs upstream
  in the importer mapper (persist pi tool-call args, or route transforms per target table with the
  raw line in context); a full re-import then feeds the channel. Recorded in `docs/04_DESIGN.md`
  §3.2 and `docs/design/history-data-processing.md` §2.3. No `history-service.ts` change; existing
  DB links are unchanged until a verify-owned re-import (stale `spur-cli`/`user-command` rows may
  persist until then).

#### Rationale (key rejections)

- Rejected transcript parsing / sibling-store reads (R1): the normalized contract tables already carry `content_text` and `args_raw`; attribution is a pure function over them.
- Reestimated-not-exact writes: even deterministic syntax is retrospective evidence at import; `exact` stays reserved for the invoke boundary, and precedence keeps one row per key.
- Rejected widening `task+run` selection: intersection through the real run chain is the R5 contract; the union belongs to the task-only path where evidence is direct.

#### Verification

- `packages/domain`: 96 pass (classifier 13, DAO+evidence reads 8, forensic-query 26 incl. selector-union + R2 structural-invariant scan, migrations 49 incl. 0028 id + drizzle folder-load).
- `packages/app`: 46 pass (attribution composition + HistoryService wiring incl. `attribution-failed` degradation, 8 new).
- `apps/cli`: 35 pass (history command incl. updated `FanOutResult` mocks).
- `bun run typecheck`: all workspaces exit 0.
- A6 full-import repair run 3 (2026-08-31, fixed-engine re-import): pi dry-run `linksCreated=0` over 1621 sessions; full-mode write reconcile re-derived 526 pi links (echo class structurally eliminated); 0703–0712 all non-empty — see Testing (run-3 verdict).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | Attribution path imports no fs/worktree modules (grep for `node:fs\|readdir\|worktree` over packages/domain/src/analytics/task-attribution.ts, packages/domain/src/dao/task-session-dao.ts, packages/app/src/services/task-attribution.ts → 0 hits). Reads only the normalized contract tables: `loadAttributionEvidence` (packages/domain/src/analytics/task-attribution.ts:213-263) queries `history_message` + `history_tool_call` only. No new noun/verb: `history import --help` shows the pre-existing surface (pi\|...\|all, --file, --root, --mode, --dry-run) unchanged. |
| R2 | MET | `HISTORY_TASK_SESSION_SCHEMA_SQL` packages/domain/src/migrations.ts:171-186 — PK `(wbs, source, session_id)` + `idx_history_task_session_source_session`; migration `0028_spur_cli_history_task_session` (migrations.ts:828) and byte-identical folder-load copy drizzle/0028_spur_cli_history_task_session.sql. Live DB: `SELECT COUNT(*) FROM history_task_session` → 991; PK-duplicate check `GROUP BY wbs,source,session_id HAVING COUNT(*)>1` → 0; 991 `estimated` / 0 `exact`; 0 null and 0 >200-char `evidence_ref`; many-to-many proven — one pi session links 10 distinct WBS (query `GROUP BY session_id ORDER BY COUNT(DISTINCT wbs) DESC` → 10). No synthesized run ids, no `history_message.task_wbs` promotion. |
| R3 | MET | Pure classifier `classifyTaskAttribution` (packages/domain/src/analytics/task-attribution.ts:109-152): one extractor per evidence kind (echo rule) — line-anchored `/sp[:_-]dev` slash in user rows (:66), `SPUR_TASK_RE` tool-args-only incl. the source-local entrypoint `(?:spur\|apps/cli/src/index.ts)\s+task` (:70); operand shape excludes dates/versions/paths. App layer locator-validates every candidate (`attributeSessions`, packages/app/src/services/task-attribution.ts:60-69 — invalid WBS → `skippedEvidence`, never a link). Domain suite: 20 pass / 0 fail incl. plain-mention, grep-echo, dispatch-prompt, frontmatter, and source-local-guard (wrong package / wrong noun / `.tsx`) negative fixtures. DB integrity: zero echo-class rows — `GROUP BY mechanism, evidence_kind` → only `slash-command\|user-command` (336) and `spur-cli\|cli-tool` (655); `spur-cli\|user-command` does not exist. |
| R4 | MET | Wiring: attribution runs after import success in write and dry-run (packages/app/src/services/history-service.ts:438-446); scope `all` for full/dry-run, `changed` for incremental (:440); full-mode write reconcile gated `input.mode === 'all' && !input.dryRun` (:479) → `dao.deleteBySource` (packages/domain/src/dao/task-session-dao.ts:152-156); dry-run previews via `hasLink` and never writes/deletes (packages/app/src/services/task-attribution.ts:44-46, 74-80). App suite 10 pass / 0 fail incl. "reconcile drops stale source links" and "dryRun never reconciles". Live: `bun run apps/cli/src/index.ts history import --source pi --mode full --dry-run --json` → attribution `{"sessionsEvaluated":1621,"linksCreated":0,"linksAlreadyPresent":3287,"skippedEvidence":15674,"ambiguousEvidence":0}`; all 526 pi rows share one `resolved_at` (2026-08-31T12:01:34.607Z) = the last full write pass re-derived the whole source; post-dry-run recount still 991 (preview wrote nothing). |
| R5 | MET | Task-only selector unions both authorities (packages/domain/src/analytics/forensic-query.ts:243-260): `EXISTS(task_run_links→history_run_session) OR EXISTS(history_task_session)`; task+run keeps intersection semantics through the run chain only (:214-225); other selectors still AND-compose. Live: `history analyze --task <wbs> --json` for each of 0703–0712 returned sessions (bySession rows 20/10/19/16/7/6/3/5/11/3, top-20 cap; sources=pi) — direct-authority rows match through the unioned branch. |
| R6 | MET | One `attribution: sessions=… links-created=… links-present=… skipped=… ambiguous=…` line in fan-out and daily text output (apps/cli/src/commands/history.ts:549-551, :578); JSON inherits `attribution`/`attributionError` via the additive result spread (history-service.ts:447-449) — no transcript content persisted (evidence_ref is `<basename>#<line>` only; 0 null refs, 0 over 200 chars). Contracts updated: docs/04_DESIGN.md:804 (two selector authorities), :1593 (schema row: echo rule, estimated exactness, bounded locator, idempotent PK); docs/design/history-data-processing.md §2.3:111-160 (scope honesty, prefilter bounds, echo rule, locator validation, read-path union). Minor residual: docs do not yet name the run-3 tool-prefilter arm `args_raw LIKE '%index.ts task%'` (task-attribution.ts:238-240) — contract-level statements remain accurate. |
| R7 | MET | Per-target live counts (query on .spur/spur.db): 0703=26, 0704=10, 0705=19, 0706=16, 0707=7, 0708=6, 0709=3, 0710=5, 0711=11, 0712=3 — every task ≥1 evidence-backed session. Evidence chains re-verified by joining `evidence_ref` basename#line back to `history_tool_call` rows: args read like `bun run apps/cli/src/index.ts task show 0703 --json` / `task list --feature A6 --json` (source-local spelling the run-3 classifier now matches). Idempotency: dry-run full pass over 1621 pi sessions → linksCreated=0; 0 PK duplicates; 991 rows stable across the dry run. Gates: focused domain classifier 20 pass/0 fail; app attribution+wire 10 pass/0 fail; root gate `bun run test` → 7034 pass / 0 fail (376 files); `bun run typecheck` → all 4 workspaces exit 0. Out-of-scope residue: the project post-check security rule is red on packages/app/tests/services/history-board-service.test.ts:72 — an UNCOMMITTED file from the concurrent 0724/0725 writer (git status modified; commit history 2d0e1e235, no 0722 commit touches it; the flagged line is a parameterized test INSERT `VALUES (?,?,…)` with bound args). Owned by 0724/0725, not a 0722 defect; observe-only verifier did not edit it. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R8 — imported sessions recover attribution from operational evidence; multi-task sessions queryable through either task | MET | command | pi session 2026-08-29T17-07-14-219Z_01a04e7d-5eab-726d-aa03-1c02a5c3dbe5 links 10 distinct WBS (query `GROUP BY session_id`); `history analyze --task 0712 --json` (and 0703–0711) returns that session through the unioned task-only selector (forensic-query.ts:243-260) without any synthesized run (`exactness` stays `estimated`, 991/991 rows). |
| R9 — ambiguous/echo references never become links; counts reported | MET | test | Zero echo-class rows in DB: `GROUP BY mechanism, evidence_kind` → only `spur-cli\|cli-tool` (655) and `slash-command\|user-command` (336); `spur-cli\|user-command` absent. Live dry-run reports `skippedEvidence=15674`, `ambiguousEvidence=0` (documented always-0 contract). Negative fixtures pinned in packages/domain/tests/analytics/task-attribution.test.ts (grep echo, dispatch-prompt quote, prose, source-local user-row quote → candidates [], skipped counted). |
| R10 — full re-import repairs existing attribution idempotently, no worktree/sibling DB | MET | command | `history import --source pi --mode full --dry-run` over 1621 sessions → linksCreated=0 (table already a converged projection); write path reconciles by delete+re-derive (`deleteBySource`, task-session-dao.ts:152-156; gated `mode==='all' && !dryRun`, history-service.ts:479) — all 526 pi rows share a single `resolved_at`; 0 PK duplicates; attribution path touches no filesystem (grep: 0 fs/worktree hits). |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Review Report — 0722 (run 3)

**Scope:** run-3 delta vs run-2 base — commit 50543ff0 (classifier source-local entrypoint spelling + full-mode reconcile; 6 files, +107/−6: `packages/domain/src/analytics/task-attribution.ts` + test, `packages/domain/src/dao/task-session-dao.ts`, `packages/app/src/services/task-attribution.ts`, `packages/app/src/services/history-service.ts`, CLI history tests) plus 49763ba74 (web test TS narrowing fix, unrelated to 0722 substance), on top of 914f0e464/7bba3c262. Run-1 implementation and run-2 echo remediation stand.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

#### Findings (P1–P4)

| # | Severity | Dimension | Finding | Location |
| --- | -------- | ----------- | --------- | ---------- |
| 1 | P4 | correctness | Verify answer-file AC rows used non-enum evidence types (`query + command`, `query + test`); the deterministic gate dropped 2 AC rows on first parse. Normalized to enum values (`command`, `test`) — evidence text unchanged; gate then PASS with zero dropped rows. | `.spur/run/0722-verify-answer.txt` |
| 2 | P3 | reliability (upstream) | Importer `record_hash` differs across engine versions for identical lines, so each full import under a different engine rewrites ~73k rows (ledger reports them new; upsert replaces content). Bounded by last-writer-wins and converges once the fixed engine is the only importer (ts-libs release pending). | ts-libs `packages/llm-jsonl-importer` (backlog) |
| 3 | P3 | process | Full-mode import with the PUBLISHED importer build overwrites retained bash `args_raw` with NULL via message-hash upsert — occurred and was repaired this turn (fixed-engine symlink + pi re-import). Standing rule until release: run imports only against the fixed engine. | `docs/design/history-data-processing.md` §2.3 |
| 4 | P4 | doc precision | Docs do not yet name the run-3 tool-prefilter arm `args_raw LIKE '%index.ts task%'`; contract-level statements remain accurate. | `docs/design/history-data-processing.md` §2.3 |
| 5 | P4 (out of scope) | security | Project post-check security rule red on an UNCOMMITTED file from the concurrent 0724/0725 writer (parameterized test INSERT with bound args — likely scanner heuristic false-positive). Not a 0722 file; not edited per one-writer discipline. | `packages/app/tests/services/history-board-service.test.ts:72` |

No P1/P2 findings. Carried-over run-2 advisory minors (CLI `attribution:` line rendering unasserted; incremental `changed`-scope service test implicit) remain untouched by this delta.

#### Functional Traceability (run-3 delta)

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R4 (reconcile) | MET | Full-mode write deletes then re-derives per source: `deleteBySource` (`packages/domain/src/dao/task-session-dao.ts:152`), gated `input.mode === 'all' && !input.dryRun` (`packages/app/src/services/history-service.ts:479`); app tests pin "reconcile drops stale source links" and "dryRun never reconciles". Live: all 526 pi rows share one `resolved_at`; zero echo-class rows remain. |
| R3/R7 (source-local spelling) | MET | `SPUR_TASK_RE`/prefilter accept `apps/cli/src/index.ts task` alongside `spur task`; live pi tool-call args (`bun run apps/cli/src/index.ts task show 0712 --json` class) now link. 0707=7, 0708=6, 0709=3, 0710=5, 0711=11, 0712=3. |

#### SECUA (run-3 delta)

- **Security:** reconcile delete is source-scoped, transactional, gated to full-mode non-dry-run; no user input in SQL; classifier unchanged and pure.
- **Correctness:** dry-run and write share classifier decisions — dry-run never deletes (pinned by test); regex hygiene unchanged (`matchAll` for global patterns).
- **Efficiency:** prefilter bounds unchanged; reconcile is one indexed delete per source before bounded re-derive.

#### Architecture

Reconcile makes `history_task_session` a converged projection of the current classifier instead of an append-only log — the run-2 "stale rows persist with no retraction path" finding is structurally closed. The upstream importer gap (bash args retention) was fixed in ts-libs (commit 96762d5) and consumed via symlinked workspace dependency; documented in the two design docs.

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
- 2026-08-31T12:48:08.967Z wip → testing (system)
- 2026-08-31T12:48:51.311Z testing → done (system)
