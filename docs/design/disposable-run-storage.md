---
kind: design
title: Disposable run storage and durable evidence
status: implemented
created_at: 2026-09-30
updated_at: 2026-10-01
related: [E71, E7, F93, docs/design/run-record-contract.md]
tags: [contract, workflow, planning]
---

# Disposable run storage and durable evidence

## 1. Issue and scope

E71 makes completed `.spur/run/` data disposable after all owning processes and consumers finish. The operator accepted this design, including the existing `workflow clean` behavior extension. Tasks 1024–1027 own its implementation:
- Task 1024 completed the ownership audit ([audit report](../reports/2026-09-30-E71-run-storage-ownership.md)).
- Task 1025 implemented evidence persistence outside run scratch: canonical roots in `packages/app/src/services/run-storage.ts` (`runStoragePaths`), `readVerdictArtifact` redirection to `.spur/memory/evidence/` first (scratch fallback), and `migrateRunStorage()` composed into `workflow clean`.
- Task 1026 implemented direct writes of run records (`.md` and `.state.json`), registered artifact bytes (`persistDurableArtifact`), and agent sessions to `.spur/memory/runs/`, worktree export transfer (`carryRunRecordDir`), late-session history discovery (`runSessionAugmentedRoots`), and dual-root `cleanRunLogs`.
- Task 1027 verified retention of all cleanup census sites for freshness and confinement correctness, routed verified analytics through `readVerdictArtifact`, and verified completed-scratch disposal equivalence.
The design changes storage lifetime without changing workflow state graphs, run identity, verification policy or retention durations.

Audit evidence and alternative approaches: [discovery plan](../plans/2026-09-30-run-scratch-brainstorm.md). The persistent ownership inventory was delivered by task 1024; task records carry current verification findings.

## 2. Context and constraints

`task-record.ts` owns `parseTesting` and the tracked Testing renderer. F93 uses that durable representation when a task verdict artifact is absent during feature coverage resolution. `verified-outcome.ts` uses the shared durable-first verdict reader for proof identity. Reuse the tracked parser for its supported fallback and retain structured evidence where its checks and run binding matter. A local file or database is not a replacement for tracked evidence across clones.

E7's two-file record, authoritative workflow DB trace/status, legacy `.log` classification, bounded redacted inspection, `--no-log` and `--trace-file` remain intact. Existing retention does not cover the new pair. This proposal does not select a new retention policy. Source-owned agent histories remain source-owned.

Spur application logic stays in `packages/app`; apps remain transports and plugin scripts remain thin standalone glue. Generated CLI config and installed twins follow their existing build owners. No schema, dependency, service framework or public CLI noun/verb/flag is introduced.

## 3. Proposed storage ownership

| Data | Destination | Writer/readers |
| --- | --- | --- |
| Attempt prompts, answers, status files, question signals, counters, temporary proof markers, intermediate logs | `.spur/run/`, using existing run/attempt identity | Existing workflow stages and runners; scratch remains confined there. |
| Canonical task verdict JSON and feature run/latest receipts | `.spur/memory/evidence/`, retaining existing filenames | Existing verdict/record/receipt owners and all task, feature, corpus, analytics and worktree consumers. |
| Human and machine run-record pair | `.spur/memory/runs/<runId>.md` and `<runId>.state.json` | Existing engine sink and inline setup writer; existing inspection readers. Write directly here, including while active. |
| Legacy retained log | `.spur/memory/runs/<runId>.log` | Migration and legacy readers; existing age policy with active ownership protected. |
| Registered lasting artifact bytes | `.spur/memory/runs/<runId>/artifacts/<original-basename>` | Existing `run.artifact` runner persists accepted bytes before recording the durable reference. Run ID must be validated; distinct source paths sharing a basename fail visibly rather than overwrite. |
| Failed-agent partial-work handoff | `.spur/memory/runs/<runId>/artifacts/<runId>-<node>-partial.md` | Existing failure writer retains the handoff and a redacted latch snapshot; workflow tracing resolves this copy first. The live session latch remains attempt scratch. |
| Spur-owned isolated agent sessions | `.spur/memory/runs/<runId>/agent-sessions/<agent>/` | Existing session-dir producer, observer, continuation and history discovery. Source-owned sessions are unchanged. |
| Durable task coverage representation | Tracked task Testing section | Existing CLI record renderer/parser; no new tracked artifact directory. |
| Recomputable doctor/suppression caches | Existing scratch location, or existing cache owner if already available | Deletion causes recomputation, never acceptance bypass or a failure attributed to missing lasting data. |

Use small path functions/constants at existing app seams where multiple callers share a root. Do not create a configurable storage backend or an artifact classification framework. Classification is an audit deliverable: source owners know which outputs require durable persistence. Registered retained output already has the `run.artifact` ownership boundary.

### Publication and reads

1. Temporary stage files keep existing freshness and lexical/physical confinement checks.
2. `task verdict` derives attempt evidence in scratch; `task record` atomically publishes the selected valid verdict, including its raw proof fields, under durable evidence before writing Testing. Feature receipt writers publish both structured copies directly under durable evidence; the coarse status and command log remain in scratch. Readers resolve durable evidence. Current-input digest, stricter-of-stored-and-computed verdict, receipt latest/run equality, supersession and malformed evidence rejection remain unchanged. F93's tracked fallback retains its current valid-data semantics; malformed durable evidence cannot fall through to an old PASS.
3. `run.artifact` accepts scratch output through its existing confined input contract, validates identity/proof as today, atomically persists the retained bytes to its owned durable destination, and records the durable path. Bound canonical evidence already published under `.spur/memory/evidence/` is validated against that fixed root and registered in place. Command-gate output confinement remains scratch-only. Persistence/registration failure reports failure and keeps the source; unregistered data is not claimed persisted. Optional missing artifacts retain truthful path-only semantics without fabricated bytes.
4. Engine and inline run records write directly to the durable run directory. DB trace/status stays authoritative; `.state.json` is the existing projection, not a replacement engine snapshot. Inspection and coordination references resolve the durable pair with migrated legacy fallback.
5. Session producer, observer and history importer share the durable session-root convention. Active/paused session identity is stable; no folder move under a running process.
6. Worktree result export carries canonical verdicts, both receipt copies, run records, registered artifact rows/bytes and session roots into the destination before worktree disposal. Resource references are redirected through the existing DB owner; proof digests and receipt provenance are unchanged. Unequal canonical evidence or nested retained bytes fail export. Planning handoff gets durable registration before scratch removal. Task 1043 owns fail-closed record prevalidation and repair after an earlier row/file tear.

Recorded verdict discovery includes corpus sweep, suppression inputs, residual folding and wrap-up metrics. Residual folding atomically updates the canonical recorded verdict and mirrors it to the attempt copy consumed by the pipeline. A malformed canonical verdict remains authoritative rejection. Registered summaries may use their original scratch name only when retained source provenance proves the mapping; their envelope still binds the producer run/action.

## 4. Compatibility and migration

Migration is a bounded explicit operation implemented in `packages/app` and composed by the existing `spur workflow clean` housekeeping surface. `--dry-run` previews classification and storage moves; an apply invocation persists eligible lasting data before existing housekeeping. `--logs` limits migration/reclamation to legacy logs and leaves evidence, sessions and pairs untouched; `--force` retains its existing stale-run meaning and never bypasses path, conflict or active-process protection. Installed execution uses the same app service, with no migration implementation in plugin code. The operator gave explicit consent for this existing-public-verb behavior extension after reviewing this design context. No new noun, verb or flag is proposed. Acceptance of the design does not itself run migration or delete live data; task 1025 implemented `migrateRunStorage` in `packages/app/src/services/run-storage.ts`, composed into `workflow clean`, recording applied outcomes in `.spur/memory/run-storage-migration.json`.

The migration persists legacy task verdicts/receipts, retained run pairs/logs, registered artifacts and owned session directories. It preserves relative identity, run/feature/task bindings and contents; updates path-only metadata/coordination references through their owners; and writes a manifest of source, destination, identity, content digest and outcome under `.spur/memory/`. Existing structured identity/digest validation is reused. Atomic files and content comparison make retries idempotent; an existing unequal destination is a conflict, never an overwrite. If a legacy artifact record no longer has bytes, preserve its truthful missing classification rather than invent them.

No global directory deletion is part of migration. Unknown, malformed, conflicting, active, paused and interrupted-recoverable candidates are preserved and reported. A directory/session migration requires no live owner and settled importer obligations. A successful migration checkpoint means every classified lasting item is durably readable, every retained reference is redirected, and no unresolved item is silently declared disposable. Until then, legacy data stays intact. Legacy locations may be consulted only for migration/diagnostic handling, never as a permanent completion authority after migration.

Session migration redirects closed-run variables, artifact references and importer source paths in one owner transaction, preserving record hashes and incremental checkpoint progress. Durable run/agent roots suppress matching legacy copies during discovery. Reference failure leaves source bytes intact and a manifest with `complete: false`; retries reconcile the same snapshots without overwriting conflicts.

For cloned tracked task records, preserve F93's existing behavior without claiming local logs or missing proof can be reconstructed. For local existing projects, migrate valid structured evidence before comparing acceptance and analytics; malformed evidence remains malformed. Missing evidence remains missing.

## 5. Cleanup and disposal contract

Automatic terminal deletion is omitted. Once all processes/consumers finish and lasting data is persisted, completed scratch is safe for manual or future centrally owned housekeeping. Task 1027 verified that all one-off cleanup census rows from task 1024 are retained for correctness (expectFile invalidation, staging handoff, atomic publication, history-service reconciliation, and agent-run delete-before-invoke freshness).

Decisive equivalence testing (`packages/app/tests/services/run-storage.test.ts:291-419`) proves snapshots of verdict acceptance, derived analytics, run-record inspection (done/failed/paused terminals), artifact bytes, and session outputs are all equal before, after, and on repeated scratch removal. Escaping symlinks cannot touch external files, active scratch is preserved, and scratch is recreated seamlessly by subsequent gates (`runLightGate`).

Existing `workflow clean` log reclamation follows the migrated legacy-log root and current age knob, protects active ownership, and leaves retained pairs alone. Public command defaults and retention durations remain unchanged; the owner docs describe the corrected protection boundary.

## 6. Verification and delivery boundaries

E71 R1 produces a classified inventory with each source owner, all consumers, lifetime, disposition and test. R2 migrates evidence and readers with equal acceptance/analytics outcomes. R3 covers retained records/artifact bytes and inspection. R4 covers sessions/history, handoff and worktree export. R5 preserves freshness/confinement and removes proven redundant cleanup. R6 covers migration, conflicts, recoverable work and persistence failures. R7 verifies completed scratch disposal and installed/config/docs parity.

Verification must exercise the real producers and readers, including completed directory removal, bound acceptance, feature receipts and history import. Equal results from synthetic files or a denominator-only analytics check do not alone prove this contract. Task records retain the executable evidence and unresolved findings.

## 7. Tradeoffs

Chosen: existing local memory storage for lasting structured evidence and retained records, with tracked Testing still owning portable coverage. This makes scratch deletion harmless with minimal storage changes and preserves current proof fields.

Rejected: DB-only storage would still need bytes for path-referenced artifacts and introduces schema work; tracked JSON per task duplicates F93's portable representation; selective cleanup of a mixed scratch directory preserves the original lifetime conflict. Costs are migration and coordinated reader updates. Exact file-by-file classification is R1 execution work, bounded by the current inventory rather than speculative artifact types.
