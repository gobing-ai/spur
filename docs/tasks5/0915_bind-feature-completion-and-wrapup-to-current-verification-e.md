---
schema_version: 1
name: Bind feature completion and wrapup to current verification evidence
status: todo
template: standard
created_at: 2026-09-22T02:56:46.299Z
updated_at: "2026-09-22T02:57:57.722Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w02
estimate_hours: 8

ac_altitude: task-local
---

## 0915. Bind feature completion and wrapup to current verification evidence

### Background

feature-verification.yaml records PASS in a feature-named status file and feature-lifecycle.yaml consumes it without binding the checked inputs. Wrapup can change documents after earlier verification. Fix this shared completion boundary while preserving task-local versus feature-wide validation. Covers proposed feature R2.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W02 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E8 D1 L2 C1 R1 = 13. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [ ] R1. Record and validate feature verification evidence against feature/run identity, selected verifier definition, check contract and the relevant checked tree/spec inputs.
- [ ] R2. Reject missing, malformed, failed, stale or cross-feature evidence at feature completion and after rework; reuse unchanged valid evidence without an unnecessary full rerun.
- [ ] R3. Order wrapup mutations and feature verification so all relevant final changes are checked; make record/learning operations idempotent where they may replay.
- [ ] R4. Reuse existing proof/digest and artifact services and preserve the existing task lifecycle and independent verification requirements.

### Acceptance Criteria

- [ ] AC1 — A completion fixture accepts a valid receipt only for its bound feature, run, verifier/check contract and input digest. (req: R1)
- [ ] AC2 — Changed relevant inputs, rework, missing/corrupt receipt and FAIL cannot advance feature completion, while unchanged valid evidence is reusable. (req: R2)
- [ ] AC3 — A wrapup document edit is verified before completion, and replay neither duplicates learning entries nor creates a lifecycle-metadata invalidation loop. (req: R3)
- [ ] AC4 — Existing task verification/proof refusal cases and canonical status transitions remain intact, with no second digest implementation. (req: R4)
- [ ] AC5 — Completion uses current evidence (req: R1)

Feature-level traceability: this task delivers D63 scenario R2; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Replace the unbound PASS consumption with a narrow shared receipt-validation boundary; choose its private schema in the owning design satellite before implementation. Fingerprint relevant tracked and dirty inputs, not HEAD alone. Exclude only explicitly defined generated bookkeeping inputs to avoid self-invalidation; exclusions cannot hide source/spec/doc changes protected by the check. Verification should precede the status-only final transition but follow relevant wrapup edits. A lifecycle metadata write must not create a permanent invalidate/recheck loop. Keep feature-verification as a separate workflow and reuse existing proof primitives rather than adding a cache service.

### Plan

- [ ] 1. Trace every writer/reader of feature-verification status and every closure mutation; freeze receipt inputs and lifecycle-metadata exclusions.
- [ ] 2. Implement shared receipt creation/validation and wire verifier, lifecycle and wrapup ordering.
- [ ] 3. Test stale prior PASS, dirty-tree/spec/check changes, wrong feature/run, failed write and repeated unchanged closure.
- [ ] 4. Update owning contracts and affected skills, then run focused checks and the feature-level gate against the final relevant inputs.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
