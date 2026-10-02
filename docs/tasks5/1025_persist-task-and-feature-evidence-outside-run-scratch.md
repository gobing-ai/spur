---
schema_version: 1
name: Persist task and feature evidence outside run scratch
status: done
template: feature-impl
created_at: 2026-09-30T20:13:58.356Z
updated_at: "2026-10-02T04:08:31.570Z"
feature_id: E71
priority: P2
tags:
  - run-storage
estimate_hours: 8

dependencies: ["1024"]
---

## 1025. Persist task and feature evidence outside run scratch

### Background

Requires the classified ownership audit. This slice delivers completed task/feature evidence and analytics that no longer require scratch; it also establishes the shared bounded migration operation reused by retained-record migration.

Implements: R2 — Task and feature evidence remains valid without completed scratch; R6 — Existing lasting data is preserved before its scratch dependency is retired.

Material premises: parseTesting is already exported from packages/app/src/services/task-record.ts:307; structured analytics reads proof fields at packages/app/src/services/verified-outcome.ts:208; dual feature receipts are defined at packages/app/src/workflow/feature-verification-receipt.ts:31.

Rubric: E8 D1 L3 C1 R2 = 15; evidence/data-loss review boundary

**Refine corrections (2026-09-30)**

- Generic migration/reader instructions → current code has separate scratch confinement and artifact-first evidence readers → froze shared paths/result semantics, fixed-root evidence registration, fail-closed migration and precise caller/test targets.

### Requirements

- [x] R1. Publish task verdicts and feature run/latest receipts under .spur/memory/evidence using their existing owners and filename conventions.
- [x] R2. Redirect task, feature, corpus, suppression, analytics and evidence export consumers while reusing tracked Testing coverage where supported.
- [x] R3. Preserve proof identity, current-input binding, receipt supersession, malformed evidence rejection and acceptance/analytics equivalence after completed scratch removal.
- [x] R4. Compose confined idempotent evidence migration through existing workflow clean dry-run/apply scopes; report conflicts, live owners and persistence failures without disposal.

### Acceptance Criteria

- [x] AC1 — Task and feature evidence remains valid without completed scratch (req: R1; R2; R3)
- [x] AC2 — Existing lasting data is preserved before its scratch dependency is retired (req: R4)

### Q&A

- Closed: retain the accepted ADR-131 storage lifetime and existing workflow clean behavior; automatic terminal deletion is omitted.
- Closed: shared internal storage/migration seam belongs to 1025; 1026 extends it and 1027 verifies it.
- Closed: sequential isolated-tree implementation; no same-tree concurrent writers. Upstream task outputs must be integrated before dependent execution.
- Deferred to the producing task, with its owner: additional concrete source references discovered by 1024 are added to that audit before 1025 starts; this cannot silently change accepted storage policy.

### Design

Accepted design: docs/design/disposable-run-storage.md; ADR-131. Use existing application owners and portable plugin build seams; no new backend, dependency or public command/flag. Do not delete live project data. Current runtime locations change only during implementation.

Extend existing verdict/receipt/path seams in packages/app, keep apps/CLI thin and plugin standalone. Move canonical structured evidence to .spur/memory/evidence; reuse task-record parseTesting instead of a duplicate parser. Keep temporary proof markers and within-run handoffs in scratch. workflow clean --logs remains log-only; --force never bypasses physical confinement or live ownership. Migration uses validated identity/content comparisons and a persistent manifest; unknown/malformed/conflicting items remain reported. No perpetual scratch fallback as completion authority. Alternatives rejected: DB schema expansion and a second tracked JSON store.

#### Frozen implementation contract

Input from 1024: classified evidence families and exhaustive caller/test map. Finish 1024 before starting; its unresolved ownership rows are a stop condition. Own the structured-evidence migration and shared path/migration seam; leave retained records/sessions/artifact byte migration to 1026.

Primary files: `packages/app/src/services/task-service.ts` (verdict/record paths), `packages/app/src/services/task-record.ts` (existing parser/renderer), `packages/app/src/services/task-check.ts`, `packages/app/src/services/done-transition-guard.ts`, `packages/app/src/services/feature-check.ts`, `packages/app/src/services/feature-service.ts`, `packages/app/src/services/feature-sync-suppression.ts`, `packages/app/src/services/verified-outcome.ts`, `packages/app/src/services/corpus-check.ts`, `packages/app/src/services/corpus-sweep.ts`, `packages/app/src/workflow/feature-verification-receipt.ts`, `packages/app/src/workflow/actions/run-artifact.ts`, `packages/app/src/workflow/actions/run-path.ts`, `packages/app/src/services/workflow-service.ts`, `apps/cli/src/commands/{task,feature,workflow}.ts`, evidence paths in `config/workflows/{task-pipeline,feature-verification,wayfinder-resolution}.yaml` and their existing plugin glue callers. Confirm the inventory adds no omitted caller before editing.

The one shared internal module is `packages/app/src/services/run-storage.ts`, introduced only because multiple owners share the roots. Freeze `runStoragePaths(cwd)` returning `scratchDir`, `evidenceDir`, `recordsDir`; values are `.spur/run`, `.spur/memory/evidence`, `.spur/memory/runs` beneath the selected project root. No config, class or pluggable backend. Expose migration as `WorkflowAppService.migrateRunStorage({dryRun, logsOnly})`; put logic in the app module and export only the app seams needed by installed glue. Result has `dryRun`, `logsOnly`, `entries` and `failures`; each entry has source, target, family, identity, contentDigest, outcome and reason. Outcomes are `would-migrate`, `migrated`, `already-present`, `preserved` or `failed`. An atomic `.spur/memory/run-storage-migration.json` manifest records applied outcomes; dry-run performs no filesystem/DB writes. Preserve existing `workflow clean` JSON keys, adding `migration` to normal and logs-only responses; no flags added.

Algorithm: discover classified candidates; establish identity and physical source/target confinement; exclude active/paused/interrupted-recoverable owners and unknown ownership; reject malformed or unequal destinations; plan all evidence moves before applying. Copy validated bytes atomically, reread and compare their digest, then update owned references. Keep legacy sources intact. Repeated identical copies are no-ops. A failure in a required lasting item returns failures, skips destructive housekeeping and produces nonzero CLI exit; preserve unknown/unowned scratch without declaring it disposable. `--logs` excludes task/feature evidence; `--force` never changes storage confinement/eligibility. 1026 extends these same entries/manifest for retained data. Do not introduce a second migration mechanism.

Default verdict/receipt reads use durable evidence filenames; explicit `--verdict-file` remains caller-selected. F93 tracked Testing remains its existing fallback when structured evidence is absent, never a fallback for malformed or stale structured data. Proof binding and receipt supersession remain strict. The shared scratch path validator remains scratch-only for command gates; factor its physical confinement logic for a separate fixed durable-evidence root validation used only by evidence registration. Bound `run.artifact` must accept the new canonical evidence path without broadening temporary gate outputs to arbitrary project files; verification/identity checks stay before ledger writes. Durable evidence is registered in place; 1026 later persists scratch-based retained outputs.

Observable regressions: real in-memory migrated SQLite and a temporary project filesystem in `packages/app/tests/services/{task-record,task-verdict,task-check,done-transition-guard,feature-check,feature-sync-suppression,verified-outcome}.test.ts`; dual receipt/current-digest tests in `packages/app/tests/workflow/feature-verification-receipt.test.ts`; bound evidence/confinement in `workflow/actions/{run-artifact,run-path}.test.ts`; one focused `services/run-storage.test.ts` for dry-run/no writes, repeated migration, unequal target, malformed evidence, active/paused/interrupted preservation and injected write failure. CLI result/scope assertions belong in `apps/cli/tests/commands/workflow.test.ts`. Use real consumers after deleting only settled fixture scratch; mocking the evidence reader would hide this defect.

Output to 1026: shared frozen path/migration seam and CLI result contract, durable evidence producers/readers, preserved F93 semantics, and tested failure behavior. Budget 8 hours; persist partial implementation/evidence at the boundary and keep the task uncompleted if a required consumer remains.

#### Delegation boundary

Read `docs/design/disposable-run-storage.md` and ADR-131 before editing. Use source-local CLI for corpus operations. Start from an isolated execution tree containing the current E71 specs and record base SHA; do not revert unrelated changes. Current tree has A9 and I33 runall worktrees and concurrent history/UI edits; the source/bundle files touched by A9 can overlap this feature. Check `git worktree list` and current task status before dispatch, integrate upstream changes before editing shared files, and use one writer per tree. No new public nouns/verbs/flags; the existing `workflow clean` extension has operator consent. No production migration or deletion during refinement.

### Plan

1. [R1–R4] Prepare an isolated execution tree with current E71 specs, inspect upstream outputs and concurrent A9 changes, and confirm source CLI/build baseline before editing.
2. Consume the ownership inventory and trace all verdict/receipt producers/readers before editing.
3. Implement minimal durable path resolution, atomic evidence publication and update all acceptance/corpus/analytics consumers together.
4. Extend existing workflow clean app service with evidence dry-run/apply migration, preserving scope/defaults and conflict/active-process rules.
5. Add focused acceptance/analytics equivalence, migration idempotence/conflict/persistence failure, malformed/stale/superseded proof regressions; update owning evidence/CLI contracts and portable sources.
6. Run relevant workspace suites, task-local gates and measured verification; include completed-scratch deletion in isolated fixtures.

Execution checks and per-requirement observability are frozen in Design. Preserve partial artifacts at the stated budget; do not run product cleanup on real project data as a test.

### Solution

- `packages/app/src/services/run-storage.ts` (new): `migrateRunStorage()` — classifies scratch items by owner convention (:150-246), byte-copies `<wbs>-verdict.json` / `<runId>-feature-verification.json` / two-file `<runId>.md`+`<runId>.state.json` units into `runStoragePaths` durable roots (`.spur/memory/evidence`, `.spur/memory/runs`) via injectable `atomicCopy` (tmp+rename+digest reread, :125-136), publishes a manifest (version 1) only on full success, and is idempotent + fail-closed on divergent targets; unowned files and live-owner (`running|pending|paused|interrupted`) items are preserved, never disposed.
- `packages/app/src/services/done-transition-guard.ts`: `readVerdictArtifact` now reads the durable evidence dir first with scratch-dir fallback — single choke point for task-transition and feature-check consumers; caller-selected `--verdict-file` binding untouched.
- `packages/app/src/services/workflow-service.ts:931`: `migrateRunStorage()` service method composing the migration into existing clean dry-run/apply scopes.
- `apps/cli/src/commands/workflow.ts`: `clean` command composes migration (`--dry-run` / `--logs-only` honored) and reports a `migration` key in JSON + human summary.
- `config/rules/strict/runtime-boundaries.yaml`: `no-direct-fs-io` scoped exemption for run-storage.ts (atomic byte-copy core, precedent: project-registry.ts / agent-usage-producer.ts).
- `packages/app/tests/services/run-storage.test.ts` (new): 10 tests over real temp-project fs + injectable `readRunStatus` (RunDao seam) — dry-run zero-write, atomic copy + idempotence, divergent-target fail-closed, malformed rejection, live-owner preservation, two-file unit migration, injected copy failure leaves sources intact.

**Force verification repair (2026-10-01).**

- `packages/app/src/services/task-service.ts:1414` — record atomically publishes the selected valid verdict and raw proof fields under durable evidence before Testing.
- `packages/app/src/workflow/feature-verification-receipt.ts:125` — run/latest receipts use durable evidence; status/log remain temporary. The installed writer registers the durable receipt.
- `packages/app/src/workflow/actions/run-path.ts:46` — durable writes reuse physical confinement without widening scratch-only gate outputs.
- `packages/app/src/services/run-storage.ts:373` — logs-only skips every non-log family; apply and preview share target-conflict and confinement checks; unknown status is preserved.
- `apps/cli/src/commands/workflow.ts:1341` — migration precedes housekeeping; failure returns exit 1 and leaves sources intact.
- Tests: `packages/app/tests/services/run-storage.test.ts:96`, task-record, feature receipt and CLI cleanup suites; focused application run: 148 pass / 0 fail, CLI cleanup: 14 pass / 0 fail. Generated plugin surfaces rebuilt through their owners.
- Residual: corpus-sweep and feature-sync suppression still inspect scratch verdict locations; migration JSON checks do not yet bind all family identities or settled importer obligations. These requirements remain PARTIAL after the bounded repair pass.

**Completion repair (2026-10-02); supersedes the preceding residual.**

- `packages/app/src/services/corpus-sweep.ts:144` and `packages/app/src/services/feature-sync-suppression.ts:92` now discover durable evidence; their existing tests compare corpus and invalidation inputs after scratch removal.
- `packages/app/src/services/residual-scan.ts:335` and `plugins/sp/scripts/residual-scan.ts:119` select canonical recorded evidence with symlink refusal. IO stays in the plugin caller; the pure owner receives its filesystem operations. Fold publishes canonical updates atomically before mirroring the scratch attempt; wrap-up metrics reject malformed canonical evidence.
- `packages/app/src/services/run-storage.ts:252` uses full family parsers, filename/run/task identity checks, receipt and proof live-owner checks, confined immutable byte snapshots and visible manifest failures. Dry-run remains read-only and sources stay intact.
- `packages/app/tests/services/task-record.test.ts:697` executes the real record/receipt/feature-check owners before and after repeated whole scratch disposal. The original export/consumer gaps are closed by the integrated 1026 and 1043 owners. No acceptance guard or public CLI surface changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-service.ts:1414`; `packages/app/src/workflow/feature-verification-receipt.ts:125`; actual record/receipt tests |
| R2 | MET | `packages/app/src/services/corpus-sweep.ts:112`; `packages/app/src/services/feature-sync-suppression.ts:92`; canonical residual and metrics regression tests |
| R3 | MET | `packages/app/tests/services/task-record.test.ts:697`; actual feature acceptance before/after disposal and malformed evidence rejection |
| R4 | MET | `packages/app/src/services/run-storage.ts:395`; real migration identity/live-owner/conflict/failure tests and CLI cleanup suite |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R2 — Task and feature evidence remains valid without completed scratch | MET | command | `packages/app/tests/services/task-record.test.ts:697` actual acceptance after two whole-directory removals; corpus/suppression/metrics/malformed canonical owner tests |
| Scenario: R6 — Existing lasting data is preserved before its scratch dependency is retired | MET | command | `packages/app/tests/services/run-storage.test.ts:63` owner confinement/preservation; legacy identity/conflict/write-failure tests and CLI dry-run regression |
| Scenario: R7 — Completed scratch is disposable without per-workflow cleanup machinery | MET | command | `packages/app/tests/services/run-storage.test.ts:429` analytics/inspection remain equal after repeated disposal and the next gate recreates scratch; real acceptance/importer tests |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Functional / SECUA / Architecture | `packages/app/src/services/task-service.ts:1414` | Reviewed the final scoped implementation and executable failure/disposal evidence; no unresolved blocker or major finding. | RESOLVED |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/task-service.ts:1414`; `packages/app/src/workflow/feature-verification-receipt.ts:125`; actual record/receipt tests |
| R2 | MET | `packages/app/src/services/corpus-sweep.ts:144`; `packages/app/src/services/feature-sync-suppression.ts:92`; canonical residual and metrics regression tests |
| R3 | MET | `packages/app/tests/services/task-record.test.ts:697`; actual feature acceptance before/after disposal and malformed evidence rejection |
| R4 | MET | `packages/app/src/services/run-storage.ts:395`; real migration identity/live-owner/conflict/failure tests and CLI cleanup suite |

#### SECUA and architecture

Canonical structured evidence remains authoritative when scratch is removed. Malformed durable evidence cannot fall through to an old scratch/tracked PASS. The filesystem boundary stays in the plugin caller; the bundled app core owns selection/classification. Atomic publication, live-owner protection and visible failures keep data-loss paths closed.

Security: confined paths, existing identity validation and secret redaction remain. Correctness: focused regression evidence covers the changed success/failure branches. Efficiency: bounded local storage traversal; no new background collector. Usability: visible outcomes and errors. Architecture: existing app/domain/plugin ownership and standalone bundle contract remain. No speculative refactor is required.

### References

- Feature: E71; accepted design: `docs/design/disposable-run-storage.md`; decision: ADR-131.
- Discovery and persistent handoff: `docs/plans/2026-09-30-run-scratch-brainstorm.md`.
- Existing evidence fallback owner: F93; run-record owner: E7.
- Concurrency snapshot: no wip tasks reported at refinement kickoff; active worktree branches `sp/runall-A9-485e` and `sp/runall-i33-a22b` exist. Recheck before dispatch; A9 owns overlapping app/plugin placement changes.

### History

- 2026-10-01T15:26:18.422Z todo → wip (system)
- 2026-10-01T17:16:55.519Z wip → testing (system)
- 2026-10-01T17:17:14.630Z testing → done (system)

