---
schema_version: 1
name: "Close 1047 review findings: server bookkeepingError surfacing, publication regression test, record-replay testability"
status: backlog
template: feature-impl
created_at: 2026-10-02T17:28:56.460Z
updated_at: "2026-10-02T17:29:44.727Z"
feature_id: D62

---

## 1055. Close 1047 review findings: server bookkeepingError surfacing, publication regression test, record-replay testability

### Background

Review of task 1047 (verdict PASS, run 2f720cbc) approved with three open findings on the terminal-write reconciliation seam, recorded in `.spur/run/2f720cbc-7e9f-40c2-98cf-af32ed9a01a6-review-answer.txt`:

1. **P3 — server transport drops `bookkeepingError`** (`apps/server/src/context.ts` tasks handlers, ~lines 97-103): the CLI reports reconciliation `bookkeepingError` on terminal writes, the HTTP seam swallows it — clients cannot observe post-commit bookkeeping failure even though the reconciliation replay contract (R3) expects callers to report it.
2. **P3 — failed-file-publication regression test absent**: the promised regression test for the failed-publication path of `reconcileExistingLifecycleRow` (structural ordering: file lands terminal, publication fails, run stays repairable via replay) was never written; only structural ordering in production code covers it.
3. **P4 — server `TaskServiceImpl` lacks injectable `getDb`**: a future server-side `record()` already-terminal replay would silently skip reconciliation; testability of the seam currently blocks proving it.

Direct-fix residue from the same review: the `lifecycle-adapter.ts` doc comment overstatement was corrected inline in this session (repair semantics of non-matching rows now stated accurately; commit `docs(app)` alongside these task files).

### Requirements

- R1: The server tasks handlers seam surfaces (or at minimum logs at error level) the `bookkeepingError` from terminal task writes instead of silently dropping it; behavior mirrors the CLI's post-commit report path.
- R2: A regression test proves the failed-publication ordering for `reconcileExistingLifecycleRow`: when the task file reaches a terminal status but the run finalize write fails, a re-driven terminal write repairs the existing run row via replay (1047 R3), without reseed or transition requests.
- R3: Server `TaskServiceImpl` accepts an injectable `getDb` (matching the CLI surface) so the already-terminal `record()` replay path is testable; a test asserts the replay calls reconciliation.

### Acceptance Criteria

- [ ] AC1: R1 — server handler test proves the error surface/log row; evidence `test+static-ref`
- [ ] AC2: R2 — regression test fails on reverting the replay-repair branch and passes on current main; evidence `test`
- [ ] AC3: R3 — DI present on server TaskServiceImpl and replay test green; evidence `test+static-ref`

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
