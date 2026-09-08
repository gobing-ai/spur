---
schema_version: 1
name: "0806 session-review follow-ups: job-queue coverage gaps and event-catalog drift"
status: done
template: issue
created_at: 2026-09-08T18:13:10.914Z
updated_at: "2026-09-08T18:52:35.782Z"
feature_id: A2

priority: P2
ac_numbering: task-local
ac_altitude: task-local
---

## 0807. 0806 session-review follow-ups: job-queue coverage gaps and event-catalog drift

### Background

Follow-ups surfaced by the post-0806 session review (`sp-dev-review-session --triage`, 2026-09-08).
Task 0806 itself is done, merged (669ab7819) and verified; the review doc fix it forced
(`docs/design/event-tracking.md` catalog renumber + count literals) landed separately as 5bdc88fde
and is excluded here. Three actionable items remain unowned:

1. Review P2 (coverage): the `rollup-refresh-failed` branch in
   `packages/app/src/services/history-service.ts:920-930` has no test.
2. Review P2 (coverage): handler↔guard exclusive-key integration
   (`job-exclusion-guard.ts` ↔ jobs handler enqueue path) is covered only indirectly.
3. Pre-existing doc drift from A6 (e587721be): `workflow.escalation.created` and
   `workflow.escalation.projection_failed` exist in the code catalog
   (`packages/app/src/services/event-names.ts`, BASE_CATALOG) but have no rows in
   `docs/design/event-tracking.md` §4 — the two-sided contract in doc §9 is only a
   recommendation, so nothing fails today.

### Requirements

#### R1

Add a unit test exercising the `rollup-refresh-failed` failure path of
`packages/app/src/services/history-service.ts:920-930` (assert emitted event and state outcome).
AC: test fails if the branch is removed or its event/payload regresses; root suite green.

#### R2

Add an integration test that enqueues two jobs with the same `exclusiveKey` through the jobs
handler and asserts the second is rejected by `job-exclusion-guard.ts` with the loud failure.
AC: test fails if the guard is bypassed at the handler layer; root suite green.

#### R3

Add §4 matrix rows for `workflow.escalation.created` and `workflow.escalation.projection_failed`
(5W1H scores per source profile, emitter `path:line`) and re-verify catalog↔matrix two-sided
equality plus strict 1..N sequence and count literals (72 → 74).

### Acceptance Criteria

- [x] R1: `rollup-refresh-failed` branch covered by a test that fails without the branch behavior.
- [x] R2: duplicate-`exclusiveKey` enqueue through the handler is asserted to be rejected by the guard.
- [x] R3: §4 has rows for both `workflow.escalation.*` events; catalog↔matrix names equal; sequence strict 1..N; count literals updated.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/services/history-refresh-service.test.ts:18` |
| `packages/app/tests/services/history-refresh-service.test.ts:481` |
| `packages/app/tests/services/history-service.test.ts:1444` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:263` |
| `packages/app/tests/services/scheduler-custom-job-service.test.ts:4` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/tests/services/history-service.test.ts:1445-1464 — schema-version drift forces refreshHistoryRollups rejection; asserts failed marker + rollup-refresh-failed warning (fresh pass) |
| R2 | MET | packages/app/tests/services/scheduler-custom-job-service.test.ts:267-315 overlapping producers rejected naming owner, no second spawn; mirror packages/app/tests/services/history-refresh-service.test.ts:482-501 (fresh pass) |
| R3 | MET | docs/design/event-tracking.md:91-92 §4 rows 47/48; sequence strict 1..74 (awk-verified); catalog↔matrix names two-sided equal (74/74); count literals 72 → 74; tally recomputed (all dimensions sum 74) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1: `rollup-refresh-failed` branch covered by a test that fails without the branch behavior | MET | test | packages/app/tests/services/history-service.test.ts:1445-1464 (fresh pass) |
| R2: duplicate-`exclusiveKey` enqueue through the handler is asserted to be rejected by the guard | MET | test | packages/app/tests/services/scheduler-custom-job-service.test.ts:267-315; packages/app/tests/services/history-refresh-service.test.ts:482-501 (fresh pass) |
| R3: §4 has rows for both `workflow.escalation.*` events; catalog↔matrix names equal; sequence strict 1..N; count literals updated | MET | command | awk/diff verification: sequence strict 1..74 OK; matrix names == baseEvent catalog names (74/74 two-sided); literals updated 72 → 74 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | task-check | — | spur task check 0807 exit 0 |
| P4 | tests-pass | — | affected suites 111 pass / 0 fail (history-service, scheduler-custom-job-service, history-refresh-service, job-exclusion-guard); root suite result recorded in Testing |
| P4 | lint-clean | — | biome check --write fixed import order in 2 test files; re-check clean |
| P4 | evidence-rule-pass | — | All 3 AC rows carry test/command evidence run this run |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-09-08T18:38:39.203Z todo → wip (system)
- 2026-09-08T18:50:29.175Z wip → testing (system)
- 2026-09-08T18:52:35.782Z testing → done (system)

