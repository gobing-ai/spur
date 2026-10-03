---
schema_version: 1
name: Verify safe historical capability replay and stable Histories results
status: done
template: feature-impl
created_at: 2026-09-30T20:26:19.399Z
updated_at: "2026-10-03T21:41:31.072Z"
feature_id: E93
priority: P1
tags:
  - history
  - capabilities
estimate_hours: 5

dependencies: ["1028", "1029"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-dev-runall-e93-4ff4/.spur/memory/evidence/1030-verdict.json
---

## 1030. Verify safe historical capability replay and stable Histories results

### Background

E93 R9 validates the upgrade behavior once the source extractor and Histories consumer contract are available. Updated packages alone do not revisit already-checkpointed unchanged files, and a safe replay must rebuild derived evidence without altering raw histories. The deliverable is a runnable isolated replay/integration check plus the operational procedure and receipts; this planning run does not reimport live data.

**Refine corrections (2026-09-30)**
- Original replay instructions allowed ad hoc checkpoint/reset approaches → importer full mode already bypasses incremental file short-circuit and resets selected checkpoints, then reconciles the entire source → use complete isolated source populations and no manual ledger deletion/history reset.
- Original isolation prose did not name composition seams → HistoryServiceContext.getDb/historyHome/cwd and importer db/files/roots are injectable → use hermetic in-memory/temporary DB fixtures and never ambient user history.
- Original acceptance lacked a cross-run result case → producer outcome updates can arrive during incremental import after a prior call's bucket → test appended results and original-bucket materialization using both predecessor contracts.
- Original live-data wording could imply rollout in this task → planning and task scope only require a runnable isolated replay and documented operation → keep live database/source files untouched; a consistent backup plus explicit isolated target precedes any real-data exercise.
- Original checks had no observation home or expected count oracle → existing history service/analysis tests exercise these seams → pin one focused replay test, 8/3 counts, same-source complete-population constraint and other-source sentinel preservation.

### Requirements

- [x] R1. Document and exercise the existing backup/dry-run/schema-adoption procedure on isolated database copies with importer and binary provenance.
- [x] R2. Invalidate affected checkpoints and derived versions deliberately so unchanged historical files are reprocessed under new extraction semantics without losing unaffected facts.
- [x] R3. Prove repeated full/incremental replay preserves distinct capability counts, legacy unknowns, original source histories and original database contents.

### Acceptance Criteria

- [x] AC1 — Historical reprocessing upgrades safely and remains repeatable (req: R1; R2; R3)

Verification lens: Use the real hermetic replay test named in Design. Dry-run writes nothing; two full replays keep stable identities and 8/3 counts; later incremental results change the existing event's original bucket; distinct repeat calls and unchanged-file skips work; sentinels and raw bytes are preserved.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T20:27:31.445Z

Closed decisions: task 1028 and task 1029 precede the isolated replay exercise. Use existing import/analyze/checkpoint/reset contracts with a backed-up copy or fixture database. Repeat full/incremental import and compare stable identities/counts. The exercise does not mutate original history files or the live database; live rollout follows its separate operational backup/dry-run invocation.

#### Q&A entry — 2026-09-30T20:47:32.533Z

Ready-depth closure: use existing full mode with complete per-source populations, no history reset or manual ledger edits. Tests use isolated injected DB/files/roots and real predecessor contracts. The 8/3 count oracle, later-result incremental case, same-name repeat case and sentinel/byte-preservation checks are fixed. An optional real-data reproduction requires a consistent backup and explicit isolated target; this task does not execute live rollout. No unresolved replay algorithm or observation choice remains.

### Design

Implement E93 R9 after both 1028 and 1029. Frozen WHAT/WHY: verify adoption/replay using their real producer and consumer contracts, because extracted hashes and source-scoped reconciliation can silently leave stale or delete omitted evidence. This task does not re-own either implementation. Follow docs/design/history-capability-detection.md section 8.4.

WHERE/no new API: packages/app/tests/services/history-capability-replay.test.ts is the focused end-to-end exercise, reusing setup patterns from history-service.test.ts/history-analysis-service.test.ts and in-memory/temp SQLite. Existing services are touched only for a demonstrated replay defect at their shared owning function, with every caller inspected before a fix. Update the existing history-data-processing.md, history-incremental-materialization.md and history-cli-contracts.md procedures as needed. No new CLI flag/command, parser, reset service or test framework.

Frozen procedure:
1. Compose an isolated migrated DB with db/getDb, files/roots and historyHome/cwd pointing to fixture/temp locations. Seed an old-schema fixture plus another source's sentinel rows; raw fixture bytes are immutable.
2. Record actual binary/upstream schema/package/revision provenance from 1028/1029; require installed dependency agreement. A missing/invalid required importer version fails before write activity.
3. Dry-run full replay with the complete per-source fixture population; assert zero changes to facts, ledger, checkpoints and raw bytes.
4. Run full replay against that complete isolated population to bypass unchanged-file short-circuit and retire old extraction hashes. Existing full mode is source-scoped: a partial files list could delete omitted same-source records. Never use a one-file full run as a mixed-source upgrade, history reset, raw SQL ledger deletion or synthesized CLI flag.
5. Full replay again: compare stable logical ids, evidence-class counts, status, schema/provenance and unaffected rows. Expect the 1029 oracle: byCapability total 8 and confirmed legacy load total 3, with duplicates collapsed only by explicit invocation identity.
6. Append a result for an earlier pending call in a later incremental run: expect that same event's status change and original bucket refresh; append a distinct same-name invocation and prove it remains separate. Incremental import with unchanged fixtures must take the expected skip path.
7. Compare materialized query results to the direct SQL reference, including filtered/partitioned windows, unknown legacy fields, null timestamps and unsupported-origin coverage. Preserve other-source sentinel rows and all original file bytes.

Test observability: use runJsonlImport/HistoryService and refreshHistoryRollups/the real domain read path, not mocked extractSkillCalls or fake aggregate results. For an optional real-data reproduction use a SQLite-consistent backup with explicit DATABASE_URL to the isolated copy, source-local CLI and documented dry-run first; never the live default target. This task's normal acceptance is hermetic and does not require destructive production actions.

Dependencies/handoff: 1028 supplies correct immutable extraction/result/replay semantics and provenance; 1029 supplies actual package adoption/migration/rollup/DTO/query/oracle behavior. Do not bypass either by using handwritten surrogate outputs. Completion leaves a runnable test, bounded machine-readable replay receipts and updated owning operational docs; live rollout is a separate operational invocation. Step 0 rechecks predecessor results, clean-tree ownership, current version and fixture isolation. No public surface, release publication or raw-history rewriting is included. Budget 5h, with one bounded corrective pass; retain diagnostics if a predecessor or release is unavailable.

### Plan

1. (R1) Confirm predecessors 1028/1029, actual released package/schema/migration/rollup versions, current ownership and source-local CLI provenance. Verify all test DB/source paths are isolated before constructing the exercise.
2. (R1) Add the focused replay test using real importer/service/domain seams and existing fixture patterns; seed an old-schema DB and another source sentinel, and record original fixture/database bytes.
3. (R1, R2) Assert full dry-run does not mutate facts/ledger/checkpoints/files; migrate and replay the complete per-source population using existing full mode, never reset or partial-source deletion.
4. (R2, R3) Replay twice and compare stable ids/statuses and the 8/3 oracle. Append a pending-call result in a later incremental run, refresh its original bucket, then append a distinct repeat call and exercise unchanged-file skipping.
5. (R3) Compare materialized/SQL-reference filtered and partitioned counts; assert no changes to other-source sentinel facts, source bytes or the original DB. Keep unsupported/missing-origin evidence visibly unknown.
6. (R1–R3) Run focused history-capability-replay/history-service/history-analysis checks in packages/app, then task-local gates and the once-per-feature gate when appropriate. Fix only defects actually exposed by these checks.
7. (R1–R3) Record bounded provenance/check receipts and reconcile the existing operational satellites with the verified procedure. Do not claim or execute live-data rollout.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

New files:
- `packages/app/tests/services/history-capability-replay.test.ts` (817 lines) — the pinned
  end-to-end replay exercise, six phases over one hermetic scenario
  (`beforeAll` harness :300 builds fixture roots, seeds the old-state FILE database via
  `createMigratedDb` + a REAL `svc.import('pi')` sentinel, legacy extraction-hash rows, the
  checkpoint identity bait, the pre-1029 `''` rollup sentinel and v6 watermarks; WAL
  checkpoint + byte snapshot + consistent copy → `replay.db`; original never reopened):
  - :409 phase 1 (R1) — full replay with importerVersion 0.4.48 rejected as
    `UnsafeHistoryImporterError` **before the first getDb** (0 opens); dry-run exempt + dump equality.
  - :458 phase 2 (R1) — dry-run full replay previews reconciliation
    `{staleTargetRows: 3, staleLedgerRows: 3, staleCheckpointRows: 0}` and mutates nothing
    (full table-dump equality; fixture bytes unchanged).
  - :496 phase 3 (R2/AC1) — incremental import identity-skips the unchanged file
    (`skippedUnchangedFiles: 1`); full replay retires the 3 legacy hashes via reconciliation,
    writes 10 new-semantics claude rows (dup pair sharing ONE invocation_id, delegation/error/
    unknown/conflicting-origin/null-timestamp coverage), leaves the pi sentinel untouched;
    `refreshHistoryRollups` rebuilds v6 → v7, retires the `''` sentinel row; **the frozen
    8/3 oracle holds** (claude byCapability 8 rows/8 calls, bySkill/bySource 3, byInvocationKind
    model 3; full corpus 9 rows/9 calls incl. sentinel; since-filtered window 3/3, bySkill empty).
  - :601 phase 4 (R3) — second full replay is a no-op: reconciliation stale 0,
    `skippedDuplicates > 0`, skill/ledger/message dumps byte-equal, oracle still 8/3,
    freshness `unchanged` before the run.
  - :632 phase 5 (R2+R3 cross-run late arrival) — appended tool_result flips the existing
    `tu-unc` event unknown → ok **in place** (same record_hash + invocation_id) and its
    ORIGINAL bucket (00:04) materializes ok while the result's own bucket (00:44) stays empty;
    a distinct same-name repeat call keeps its own invocation_id and the class counts 2 calls
    in one row; claude totals become 8 rows / 9 calls, bySkill 2+1+1+1.
  - :727 phase 6 (R3) — unchanged incremental re-import changes nothing (line-count resume,
    0 processed) and every materialized claude row equals the direct representative-selection
    SQL reference over `history_skill_call`; null-timestamp conflicting-origin row stays
    source-visible and unbucketed; pi sentinel, append-only fixture prefix and original DB
    bytes all preserved.

Updated docs (procedure per design §8.4):
- `docs/design/history-data-processing.md:349-373` — new §7 "Safe Historical Replay & Upgrade
  Procedure" (provenance gate → backup/isolate → dry-run → complete-population full replay →
  derived-state adoption → frozen-oracle verification; prohibited actions list) with primary-source
  file:line citations.
- `docs/design/history-cli-contracts.md:67` — "Capability replay (E93 task 1030)" contract note
  on the import command (dry-run-first, complete-population scoping, analyze adoption).
- `docs/design/history-incremental-materialization.md:518` — §13.2 records definition `v7`
  (E93 1029 representative grain) and links the replay procedure + late-arrival repair.

Rationale: composition uses only the frozen seams — `HistoryServiceContext.getDb/importerVersion/
capabilityOrigins/historyHome/cwd` and `HistoryService.import({root, mode, dryRun})`; upgrade
mechanics are importer full mode (checkpoint short-circuit bypass + source-scoped `record_hash`
reconciliation + checkpoint reset) and the rollup definition bump; no checkpoint/ledger surgery,
no `history reset`, no production code changes (no replay defect surfaced), live data untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | test+static-ref — Documented: docs/design/history-data-processing.md:349-372 (§7.1 steps 1-6 provenance gate, backup-then-isolate, dry-run, complete-population full replay, derived-state adoption, frozen-oracle verification; §7.2 prohibited actions), CLI note docs/design/history-cli-contracts.md:67-75 — fresh read this verify. Exercised: replay test phases 1-2 (history-capability-replay.test.ts:409/:458) — importerVersion 0.4.48 rejected as UnsafeHistoryImporterError with dbOpens=0 (guard precedes first getDb; assertPiImporterSafe history-service.ts:315, call site :565, MIN_SAFE '0.4.49' :256 — fresh reads); dry-run previews reconciliation {3,3,0} with six-table dump equality and fixture bytes unchanged; isolation via PRAGMA wal_checkpoint + byte snapshot + copyFileSync (:368-377), original DB never reopened, byte-identity asserted in phases 3 (:591) and 6 (:814). Provenance receipts: installed importer node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json = 0.5.12 (fresh read) >= 0.4.49 minimum. FRESH receipt this verify: bun test (packages/app) tests/services/history-capability-replay.test.ts = 6 pass / 0 fail / 106 expect() calls. |
| R2 | MET | test+static-ref — Deliberate invalidation only: incremental import identity-skips the unchanged seeded bait file (phase 3 :496, skippedUnchangedFiles=1 / processedLines=0) proving the checkpoint short-circuit is real; full replay bypasses it and retires exactly the 3 legacy extraction hashes via importer-owned reconcileFullImport (installed dist jsonl-importer-dao.js:592, fresh read; source-scoped, record_hash-keyed) with resetCheckpoints (:238, DELETE-then-recreate — matches review P4 wording note); derived-version adoption is the ROLLUP_DEFINITION_VERSION 'v7' bump (rollup-watermark.ts:31, fresh read) retiring the pre-1029 '' sentinel row; no ad hoc surgery anywhere: grep over the test for DELETE/history reset finds only the header comment :28 asserting none; pi sentinel untouched (:552-556). Fresh receipt: phases green in this verify's 6/0/106 run. |
| R3 | MET | test+static-ref — Repeatability + preservation (phases 4-6, :601/:632/:727): second full replay is a no-op (stale 0, skippedDuplicates>0, skill/ledger/message dumps byte-equal, freshness 'unchanged'); late appended result flips the existing tu-unc event unknown→ok IN PLACE (same record_hash + invocation_id) and its ORIGINAL bucket 00:04 materializes ok while the result's own 00:44 bucket stays empty (1029 lateSkillResultBuckets contract, history-board-rollup.ts:2170); a distinct same-name repeat call keeps its OWN invocation_id; unchanged incremental re-import processes 0 lines; every materialized claude row equals the direct SKILL_ROLLUP_REP_SQL reference (history-board-rollup.ts:311 mirrored in test :752-787); legacy unknowns stay source-visible and unbucketed (null-timestamp conflicting-origin row); 8/3 oracle assertions at :560-562 (byCapability 8 rows = 8 calls; legacy confirmed loads = 3); pi sentinel, append-only fixture prefix and original DB bytes preserved. Fresh receipt: phases green in this verify's 6/0/106 run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Historical reprocessing upgrades safely and remains repeatable | MET | test | All of R1+R2+R3 (above). Verification-lens items each pinned by an assertion: dry-run writes nothing (phase 2 full-dump equality); two full replays keep stable identities + the 8/3 oracle (phases 3-4); later incremental result changes the existing event's original bucket (phase 5); distinct repeat calls separate (phase 5); unchanged-file skips (phases 3+6); sentinels and raw bytes preserved (phases 3+6). Hermetic: historyHome/cwd injected as emptyRoot temp dirs (:325-326, :399-400 — fresh read) so ambient user history is unreachable. FRESH receipts this verify: focused replay test 6 pass / 0 fail / 106 expect(); seeded regression suites history-service + history-analysis-service 59 pass / 0 fail / 275 expect(); bun run typecheck exit 0 (spur/spur-app/spur-web/spur-server). Recorded breadth (reused per dispatch after spot re-confirmation): quality-gate PASS 1st try, 9870/0 in 302s (1030-test-gate.status = PASS; 1029-event-trace.md:29; 1030-diffstat.json files:6 +930/−5 'includes untracked replay test'; base sha c4b3b7ecf matches) and the reviewer's 7,959/0 six-workspace sweep (review-answer addendum). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-03T21:41:01.485Z todo → testing (system)
- 2026-10-03T21:41:31.066Z testing → done (system)

