---
schema_version: 1
name: Bind feature completion and wrapup to current verification evidence
status: todo
template: standard
created_at: 2026-09-22T02:56:46.299Z
updated_at: "2026-09-23T03:01:29.546Z"
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

The completion boundary consumes a private verification receipt, not the current feature-named PASS text file. Bind the receipt to feature and run identity, selected verifier definition and check command, and a digest of the checked tree and relevant feature/task/doc inputs. Reuse the existing workflow resolver, proof fingerprint, semantic digest, run snapshot and artifact ledger; do not add a public CLI verb, second digest implementation or cache service. The receipt's exact private schema and storage path belong to the workflow contract satellite before implementation.

At verification entry, reuse an unchanged valid receipt; otherwise run the selected verifier and publish a new receipt only after the check and input-stability check pass. Missing, malformed, failed, superseded or cross-feature/run receipts refuse completion. A one-off command override cannot certify the lifecycle's configured check contract. Forward status metadata and generated task/index bookkeeping must be normalized narrowly enough to avoid a completion loop, while source, specifications, authored docs, rework and learning changes still invalidate evidence.

Wrapup must apply relevant doc and learning mutations before final verification. Replay of the same wrapup run must not duplicate learnings or metrics, and a done feature whose inputs changed must re-enter the supported lifecycle before recertification. A partial-feature wrapup remains task-local; it must not trigger an unnecessary feature-wide gate. Keep the existing task proof refusal and canonical transition behavior intact.

Acceptance evidence includes an actual harmless CLI/engine verification run plus focused cases for unchanged reuse, changed input, rework, wrong identity, missing/corrupt/FAIL receipts, mid-check drift and replayed wrapup side effects. Validate source and bundle-only plugin execution, generated script parity, task gates and affected documentation. Implementation files and helper shape are chosen by the coding agent after checking the current 0914 boundary.

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
