---
schema_version: 1
name: "Recover task attribution from imported agent sessions"
status: wip
template: issue
created_at: 2026-08-30T18:44:01.803Z
updated_at: "2026-08-31T04:47:50.484Z"
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

- `packages/domain/src/analytics/task-attribution.ts:109` — pure `classifyTaskAttribution(records) → {candidates, skipped, ambiguous}` (R3): first-party allowlisted syntax only, one extractor per evidence kind (echo rule, run-2 remediation R9) — line-anchored task-scoped `/sp[:_-]dev` invocations in user rows, structured `spur task <verb> <wbs>` **only in tool `args_raw`**; quoted command text in user-kind rows (dispatch prompts, tool-output echoes, pasted prose) never links and is counted skipped; four-digit operand shape with lookarounds excludes dates/versions/paths. Deterministic, so dry-run and write share decisions. `evidenceRef = <file basename>#<line>`, 200-char cap.
- `packages/domain/src/analytics/task-attribution.ts:173` / `:205` — `listAttributionSessions` (`all` / `changed`-since scopes, placeholder session ids excluded, `ATTRIBUTION_SESSION_LIMIT`-bounded) and `loadAttributionEvidence` (allowlist-prefiltered user/tool rows, `ATTRIBUTION_EVIDENCE_LIMIT`-bounded); missing-table → [].
- Exports via `dao/index.ts` and `analytics/index.ts`.

**Domain — read path**

- `packages/domain/src/analytics/forensic-query.ts:214-221` — task-only selector now unions the run chain (`task_run_links` → `history_run_session`) with `history_task_session` (R5); task+run keeps intersection semantics through the run chain only. R2 structural invariant intact (no corpus query unbounded; verified by scan test).

**App — composition + import wiring**

- `packages/app/src/services/task-attribution.ts:33` — `attributeSessions({db, source, sessionIds, isKnownWbs, resolvedAt, dryRun}) → TaskAttributionSummary`: locator-validates every candidate (R3), previews via `hasLink` when `dryRun` (R4), counts idempotent writes as `linksAlreadyPresent`.
- `packages/app/src/services/history-service.ts:438` / `:456` — attribution runs after the source import succeeds, in write and dry-run mode; `full`/dry-run scope `all` (source-local full re-import repairs consolidated history), incremental scope `changed` (`imported_at >= import start`); no task locator in context → `attribution: null` (skip, never guess); failure → `attributionError` + `attribution-failed` warning (history-service.ts:850), never a failed import. `HistoryImportResult` extended additively (`attribution?`, `attributionError?`) so existing call sites are unaffected; `FanOutResult.attribution` always present (summed across sources).
- `packages/app/src/index.ts` — re-exports `attributeSessions` / `AttributeSessionsInput`.

**CLI**

- `apps/cli/src/commands/history.ts:498` / `:527` — one `attribution: sessions=… links-created=… links-present=… skipped=… ambiguous=…` line in fan-out and daily text output; JSON output inherits the fields via the existing result spread.

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
- A6 full-import repair intentionally NOT run — the verify stage owns it.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

## Review Report — 0722 (run-2 remediation delta)

**Scope:** working-tree delta vs base fad7ef5b6 — 5 files: `packages/domain/src/analytics/task-attribution.ts` + its test, `docs/04_DESIGN.md`, `docs/design/history-data-processing.md`, this WBS. Run 1's 20-file implementation remains PASS; only the delta is re-reviewed.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture (delta-focused)
**Verdict:** PASS
**Evidence chain:** proof digest sha256:87c68b70035ef3e19c035a482c518e52ddfb03b592467b2bf80091386a04b6f8 (remediation provenance); fresh this turn — domain 1115 pass / app 2362 pass / cli 920 pass, focused classifier suite 17 pass (0 fail), `bun run typecheck` all workspaces exit 0. Importer gap statically corroborated against installed `@gobing-ai/ts-llm-jsonl-importer@0.4.48` (`dist/mappers.js:116` — `maybeArgsRaw` returns `undefined` for every non-todo-allowlist tool).

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | advisory (positive) | correctness | Echo class is structurally eliminated, not just behaviorally patched: the false-link shape from run 1 (`mechanism='spur-cli'` + `evidence_kind='user-command'`) is now unrepresentable — the user branch can only emit `slash-command`/`user-command`, the tool branch only `spur-cli`/`cli-tool`. All five cd09d701-class fixtures (grep echo, dispatch-prompt quotes, frontmatter, prose, slash+nearby-quote) are pinned as never-link or slash-only-link. | `packages/domain/src/analytics/task-attribution.ts:109-152`, `packages/domain/tests/analytics/task-attribution.test.ts:90-152` |
| 2 | advisory | correctness (doc precision) | Quoted `spur task` text in a record that ALSO carries a slash link is silently ignored, not counted skipped — `skipped` only increments in the slash-less branch. WBS/docs wording ("counted skipped") slightly overstates; actual behavior is deliberate and pinned by test (slash record with nearby quote → `skipped 0`). | `packages/domain/src/analytics/task-attribution.ts:118-127` vs WBS "Remediation run 2" echo-rule bullet |
| 3 | advisory | correctness (residual) | The certified slash channel still trusts line-anchored `/sp[:_-]dev` text in user-kind rows, and pi flattens `toolResult` content into user rows — a tool-output echo quoting a slash invocation at line start would still link. Accepted deliberately: verify certified the dispatch-prompt line-2 slash as the genuine R8 recovery channel, and relay-vs-echo is undecidable at this layer. | `packages/domain/src/analytics/task-attribution.ts:66`, `:117-120` |
| 4 | carry-over | correctness/usability | Run-1 minors persist untouched by this delta (CLI `attribution:` line rendering unasserted; incremental `changed`-scope service test implicit; incremental dry-run previews scope `all`). Not re-litigated per assignment scope. | `apps/cli/src/commands/history.ts:498`, `packages/app/src/services/history-service.ts:440` |

No blocker or major findings.

#### Functional Traceability (delta-scoped)

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R3 (echo remediation, run-2 R9) | MET | One extractor per evidence kind (`task-attribution.ts:109`): user rows link only via line-anchored slash; `spur task` syntax only via tool `args_raw`; quoted user-row text never links. 5 echo-class tests + 1 deliberate-R8 test, 17/17 pass. |
| R6 (docs honesty) | MET | `docs/04_DESIGN.md` schema row rewritten to the echo rule + new §3.2 `fieldTransforms` limits paragraph; `docs/design/history-data-processing.md` §2.3 rewritten (echo rule + "Bash-evidence channel — upstream gap" paragraph naming importer 0.4.48, `maybeArgsRaw`, `piSplit`, and the typed-insert throw). `ambiguous` kept for the R6 contract, documented always-0. |
| R7 (bash channel) | NOT MET by design — upstream dependency | Genuine pi bash `spur task` ops persist `args_raw=NULL` (importer 0.4.48 `maybeArgsRaw` todo-allowlist — corroborated in `dist/mappers.js:116`; `args_digest` only survives split). Caller-side transform cannot fix (docs record the live repro). Recorded, not worked around. R7 non-PASS on 0707–0712 is a documented upstream dependency owned by the verify stage — NOT a review blocker for this delta. |
| R1/R2/R4/R5 | MET (unchanged) | Delta touches none of these paths; run-1 PASS evidence stands. |

#### SECUA (delta scan)

- **Security:** no new SQL, no I/O in the classifier (still pure); no injection surface; no transcript content persisted.
- **Correctness:** regex hygiene — `SPUR_TASK_RE` (g) only via `matchAll`, `WBS_RE` (g) only via `match`, `SLASH_COMMAND_RE` non-global via `.test` — no `lastIndex` state bugs; deterministic; `ambiguous` collapse documented and contract-stable.
- **Efficiency:** bounds unchanged (`ATTRIBUTION_SESSION_LIMIT`/`EVIDENCE_LIMIT`); the user-row LIKE prefilter's `'%spur task%'` arm now only feeds skip counting — benign over-fetch.
- **Usability:** R6 counters unchanged; skip counting still honest for slash-less echo records.

#### Architecture

The fix is structural: splitting extraction by evidence kind removes the ambiguity channel entirely instead of adjudicating conflicts — the run-1 false-positive class cannot be re-created by any input. Recording the importer gap in Solution + two design docs (with the live repro) rather than hacking a transform is the right call; the extension point provably cannot carry the fix.

**Next:** hand to verify stage for R7 execution (A6 dry-run + write import, idempotency, 0703–0712 assertion); the 0707–0712 bash-channel non-PASS is expected and upstream-owned. Optionally tighten finding 2's doc wording in a fast-follow.

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
