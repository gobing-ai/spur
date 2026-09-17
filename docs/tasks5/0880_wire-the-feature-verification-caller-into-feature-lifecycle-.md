---
schema_version: 1
name: Wire the feature verification caller into feature-lifecycle and drop the settled-tree precondition
status: done
template: feature-impl
created_at: 2026-09-17T17:41:13.462Z
updated_at: "2026-09-17T19:00:53.590Z"
feature_id: D62

---

## 0880. Wire the feature verification caller into feature-lifecycle and drop the settled-tree precondition

### Background

Captured from the creation title: "Wire the feature verification caller into feature-lifecycle and drop the settled-tree precondition".

### Requirements

- Deliver the `feature-verification` caller so a feature whose `verifying→done` guard requires the pass can reach done without a hand-run command (`config/workflows/feature-lifecycle.yaml:71` reads the status file; nothing invokes `feature-verification`).
- Assert the guard's declaration order, not only its kind set.
- Settled-tree precondition (DECIDED: drop) — remove the clause from the contract rather than enforce it; nothing consumes it.

### Acceptance Criteria

- Caller wired and tested (a feature reaches `done` through the guard via the caller).
- Guard-order assertion test.
- Contract clause removed with same-commit doc sync (T3 satellite); `bun run spur-check` green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/tests/feature-verification-scope.test.ts:98` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Caller wired: `config/workflows/feature-lifecycle.yaml:40-45` re-read — verifying onEnter shell runs `$spurBin workflow run feature-verification.yaml --vars {featureId}` (comment names task 0880/ADR-119). R5 caller assertion in feature-verification-scope.test.ts — re-run 6 pass / 0 fail; feature-lifecycle-adapter.test.ts re-run 9 pass / 0 fail (2026-09-17). |
| R2 | MET | Guard declaration-order assertion covered in the feature-verification-scope/feature-lifecycle-adapter suites (passing). |
| R3 | MET | Settled-tree precondition dropped: grep for 'settled' across config/workflows/feature-verification.yaml and docs/design/workflow-execution-economy.md returns nothing this run; both yamls pass `spur workflow validate --json` (ok:true). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC: caller wired and tested | MET | test | feature-verification-scope.test.ts (6 pass) + feature-lifecycle-adapter.test.ts (9 pass) re-run 2026-09-17; verifying→done guard consumes the pass's PASS status file (feature-lifecycle.yaml:71). |
| AC: guard-order assertion test | MET | test | In the passing suites above. |
| AC: contract clause removed with doc sync; spur-check green | MET | command | Clause absent from yaml + design doc (grep, this run). Repo gates this batch: lint+typecheck PASS, test stage 8416 pass / 0 fail, spur-check-feature exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Caller-in-lifecycle design matches ADR-119; clause removal documented same-commit per T3. |
| P4 | secua | — | Fail-closed guard preserved; caller adds no model surface; no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.646Z backlog → todo (system)
- 2026-09-17T18:00:02.206Z todo → wip (system)
- 2026-09-17T18:01:55.132Z wip → testing (system)
- 2026-09-17T18:01:55.818Z testing → done (system)

