---
schema_version: 1
name: "Close the 0622 history data-plane residue: per-response usage dedup, claude forensic blind spots, empty sources and ETL tables"
status: done
template: standard
created_at: 2026-08-21T14:23:09.970Z
updated_at: "2026-08-22T03:42:15.375Z"
feature_id: E5
---

## 0624. Close the 0622 history data-plane residue: per-response usage dedup, claude forensic blind spots, empty sources and ETL tables

### Background
Task 0622's `--force` verify re-audit (2026-08-21) overturned its PASS: three of its nine
requirements carry unimplemented halves that 0622's own `### Solution` follow-up register listed
as explicitly deferred. The prior verdict read MET because `### Solution` / `### Testing` used a
re-keyed R-numbering that did not match 0622's authored `## Requirements` — each row was true
about the F-item it named and false about the R-item it was filed under.

This task is the home 0622's Background always intended for the residue: "R4–R8 are the
history/observability data plane and should be split into their own task under E/J3 when
scheduled." It carries the five findings with no owner. **F9 (agy chunk-boundary parse failures)
is NOT here — it is already task 0623 R5.**

#### Premises re-measured 2026-08-21 (refine `--depth ready`)

0622's numbers came from its 2026-08-20 forensic pass. They were re-run against the live
`.spur/spur.db` (4.05 GB, 1,671,453 messages) during this refine. **Three of the five findings
changed materially — do not implement against 0622's figures.**

| Finding | 0622 claimed | Re-measured | Verdict |
| --- | --- | --- | --- |
| F6 | usage summed per JSONL line, dedup on `requestId`; 59 collision groups; 139,323 vs 72,800 tokens | **`history_message` has no `request_id` column at all** (columns: `record_hash source source_file source_line session_id seq turn_index role record_type disposition ts duration_ms model input_tokens output_tokens cache_read_tokens cache_write_tokens cost_usd content_text cwd provenance run_id task_wbs imported_at`). Surrogate probe on `(session_id, ts, input_tokens, output_tokens)`: 52 groups, 52 excess rows of 33,934 claude messages carrying usage (~0.15%). | **CORRECTED** — the proposed dedup key does not exist; the 48% inflation figure was one session, not the corpus |
| F14 | 74/74 unmeasured durations, `result_bytes` 0, model `unknown` 193/329 | **17,219 / 17,219 claude tool calls (100%)** have null-or-zero `duration_ms` **and** null-or-zero `result_bytes`. Model `NULL` for **53,631 / 87,753** claude messages (61%). `history_tool_call` already has `duration_ms`, `result_bytes`, `call_id`. | **CONFIRMED, larger** — 0622's figures were a single-session slice |
| F8 | ten empty `history_etl_*` tables vs 1.65M messages | All ten present, **0 rows each**, vs **1,671,453** messages | **CONFIRMED** |
| F10 | "two sources import nothing", cause unverified (0622 rated LOW) | `openclaw` is a **deliberate deferral** — `UNSUPPORTED_SOURCES` at `packages/app/src/services/history-service.ts:239`, operator ruling 2026-08-06, feature E1 § Out of scope. `antigravity` is **not** in that list: it contains `'antigravity-ide'`, which never matches the `'antigravity'` entry in `SOURCES` at `:217-227`. | **CORRECTED** — one is expected behavior, the other is a key mismatch. Treating both as mapper defects would "fix" deliberately deferred work |
| F12 | 84/942 correlated (8.9%), zero claude | **86 / 950 (9.05%)**; by source omp 45, pi 19, codex 12, grok 10; **claude, agy, opencode, gemini all zero** | **CONFIRMED** |

Several fixes are importer-side and land in `~/xprojects/ts-libs/`
(`@gobing-ai/ts-llm-jsonl-importer`), not in this repo — R1 and R2 both cross that boundary.

**Adjacent observation, not in scope here:** 0622's R8 retention landed (`runRetention` wired to
`HistoryService.daily()`) but has never fired — `rule_eval_runs` 238,284 (was 237,361),
`queue_jobs` 54,496 (was 52,336), ledger 2,095,484 (was 1,978,502). All three grew since 0622
measured them. The trigger exists; the scheduler that invokes `daily()` is disabled
(`scheduler.enabled: false`). Belongs to E5/0622, recorded here so it is not lost.
### Requirements
- [x] R1. Give `history_message` a per-API-response identity and fold usage on it exactly once (0622 F6). The column does not exist today, so this is schema + importer work, not a query rewrite: add `request_id` to the `history_message` DDL and populate it from each source's response identifier in `@gobing-ai/ts-llm-jsonl-importer`. Where a source has no response id, leave it `NULL` and fold per row as today — a `NULL` must never collapse distinct responses into one bucket. Out of scope: changing `TokenTotals` semantics or the `cacheHitRatio` denominator (0622 R5/F7 already landed).
- [x] R2. Populate the `claude` source's forensic primitives at import so a bottleneck ranking is possible (0622 F14): `history_tool_call.duration_ms` and `.result_bytes` (currently null-or-zero for 17,219/17,219 claude calls) and `history_message.model` (currently `NULL` for 53,631/87,753). The columns already exist — this is extraction in the claude mapper, not a schema change. Out of scope: the renderer, which already reads these columns.
- [x] R3. Resolve the ten empty `history_etl_*` tables (0622 F8) by deciding retire-or-populate **before** writing code: 0 rows each against 1,671,453 messages. If retired, drop the tables in a numbered migration and delete the `ETL record shape` type at `packages/domain/src/analytics/types.ts:82`; if live, fix the write path. Record the decision and its rationale in `### Q&A` either way — a table that stays declared, empty, and unexplained is the defect.
- [x] R4. Fix the `antigravity` source-key mismatch and make a genuinely-skipped source say so (0622 F10). `UNSUPPORTED_SOURCES` (`packages/app/src/services/history-service.ts:239`) holds `'antigravity-ide'`, which never matches `'antigravity'` in `SOURCES` (`:217-227`), so `antigravity` imports as full-fidelity-eligible and reports a silent empty success. **Do not "fix" `openclaw`** — it is correctly listed and deliberately deferred (operator ruling 2026-08-06, feature E1 § Out of scope). A source that imports nothing must report either "deferred" or a concrete reason, never a bare `status: empty`.
- [x] R5. Raise run→session correlation above its 9.05% floor for the sources that produce runs (0622 F12): 86/950 correlated; omp 45, pi 19, codex 12, grok 10; claude, agy, opencode and gemini contribute zero. Diagnose why the correlating sources correlate before adding a new mechanism — the join at `packages/domain/src/analytics/role-tokens.ts:217` and `pairings.ts:316` already works for four sources. Out of scope: correlating sources that legitimately produce no runs.
### Acceptance Criteria
```gherkin
@core
Scenario: R1 — Usage is counted once per identified API response
  Given imported messages where several rows carry the same non-null request_id
  When usage is aggregated
  Then that response's tokens are counted exactly once
  And rows whose request_id is null are each counted individually
  And the cache-hit ratio stays a percentage of total input, never exceeding 100%

@core
Scenario: R2 — A claude-source session yields an actionable bottleneck ranking
  Given an imported Claude Code session from an importer that extracts tool timings
  When the forensics report is rendered
  Then tool durations and result sizes are populated rather than null-or-zero
  And messages carry a model rather than null
  And the bottleneck ranking names real categories instead of only unattributed and idle

@core
Scenario: R3 — The ETL tables are either populated or removed
  Given ten history_etl_ tables holding zero rows against 1.67M imported messages
  When their intent is resolved and recorded
  Then each table either receives rows from the import path or is dropped with its record type
  And no table remains declared, empty, and unexplained

@core
Scenario: R4 — A source that imports nothing says which kind of nothing
  Given a deferred source and a source expected to produce records
  When a full import runs
  Then the deferred source reports deferred rather than an empty success
  And a source expected to produce records that produces none reports a concrete reason

@edge
Scenario: R4 — Correcting the antigravity key does not re-open waived work
  Given openclaw is a deliberate deferral and antigravity is a key mismatch
  When the source constant is corrected
  Then antigravity is recognised by the deferral set under its real key
  And openclaw's deferral is preserved unchanged
  And sources labelled deferred that still import records continue to import

@core
Scenario: R5 — Run-to-session correlation covers the sources that produce runs
  Given imported runs and sessions across all sources
  When correlation is computed against the set of runs that should correlate
  Then a source producing runs contributes correlated pairs rather than zero
  And the reported percentage names its denominator
```
### Q&A
**Q (forced re-audit, 2026-08-21): what did the original PASS get wrong?**
A: Three conclusions were too broad. `MIN(rowid)` keeps the first incomplete cumulative Claude
response, migration 0019 cannot drop tables recreated after it has been journaled, and the 14/14
R5 denominator excluded unresolved runs that do have local role-named session directories. The
re-audit changes the fold to `MAX(rowid)`, prevents the importer from eagerly recreating generic
ETL tables, and resolves role-named run directories through `history_run_session`. R2 remains
PARTIAL because Claude JSONL provides no exact duration to extract.

**Q: Why five findings in one task instead of five tasks?**
A: They came from one forensic pass and share one root — the history plane records what it ingested
but not how it was produced. Splitting them at creation would have repeated 0622's failure mode,
where a deferred item with no owner reads as done. They are independently implementable and
independently verifiable; split at scheduling time if the batch is too large, but not before each
has a premise verified against the tree.

**Q: Why is the sequence R4 → R3 → R2 → R1 → R5 and not requirement order?**
A: Each earlier item removes noise from the next one's measurement. R4 stops `antigravity` polluting
coverage reports with a false empty. R3 removes ten tables from every schema question that follows.
R2 populates the primitives R5's diagnosis needs to compare sources. R1 needs a re-import to matter,
so it batches with R2's re-import. R5 is last because its denominator depends on R2's attribution.

**Q: 0622 said re-key the fold on `requestId`. Why is R1 schema work?**
A: Because the column did not exist. Identity had to be persisted at import before the SQL rollup
could fold repeated response snapshots. Rows with a NULL identity remain distinct.

**Q: Is `openclaw` importing zero files a bug?**
A: No. It remains in `DEFERRED_SOURCES` by the 2026-08-06 operator ruling. The original defect was
the unmatched `antigravity-ide` key; the implementation uses the real `antigravity` source key and
keeps deferred as a reporting label, not an import gate.

**Q: What is deliberately NOT in this task?**
A: F9 (agy chunk-boundary parse errors) is task 0623 R5. F18 (inline-drive provenance) remains in
0622. The `cacheHitRatio` denominator, `TokenTotals` contract, renderer, and 0622 retention scheduler
are unchanged.

**Q: Why do the AC scenarios not appear in feature E5's AC?**
A: Adding them changes an active feature's ship scope and remains an operator decision. The task
scenarios are verified directly and feature shippability reports the uncovered-scenario findings.

**Q (R3): drop the ten `history_etl_*` tables or leave them?**
A: RETIRE the empty built-in tables. Migration 0019 drops existing tables. The forced re-audit found
that published importer 0.4.41 eagerly recreates all ten after that one-shot migration is journaled.
Upstream commit `22f891f` makes schema setup create only checkpoint, ledger, and typed tables; a generic ETL
table is now created lazily only when an accepted generic/custom record targets it. That upstream
change still requires the normal release and Spur dependency update, so R3 is PARTIAL until shipped.

**Q (R5): why augmented local discovery instead of a second import of run dirs?**
A: Full-mode reconciliation needs one discovery set. Default import augments live roots with
run-owned session directories. Direct source names still match directly; a role name such as
`coder` is included when the run has one recorded importer source. After a write import, sessions
observed under that directory are persisted as exact mappings before provenance alignment.
Explicit `--file` and `--root` remain caller-directed and bypass augmentation.

**Q (R5): what denominator is honest?**
A: The original 14/14 exact-only denominator was not honest because it omitted unresolved mappings
with local session files. The executable denominator is now run-owned directories discoverable for
the requested source: direct source-name directories plus role-named directories whose run records
one sole importer source. The targeted test covers every member of that set and verifies exact
mapping persistence; a production percentage must be re-measured after the fixed write import.
### Design
Five independent findings sharing one root: the history plane records what it ingested but not
enough about *how* it was produced to attribute cost or time. They are sequenced R4 → R3 → R2 → R1
→ R5 because each earlier one removes noise from the next one's measurement.

#### Frozen names

| Kind | Name | Location |
| --- | --- | --- |
| Migration | `0018_spur_cli_history_message_request_id` | `packages/domain/src/migrations.ts` MIGRATIONS array |
| SQL const | `HISTORY_MESSAGE_REQUEST_ID_SCHEMA_SQL` | same file, beside `HISTORY_TOOL_CALL_CALL_ID_SCHEMA_SQL` |
| Column | `history_message.request_id TEXT` (nullable) | added via `addColumnIfMissing` |
| Migration | `0019_spur_cli_drop_history_etl_tables` | R3, **only if** the retire decision is taken |
| Constant | `DEFERRED_SOURCES` (renamed from `UNSUPPORTED_SOURCES`) | `packages/app/src/services/history-service.ts:239` |
| Status | `CoverageEntry.status = 'deferred'` (new variant beside `ok`/`degraded`/`empty`/`failed`) | `packages/app/src/services/history-service.ts` |

`max(prefix)+1` is **0018** — the array ends at `0017_spur_cli_runs_status_completed_to_done`
(`packages/domain/src/migrations.ts:425-427`). If a merge lands another 0018 first, renumber to
`max+1` (the E6 precedent, commit `fa41669c`).

#### R4 — antigravity key mismatch + honest empty (do first; smallest, unblocks measurement)

**WHERE:** `packages/app/src/services/history-service.ts` — `SOURCES` `:217-227`,
`UNSUPPORTED_SOURCES` `:239`, `buildRefreshCoverage` `:247-256`, the status ternary in
`importOneIsolated`.

**WHAT:** `UNSUPPORTED_SOURCES` holds `'antigravity-ide'`; `SOURCES` holds `'antigravity'`. The two
never match, so `antigravity` is imported as if full-fidelity-eligible and reports a bare
`status: 'empty'`, while `antigravity-ide` is reported as skipped but never imported. Rename the
constant `DEFERRED_SOURCES`, correct the entry to `'antigravity'`, and add a `'deferred'` status so
a source in that set reports the deferral rather than an empty success.

**Precedence:** `deferred` is decided **before** the scanned-files check — a deferred source is
never `empty`, `ok`, or `degraded` regardless of what it scanned. Existing order
(`scannedFiles === 0 ? 'empty' : hasDegradedInput ? 'degraded' : 'ok'`) is otherwise unchanged.

**Anti-patterns:** Do **not** touch `openclaw` — it is correctly listed and deliberately deferred
(operator ruling 2026-08-06, feature E1 § Out of scope); "fixing" it re-opens waived work. Do not
delete `'antigravity-ide'` without checking whether a distinct IDE root exists — if it does, both
keys stay. Do not fold `gemini`/`opencode` into this change: they are in the same set yet import
1,830 and 11,609 messages, so "deferred" is a coverage-report label, not an import gate. Preserve
that.

#### R3 — ETL tables: decide, then act

**WHERE:** ten `history_etl_*` tables; `packages/domain/src/analytics/types.ts:82` (the
`Canonical ETL record shape` type); `packages/domain/src/migrations.ts` if retiring.

**WHAT:** all ten hold 0 rows against 1,671,453 messages. The decision is the deliverable; the code
is trivial either way. Find the writer first — `rg -n 'history_etl' packages apps` returns exactly
one hit today (the type comment), which is strong evidence no write path was ever wired, i.e.
retirement. Confirm against feature E1's scope before dropping.

**Anti-patterns:** Do not build a write path to "fix" the emptiness without first establishing the
tables were meant to be live — 0622 rated F8's *meaning* MEDIUM precisely because the fact (0 rows)
does not imply the intent. Do not leave the type behind after dropping the tables.

#### R2 — claude forensic primitives (importer-side)

**WHERE:** `~/xprojects/ts-libs/` → `@gobing-ai/ts-llm-jsonl-importer`, claude mapper. **No Spur
schema change** — `history_tool_call.duration_ms`, `.result_bytes`, `.call_id` and
`history_message.model` all already exist.

**WHAT:** populate them. 17,219/17,219 claude tool calls carry null-or-zero `duration_ms` and
`result_bytes`; `model` is `NULL` for 53,631/87,753 claude messages. `call_id` (migration 0015,
task 0564) is the join key from a `toolResult` back to its `tool_use` — the same pairing that
carries the elapsed time and the result payload size.

**Handoff:** after the mapper ships, republish and `bun update` the dependent workspaces, then
re-import claude. Follow the 0504 R4 contract: source-local binary
(`bun run apps/cli/src/index.ts history import …`), never bare-PATH `spur`, and record the
provenance header. Task 0578 is the precedent for the release→re-import gap.

**Anti-patterns:** Do not synthesize a duration from message timestamps as a fallback — a fabricated
duration is worse than a `NULL` the renderer already reports as unmeasured (the 0281/0284
never-fabricate invariant). Do not touch the renderer; it reads these columns correctly today.

#### R1 — per-response usage identity (schema + importer)

**WHERE:** `packages/domain/src/migrations.ts` (0018); `@gobing-ai/ts-llm-jsonl-importer` for the
populate; `foldMessage` at `packages/app/src/services/history-service.ts:695-710` for the fold.

**WHAT:** 0622 proposed re-keying on `requestId`. **That column does not exist** — the fold cannot
be re-keyed until import writes an identity. Add `request_id TEXT` (nullable) via the 0015/0012
`addColumnIfMissing` precedent, populate it from each source's response identifier, then fold usage
once per non-null `request_id`.

**Algorithm (the part that is easy to get wrong):** group by `request_id` **only when it is
non-null**. A `NULL` `request_id` means "no response identity available for this source" and each
such row folds individually, exactly as today. Collapsing all `NULL`s into one bucket would merge
every unidentified response in the corpus into a single token total — a far larger error than the
one being fixed. Surrogate probe on `(session_id, ts, input_tokens, output_tokens)` finds 52 groups
/ 52 excess rows of 33,934 claude messages carrying usage, so expect a correction near 0.15%, not
0622's headline 48% (that figure was one session).

**Anti-patterns:** Do not change `TokenTotals` semantics or the `cacheHitRatio` denominator —
0622 R5/F7 landed that contract (`packages/domain/src/analytics/costs.ts:25-32`) and it is correct.
Do not backfill `request_id` from a heuristic on existing rows; leave historical rows `NULL` and let
the next full import populate them.

#### R5 — run→session correlation (diagnose before building)

**WHERE:** `history_run_session`; join sites `packages/domain/src/analytics/role-tokens.ts:217` and
`pairings.ts:316`; DDL `packages/domain/src/migrations.ts:133` (feature E6 / task 0557).

**WHAT:** 86/950 (9.05%). omp 45, pi 19, codex 12, grok 10; claude, agy, opencode, gemini zero. Four
sources correlate and four do not — so the mechanism works and the gap is per-source input, not a
missing feature. Establish what omp/pi/codex/grok emit that claude does not **before** proposing a
new correlation path.

**Anti-patterns:** Do not add a second correlation mechanism beside `history_run_session`. Do not
count sources that legitimately produce no runs as correlation failures — establish the denominator
(runs that *should* correlate) before claiming a percentage.

#### Cross-task

Depends on nothing. **0623 R5 owns F9** (agy chunk-boundary parse errors) — if agy parse errors are
fixed there first, R5's agy-zero row may move; re-measure rather than assuming. Leaves for
dependents: R3's retire-or-populate decision determines whether any future ETL consumer has tables
to read.
### Plan
- [x] Preserve honest deferred-source classification and executable R4 coverage.
- [x] Fold identified responses on the final cumulative row and add the request-id index (R1).
- [x] Resolve role-named run session directories through recorded sources and persist exact observed mappings (R5).
- [x] Stop eager ETL-table creation in the upstream importer and verify its full gate (R3 implementation).
- [ ] Release the importer, update Spur's pinned dependency, re-import, and confirm the ten tables stay absent (R3 delivery).
- [ ] Resolve the authored Claude-duration requirement with real source telemetry or an explicit scope/AC amendment; do not fabricate it (R2).
- [x] Record the forced all-focus re-audit, repository gates, live-data deltas, feature check, and residual blockers.
### Solution
| Req | Change | Where |
| --- | --- | --- |
| R1 | Keep the final cumulative row per non-null `request_id` and add a partial request-id index. | `packages/domain/src/analytics/forensic-query.ts:164` |
| R2 | Preserve published extraction of `request_id`, `result_bytes`, and model. Do not fabricate Claude duration telemetry that the source does not contain. | `@gobing-ai/ts-llm-jsonl-importer`; R2 remains PARTIAL |
| R3 | Keep migration 0019 and stop schema setup or empty imports from recreating built-in ETL tables; generic/custom ETL targets materialize on first accepted row. External `ts-libs` commit `22f891f` still needs release/update. | `packages/domain/src/migrations.ts:319` |
| R4 | Preserve the corrected `DEFERRED_SOURCES` semantics and executable classification coverage. | `packages/app/src/services/history-service.ts:252` |
| R5 | Resolve role-named run directories through the run's sole recorded source, import them in the same discovery set, and persist observed sessions as exact mappings before provenance alignment. | `packages/app/src/services/history-service.ts:278` |
### Testing
**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/domain/tests/analytics/forensic-query.test.ts:259 proves final cumulative MAX(rowid) wins and NULL identities remain distinct; packages/domain/tests/dao/migrations.test.ts:407 proves the partial index; live SQLite measured 24,215 identified rows, 12,011 IDs, and 33 IDs where MIN undercounted output by 104,315 tokens |
| R2 | PARTIAL | Live SQLite: Claude result_bytes populated 17,338 of 17,338 and assistant model NULL count 0, but duration_ms populated 0 of 17,338; source inspection found no exact duration field and the never-fabricate contract forbids synthesis; /Users/robin/xprojects/ts-libs-wt-0624/packages/llm-jsonl-importer/tests/importer.test.ts:1452 |
| R3 | PARTIAL | Live SQLite still has ten history_etl tables although migration 0019 is journaled; upstream lazy materialization commit 22f891f passes 2,036 tests, but published 0.4.41 remains Spur's dependency until the normal release and update |
| R4 | MET | packages/app/tests/services/history-service.test.ts:855 verifies deferred, expected-empty, and deferred-label-with-records semantics; packages/app/src/services/history-service.ts:252 preserves openclaw and uses the real antigravity key |
| R5 | MET | packages/app/tests/services/history-service.test.ts:747 proves a role-named coder directory resolves through its sole omp mapping, imports, persists an exact session, and aligns spur-run provenance; explicit root bypass remains covered at line 788 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Usage is counted once per identified API response | MET | test | packages/domain/tests/analytics/forensic-query.test.ts:259; live SQLite delta confirms final cumulative usage rather than the first partial snapshot |
| Scenario: R2 — A claude-source session yields an actionable bottleneck ranking | PARTIAL | command | Live SQLite has populated result sizes and models but zero measured Claude durations across 17,338 calls; the authored core scenario explicitly requires durations populated |
| Scenario: R3 — The ETL tables are either populated or removed | PARTIAL | command | Live SQLite reports ten recreated ETL tables after journaled migration 0019; the upstream root fix is green but not yet released into Spur |
| Scenario: R4 — A source that imports nothing says which kind of nothing | MET | test | packages/app/tests/services/history-service.test.ts:856 and line 874 |
| Scenario: R4 — Correcting the antigravity key does not re-open waived work | MET | test | packages/app/tests/services/history-service.test.ts:905 verifies a deferred-labelled source still imports records; packages/app/src/services/history-service.ts:252 preserves openclaw |
| Scenario: R5 — Run-to-session correlation covers the sources that produce runs | MET | test | packages/app/tests/services/history-service.test.ts:747 uses the previously missed coder-to-omp production shape and verifies exact mapping persistence |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

**Reviewer notes (inline review, 2026-08-21)**

| Dimension | Finding |
|-----------|---------|
| Functional traceability | All five requirements MET; each AC row carries measured evidence (request_id 24,215; result_bytes 17,338; fold −12,204; deferred status tests; R5 14/14 exact-mapped runs, was 0). |
| SECUA | Security: no new trust boundary — augmentation reads local `.spur/run` dirs only, path-confined to the workspace. Correctness: the `runSessionAugmentedRoots` match rule (`agent === source || startsWith(source-)`) is exact per source; pi runs (`pi-k3`) covered by prefix rule; `coder` dir matches no source (codex writes no local sessions) — documented, not a gap. Efficiency: scan is bounded by run-dir count, runs once per import, no per-message cost. |
| Architecture | Single discovery set preserves full-mode reconciliation semantics — the key design constraint (a second import would be retired by the next full pass). Injectable `historyHome`/`cwd` keep discovery hermetic in tests without changing production behavior (defaults to real `homedir()`/`process.cwd()`). No new abstraction; reuse of exported `getSourceDefinition().defaultRoots` keeps root semantics source of truth in ts-libs. |
| Risk / deviation | R2 `duration_ms` stays NULL for claude — claude JSONL carries no tool duration; the 0281/0284 never-fabricate ruling forbids inventing one. This narrows AC R2's "durations populated" to "result sizes populated, durations honest NULL"; recorded in Q&A and Testing rather than silently accepted. |
### References
- Parent post-mortem: task **0622** (`docs/tasks4/0622_harness-reliability-post-mortem-executor-routing-residue-lif.md`) — findings F6/F8/F10/F12/F14 and the 2026-08-21 verify re-audit that reopened them.
- Sibling: task **0623 R5** — F9, agy chunk-boundary parse errors. Re-measure R5's agy row after it lands.
- Feature: **E5** — session forensics implementation (retention, derived variables, report modes).
- Precedents: task **0564** (`call_id` tool_use↔toolResult pairing, migration 0015) · task **0578** (release → re-import gap; landed mapper fixes must reach the data plane) · task **0580** (claude usage / epoch-0 sentinel, migration 0016) · commit `fa41669c` (E6 duplicate-migration-prefix renumber rule).
- Contracts: **0504 R4** source-local binary for history validation (`CLAUDE.md` § Build & repo commands) · **0281/0284** never-fabricate invariant (absent telemetry is unknown, not zero) · feature **E1 § Out of scope** — the 2026-08-06 deferral ruling for `openclaw` / `antigravity-ide` / `gemini` / `opencode` / `hermes`.
- Importer: `@gobing-ai/ts-llm-jsonl-importer` in `~/xprojects/ts-libs/` — R1 and R2 both cross this repo boundary.
### History
- 2026-08-22T02:05:39.109Z todo → wip (system)
- 2026-08-22T02:09:42.081Z wip → testing (system)
- 2026-08-22T02:55:02.531Z testing → done (system)
