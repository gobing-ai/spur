---
schema_version: 1
name: Retain run records sessions and artifacts outside scratch
status: todo
template: feature-impl
created_at: 2026-09-30T20:13:58.357Z
updated_at: "2026-09-30T20:36:57.900Z"
feature_id: E71
priority: P2
tags:
  - run-storage
estimate_hours: 12

dependencies: ["1025"]
---

## 1026. Retain run records sessions and artifacts outside scratch

### Background

Requires the ownership audit and durable-evidence migration seam. Records, registered artifact references, session roots and result exports form one lifetime change and share execution/inspection review context, so they stay in one sequential task.

Implements: R3 — Retained run inspection and artifact references survive scratch removal; R4 — Session history and exported results remain available outside scratch; R6 — Existing lasting data is preserved before its scratch dependency is retired.

Material premises: Agent artifact lookup uses the run-record reader at packages/app/src/services/agent-service.ts:2533; agent sessions are discovered under run scratch at packages/app/src/services/history-service.ts:498; current pair topology is documented in docs/design/run-record-contract.md:23.

Rubric: E12 D1 L4 C1 R2 = 20; retained-record/session review boundary, below 16-hour forced-size split

**Refine corrections (2026-09-30)**

- Retained-copy instructions omitted optional missing artifacts and CLI sink composition → these modes exist in current run.artifact/run/continue code → froze truthful missing references, both sink roots, session/export ordering and the exact upstream seam.

### Requirements

- [ ] R1. Write retained engine/inline record pairs under .spur/memory/runs and preserve authoritative DB status, append order, redaction, no-log and legacy inspection behavior.
- [ ] R2. Persist registered lasting artifact bytes before durable reference registration and redirect inspection/coordination references with confinement and collision rejection.
- [ ] R3. Move Spur-owned session roots and their observer/resume/history readers together; persist planning handoffs and worktree exports before consumer or worktree disposal.
- [ ] R4. Extend the bounded migration with record/log/artifact/session data and truthful missing/conflict outcomes; preserve active/paused owners and importer obligations.

### Acceptance Criteria

- [ ] AC1 — Retained run inspection and artifact references survive scratch removal (req: R1; R2)
- [ ] AC2 — Session history and exported results remain available outside scratch (req: R3)
- [ ] AC3 — Existing lasting data is preserved before its scratch dependency is retired (req: R4)

### Q&A

- Closed: retain the accepted ADR-131 storage lifetime and existing workflow clean behavior; automatic terminal deletion is omitted.
- Closed: shared internal storage/migration seam belongs to 1025; 1026 extends it and 1027 verifies it.
- Closed: sequential isolated-tree implementation; no same-tree concurrent writers. Upstream task outputs must be integrated before dependent execution.
- Deferred to the producing task, with its owner: additional concrete source references discovered by 1024 are added to that audit before 1025 starts; this cannot silently change accepted storage policy.

### Design

Accepted design: docs/design/disposable-run-storage.md; ADR-131. Use existing application owners and portable plugin build seams; no new backend, dependency or public command/flag. Do not delete live project data. Current runtime locations change only during implementation.

Reuse WorkflowRunLogSink, inline setup, run-record readers, run.artifact and session/import owners. Records write directly to .spur/memory/runs/<runId>.md and .state.json; sessions use <runId>/agent-sessions; retained artifact bytes use <runId>/artifacts/<basename>. Preserve current run ID and machine state projection semantics. Accept scratch registration input through its current confined boundary; internally persist retained bytes before storing the durable reference. A basename collision with unequal source identity fails visibly. Extend the same migration service/manifest from the evidence task; do not create a second migration engine. Keep source-owned histories and explicit trace-file behavior unchanged.

#### Frozen implementation contract

Input from 1025: `runStoragePaths(cwd)`, `WorkflowAppService.migrateRunStorage({dryRun, logsOnly})`, its entry/result/manifest contract and durable evidence paths. Do not rename these or fork migration. Read the finished 1024 inventory and 1025 Solution before starting. Output to 1027: all retained data and late consumers resolved outside scratch, plus regression fixtures for the final deletion test.

Primary files: `packages/app/src/observability/workflow-run-log-sink.ts`, `packages/app/src/services/inline-run-setup.ts` (`writeInlineRunOutcome` and `persistWorktreeRuns`), `packages/app/src/services/workflow-service.ts`, `packages/app/src/workflow/run-record.ts`, `packages/app/src/services/agent-service.ts` (artifact refs), `packages/app/src/workflow/actions/{run-artifact,agent-run}.ts`, `packages/app/src/services/history-service.ts` (session discovery), `packages/app/src/services/run-session-observer.ts`, `packages/app/src/workflow/fleet-dispatch.ts`, `apps/cli/src/commands/workflow.ts` (source run/continue sink dir), existing ArtifactDao/CoordinationRunDao metadata updates, and source plugin drivers/worktree guidance. Actual additional consumers come from 1024; domain mutations stay behind DAOs with no schema migration.

Record pairs keep existing basenames, append semantics, redaction, limits and state schema under recordsDir. DB trace is authoritative; do not synthesize paused snapshots or alter definition identity. The CLI run and continue composition roots both select recordsDir; inline setup selects the same path. Keep `--no-log` and explicit trace output behavior. Session paths are `recordsDir/<runId>/agent-sessions/<agent>` and session IDs survive root relocation; import, watermark and continuation use that root. Source-owned native histories are not copied or rewritten.

For `run.artifact`: bound durable evidence from 1025 stays registered in place. Existing scratch outputs that are retained are confined/validated before copy to `recordsDir/<runId>/artifacts/<basename>`. Reuse safe run-ID validation; reject non-regular files, escaping links and unequal basename collisions. Compare bytes on a repeated identical operation. Only after atomic copy succeeds may the DAO register the durable target or existing reference be redirected. Registration failure keeps both source and durable bytes and reports failure; do not erase a useful copy as rollback. An optional missing source (`requireExisting:false`) may retain truthful path-only/missing semantics with a durable target reference, but never claims persisted bytes; no file is fabricated. Tests must cover this compatibility case. Preserve bound proof checks and inline registration-equivalent documentation; no invented inline ledger row.

Migration extends 1025's plan with terminal owned pair/log/artifact/session candidates and owner-backed metadata references. A pair migration preserves both bytes and run ID. Session migration requires settled importer obligations and no live/resumable owner; missing legacy bytes remain missing, unequal destination refuses overwrite. Worktree `persistWorktreeRuns` transfers durable evidence, records and referenced bytes before worktree removal, including target-conflict checks. Planning handoff registration persists final bytes before returning a lasting reference. Do not leave a reader using legacy scratch after a successful migration checkpoint. Missing/legacy/incomplete inspection states retain current truthful behavior; absence is not evidence of expiry.

Test through existing real producer/consumer paths: `packages/app/tests/observability/workflow-run-log-sink.test.ts`; `services/{inline-run-setup,workflow-service,agent-service,history-service,run-session-observer}.test.ts`; `workflow/{run-record,session-pinned-dispatch,idea-handoff}.test.ts`; `workflow/actions/{run-artifact,agent-run}.test.ts`. Extend the shared `services/run-storage.test.ts` for pair/ref/session migration, conflict and persistence failures. Integration covers inline plus subprocess run/continue, no-log, legacy inspection, late history import and worktree export. Invoke real file readers and SQLite DAOs rather than stubbing their storage contract. Budget 12 hours; retain partial artifacts on timeout without claiming completion.

#### Delegation boundary

Read `docs/design/disposable-run-storage.md` and ADR-131 before editing. Use source-local CLI for corpus operations. Start from an isolated execution tree containing the current E71 specs and record base SHA; do not revert unrelated changes. Current tree has A9 and I33 runall worktrees and concurrent history/UI edits; the source/bundle files touched by A9 can overlap this feature. Check `git worktree list` and current task status before dispatch, integrate upstream changes before editing shared files, and use one writer per tree. No new public nouns/verbs/flags; the existing `workflow clean` extension has operator consent. No production migration or deletion during refinement.

### Plan

1. [R1–R4] Prepare an isolated execution tree with current E71 specs, inspect upstream outputs and concurrent A9 changes, and confirm source CLI/build baseline before editing.
2. Consume the ownership inventory, trace engine/inline writers, inspection/reference readers, session consumers and worktree exporters.
3. Redirect retained record publication and inspection/coordination references together; preserve legacy missing/incomplete classification and no-log semantics.
4. Persist registered bytes and owned session roots outside scratch; update observer/continuation/import discovery and late consumer obligations.
5. Migrate eligible legacy records/logs/artifacts/sessions through existing dry-run/apply scopes and export durable results before worktree deletion; preserve active/paused/conflicting records.
6. Test inline/subprocess inspect/resume, legacy logs, reference collisions, persistence failures, late history import, worktree export and scratch-removal equivalence; regenerate standalone bundles and run focused gates.

Execution checks and per-requirement observability are frozen in Design. Preserve partial artifacts at the stated budget; do not run product cleanup on real project data as a test.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: E71; accepted design: `docs/design/disposable-run-storage.md`; decision: ADR-131.
- Discovery and persistent handoff: `docs/plans/2026-09-30-run-scratch-brainstorm.md`.
- Existing evidence fallback owner: F93; run-record owner: E7.
- Concurrency snapshot: no wip tasks reported at refinement kickoff; active worktree branches `sp/runall-A9-485e` and `sp/runall-i33-a22b` exist. Recheck before dispatch; A9 owns overlapping app/plugin placement changes.

### History
