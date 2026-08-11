---
template: feature-impl
schema_version: 1
name: "Run real-data full-mode verification pass for history import (0504 R1 on the 1.7 GB DB)"
description: ""
status: todo
type: task
profile: standard
feature_id: E
parent_wbs: null
priority: P2
tags: []
dependencies: ["0504"]
ac_numbering: task-local
created_at: "2026-08-11T03:54:32.827Z"
updated_at: "2026-08-11T04:08:52.458Z"
---

## 0505. Run real-data full-mode verification pass for history import (0504 R1 on the 1.7 GB DB)

### Background
Task 0504 implemented authoritative full-mode reconciliation in sibling repository `~/xprojects/ts-libs` at commit `b988a64`, but that commit is newer than the published/tagged `@gobing-ai/ts-llm-jsonl-importer@0.4.24`. Spur still resolves the pre-change 0.4.24 tarball, whose `ImportResult` has no `reconciliation` field. A source-local CLI invocation proves which binary and package version ran, but the current package cannot exercise 0504 R1.

The Spur fan-out currently also discards the importer's reconciliation summary: `HistoryService.importOneIsolated` maps `ImportResult` to `CoverageEntry`, and `FanOutResult` exposes only `entries`, `warnings`, and `exitCode`. Therefore `history import --source all --mode full --json` cannot report the stale target, ledger, and checkpoint counts this task must compare.

The real-data target is repository-root `.spur/spur.db` (1.7 GB), not `apps/cli/.spur/spur.db` (288 KB). The 2026-08-10 baseline was 1,478,621 messages, 102,914 tool calls, zero unknown messages, zero orphan tool calls, and `PRAGMA integrity_check = ok`; those totals are evidence, not frozen expectations, because agent histories remain live.

Two historical facts change the verification contract. First, manual cleanup during the original backfill already removed 37,999 false Gemini ETL rows, 37,998 Gemini ledger rows, 233 Gemini checkpoints, 8,444 obsolete Codex/Grok unknown message+ledger rows, and 9,046 Grok orphan tools, so a new dry-run must report the current stale set rather than reproduce those old totals. Second, an all-source run records its own active Codex session, so idempotence means zero stale reconciliation on the second pass, not zero newly discovered records or unchanged global row totals. The seven known invalid AGY source lines may legitimately yield `degraded`/exit 2; any other failed/degraded source is a blocker.
### Requirements
- [ ] R1. Make the 0504 reconciliation build both runnable and observable before touching real data: release a lockstep ts-libs version containing commit `b988a64`, update Spur's catalog/lock resolution to that published version, and preserve each importer's optional `reconciliation` summary as additive `entries[].reconciliation` data in `history import --json`. Add no noun, verb, flag, wrapper, or configuration switch; update the existing tests and `docs/04_DESIGN.md` surface in the same change.
- [ ] R2. Establish a recoverable real-data baseline for repository-root `.spur/spur.db`: exclude concurrent writers, create and integrity-check a SQLite backup before the write, then record per-source counts for `history_message`, `history_tool_call`, `history_import_ledger`, and `history_import_checkpoint`, plus unknown/orphan counts and `PRAGMA integrity_check`. Never target `apps/cli/.spur/spur.db`.
- [ ] R3. Run `bun run apps/cli/src/index.ts history import --source all --mode full --dry-run --json`, capture `provenance.binary`, the released importer version, per-source status/errors, and every reconciliation count, and prove the dry-run left all four history-table baselines unchanged. Treat only the already-known AGY malformed-source condition as an allowed degraded result; investigate any count drift and block on every other failed/degraded source.
- [ ] R4. Run one all-source full write through the same source-local CLI and confirm each source's applied reconciliation counts exactly match its dry-run preview, with no manual SQLite mutation. Immediately follow it with another all-source full dry-run and require `staleTargetRows = staleLedgerRows = staleCheckpointRows = 0` for every non-empty source; fresh records from live sources do not violate this idempotence check.
- [ ] R5. After the write, require `PRAGMA integrity_check = ok`, zero rows where `history_message.record_type = 'unknown' OR disposition = 'unknown'`, and zero `history_tool_call` rows lacking a parent `history_message`. Record the raw command/SQL evidence under `.spur/run/0505/` and summarize it in the task's Testing/Solution sections; restore from the backup if a write or integrity gate fails.

**Out of scope:** repairing the seven malformed AGY source lines; changing importer reconciliation algorithms already covered by 0504; introducing a new public command surface; forcing global message/tool totals to remain constant while histories are live; manual deletion of target, ledger, or checkpoint rows.
### Acceptance Criteria
Scenario: R1 — Released importer reconciliation is visible through the source-local CLI
  Given ts-libs commit b988a64 is newer than the published 0.4.24 importer
  When the next lockstep ts-libs release is published and Spur updates its catalog and lockfile
  Then the source-local CLI provenance names that released importer version
  And each full-mode JSON source entry carries the importer's optional reconciliation summary
  And no noun, verb, flag, wrapper, or configuration switch is added

Scenario: R2 — Real-data verification starts from the intended recoverable database
  Given repository-root .spur/spur.db is the 1.7 GB history database and no concurrent writer is active
  When the pre-write baseline is captured
  Then an integrity-checked SQLite backup exists
  And per-source target, tool, ledger, checkpoint, unknown, and orphan counts are recorded
  And apps/cli/.spur/spur.db is never opened as the verification target

Scenario: R3 — Full dry-run previews reconciliation without mutation
  Given the released reconciliation build and the recorded database baseline
  When an all-source full dry-run runs through bun run apps/cli/src/index.ts with JSON output
  Then provenance, per-source status/errors, and stale target, ledger, and checkpoint counts are captured
  And the four history-table baselines are unchanged after the dry-run
  And only the documented AGY malformed-source condition may be degraded

Scenario: R4 — Full write matches its preview and reconciliation becomes idempotent
  Given the dry-run reconciliation counts have been reviewed
  When one all-source full write runs and is followed immediately by another full dry-run
  Then each applied stale-row count equals its dry-run preview without manual SQL
  And the second dry-run reports zero stale target, ledger, and checkpoint rows for every non-empty source
  And fresh records from active agent sessions are reported separately rather than treated as an idempotence failure

Scenario: R5 — Post-write history data remains structurally healthy
  When the post-write SQL verification runs
  Then PRAGMA integrity_check returns ok
  And unknown history messages equal zero
  And orphan history tool calls equal zero
  And the raw evidence is retained under .spur/run/0505 and summarized in the task record
### Q&A
**Q: Why does 0505 include a package release and a small Spur projection change?**

A: They are hard prerequisites for the requested verification. The reconciliation code exists only in unpublished ts-libs commit `b988a64`, while the installed 0.4.24 package predates it; Spur's fan-out also drops `ImportResult.reconciliation`. Running the 1.7 GB write first would test the wrong binary and produce no comparable stale-row evidence.

**Q: Must the new dry-run reproduce the 37,999 Gemini, 8,444 unknown-message, or 9,046 orphan-tool findings?**

A: No. Those rows were manually removed during the original backfill. The dry-run establishes the current authoritative preview; the write must match that preview, and the second dry-run must report zero remaining reconciliation work.

**Q: What does "zero changes" mean while Codex is recording this task?**

A: Zero stale reconciliation counts. Newly discovered records may be non-zero because the verification command creates agent history while it runs. Global message/tool totals are therefore observed, not frozen.

**Q: Is exit code 2 automatically a failure?**

A: Not for the already-documented seven malformed AGY source lines, which 0504 intentionally reports as `degraded`. The transcript must show that exact known class (or explicitly investigate source drift). Any other degraded or failed source blocks the write.

**Q: May the implementer clean up discrepancies with SQLite statements?**

A: Read-only SQL is required for evidence; manual SQL mutation is forbidden. Reconciliation must occur through `history import --mode full`, and a failed write restores the pre-write backup.
### Design
**Frozen output seam**

- Upstream authority: `@gobing-ai/ts-llm-jsonl-importer` commit `b988a64` already defines `ReconcileSummary` and `ImportResult.reconciliation?: { staleTargetRows; staleLedgerRows; staleCheckpointRows }`.
- Spur projection: add the same optional field to the existing per-source `CoverageEntry`/fan-out entry and copy it unchanged in `HistoryService.importOneIsolated`. The existing CLI JSON spread then emits `entries[].reconciliation`; no parallel result model, command, flag, or renderer is needed.
- Surface documentation/tests: update `packages/domain/src/analytics/artifact.ts`, `packages/app/src/services/history-service.ts`, focused app/CLI tests, and `docs/04_DESIGN.md`. Text output need not grow; this verification consumes `--json`.
- Package provenance: publish the next lockstep ts-libs version containing `b988a64` through the sibling repository's operator-controlled `bun run bump-ver <version> --push` release path, wait for OIDC publication, then update Spur's catalog/lockfile. Temporary Bun links or store overlays are not acceptable evidence.

**Verification sequence and invariants**

1. Preflight both repositories: clean intended worktrees, published package resolves from Spur, source-local `provenance.binary` points to `apps/cli/src/index.ts`, no competing Spur/SQLite writer, and the target resolves to `/Users/robin/xprojects/spur-new/.spur/spur.db`.
2. Create a SQLite-consistent backup under `.spur/backups/` before the destructive full write and verify the backup with `PRAGMA integrity_check`.
3. Store pre/dry-run/post/second-dry-run JSON and read-only SQL snapshots under `.spur/run/0505/`. Compare per source, not only aggregate totals.
4. Dry-run is mutation-free: history message/tool/ledger/checkpoint counts remain identical before and after it.
5. Write parity: for each source, applied reconciliation equals the preview. The second dry-run must show all three stale counts at zero. `importedRecords` and total rows may increase for live sources.
6. Post-write health is fail-closed: integrity, unknown, orphan, unexpected degraded source, provenance, or parity failure stops completion and triggers backup restoration where the database was mutated.

**Anti-patterns:** bare global `spur`; `apps/cli/.spur/spur.db`; temporary dependency links as final evidence; manual `DELETE`/`UPDATE`; assuming exit 0 despite known AGY degradation; comparing only global totals; treating live-source inserts as stale reconciliation.

**Cross-task contract:** depends on 0504 for the importer algorithm and tests. 0505 owns only release/consumption, additive observability, and the real-data gate; it must not redesign 0504's reconciliation algorithm.
### Plan
- [ ] P1 (R1) In `~/xprojects/ts-libs`, verify commit `b988a64` and its gates, prepare the next lockstep release, pause for the operator-controlled push, confirm OIDC publication, then update Spur's catalog/lockfile and verify the source-local CLI resolves the released package without links or overlays.
- [ ] P2 (R1) Add the optional per-source reconciliation projection at the existing `CoverageEntry`/`HistoryService.importOneIsolated` seam; add focused mapping/CLI JSON tests and update `docs/04_DESIGN.md` in the same change.
- [ ] P3 (R2) Confirm the absolute target database, exclude concurrent writers, create and integrity-check a SQLite backup, and capture the per-source/table pre-write SQL baseline under `.spur/run/0505/`.
- [ ] P4 (R3) Execute and capture the source-local all-source full dry-run; verify provenance, expected source statuses, reconciliation fields, and unchanged history-table baselines. Stop before the write on any unexplained degraded/failed source or mutation.
- [ ] P5 (R4) Execute one captured all-source full write, compare applied reconciliation to the preview per source, then execute the second full dry-run and require all stale reconciliation counts to be zero while separating live-source inserts from reconciliation.
- [ ] P6 (R5) Run final integrity, unknown-message, and orphan-tool SQL checks; retain raw evidence, summarize exact versions/counts/outcomes in Solution and Testing, run the focused code gates plus the project completion gates, and restore the backup if any database-health gate fails.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent implementation: task 0504, `docs/tasks4/0504_harden-full-history-backfill-after-real-data-import-forensic.md`
- Feature E — History (`feature_id: E`; `spur feature show E --json`)
- Upstream reconciliation commit: `/Users/robin/xprojects/ts-libs`, `b988a641e838cc42741571f7eb84a15f0a6b7737`
- Published baseline preceding that commit: ts-libs tag `@gobing-ai/ts-llm-jsonl-importer-v0.4.24` at `bd4d7da`
- Upstream release contract: `/Users/robin/xprojects/ts-libs/docs/PACKAGE_RELEASE.md`
- Spur fan-out seam: `packages/app/src/services/history-service.ts` (`FanOutResult`, `importAll`, `importOneIsolated`)
- Spur coverage shape: `packages/domain/src/analytics/artifact.ts` (`CoverageEntry`)
- CLI/provenance surface: `apps/cli/src/commands/history.ts`; `docs/04_DESIGN.md` history import section
- Real-data database: `/Users/robin/xprojects/spur-new/.spur/spur.db`
- Original import session: `/Users/robin/.codex/sessions/2026/08/10/rollout-2026-08-10T14-29-42-019fed94-d72f-7351-abee-3ca0cc770388.jsonl`
### History
