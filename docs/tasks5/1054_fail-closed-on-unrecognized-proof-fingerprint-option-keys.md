---
schema_version: 1
name: Fail closed on unrecognized proof.fingerprint option keys
status: todo
template: feature-impl
created_at: 2026-10-02T17:06:35.732Z
updated_at: "2026-10-02T17:07:30.926Z"
feature_id: D64

---

## 1054. Fail closed on unrecognized proof.fingerprint option keys

### Background

Session review of run c88b0ef3 (task 1048): the test-exit emulation invoked ProofFingerprintActionRunner.execute with legacy option keys (gitDiffSummary, gitLogHashObject). The real signature ({cwd, taskContent, featureContent, learningsContent}) silently ignored them and computed a digest over a DIFFERENT input set (sha256:23e9cdf3…) than the faithful one (sha256:4e767363…), which the verify loop only caught by manual re-derivation. Unknown option keys fail open today — proof-fingerprint.ts execute() and readProofInputContents() never reject unrecognized keys.

### Requirements

- [ ] R1. proof.fingerprint (ProofFingerprintActionRunner.execute) rejects unknown option keys with an actionable error naming the unexpected key(s) and the accepted key set; proof-bound run.artifact inherits the same strictness through its options pass-through.
- [ ] R2. Known-optional keys (taskFile, featureFile) stay optional; empty-string/whitespace keys are treated as absent, matching current readProofInputContents behavior.

### Acceptance Criteria

AC1. execute({var:"d", gitDiffSummary:"x", …}) returns ok:false naming gitDiffSummary as unexpected (before this fix it returned a silently-different digest).
AC2. Existing fingerprint tests pass unchanged; one new test pins the fail-closed behavior.

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

- 2026-10-02T17:07:15.137Z backlog → todo (system)

