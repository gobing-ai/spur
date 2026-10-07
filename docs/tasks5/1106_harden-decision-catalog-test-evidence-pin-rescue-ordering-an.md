---
schema_version: 1
name: "Harden decision-catalog test evidence: pin rescue ordering and persisted gate rows"
status: backlog
template: feature-impl
created_at: 2026-10-07T07:09:24.800Z
updated_at: "2026-10-07T07:09:47.683Z"
feature_id: P1

---

## 1106. Harden decision-catalog test evidence: pin rescue ordering and persisted gate rows

### Background

Session review (runall-P1-20261006-02 wrap, 2026-10-07) triaged two report-only P4 review findings from tasks 1098 and 1099 into this task. Not duplicates: both are evidence-hardening gaps, not deferred requirements. No code behavior defect is known.

1. `apps/cli/tests/workflow-decision-scan.test.ts` covers the history-anatomy rescue step's verdicts but does not pin that the rescue shell action fires only AFTER normalization succeeds (ordering contract of `config/workflows/history-anatomy.yaml` second shell action). If the steps were reordered or merged, tests would stay green while the ADR-115 composition deviation loses its guarantee.
2. The gate-evidence fallback event lifecycle is asserted in committed tests via a recording bus only (`packages/app/tests/workflow/decision-gate-catalog.test.ts`); the proof that persisted rows reach `system_events` through the run tap exists only in the gitignored artifact `.spur/run/1099-gate.json` (implementing worktree, now removed). Post-landing, committed coverage should prove persistence, not just in-memory emission.

### Requirements

- [ ] R1. `apps/cli/tests/workflow-decision-scan.test.ts` gains an explicit normalize-then-rescue ordering assertion; reordering either shell action fails the test.
- [ ] R2. A committed test in `packages/app/tests/` asserts evidence-mode gate fallback persists decision rows through the run tap (system_events) with caller `gate` and runId/node correlation — no reliance on gitignored artifacts.

### Acceptance Criteria

- [ ] AC1 — History-anatomy rescue fires only after normalization, pinned by a failing-if-reordered test
- [ ] AC2 — Gate-evidence fallback decision rows are persisted and provable from committed coverage alone

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

- Add an ordering assertion to the scan test: normalize-before-rescue (e.g. assert rescue rows/lifecycle only appear when normalization produced exact-FAIL input, and pin step order from the YAML or an ordered execution double).
- Add a DB-backed test for evidence-mode gate fallback asserting persisted decision rows (caller `gate`, correlation runId/node, fallback lifecycle) via the run tap against in-memory SQLite, mirroring the `.spur/run/1099-gate.json` shape.


Key anchors: rescue step `config/workflows/history-anatomy.yaml:253`; scan test `apps/cli/tests/workflow-decision-scan.test.ts:1`; bus-only lifecycle assertion `packages/app/tests/workflow/decision-gate-catalog.test.ts:245`; gitignored artifact `.spur/run/1099-gate.json` (implementing worktree, removed at cleanup).

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
