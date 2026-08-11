---
template: meta
schema_version: 1
name: "Harden full history backfill after real-data import forensics"
description: ""
status: backlog
type: meta
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T00:17:08.921Z"
updated_at: "2026-08-11T00:37:02.769Z"
---

## 0504. Harden full history backfill after real-data import forensics

### Background
The real-data backfill ran from 2026-08-10T22:07:04Z through 23:51:05Z (104 minutes) in one Codex session. It ultimately produced a healthy 1.7 GB database with 1,478,621 messages, 102,914 tool calls, zero unknown messages, zero orphan tool calls, and `PRAGMA integrity_check = ok`.

The result required substantial repair work. The first write exposed overlapping Gemini/Antigravity discovery, missing typed Gemini and OpenCode ingestion, Codex/Grok schema drift, stale full-mode rows, Grok orphan tools, and an OpenCode O(N²) delete path.

This task owns only the remaining process gaps: authoritative full-mode reconciliation, degraded-result signaling, an OpenCode complexity regression, and source-local CLI provenance. Codex session-format confidence is Medium overall, but tool-call counts are high-confidence because all `response_item` call/output records were readable and correlated by `call_id`. Concurrent-writer and database-lock fallout is already owned by task 0503 and is referenced rather than duplicated here.
### Requirements
- [ ] R1. Make `--mode full` authoritative per source: transactionally reconcile target rows, ledger rows, and checkpoints that are no longer reproduced by current source data or mapper output. Dry-run reports proposed insert/update/delete counts, and recovery requires no manual SQLite statements.
- [ ] R2. Fail loudly on degraded source ingestion. Parse/validation failures remain bounded and source-attributed; a source with skipped records cannot be reported as clean `ok`, and validation failures cannot leave partially accepted rows for that source.
- [ ] R3. Add a deterministic OpenCode regression proving persistence cost scales with imported chunks rather than `existing ledger rows × new messages`. The test must fail if a new-message path performs an unindexed source/source-file ledger delete or per-record full-ledger scan.
- [ ] R4. Make monorepo dogfood provenance unambiguous: history validation invokes a source-local binary directly and records the resolved binary/package version before writes. Update the existing local-CLI guidance; do not add a public command or wrapper noun.
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
- [ ] P1 (R1) Implement source-scoped desired-set reconciliation for JSONL and OpenCode full imports, including mutation-free dry-run counts and atomic stale-row deletion.
- [ ] P2 (R2) Tighten fan-out result classification and transactional validation behavior; add malformed and schema-invalid mixed-source tests.
- [ ] P3 (R3) Add the deterministic large-ledger OpenCode regression and verify the generated operations/query plan contain no O(N²) delete path.
- [ ] P4 (R4) Tighten monorepo local-CLI guidance and capture binary/package provenance during real-data validation.
- [ ] P5 Run importer gates, Spur `spur-check`, test-cf, build, a real all-source dry-run, one full write, a zero-change second full write, and database integrity/orphan/unknown checks.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Codex session: `/Users/robin/.codex/sessions/2026/08/10/rollout-2026-08-10T14-29-42-019fed94-d72f-7351-abee-3ca0cc770388.jsonl`
- Session window analyzed: `2026-08-10T22:07:04.632Z` through `2026-08-10T23:51:05.667Z`
- Tool metrics: 234 `exec_command`, 85 wait, 83 `write_stdin`, 24 patches, 2 compactions, 44 test/build/gate commands
- OpenCode importer/persistence: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/opencode-importer.ts:47`; `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/jsonl-importer-dao.ts:455`
- Spur routing: `packages/app/src/services/history-service.ts:190`; `apps/cli/src/commands/history.ts:48`
- Local CLI contract: `AGENTS.md:192-205`
- Related, not duplicated: `docs/tasks4/0503_fix-executor-routing-and-pipeline-resilience-from-the-0502-p.md:22` (concurrent writer, dangling dependency, DB-lock backoff)
### History
### Notes
**RC1 — OpenCode persistence contained an O(N²) ledger scan (S1, ~38 minutes waste).** Every new message attempted a delete by `(source, source_file)` without a supporting index, scanning roughly 1.1 million ledger rows thousands of times. Six implementation/benchmark cycles changed transaction and batch shapes before a process sample identified the query. Profiling after the first projected timeout would have found the root cause much earlier.

**RC2 — Full mode was additive, not reconciling (S1 correctness risk, ~10 minutes direct cleanup).** Mapper changes did not retire stale ETL/message/tool/ledger rows. Manual repairs included one wrong relationship query and one unindexed orphan delete that had to be terminated. Authoritative source-scoped reconciliation is the durable fix.

**RC3 — Binary provenance was ambiguous (S2).** A rebuilt bundle was followed by a bare global `spur`, which ran old code for about 83 seconds. The remaining fix is to invoke and record the source-local CLI explicitly during dogfood runs. The separate shared-checkout race remains owned by task 0503.

**RC4 — Degraded records did not fail loudly enough (S2).** An all-source run could exit 0 while reporting thousands of validation errors, and irrecoverable parse errors remained under source status `ok`. The diagnostics existed, but the status contract made automated monitoring treat a partial import as clean.

**What worked and must remain:** database growth was monitored without interrupting the healthy initial run; raw histories were never modified; cleanup scopes were counted before mutation; targeted tests preceded full gates; final verification checked integrity, idempotency, unknown records, and orphan tool relationships.
