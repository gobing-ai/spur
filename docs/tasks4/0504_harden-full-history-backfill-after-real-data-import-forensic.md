---
template: meta
schema_version: 1
name: "Harden full history backfill after real-data import forensics"
description: ""
status: done
type: meta
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T00:17:08.921Z"
updated_at: "2026-08-11T15:18:10.944Z"
---

## 0504. Harden full history backfill after real-data import forensics

### Background
The real-data backfill ran from 2026-08-10T22:07:04Z through 23:51:05Z (104 minutes) in one Codex session. It ultimately produced a healthy 1.7 GB database with 1,478,621 messages, 102,914 tool calls, zero unknown messages, zero orphan tool calls, and `PRAGMA integrity_check = ok`.

The result required substantial repair work. The first write exposed overlapping Gemini/Antigravity discovery, missing typed Gemini and OpenCode ingestion, Codex/Grok schema drift, stale full-mode rows, Grok orphan tools, and an OpenCode O(N²) delete path.

This task owns only the remaining process gaps: authoritative full-mode reconciliation, degraded-result signaling, an OpenCode complexity regression, and source-local CLI provenance. Codex session-format confidence is Medium overall, but tool-call counts are high-confidence because all `response_item` call/output records were readable and correlated by `call_id`. Concurrent-writer and database-lock fallout is already owned by task 0503 and is referenced rather than duplicated here.
### Requirements
- [x] R1. Make `--mode full` authoritative per source: transactionally reconcile target rows, ledger rows, and checkpoints that are no longer reproduced by current source data or mapper output. Dry-run reports proposed insert/update/delete counts, and recovery requires no manual SQLite statements.
- [x] R2. Fail loudly on degraded source ingestion. Parse/validation failures remain bounded and source-attributed; a source with skipped records cannot be reported as clean `ok`, and validation failures cannot leave partially accepted rows for that source.
- [x] R3. Add a deterministic OpenCode regression proving persistence cost scales with imported chunks rather than `existing ledger rows × new messages`. The test must fail if a new-message path performs an unindexed source/source-file ledger delete or per-record full-ledger scan.
- [x] R4. Make monorepo dogfood provenance unambiguous: history validation invokes a source-local binary directly and records the resolved binary/package version before writes. Update the existing local-CLI guidance; do not add a public command or wrapper noun.
### Acceptance Criteria
Scenario: R1 — Full mode reconciles stale derived history
  Given a source was previously imported with mapper output that is now obsolete
  When a full dry-run and then full write are executed for that source
  Then dry-run reports the exact stale-row deletion count without changing the database
  And the write removes stale target, tool, ledger, and checkpoint rows in one source-scoped transaction
  And a second full run reports zero changes

Scenario: R2 — Degraded source input is visible and bounded
  Given a source contains valid records plus malformed or schema-invalid records
  When it is imported through the all-source fan-out
  Then the source result is not reported as clean ok
  And diagnostics include bounded file-and-line samples and aggregate counts
  And schema-invalid records do not leave a partial source commit

Scenario: R3 — OpenCode persistence avoids ledger-size multiplication
  Given a target database seeded with at least 10000 unrelated ledger rows and a representative OpenCode fixture
  When the OpenCode importer writes the fixture
  Then instrumented database operations scale with write chunks rather than existing-ledger-row count
  And no new-message operation deletes ledger rows by an unindexed source and source_file predicate

Scenario: R4 — Real-data dogfood uses the intended build
  Given a developer rebuilt Spur for real-data history validation
  When the real-data dry-run and write commands start
  Then the transcript records a source-local CLI path and the resolved importer version before either run
  And bare globally installed spur is never used for that validation
### Q&A
**Q: Why is this one meta task instead of separate reconciliation, performance, and process tasks?**

A: They share the same full-import contract and one 1.7 GB real-data verification pass. Splitting them would repeat the expensive backfill gates.

**Q: Why change full-mode reconciliation instead of documenting manual cleanup SQL?**

A: Manual SQL caused wrong-key deletes, an unindexed long transaction, and a lock. Full mode should be the authoritative, repeatable repair surface.

**Q: Should malformed AGY source lines abort every other source?**

A: No. Per-source isolation remains; valid AGY rows and other sources may commit. The degraded source must be visible and the overall result must not claim a completely clean import.

**Q: Why not add a new backfill script or public CLI verb?**

A: The existing `history import --source all --mode full --dry-run` and write surfaces are sufficient. The remaining pieces are reconciliation, correctness signals, a complexity regression, and disciplined local-binary use.

**Q: Is the concurrent SQLite lock fixed here?**

A: No. Task 0503 owns retry/backoff and the concurrent-writer race. This task only requires isolated validation so it does not create that contention again.

**Q: What is the expected saving?**

A: At least 40 minutes on a comparable first backfill: roughly 38 minutes of blind OpenCode strategy iteration plus stale-binary and manual-cleanup churn.
### Design
| Finding | Evidence | Fix | Target |
| --- | --- | --- | --- |
| Full mode does not remove stale derived rows | 37,999 false Gemini ETL rows, 8,444 obsolete unknown messages, and 9,046 Grok orphan tools required manual SQL | Build source-scoped desired hashes, diff against ledger, and apply deletes plus writes transactionally; dry-run returns the same diff without mutation | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/importer.ts`; `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/jsonl-importer-dao.ts:455`; `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/opencode-importer.ts:47` |
| Validation diagnostics did not prevent a misleading clean result | First all-source run exited 0 while Gemini emitted 18,945 validation errors; final AGY result remained `ok` with seven parse errors | Preserve per-source isolation but make degraded status/exit semantics reflect skipped rows; validation writes are atomic | `packages/app/src/services/history-service.ts:303`; `apps/cli/src/commands/history.ts:48` |
| OpenCode optimization proceeded through six write strategies before profiling | Timed attempts began at 22:47, 22:57, 23:01, 23:02, 23:24, and 23:29; the 23:29 process sample exposed repeated unindexed ledger deletes, after which 19,725 entries committed in 11.3 seconds | Add an instrumented large-ledger regression and require query-plan/process sampling after the first projected timeout | `~/xprojects/ts-libs/packages/llm-jsonl-importer/tests/opencode-importer.test.ts`; `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/jsonl-importer-dao.ts:455` |
| Rebuilt code was tested through stale global `spur` | The 22:36:58 all-source run used `/Users/robin/.bun/bin/spur` and reproduced old Gemini/OpenCode behavior | Invoke `bun run apps/cli/src/index.ts` or a built source-local binary directly and record provenance before write | `AGENTS.md:192`; `AGENTS.md:204` |

Keep the implementation inside the existing importer, DAO, HistoryService, and CLI fan-out seams. No new package, public noun, wrapper script, or configuration switch is justified.
### Plan
- [x] P1 (R1) Implement source-scoped desired-set reconciliation for JSONL and OpenCode full imports, including mutation-free dry-run counts and atomic stale-row deletion.
- [x] P2 (R2) Tighten fan-out result classification and transactional validation behavior; add malformed and schema-invalid mixed-source tests.
- [x] P3 (R3) Add the deterministic large-ledger OpenCode regression and verify the generated operations/query plan contain no O(N²) delete path.
- [x] P4 (R4) Tighten monorepo local-CLI guidance and capture binary/package provenance during real-data validation.
- [x] P5 Run importer gates (192 pass), Spur `spur-check` (PASS), test-cf (PASS), and build (PASS). The real-data all-source dry-run → one full write → zero-change second full write → integrity/orphan/unknown checks on the 1.7 GB database is the shared expensive backfill gate, tracked as a follow-up task (0505) rather than deferred silently.
### Solution
**R1 — authoritative full-mode reconciliation (JSONL + OpenCode):**
- `ts-libs `packages/llm-jsonl-importer/src/jsonl-importer-dao.ts`` — new `reconcileFullImport`: loads the source's ledger rows, diffs against the desired hash set, and removes stale target/ledger rows (keyed by `record_hash` PK) plus checkpoints for vanished source files (keyed by `(source, source_file)` PK) in ONE source-scoped `db.batch` — no unindexed deletes, no manual SQL. Dry-run returns the identical counts without mutation.
- `ts-libs `packages/llm-jsonl-importer/src/importer.ts`` — collects the full-mode desired hash set during processing and invokes reconciliation after the file loop (`mode === 'full'`), surfacing `reconciliation` counts in `ImportResult`.
- `ts-libs `packages/llm-jsonl-importer/src/opencode-importer.ts`` — tracks seen source files and sweeps ledger/target/checkpoint rows for messages deleted from the OpenCode store, merged into the same source-scoped batch as the writes.
- `ts-libs `packages/llm-jsonl-importer/src/types.ts`` — `ReconcileSummary` (`staleTargetRows` / `staleLedgerRows` / `staleCheckpointRows`) + optional `ImportResult.reconciliation`.

**R2 — degraded fan-out signaling + atomic validation writes:**
- `packages/app/src/services/history-service.ts:400-419` — a source with parse/validation errors is `degraded`, never clean `ok`, and emits a `source-degraded` warning with counts.
- `packages/domain/src/analytics/artifact.ts:31-42` — `CoverageEntry.status` union gains `'degraded'`.
- `packages/app/src/services/history-service.ts:565-569,597,628-633,832-835` — coverage merge/analyze-only paths preserve degraded status; `computeExitCode` returns 2 (non-zero) when any source is degraded.
- `apps/cli/src/commands/history.ts:186-197` — daily-failure detail names degraded sources alongside failed ones.
- `ts-libs `packages/llm-jsonl-importer/src/importer.ts`` — line-level atomic validation: a schema-invalid split rejects the whole line (no partially accepted rows, no orphaned tool calls with a dangling `message_hash`).

**R3 — deterministic OpenCode complexity regression:**
- `ts-libs `packages/llm-jsonl-importer/tests/opencode-importer.test.ts`` — seeds 10,000 unrelated ledger rows, instruments the target `DbAdapter`, and asserts (a) executed statements < 100 (cost scales with write chunks, not existing-ledger-row count) and (b) no new-message operation deletes ledger rows by an unindexed `(source, source_file)` predicate.

**R4 — source-local CLI provenance:**
- `apps/cli/src/commands/history.ts:25-46,101-107` — `resolveImportProvenance` / `formatProvenance`: every `spur history import` prints `binary:` (the actually-invoked entry path) + resolved `@gobing-ai/ts-llm-jsonl-importer@<version>` before the fan-out result; `--json` embeds the same `provenance` field.
- `AGENTS.md:203-215` — real-data history validation must invoke a source-local CLI (`bun run apps/cli/src/index.ts` or the built `apps/cli/spur.js`), never a bare global `spur`; record the provenance header before each dry-run/write.

**Scope note:** importer changes ship in `/Users/robin/xprojects/ts-libs` (own repo/tests); the Spur monorepo consumes published `@gobing-ai/ts-llm-jsonl-importer@0.4.24` — the R1/R3 reconciliation surface is exercised by the ts-libs suite (191 pass) and reaches Spur consumers on the next release.
### Testing
**Re-audit 2026-08-11 (verifyall batch re-audit 2026-08-11; /sp-dev-verifyall --feature E --force --focus all --fix all): verdict PASS.** ts-libs importer + opencode suites re-run green this run (45 pass / 0 fail at `@gobing-ai/ts-llm-jsonl-importer@0.4.26`); live provenance header re-captured this run (`binary: /Users/robin/xprojects/spur-new/apps/cli/src/index.ts`, `importer: @gobing-ai/ts-llm-jsonl-importer@0.4.26`) via a mutation-free single-file full `--dry-run`; `formatProvenance` re-read at `apps/cli/src/commands/history.ts:40-42,118-122`. Fix pass: two L4 stale Solution anchors rewritten from `~/xprojects/ts-libs/...` to absolute paths.

**Pipeline verify results**

- Verdict: PASS (pipeline run 52A62421)
- Re-audit 2026-08-11 (`--force --fix all --focus all`): verdict **PASS**, all evidence re-run fresh this audit. Fix applied: stale R1 Testing anchor ts-libs `packages/llm-jsonl-importer/src/types.ts` corrected to ts-libs `packages/llm-jsonl-importer/src/types.ts` (line drift after ts-libs edit; content verified present and on-subject). Gitignored artifact touched by this audit: `.spur/run/0504-verdict.json` (rewritten with re-audit verdict + checks).

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `ts-libs `packages/llm-jsonl-importer/src/jsonl-importer-dao.ts`` (`reconcileFullImport`: desired-hash diff, PK-keyed deletes, one source-scoped batch, dry-run identical counts); ts-libs `packages/llm-jsonl-importer/src/importer.ts` (full-mode invocation); `opencode-ts-libs `packages/llm-jsonl-importer/src/importer.ts` (per-file drift + vanished-file sweep, both counted); ts-libs `packages/llm-jsonl-importer/src/types.ts` (`ReconcileSummary` + `ImportResult.reconciliation`); tests ts-libs `packages/llm-jsonl-importer/tests/importer.test.ts`, ts-libs `packages/llm-jsonl-importer/tests/opencode-importer.test.ts` — fresh: `bun test tests/importer.test.ts tests/opencode-importer.test.ts` → 44 pass / 0 fail |
| R2 | MET | `packages/app/src/services/history-service.ts:398-419` (degraded, never clean ok, `source-degraded` warning with counts); `packages/app/src/services/history-service.ts:832-838` (`computeExitCode` → 2 on any degraded); `packages/domain/src/analytics/artifact.ts:31-42` (`'degraded'` union member); `ts-libs `packages/llm-jsonl-importer/src/importer.ts`` (line-atomic validation, no partial rows); tests `packages/app/tests/services/history-service.test.ts:452` (fresh: 20 pass / 0 fail), ts-libs `packages/llm-jsonl-importer/tests/importer.test.ts` (fresh pass) |
| R3 | MET | `~/xprojects/ts-libs/.../tests/opencode-ts-libs `packages/llm-jsonl-importer/tests/importer.test.ts` (10,000 unrelated ledger rows; statements < 100; no unindexed `(source, source_file)` ledger delete) — fresh pass |
| R4 | MET | `apps/cli/src/commands/history.ts:25-43,99-107` (`resolveImportProvenance`/`formatProvenance`, printed before results, embedded in `--json`); `AGENTS.md:209-219` (source-local binary contract); fresh CLI smoke: `binary: /Users/robin/xprojects/spur-new/apps/cli/src/index.ts` + `importer: @gobing-ai/ts-llm-jsonl-importer@0.4.24` in text mode and `provenance` object in `--json` mode |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Full mode reconciles stale derived history | MET | test | ts-libs `packages/llm-jsonl-importer/tests/importer.test.ts` (dry-run exact counts, no mutation; write deletes; second run zero), ts-libs `packages/llm-jsonl-importer/tests/opencode-importer.test.ts` (vanish sweep + mapper-drift counts) — 44 pass / 0 fail fresh |
| Scenario: R2 — Degraded source input is visible and bounded | MET | test | `packages/app/tests/services/history-service.test.ts:452` (degraded status, bounded counts, non-zero exit) — 20 pass / 0 fail fresh; ts-libs `packages/llm-jsonl-importer/tests/importer.test.ts` (atomic line rejection) |
| Scenario: R3 — OpenCode persistence avoids ledger-size multiplication | MET | test | ts-libs `packages/llm-jsonl-importer/tests/opencode-importer.test.ts` — fresh pass |
| Scenario: R4 — Real-data dogfood uses the intended build | MET | command | Fresh CLI smoke (text + `--json`): provenance header before results, source-local binary path, importer@0.4.24; `AGENTS.md:209-219` |
- Coverage: N/A (verdict-based re-audit; targeted suites re-run fresh — ts-libs importer 44 pass, spur history-service 20 pass, CLI history 24 pass, all 0 fail)
### Review
**Review disposition: PASS** — quality gate green (`bun run format && bun run spur-check`, full workspaces), ts-libs importer suite 192 pass, domain 109, app 20, CLI 677 pass; tsc clean in domain/app/cli/ts-libs; biome clean.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Correctness | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/opencode-importer.ts:104-113` | **Fixed during review.** `reconciliation` counted only vanished-file sweeps; per-file mapper-drift deletes (same source_file, changed hash) were excluded, so a dry-run did not report the *exact* stale-row deletion count the write performs. Now counted in the loop and covered by a new drift test (`tests/opencode-importer.test.ts` "counts mapper-drifted messages as stale"). |
| P4 | Efficiency | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/jsonl-importer-dao.ts:395-407,455` | One-shot full scan of `history_import_ledger WHERE source = ?` (no `(source)` index) per full run, for reconciliation and OpenCode existing-entry load. O(n) once per run, not per record — R3's chunk-scaling bound holds. Advisory: add `CREATE INDEX … ON history_import_ledger(source)` when the 1.7 GB corpus makes full runs slow. |
| P4 | Correctness | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/importer.ts:145-160` | Pre-existing orphan edge (not introduced here): when a line's message split is a ledger duplicate but a sibling tool split is new, `_messageSplitIndex` cannot resolve to the skipped message hash and the tool row persists with null `message_hash`. 0504's atomicity covers validation failures; the duplicate case is a follow-up candidate. |
| P4 | Correctness | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/jsonl-importer-dao.ts:424-427` | `staleTargetRows` counts the delete operations issued (one per stale ledger row), not rows verified present. Matches "deletion count" semantics; a consistent database yields zero stale rows on the second full run (pinned by tests). |

**Residual risk:** importer changes ship in `~/xprojects/ts-libs` (own repo) and reach Spur consumers only on the next `@gobing-ai/ts-llm-jsonl-importer` release; the Spur side consumes 0.4.24 and is covered by its own R2 classification tests. No P1 findings; no unresolved majors.
### References
- Codex session: `/Users/robin/.codex/sessions/2026/08/10/rollout-2026-08-10T14-29-42-019fed94-d72f-7351-abee-3ca0cc770388.jsonl`
- Session window analyzed: `2026-08-10T22:07:04.632Z` through `2026-08-10T23:51:05.667Z`
- Tool metrics: 234 `exec_command`, 85 wait, 83 `write_stdin`, 24 patches, 2 compactions, 44 test/build/gate commands
- OpenCode importer/persistence: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/opencode-importer.ts:47`; `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/jsonl-importer-dao.ts:455`
- Spur routing: `packages/app/src/services/history-service.ts:190`; `apps/cli/src/commands/history.ts:48`
- Local CLI contract: `AGENTS.md:192-205`
- Related, not duplicated: `docs/tasks4/0503_fix-executor-routing-and-pipeline-resilience-from-the-0502-p.md:22` (concurrent writer, dangling dependency, DB-lock backoff)
### History
- **2026-08-11 — Pipeline 52A62421 (inline full), verdict PASS, done.**
- Follow-up created: **0505** — real-data full-mode verification pass (all-source dry-run → full write → zero-change second run → integrity/orphan/unknown checks on the 1.7 GB DB). The shared expensive backfill gate is tracked there, not deferred silently.
- Learnings: (1) full-mode reconciliation must count BOTH per-file mapper drift and vanished-file sweeps — the initial OpenCode implementation missed the former and the review hop caught it (P2 fixed in-loop); (2) the CLI rule `no-direct-fs-io` bans `node:fs` in commands — use the `context.fs` seam; (3) a stale gitignored `apps/cli/.spur/spur.db` (journal ≤ 0008, pre-history schema) breaks migration 0009 in every CLI test that runs without an explicit dbUrl — move it aside and let the next run regenerate.
### Notes
**RC1 — OpenCode persistence contained an O(N²) ledger scan (S1, ~38 minutes waste).** Every new message attempted a delete by `(source, source_file)` without a supporting index, scanning roughly 1.1 million ledger rows thousands of times. Six implementation/benchmark cycles changed transaction and batch shapes before a process sample identified the query. Profiling after the first projected timeout would have found the root cause much earlier.

**RC2 — Full mode was additive, not reconciling (S1 correctness risk, ~10 minutes direct cleanup).** Mapper changes did not retire stale ETL/message/tool/ledger rows. Manual repairs included one wrong relationship query and one unindexed orphan delete that had to be terminated. Authoritative source-scoped reconciliation is the durable fix.

**RC3 — Binary provenance was ambiguous (S2).** A rebuilt bundle was followed by a bare global `spur`, which ran old code for about 83 seconds. The remaining fix is to invoke and record the source-local CLI explicitly during dogfood runs. The separate shared-checkout race remains owned by task 0503.

**RC4 — Degraded records did not fail loudly enough (S2).** An all-source run could exit 0 while reporting thousands of validation errors, and irrecoverable parse errors remained under source status `ok`. The diagnostics existed, but the status contract made automated monitoring treat a partial import as clean.

**What worked and must remain:** database growth was monitored without interrupting the healthy initial run; raw histories were never modified; cleanup scopes were counted before mutation; targeted tests preceded full gates; final verification checked integrity, idempotency, unknown records, and orphan tool relationships.
