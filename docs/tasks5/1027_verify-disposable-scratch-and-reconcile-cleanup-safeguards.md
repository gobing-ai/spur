---
schema_version: 1
name: Verify disposable scratch and reconcile cleanup safeguards
status: todo
template: feature-impl
created_at: 2026-09-30T20:13:58.359Z
updated_at: "2026-09-30T20:37:19.660Z"
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

- [ ] R1. Review every classified one-off cleanup and remove only redundancy proven safe, preserving delete-before-dispatch freshness and atomic publication.
- [ ] R2. Preserve physical path confinement, paused recovery and concurrent unrelated active ownership; reconcile existing legacy log cleanup with migrated roots and active-run protection.
- [ ] R3. Add terminal success/failure disposal regressions showing acceptance, analytics, retained inspection and consumer outputs remain equal after completed scratch removal, repeated removal and subsequent recreation.
- [ ] R4. Close the inventory dispositions and synchronize command/workflow/unit-test/docs/generated/installed contracts without per-workflow terminal cleanup machinery.

### Acceptance Criteria

- [ ] AC1 — Temporary handoffs retain freshness and confinement safeguards (req: R1; R2)
- [ ] AC2 — Completed scratch is disposable without per-workflow cleanup machinery (req: R3; R4)

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
