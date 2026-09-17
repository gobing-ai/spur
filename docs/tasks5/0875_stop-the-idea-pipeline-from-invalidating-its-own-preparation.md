---
schema_version: 1
name: Stop the idea pipeline from invalidating its own preparation evidence
status: done
template: feature-impl
created_at: 2026-09-16T11:04:31.573Z
updated_at: "2026-09-17T18:40:54.941Z"
feature_id: D62

priority: P2
---

## 0875. Stop the idea pipeline from invalidating its own preparation evidence

### Background

Observed on 2026-09-16 in run E03850FB-A672-47BF-BF46-5992C64484CD (the idea-pipeline run that produced this feature). State L `ready-prepare` binds each task's planning digest via `computePlanningDigest` (packages/app/src/services/task-readiness.ts:395). State M `handoff-finalize` then applies `spur task deps` for every task carrying a `depends_on_names` edge (packages/app/src/workflow/idea-handoff.ts:199-216) and only afterwards verifies the recorded digest against the file (idea-handoff.ts:283-296). The digest payload binds frontmatter `dependencies` (task-readiness.ts:405), so the state invalidates the evidence it is about to check: 6 of 9 tasks reported `planning digest stale — task content changed after preparation` with no task content having changed. The operator worked around it by rebinding the digests after deps were applied and re-running finalize, which produced 9/9 READY.

The same ordering makes `handoff-finalize` non-idempotent: a second run over an unchanged corpus reports every dependent task stale, because pass one already wrote the dependencies that pass two's digest now includes.

### Requirements

- [x] R1. A task is never reported `planning digest stale` on account of a frontmatter mutation the pipeline itself applied between binding the evidence and verifying it.
- [x] R2. `handoff-finalize` is idempotent: re-running it against an unchanged corpus reports the same per-task outcome as the first run.
- [x] R3. A genuine post-preparation change to planning content (Background, Requirements, Design, Plan, Acceptance Criteria, Q&A, References, feature_id, template) still moves the digest and still degrades to the refine action.
- [x] R4. The chosen resolution is recorded against `computePlanningDigest`'s contract and its test in packages/app/tests/services/task-readiness.test.ts, which today asserts that dependency membership moves the digest.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @edge
  Scenario: R15 — Preparation evidence survives the pipeline's own deterministic mutations
    Given a planning pipeline that binds a task's preparation digest in one state and mutates that same task's dependency frontmatter in a later state
    When the later state verifies the recorded evidence against the task's current content
    Then the task is not reported stale on account of a mutation the pipeline itself applied
    And re-running the verifying state against an unchanged task reports the same outcome as the first run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Two resolutions were weighed; the implementer picks one and records why.

**A — apply dependencies before the digest is bound.** Move the name→WBS dependency application out of `handoff-finalize` (state M) into the batch-create step (state K), so the frontmatter is final before `ready-prepare` (state L) hashes it. Preserves the current digest contract intact, including its `dependencies` binding. Costs an extracted `applyBatchDependencies()` in packages/app/src/workflow/, a small invoking script beside `idea-handoff-cli.ts`, and a config/workflows/idea-pipeline.yaml state-K edit.

**B — unbind `dependencies` from the digest.** One-line change to the payload in task-readiness.ts:405 plus the test at task-readiness.test.ts:375-379. `computePlanningDigest` has exactly one consumer — `idea-handoff.ts` — and that consumer is also the only writer of the field, so the bound value can never serve as a drift signal there. The ready-checklist already carries a `dependencies` row with its own evidence (`READY_CHECKLIST_IDS`), and `spur task check` validates dependency edges independently, so unbinding does not leave dependency drift unchecked. This also makes the state idempotent for free, satisfying R2 without further work.

B is the smaller and more honest diff; A is the more conservative one. Do not adopt a third option that rebinds the digest inside `handoff-finalize` after applying deps — that would mask every other post-preparation change, violating R3.

### Plan

1. Reproduce: bind a digest, apply `spur task deps`, verify — confirm the false stale verdict, and confirm a second `handoff-finalize` pass reports stale on an unchanged corpus.
2. Choose A or B per the Design and record the reason in the Solution section.
3. Apply the change; update `computePlanningDigest`'s doc comment so the contract it states matches the payload it hashes.
4. Update packages/app/tests/services/task-readiness.test.ts (the dependency-membership assertion encodes the current contract and must move with it) and packages/app/tests/workflow/idea-handoff.test.ts.
5. Add a regression test: deps applied between binding and verification must not produce a stale verdict, and a Requirements edit still must.
6. Run the workspace tests, then `bun run spur-check`.

### Solution

Resolution — Option B (unbind `dependencies` from the digest).

Chose B over A: B is the smaller, more honest diff and satisfies R2 (idempotence)
for free. `computePlanningDigest` has exactly one consumer (`idea-handoff.ts`),
which is also the only writer of the `dependencies` frontmatter, so a bound value
can never signal drift there. Dependency drift stays checked independently by the
ready-checklist `dependencies` row (`READY_CHECKLIST_IDS`) and `spur task check`.
A (move deps application into state K) would preserve the old contract but costs an
extracted batch-dependency step and a pipeline edit for no added drift coverage.
The forbidden third option (rebind digest after deps) would mask every other
post-preparation change, violating R3.

#### Change map

- `packages/app/src/services/task-readiness.ts:389` — updated `computePlanningDigest` doc comment to record that `dependencies` is deliberately unbound (the pipeline applies `spur task deps` between bind and verify).
- `packages/app/src/services/task-readiness.ts:403-410` — removed `dependencies` from the hashed payload; the digest now binds planning sections + `feature_id` + `template` only.
- `packages/app/tests/services/task-readiness.test.ts:375` — dependency-membership assertion now asserts membership does **not** move the digest.
- `packages/app/tests/workflow/idea-handoff.test.ts:211` — regression test: deps applied between binding and verification does not stale; a Background edit still degrades to refine.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-readiness.ts:400-410` re-read: computePlanningDigest payload hashes sections + featureId + template — dependencies absent; idea-handoff.test.ts:211 proves deps applied between bind and verify no longer reports stale. Re-run: `bun test tests/services/task-readiness.test.ts tests/workflow/idea-handoff.test.ts` -> 38 pass / 0 fail (2026-09-17). |
| R2 | MET | Digest invariant to dependency frontmatter (the only post-bind mutation handoff-finalize applies); task-readiness.test.ts:375 asserts dependency membership does not move the digest (passing) — second pass over unchanged corpus computes the same digest. |
| R3 | MET | task-readiness.test.ts:368 (planning-body edits still move the digest) and idea-handoff.test.ts:211 (Requirements edit still degrades to refine) in the passing set. |
| R4 | MET | Unbinding decision recorded in computePlanningDigest's doc comment (task-readiness.ts:388-399, adjacent to re-read anchor); test :375 encodes the new contract. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R15 — Preparation evidence survives the pipeline's own deterministic mutations | MET | test | idea-handoff.test.ts:211 (deps between bind/verify → not stale; Requirements edit → refine) in the 38-test pass re-run 2026-09-17. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Digest unbinding matches Design; contract comment + test updated as required. |
| P4 | secua | — | Genuine edits still degrade to refine — no validation weakening; no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T11:05:18.556Z backlog → todo (system)
- 2026-09-16T20:51:23.267Z todo → wip (system)
- 2026-09-16T21:15:16.312Z wip → testing (system)
- 2026-09-16T21:15:17.681Z testing → done (system)

