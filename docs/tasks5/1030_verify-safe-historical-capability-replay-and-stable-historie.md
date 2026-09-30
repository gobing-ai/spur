---
schema_version: 1
name: Verify safe historical capability replay and stable Histories results
status: todo
template: feature-impl
created_at: 2026-09-30T20:26:19.399Z
updated_at: "2026-09-30T20:52:16.193Z"
feature_id: E93
priority: P1
tags:
  - history
  - capabilities
estimate_hours: 5

dependencies: ["1028", "1029"]
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

- [ ] R1. Document and exercise the existing backup/dry-run/schema-adoption procedure on isolated database copies with importer and binary provenance.
- [ ] R2. Invalidate affected checkpoints and derived versions deliberately so unchanged historical files are reprocessed under new extraction semantics without losing unaffected facts.
- [ ] R3. Prove repeated full/incremental replay preserves distinct capability counts, legacy unknowns, original source histories and original database contents.

### Acceptance Criteria

- [ ] AC1 — Historical reprocessing upgrades safely and remains repeatable (req: R1; R2; R3)

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

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
