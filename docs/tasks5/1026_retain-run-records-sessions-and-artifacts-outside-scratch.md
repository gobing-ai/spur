---
schema_version: 1
name: Retain run records sessions and artifacts outside scratch
status: done
template: feature-impl
created_at: 2026-09-30T20:13:58.357Z
updated_at: "2026-10-02T01:11:34.039Z"
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

- [x] R1. Write retained engine/inline record pairs under .spur/memory/runs and preserve authoritative DB status, append order, redaction, no-log and legacy inspection behavior.
- [x] R2. Persist registered lasting artifact bytes before durable reference registration and redirect inspection/coordination references with confinement and collision rejection.
- [x] R3. Move Spur-owned session roots and their observer/resume/history readers together; persist planning handoffs and worktree exports before consumer or worktree disposal.
- [x] R4. Extend the bounded migration with record/log/artifact/session data and truthful missing/conflict outcomes; preserve active/paused owners and importer obligations.

### Acceptance Criteria

- [x] AC1 — Retained run inspection and artifact references survive scratch removal (req: R1; R2)
- [x] AC2 — Session history and exported results remain available outside scratch (req: R3)
- [x] AC3 — Existing lasting data is preserved before its scratch dependency is retired (req: R4)

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

Extended the 1025 storage seam (no fork; ADR-131, `docs/design/disposable-run-storage.md`):

- `packages/app/src/services/run-storage.ts`
  - `runStoragePaths` gains `recordsDir` `.spur/memory/runs` (run-storage.ts:42, run-storage.ts:52) with per-run `runSessionsDir`/`runArtifactsDir` roots (run-storage.ts:492-498); `classify()` treats run-record pairs, agent sessions (`<runId>/agent-sessions/…`), artifacts and `.log` scratch logs as owned families (subpath classify run-storage.ts:184-194; run-scoped receipts run-storage.ts:216-227; preserved fallthrough run-storage.ts:275-284).
  - `migrateRunStorage` walks `<runId>/agent-sessions|artifacts` subtrees as per-file units (:330-343), routes run-record families to `recordsDir` (:408), and calls `ensureDurablePlaneIgnored` (:353, def :515) — the durable plane is kept fingerprint-inert via an idempotent `.git/info/exclude` entry (0612 invariant).
  - New `resolveRunRecordDir` (:542-548) gives readers scratch-first, durable-fallback resolution.
- `packages/app/src/services/inline-run-setup.ts`
  - `writeInlineRunOutcome` writes the two-file record pair under `recordsDir` (:822-823); worktree transfer carries the whole record dir before worktree removal (`carryRunRecordDir` :780-796, invoked :481); citation copies resolve scratch-first with durable fallback so evidence keeps its source plane (:282-283, transfer block :396-420).
- `packages/app/src/workflow/actions/run-artifact.ts`
  - `persistDurableArtifact` (:31-51) copies retained artifact bytes into `recordsDir/<runId>/artifacts/` before DAO registration at both call sites (:170 unbound, :463 bound); sha256-divergent basename collisions fail closed (:43-44), identical re-registration is idempotent (:46). File IO behind dynamic import (no-direct-fs-io rule).
- `packages/app/src/workflow/actions/agent-run.ts` — session dirs write to `runSessionsDir` (:577,:586) so native-session observers and resume read the durable root.
- `packages/app/src/services/history-service.ts` — late import/session discovery prefers the durable root (`runSessionAugmentedRoots` :491,559); scratch retained as fallback only.
- `packages/app/src/services/workflow-service.ts` — `cleanRunLogs` reclaims both scratch and durable roots (:954-962) and `listActiveRuns` skip keeps live owners (:1046).
- `apps/cli/src/commands/workflow.ts` — run and continue composition sinks select `recordsDir` (:901,:1259).
- `packages/app/src/index.ts` — exports the new seam members (`runSessionsDir`, `runArtifactsDir`, `resolveRunRecordDir`, `ensureDurablePlaneIgnored`).

DB trace stays authoritative (no paused snapshots, no schema change, no new backend/dep/public command). Terminal scratch deletion remains out of scope (ADR-131).

**Force verification repair (2026-10-01).**

- `packages/app/src/workflow/actions/run-artifact.ts:31` — durable publication now checks the destination's physical confinement, stages bytes and atomically links without overwriting a competing destination. Optional absent output returns a truthful path-only reference; a required source disappearing before persistence fails.
- `packages/app/src/services/run-storage.ts:537` — artifact/session path construction validates run IDs before using them as path components.
- `packages/app/tests/workflow/actions/run-artifact.test.ts:13` — regressions reproduced optional-missing refusal and an escaping durable-root write before the repair. Artifact/agent/inline/export/migration suites now pass: 244 tests across 5 files.
- Residual: migration has no metadata-redirection or settled-importer port; worktree export can report success while record conflicts are skipped and does not transfer the evidence plane as a complete family. Bound evidence registration still accepts only scratch. These requirements remain PARTIAL after the bounded repair pass; the existing export follow-up 1043 is outside the frozen verify set.

**Completion repair (2026-10-02); supersedes the preceding residual.**

- `packages/app/src/workflow/actions/run-artifact.ts:53` binds retained artifact bytes to canonical project-relative source provenance and rejects basename collisions; fixed durable evidence registration keeps the same run/proof/stage checks.
- `packages/domain/src/dao/run-storage-reference-dao.ts:12` owns transactional metadata/artifact/importer reference redirection; `packages/app/src/services/workflow-service.ts:934` composes this after confined byte publication. Live importer/reference obligations block retirement and failures preserve sources.
- `packages/app/src/services/history-service.ts:501` discovers retained session roots first and deduplicates copied/aliased identities. `packages/app/tests/services/history-service.test.ts:978` executes the real OMP importer before disposal, after two removals and during a later full import, preserving imported results and checkpoint positions.
- `packages/app/src/services/inline-run-setup.ts:307` validates and carries all canonical verdicts/receipts, artifact and task-link rows, retained records and session roots, then redirects copied metadata. Missing/unreadable/conflicting required families fail visibly. Integrated 1043 prevalidation and replay repair remain intact; 1045 adds the two omitted direct branches.
- `packages/app/src/workflow/actions/agent-run.ts:1670` persists failed-action handoff bytes and a redacted latch snapshot before publishing the compatibility scratch handoff; durable-first tracing survives disposal. `packages/app/tests/services/workflow-service.test.ts:211` proves a real decision workflow still consumes its registered summary using the original source name after scratch removal.


- `packages/app/src/services/inline-run-setup.ts:1356` now makes the shared persist-out delegate exit 1 / ok:false for reported retained record conflicts, preserving both source and target and blocking worktree teardown. The underlying service retains its existing conflict-skip contract. `packages/app/tests/services/inline-run-driver.test.ts:440` exercises a real copied run followed by divergent record replay; combined export/delegate suite: 46 pass, 0 fail.

Final consumer audit also fixes `outputArtifactForRun` through the existing durable/legacy root resolver, and retains trace-emission failure logs in the durable run root. The domain `listActiveRuns` query now matches its documented non-terminal ownership contract, protecting paused/interrupted logs and checkpoints; failed ownership reads refuse log reclamation. Driver, CLI help and owning contracts use the durable record/partial paths. Focused workflow, checkpoint and action-trace tests: 190 PASS, 0 FAIL.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/workflow.ts:901` selects durable record sinks; inline producer and retained inspection suites pass within 244 focused tests. |
| R2 | PARTIAL | `packages/app/src/workflow/actions/run-artifact.ts:31` now atomically persists confined retained bytes and preserves optional missing semantics. Bound evidence input remains scratch-only and source-identity collision coverage is incomplete. |
| R3 | PARTIAL | `packages/app/src/services/run-storage.ts:537` validates durable session run IDs; session/history producers use durable roots, but `packages/app/src/services/inline-run-setup.ts:481` exports records without a complete evidence-plane transfer and can skip conflicts. |
| R4 | PARTIAL | `packages/app/src/services/run-storage.ts:335` migration copies owned data and preserves live/unknown owners; no metadata-redirection or settled-importer port is present. Byte preservation alone does not settle retained references. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — Retained run inspection and artifact references survive scratch removal | PARTIAL | test | 244 focused producer/reader/artifact/export tests pass; optional missing and escaping-root regressions are fixed, but bound durable evidence and legacy metadata redirection remain incomplete. |
| Scenario: R4 — Session history and exported results remain available outside scratch | PARTIAL | test | Durable session paths are covered; `packages/app/src/services/inline-run-setup.ts:481` still carries record conflicts as skips and omits complete evidence-family export. |
| Scenario: R6 — Existing lasting data is preserved before its scratch dependency is retired | PARTIAL | test | Migration byte-copy preservation passes; `packages/app/src/services/run-storage.ts:335` lacks reference-redirection/importer eligibility inputs needed by the frozen contract. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Functional / SECUA / Architecture | `packages/app/src/services/inline-run-setup.ts:1090` | Reviewed the final scoped implementation and executable failure/disposal evidence; no unresolved blocker or major finding. | RESOLVED |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/inline-run-setup.ts:1090`; durable records and authoritative trace tests |
| R2 | MET | `packages/app/src/workflow/actions/run-artifact.ts:53`; provenance/collision/confinement tests and retained registered-summary workflow |
| R3 | MET | `packages/app/src/services/inline-run-setup.ts:307`; complete evidence/reference export and real session importer disposal tests |
| R4 | MET | `packages/domain/src/dao/run-storage-reference-dao.ts:12`; rollback/live-consumer tests; `packages/app/tests/services/history-service.test.ts:978` real importer checkpoint equivalence |

#### SECUA and architecture

Retained bytes and source provenance publish before ledger references. Physical confinement and immutable identity checks cover aliases/collisions. The domain DAO owns transactional reference/importer changes and rolls them back on failure; app services compose it. Complete export retains 1043 prevalidation/replay behavior. No new backend/schema/dependency was added.

Security: confined paths, existing identity validation and secret redaction remain. Correctness: focused regression evidence covers the changed success/failure branches. Efficiency: bounded local storage traversal; no new background collector. Usability: visible outcomes and errors. Architecture: existing app/domain/plugin ownership and standalone bundle contract remain. No speculative refactor is required.


The final export review found the teardown delegate accepted a reported retained-record conflict. The shared delegate now fails closed, preserving both copies; the real replay regression passes alongside all 1043/1045 branch tests (46 pass). This resolves the caller-side disposal gap without changing the copy service contract.

Final functional/SECUA/architecture audit: durable trace references and failure logging now survive scratch removal. Shared domain non-terminal ownership protects both cleanup callers, including paused/interrupted runs; ownership failures preserve logs. Installed runtime instructions and CLI help agree with the durable owners. These gaps are resolved, covered by 190 passing focused tests; no unresolved P1–P3 finding remains.

### References

- Feature: E71; accepted design: `docs/design/disposable-run-storage.md`; decision: ADR-131.
- Discovery and persistent handoff: `docs/plans/2026-09-30-run-scratch-brainstorm.md`.
- Existing evidence fallback owner: F93; run-record owner: E7.
- Concurrency snapshot: no wip tasks reported at refinement kickoff; active worktree branches `sp/runall-A9-485e` and `sp/runall-i33-a22b` exist. Recheck before dispatch; A9 owns overlapping app/plugin placement changes.

### History

- 2026-10-01T19:50:44.061Z todo → wip (system)
- 2026-10-01T19:50:44.913Z wip → testing (system)
- 2026-10-01T19:51:13.700Z testing → done (system)

