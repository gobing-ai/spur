---
schema_version: 1
name: "Lock task-pipeline verification to one immutable proof state"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.554Z
updated_at: "2026-08-28T23:09:17.349Z"
priority: P0
tags: ["harness", "verdict-integrity", "workflow", "proof-state"]
feature_id: A6
ac_altitude: task-local
---

## 0703. Lock task-pipeline verification to one immutable proof state

### Background

The default task pipeline currently runs `/sp:dev-verify --fix all`, derives a verdict, and captures the proof-input fingerprint only after verification. A verifier is therefore allowed to mutate the same repository and task-spec inputs it is certifying. Quality, review, and verification evidence also do not all name one shared digest. The comparison report classifies this as critical because a PASS can describe a mixture of pre-repair and post-repair states rather than one immutable state.

This task closes the proof-chain defect in the existing `task-pipeline.yaml`, `proof.fingerprint` action, verdict artifact, and workflow composition baseline. It must not introduce a second pipeline, proof store, or verification framework.

### Requirements

- [ ] R1. Final verification must be observe-only: the shipped task pipeline invokes `/sp:dev-verify` with `--fix none`, and any write to a proof input during verification fails the run.
- [ ] R2. Capture one canonical proof-input digest before the final quality/review/verification chain and compare it after every stage that claims evidence about that state.
- [ ] R3. Quality-gate, review, and verification evidence must each carry the same digest value; prose asserting that proof is valid is insufficient.
- [ ] R4. Any remediation must occur in the existing bounded repair loop, then re-enter the complete quality -> review -> verify chain with a newly captured digest.
- [ ] R5. `task record` and the done transition must refuse missing, malformed, or mismatched proof-digest evidence.
- [ ] R6. Task-spec writes needed to record evidence occur only after the final digest comparison and must not retroactively invalidate the certified code/spec input set.
- [ ] R7. Update the workflow composition baseline so mutating final verification, missing digest capture, or incomplete digest propagation fails deterministically.
- [ ] R8. Preserve interactive approval, retry bounds, feature sync, existing artifact names where compatible, and the current public CLI surface.

Non-goals: a new cryptographic service, signing keys, remote attestation, a second workflow engine, or an unbounded autonomous repair loop.

### Acceptance Criteria

```gherkin
Feature: Immutable task-pipeline proof state

  Scenario: PASS certifies one unchanged state
    Given a task whose quality gate, review, and read-only verification pass
    When task-pipeline reaches record
    Then all three evidence records name the same proof digest
    And a fresh fingerprint equals that digest
    And the done transition succeeds

  Scenario: Verification cannot repair its own subject
    Given final verification discovers a fixable defect
    When `/sp:dev-verify` runs
    Then it runs with `--fix none` and returns a non-PASS result
    And remediation occurs only through the bounded repair route
    And the full evidence chain reruns against a new digest

  Scenario: Mutation invalidates earlier evidence
    Given quality or review has produced evidence for digest D1
    When a proof input changes before record
    Then fingerprint comparison fails
    And no PASS verdict is recorded or transitioned to done

  Scenario: Baseline rejects regression
    Given a workflow edit restores `--fix all`, moves capture after verify, or omits one stage digest
    When the workflow composition checks run
    Then they fail with the violated proof-chain invariant
```

### Q&A

**Q: Why not keep `--fix all` and capture immediately afterward?** Because the quality and review evidence may describe
the pre-fix state. A final verifier that repairs and certifies in one pass collapses remediation and observation, so the
result is not independently reproducible.

**Q: How many remediation attempts are allowed?** Reuse the pipeline's existing bounded repair/recheck path. This task
must not add an unbounded verifier loop. Every mutation invalidates prior evidence and restarts the complete final chain.

**Q: Is the task Markdown itself part of the proof input?** Yes where it supplies requirements/AC. Recording generated
Testing/Review/Solution evidence happens after the last comparison and must be treated as evidence persistence, not as a
change to the certified requirements. If the current fingerprint cannot distinguish those regions, refine the existing
fingerprint contract rather than excluding the whole task file.

**Q: Does this require signatures or external attestations?** No. The required guarantee is local deterministic state
identity and fail-closed ordering, not non-repudiation.

### Design

**Decision.** Reuse `proof.fingerprint`, the existing verdict JSON, and the composition-baseline gate. Move the authoritative fingerprint capture to the boundary immediately before evidence-producing final checks. Every evidence-producing stage receives or records that digest, and the pipeline compares the live digest before advancing.

**Repair boundary.** Verification never repairs. A FAIL or PARTIAL result may route once through the existing bounded remediation path; the next attempt starts from quality with a new digest. No evidence survives a mutation.

**Evidence contract.** Add a required proof block to the verdict artifact containing the digest, capture point, and the named stage results. Keep the current verdict file as the completion-gate input; do not create a parallel proof manifest unless the existing bounded artifact cannot represent the data.

**Compatibility.** This is an internal workflow/action contract change. Do not add a public CLI noun or flag. Update `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, and ADR status only as required by T3 and the accepted ADR-071 direction.

### Plan

1. Characterize the current state/evidence write set in `task-pipeline.yaml` and add failing composition tests for mutating final verify and late fingerprint capture.
2. Define the smallest verdict proof block that can name one digest across quality, review, and verify.
3. Move fingerprint capture before the final evidence chain and expose the digest to subsequent actions using existing workflow vars.
4. Change final verify to `--fix none`; route repairable failure through the existing bounded fix path rather than editing in verify.
5. Stamp or deterministically derive the shared digest in quality, review, and verification evidence.
6. Compare the digest after each evidence stage and immediately before record/done.
7. Harden verdict loading/completion guards against absent or mismatched proof evidence.
8. Update composition baseline, workflow tests, proof-action tests, and lifecycle drift tests.
9. Synchronize architecture/design documentation in the same commit.
10. Run targeted workflow tests, `bun run spur-check`, and the source-local task gate.

### Root Cause

The defect is ordering, not missing primitives. In `config/workflows/task-pipeline.yaml`, the `verify` state invokes
`/sp:dev-verify ... --fix all`, derives `.spur/run/<wbs>-verdict.json`, and only then captures `proofDigest`.
`record` compares against that late digest. This proves only that the tree did not change between verify exit and
record entry; it cannot prove that the quality gate, review, and verifier observed the same state, and it explicitly
permits the verifier to change its subject before certification.

`packages/app/src/workflow/actions/proof-fingerprint.ts` and
`packages/app/src/workflow/proof-input-fingerprint.ts` already provide deterministic capture/compare behavior. The
composition baseline in `config/workflow-composition-baseline.json` also already classifies action state effects. The
missing invariant is that the final evidence chain starts from one digest, remains observe-only, and propagates that
digest into every evidence record accepted by the completion guard.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — M1 and Wave 0.
- `docs/03_ARCHITECTURE.md` — proof-state invariant and ADR-071 implementation direction.
- `config/workflows/task-pipeline.yaml` — quality, review, verify, record, and done states.
- `config/workflow-composition-baseline.json` — workflow action/state-effect contract.
- `packages/app/src/workflow/actions/proof-fingerprint.ts`
- `packages/app/src/workflow/proof-input-fingerprint.ts`
- `packages/app/src/services/done-transition-guard.ts`
- `packages/app/tests/workflow/actions/proof-fingerprint.test.ts`
- `packages/app/tests/workflow/proof-input-fingerprint.test.ts`
- `packages/app/tests/workflow/composition-baseline.test.ts`
- `packages/domain/tests/planning/lifecycle-drift.test.ts`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
