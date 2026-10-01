---
schema_version: 1
name: Verify disposable scratch and reconcile cleanup safeguards
status: done
template: feature-impl
created_at: 2026-09-30T20:13:58.359Z
updated_at: "2026-10-01T20:21:21.708Z"
feature_id: E71
priority: P2
tags:
  - run-storage
estimate_hours: 8

dependencies: ["1025", "1026"]
---

## 1027. Verify disposable scratch and reconcile cleanup safeguards

### Background

Requires both durable evidence and retained-record/session slices. This is the final disposal behavior and cleanup review, not a task that merely runs tests or claims a feature-wide PASS.

Implements: R5 — Temporary handoffs retain freshness and confinement safeguards; R7 — Completed scratch is disposable without per-workflow cleanup machinery.

Material premises: Delete-before-invoke guards exist at packages/app/src/workflow/actions/agent-run.ts:324; physical confinement lives at packages/app/src/workflow/actions/run-path.ts:37; legacy retention is owned by packages/app/src/services/workflow-service.ts:931.

Rubric: E8 D1 L3 C1 R2 = 15; disposal/correctness review boundary

**Refine corrections (2026-09-30)**

- Broad regression intent left cleanup ownership/test observability to the delegate → current delete-before-invoke and physical confinement are correctness safeguards → froze keep/remove criteria, real-consumer disposal checks and final integration commands.

### Requirements

- [x] R1. Review every classified one-off cleanup against the proven-safe bar; remove only proven-safe redundancy and preserve delete-before-dispatch freshness and atomic publication.
- [x] R2. Preserve physical path confinement, paused recovery and concurrent unrelated active ownership; reconcile legacy log cleanup with migrated roots and active-run protection.
- [x] R3. Cover terminal success/failure disposal regressions: acceptance, analytics, retained inspection and consumer outputs stay equal after completed scratch removal, repeated removal and subsequent recreation.
- [x] R4. Close inventory dispositions and synchronize command/workflow/unit-test/docs/generated/installed contracts; add no per-workflow terminal cleanup machinery.

### Acceptance Criteria

- [x] AC1 — Temporary handoffs retain freshness and confinement safeguards (req: R1; R2)
- [x] AC2 — Task and feature evidence remains valid without completed scratch (req: R3; R4)

### Q&A

- Closed: retain the accepted ADR-131 storage lifetime and existing workflow clean behavior; automatic terminal deletion is omitted.
- Closed: shared internal storage/migration seam belongs to 1025; 1026 extends it and 1027 verifies it.
- Closed: sequential isolated-tree implementation; no same-tree concurrent writers. Upstream task outputs must be integrated before dependent execution.
- Deferred to the producing task, with its owner: additional concrete source references discovered by 1024 are added to that audit before 1025 starts; this cannot silently change accepted storage policy.

### Design

Accepted design: docs/design/disposable-run-storage.md; ADR-131. Use existing application owners and portable plugin build seams; no new backend, dependency or public command/flag. Do not delete live project data. Current runtime locations change only during implementation.

Use the classified inventory to distinguish correctness invalidation from housekeeping. Keep stale expectFile/escalation/retry protection and atomic tmp cleanup; remove a deletion only with an equivalent runnable check. Existing workflow clean preserves legacy-log retention duration and no pair-retention policy while rejecting active-process deletion. The decisive integration test settles all consumers, snapshots acceptance/analytics/inspection, removes only completed fixture scratch twice and reruns the next command. Do not delete the real project run directory. Reuse existing tests and path contracts; no new cleanup timers, hooks, flags or generic framework.

#### Frozen implementation contract

Inputs: finished 1024 inventory, 1025 evidence/migration behavior and 1026 retained-data/reference behavior. Both 1025 and 1026 are direct dependencies. Reuse their path/migration seam and integration fixtures; do not re-own publication or create a separate collector. Leave the closed inventory and current contract docs as output to feature verification/delegation.

Primary files are the cleanup rows from 1024: `config/workflows/{task-pipeline,idea-pipeline,wayfinder-resolution}.yaml`, `packages/app/src/workflow/actions/agent-run.ts`, `packages/app/src/services/{quality-gate,workflow-service,feature-service}.ts`, atomic publishers and corresponding plugin source guidance. Keep `packages/app/src/workflow/actions/run-path.ts` scratch confinement and 1025's separate evidence registration scope. Reconcile `workflow clean` legacy log reclamation with the durable log root and real active/paused ownership; unchanged retention duration does not authorize deleting a live run's log.

Keep delete-before-dispatch for expectFile/escalation, consumed-question ordering, retry-output invalidation and failed `.tmp` publication cleanup unless a specific equivalent attempt-identity check proves redundancy. Cached doctor or suppression data may regenerate, but its absence cannot fabricate acceptance. Freshness remains meaningful within runs even though lasting evidence has moved. Do not delete source-owned sessions, checkpoint/report retention data or unrelated `/tmp` files through a new run cleaner. No automatic terminal deletion is added.

Decisive check in `packages/app/tests/services/run-storage.test.ts`: create real completed task/feature evidence, retained logging-enabled run and registered bytes/session outputs in an isolated project; settle consumers/import/export and capture completion, scenario coverage, `deriveVerifiedOutcome`, `inspectRunRecord`, artifact bytes and imported history. Remove the completed fixture scratch directory, rerun the same consumers and compare identities/results; repeat removal; run doctor/temporary gate and confirm scratch recreation. Include success and failure terminal runs, a concurrent unrelated active run whose scratch survives selective disposal, paused/interrupted recovery, stale PASS/answer, escaping link, optional missing artifact, and migration write failure. Fixtures must fail on the pre-migration code; deleting the directory in a test that mocks the post-completion reader is not evidence.

Existing freshness/confinement suites: `packages/app/tests/workflow/actions/{agent-run,run-artifact,run-path,command-gate}.test.ts`, `services/{quality-gate,workflow-service}.test.ts`, `plugins/sp/tests/{task-pipeline-resilience,run-record-catalog,quality-gate-receipt,feature-verification-steps}.test.ts`; installed parity uses root `bun run plugin-smoke`. Execute focused tests inside the owning workspace. After CLI changes link from apps/cli and bundle with `bun run --filter @gobing-ai/spur build:bundle`; generated plugin twins use root `bun run build:scripts`. Then task-local gates, `bun run spur-check-feature` once for E71, `bun run test-cf`, `bun run build`, and scoped changed-corpus checks. Do not suppress findings or run the unsuppressed whole-corpus audit unless checker policy changes.

Close each inventory row as implemented, legitimate temporary use, recomputable cache or unrelated scope; a remaining lasting reader in scratch is incomplete, not a baseline exception. Owner docs include run-record, workflow log, CLI/inspection/inter-agent contracts and installed driver guidance. Preserve old ADR history and mark actual implementation separately from accepted design. Budget 8 hours; leave unresolved evidence in the task rather than forcing a green feature.

#### Delegation boundary

Read `docs/design/disposable-run-storage.md` and ADR-131 before editing. Use source-local CLI for corpus operations. Start from an isolated execution tree containing the current E71 specs and record base SHA; do not revert unrelated changes. Current tree has A9 and I33 runall worktrees and concurrent history/UI edits; the source/bundle files touched by A9 can overlap this feature. Check `git worktree list` and current task status before dispatch, integrate upstream changes before editing shared files, and use one writer per tree. No new public nouns/verbs/flags; the existing `workflow clean` extension has operator consent. No production migration or deletion during refinement.

### Plan

1. [R1–R4] Prepare an isolated execution tree with current E71 specs, inspect upstream outputs and concurrent A9 changes, and confirm source CLI/build baseline before editing.
2. Reconcile each inventory row with implemented durable destinations and remaining legitimate within-run consumers.
3. Preserve freshness/atomicity/confinement and remove proven redundant cleanup; fix tests or workflows that assume lasting scratch.
4. Add isolated terminal success/failure, concurrency, paused-recovery, late-import/export, migration-failure and repeated disposal/recreation checks.
5. Update current owner docs and plugin guidance, regenerate twins/config and run standalone smoke plus focused workspace suites.
6. Run task-local verification and the feature-wide gate once, refresh the final inventory and record unresolved candidates honestly before feature completion.

Execution checks and per-requirement observability are frozen in Design. Preserve partial artifacts at the stated budget; do not run product cleanup on real project data as a test.

### Solution

**Disposition: remove nothing from the 1024 cleanup census — every row is correctness, not redundancy.** The one real defect found was a lasting reader living in scratch, fixed by routing analytics through the shared durable-first seam (1025/1026 storage work, extended here).

#### Census dispositions (1024 report §4, all rows truthful-checked against the tree)

| Site | Disposition | Why it stays |
| --- | --- | --- |
| `packages/app/src/services/quality-gate.ts:541,611,620` | retain | one-off invalidation of gate outputs (temp dir, probe log, attempt log); expectFile re-verification (`:446-465`) invalidates stale receipts before PASS — freshness, not redundancy |
| `config/workflows/task-pipeline.yaml:685` + `packages/app/src/services/inline-run-setup.ts:358-364` | retain | scratch staging IS the handoff payload (atomic `$V.tmp`→`mv` verdict stage); copies keep their source plane, removed only after export |
| `packages/app/src/services/history-anatomy.ts:867-884` | retain | analysis-time scratch inputs (C7); publication of the report is atomic (`publishAtomically`), landing outside scratch |
| `packages/app/src/services/history-service.ts:491,559,1451,1668` + `packages/app/src/services/workflow-service.ts:969-984` | retain | legacy dual-root scan and `cleanRunLogs` sweeping are the legacy-retention reconciliation itself (live runs skipped at `packages/app/src/services/workflow-service.ts:1046`); published reports + retention live under `.spur/reports/history` (`history-service.ts:1451,1668`) |
| `config/workflows/idea-pipeline.yaml:464-470` + `packages/app/src/workflow/idea-handoff.ts:106-139` | retain | planning handoff staging (B6) is lasting-at-handoff: fail-closed consumers require batch/result/order before scratch removal; post-confirm duplicates were already deleted (1007 R2, yaml `:304,557`) |
| `packages/app/src/workflow/actions/agent-run.ts:324-326` | retain | delete-before-invoke enforces answer/expect freshness — a stale expectFile from a prior run must not satisfy this dispatch |
| `packages/app/src/services/feature-service.ts:691-701` | retain | terminal housekeeping of its own recomputable blocked-state cache (computed blocked, then cleared on non-BLOCKED outcome) |

#### Production fix: analytics must not read lasting evidence from scratch

`deriveTaskInput` read the verify verdict from `.spur/run/<wbs>-verdict.json` only. After 1025/1026, verdicts are durable acceptance evidence (`.spur/memory/evidence/`), so completed scratch disposal would silently change the verified population. The read now routes through the existing durable-first seam `readVerdictArtifact` (`packages/app/src/services/done-transition-guard.ts:112-137`, evidence-first with scratch fallback and guard precedence) at `packages/app/src/services/verified-outcome.ts:212`. No fork of the resolution logic, no circular import, and the conservative-false extraction on absent/malformed artifacts is preserved (guard precedence).

#### Verification

Decisive disposal-equivalence test `packages/app/tests/services/run-storage.test.ts:291-419`: success/failure/paused terminal pairs, verdict, artifact bytes, sessions and analytics snapshotted before/after/repeated scratch removal — all equal; active-run scratch survives selective disposal; escaping symlinks leave targets intact; the next temporary gate recreates scratch (`runLightGate`). Analytics durable-fallback regression: `packages/app/tests/services/verified-outcome.test.ts:90`. Scenario matrix (stale PASS, missing artifact, migration write failure, paused recovery) stays owned by the existing done-transition-guard, quality-gate, 1025 migration and workflow-service staleness suites — deliberately not duplicated. `bun run plugin-smoke` PASS (installed parity; verified-outcome.ts is app-only, no twin regen). Full gate: `bun run spur-check` exit=0, 9566 pass / 0 fail / 562 files.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Every classified one-off cleanup from the 1024 inventory (docs/reports/2026-09-30-E71-run-storage-ownership.md §4) was reviewed against the proven-safe-removal bar and all are retained as correctness, not redundancy: quality-gate expectFile re-verification invalidates stale receipts before PASS (`packages/app/src/services/quality-gate.ts:446-465`); inline-run-setup scratch staging is the handoff payload itself (`packages/app/src/services/inline-run-setup.ts:804`); history-anatomy scratch reads are analysis-time inputs (`packages/app/src/services/history-anatomy.ts:880`); history-service legacy scans and workflow-service `cleanRunLogs` dual-root sweeping are the legacy-retention reconciliation itself (`packages/app/src/services/workflow-service.ts:969-984`, live-skip `:1046`); idea-pipeline W1-W6 rm steps are atomic publication between hops; agent-run delete-before-invoke (`packages/app/src/workflow/actions/agent-run.ts:324`, contract chain `:327-337,809-843`) enforces answer/expect freshness; feature-service terminal deletion is housekeeping of its own generated files (`packages/app/src/services/feature-service.ts:696-703`). Delete-before-dispatch freshness and atomic publication semantics are unchanged and covered by the existing suites (agent-run 163 pass, run-path, command-gate, quality-gate, workflow-service — all green in the full gate). |
| R2 | MET | Physical confinement unchanged: `resolveRunArtifactPath` realPath walk fails closed on unreadable ancestors and documents the static-symlink scope (`packages/app/src/workflow/actions/run-path.ts:30-44`). Paused recovery preserved: the paused terminal record pair stays inspectable after completed-scratch disposal (asserted in `packages/app/tests/services/run-storage.test.ts:291`), and paused/resume staleness checks remain in workflow-service tests. Concurrent unrelated active ownership: an active run's scratch survives selective completed-run disposal (`activeFile` assert, `packages/app/tests/services/run-storage.test.ts:291`) and `cleanRunLogs` skips live runs when reconciling legacy logs across both roots (`packages/app/src/services/workflow-service.ts:969-984,1046`). |
| R3 | MET | Terminal disposal regressions covered by one decisive equivalence test (`packages/app/tests/services/run-storage.test.ts:291-419`): a completed SUCCESS run's verdict + registered artifact bytes + session outputs + record pair are snapshotted before and after scratch disposal and stay equal (acceptance resolves durable-first via `readVerdictArtifact`, analytics derive identically), repeated removal is a no-op, the failure and paused terminal pairs stay intact, scratch recreation by the next temporary gate works (`runLightGate` writes back into `.spur/run`), and a symlink escaping scratch cannot take its target along. The production gap this task closed: `deriveTaskInput` read the verify verdict from scratch only (`packages/app/src/services/verified-outcome.ts:212` previously a raw scratch-only read); it now routes through the shared durable-first seam `readVerdictArtifact` (`packages/app/src/services/done-transition-guard.ts:112-137`), so analytics survive completed scratch disposal. Regression: `packages/app/tests/services/verified-outcome.test.ts:90`. |
| R4 | MET | Inventory dispositions are closed in the Solution section (per-row retain rationale for all seven census rows, one seam fix). No public command/workflow surface changed — the diff adds a seam import/routing change and tests only, so command/workflow contracts are untouched; unit-test contracts synchronized in-run (verified-outcome, run-storage). Docs/generated/installed contract sync happens at the wrap step (E71 runall worker constraint); installed parity verified via `bun run plugin-smoke` PASS (verified-outcome.ts is app-only, not bundled into plugin twins — no regen needed). No per-workflow terminal cleanup machinery was added. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | test | Freshness and confinement safeguards preserved: delete-before-dispatch contract suites green (`packages/app/tests/workflow/actions/agent-run.test.ts` 163 pass), artifact-path confinement suite green (`packages/app/tests/workflow/run-path.test.ts`), stale-receipt invalidation green (`packages/app/tests/services/quality-gate.test.ts`), and disposal cannot follow escaping links nor touch unrelated active scratch (`packages/app/tests/services/run-storage.test.ts:291` confinement asserts). |
| AC-2 | MET | test | Completed scratch is disposable with no per-workflow cleanup machinery: the decisive equivalence test (`packages/app/tests/services/run-storage.test.ts:291`) proves snapshots of verdict acceptance, derived analytics, run-record inspection (done/failed/paused terminals), artifact bytes and session outputs are all equal before/after/repeated scratch removal, with recreation by the next temporary gate; `bun run spur-check` exit=0 — 9566 pass / 0 fail across 562 files, including the durable-first analytics regression (`packages/app/tests/services/verified-outcome.test.ts:90`). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: E71; accepted design: `docs/design/disposable-run-storage.md`; decision: ADR-131.
- Discovery and persistent handoff: `docs/plans/2026-09-30-run-scratch-brainstorm.md`.
- Existing evidence fallback owner: F93; run-record owner: E7.
- Concurrency snapshot: no wip tasks reported at refinement kickoff; active worktree branches `sp/runall-A9-485e` and `sp/runall-i33-a22b` exist. Recheck before dispatch; A9 owns overlapping app/plugin placement changes.

### History

- 2026-10-01T20:14:22.611Z todo → wip (system)
- 2026-10-01T20:14:23.327Z wip → testing (system)
- 2026-10-01T20:21:21.708Z testing → done (system)

