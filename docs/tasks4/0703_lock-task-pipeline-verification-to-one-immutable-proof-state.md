---
schema_version: 1
name: "Lock task-pipeline verification to one immutable proof state"
status: done
template: issue
created_at: 2026-08-28T23:03:05.554Z
updated_at: "2026-08-29T20:47:31.163Z"
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

- [x] R1. Final verification must be observe-only: the shipped task pipeline invokes `/sp:dev-verify` with `--fix none`, and any write to a proof input during verification fails the run.
- [x] R2. Capture one canonical proof-input digest before the final quality/review/verification chain and compare it after every stage that claims evidence about that state.
- [x] R3. Quality-gate, review, and verification evidence must each carry the same digest value; prose asserting that proof is valid is insufficient.
- [x] R4. Any remediation must occur in the existing bounded repair loop, then re-enter the complete quality -> review -> verify chain with a newly captured digest.
- [x] R5. `task record` and the done transition must refuse missing, malformed, or mismatched proof-digest evidence.
- [x] R6. Task-spec writes needed to record evidence occur only after the final digest comparison and must not retroactively invalidate the certified code/spec input set.
- [x] R7. Update the workflow composition baseline so mutating final verification, missing digest capture, or incomplete digest propagation fails deterministically.
- [x] R8. Preserve interactive approval, retry bounds, feature sync, existing artifact names where compatible, and the current public CLI surface.

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

Single YAML composition change (ordering), one baseline merge, one invariant test, four doc surfaces. No TypeScript production code changed — `proof.fingerprint` / `proof-input-fingerprint.ts` / `task verdict` already provided the primitives (task Root Cause: ordering, not missing primitives).

| File | What / why |
| --- | --- |
| `config/workflows/task-pipeline.yaml:88-100` (vars comment) | Proof-bracket contract rewritten: canonical capture at quality-gate entry, re-capture on remediation, observe-only verify (R1/R2/R4). |
| `config/workflows/task-pipeline.yaml:316-333` (test.onEnter) | Added taskpath-resolve shell + `file.read.into-var` + canonical `proof.fingerprint` capture BEFORE the gate shell; gate shell stamps `proof-digest:` into the gate log (R2/R3). |
| `config/workflows/task-pipeline.yaml:372-401` (test-fix.onEnter) | Projects existing verify verdict into the gate log as remediation input (R4 hop becomes the single repair route). |
| `config/workflows/task-pipeline.yaml:407-413` (test-recheck.onEnter) | Added `proof.fingerprint` re-capture of `proofDigest` before the recheck gate — re-entered chain certifies a fresh state (R4). |
| `config/workflows/task-pipeline.yaml:470-520` (verify.onEnter) | `--fix all` → `--fix none` (R1); added midpoint `proof.fingerprint expect=${vars.proofDigest}` compare (R2); removed late capture (4 actions → 4 actions: compare, agent, verdict, proof-block stamp with `stages.{qualityGate,review,verification}.digest` + `proof-input-digest` checks row) (R3). |
| `config/workflows/task-pipeline.yaml:549-560` (record.onEnter:0 comment) | Compare documented as closing the pre-chain bracket (R6: evidence writes after compare; fingerprint scopes to proof-input sections). |
| `config/workflows/task-pipeline.yaml:700-745` (transitions) | `verify→record` guard: PASS + `.proof.digest` + all three stage digests == `$proofDigest`; NEW `verify→test-fix` bounded edge (verdict non-PASS + attempt < `qualityGateMaxFixAttempts`); `verify→failed` and `record→failed` became `always` catch-alls (R4/R5 termination defense); `record→done` guard adds `.verdict=PASS` + `.proof.digest` re-assertion (R5). |
| `config/workflow-composition-baseline.json` | Regenerated `task-pipeline` action facts (30 actions) with carried/derived effect annotations; pins `--fix none` so a regression fails deterministically (R7). |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (new) | 6 structural invariants: observe-only invocation, capture ordering + remediation re-capture, proof-block shape, fail-closed guards, bounded remediation route, baseline pin. |
| `docs/00_ADR.md` (ADR-071 amendment 2) | Task-pipeline half marked built; docs-pipeline half (0704) remains open. |
| `docs/03_ARCHITECTURE.md` §20.3 | "live action is --fix all" paragraph replaced with the implemented flow (midpoint compare, `--fix none`, bounded hop, proof block, fail-closed guards). |
| `docs/04_DESIGN.md` §7.5 | Vars list (+`taskSpecPath`/`proofDigest`/`proofDigestNow`), verify mapping, completion gate, done gate, D5-transition status updated. |
| `docs/design/workflow-composition-contract.md` §Verification proof state | "cannot claim this proof state" replaced with implemented contract + baseline pin. |

Rationale: the shipped digest capture previously sat at verify-exit, so the verifier (`--fix all`) could mutate the very inputs it certified and earlier evidence could describe a different state. Moving the capture before the evidence chain, making the verifier observe-only, routing remediation through the existing bounded `test-fix`/`test-recheck` loop with a fresh capture, and failing the completion guards closed on the proof block yields one immutable certified state per PASS with zero new engine code.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `config/workflows/task-pipeline.yaml:482` (`input: /sp:dev-verify ${vars.wbs} --auto --fix none --focus all`) + midpoint expect-compare `config/workflows/task-pipeline.yaml:472-475` fails the run on any proof-input mutation; test `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (observe-only invocation) passed this run (6/6). |
| R2 | MET | Canonical capture before the chain at `config/workflows/task-pipeline.yaml:324-328` (test.onEnter), re-capture at remediation `config/workflows/task-pipeline.yaml:410-413`, midpoint compare `:472-475`, record compare `:560-563` — captured live this run: digest `sha256:0503223560f2dfe8f671efd981716d2a2d67954566b52ca052a4818f08903d36` recomputed and matched post-recheck. |
| R3 | MET | Proof-block stamp sets `stages.{qualityGate,review,verification}.digest = $proofDigest` (`config/workflows/task-pipeline.yaml:511-519` region); `verify→record` guard asserts all four equalities `config/workflows/task-pipeline.yaml:775-787`; test (proof-block shape) passed. |
| R4 | MET | Bounded edge `verify→test-fix` `config/workflows/task-pipeline.yaml:788-800` (non-PASS + attempt < `qualityGateMaxFixAttempts`) + `test-recheck` fresh capture `:407-413`; exercised live this run (attempt 1/2, gate FAIL → fix → recheck PASS → fresh digest). |
| R5 | MET | `verify→record` guard requires `.verdict=PASS` + `.proof.digest == $proofDigest` `config/workflows/task-pipeline.yaml:778-787`; `verify→failed` / `record→failed` `always` catch-als fail closed on missing/malformed evidence `:801-808`, `:823-827`; `record→done` re-asserts PASS + digest `:813-822`; test (fail-closed guards) passed. |
| R6 | MET | `record.onEnter:0` compare precedes all evidence writes `config/workflows/task-pipeline.yaml:549-563`; fingerprint scopes task content to proof-input sections (Background/Requirements/AC/Design/Plan) per vars comment `:88-92` and `packages/app/src/workflow/proof-input-fingerprint.ts` (pre-existing primitive, unchanged). |
| R7 | MET | `config/workflow-composition-baseline.json` regenerated with per-action facts (e.g. `precheck:onEnter:0…`) and pins `--fix none` (verified in JSON this run); test "baseline pins the observe-only invocation (R7)" passed; composition checks run green in the quality gate this session. |
| R8 | MET | `hitl.confirm`/approve edge present (review→approve), `feature-sync-bounded` retained in record (`config/workflows/task-pipeline.yaml:580-592`), attempt counter + max bound preserved, artifact names (`.spur/run/$wbs-test-gate.*`, `-verify-answer.txt`, `-verdict.json`) unchanged; zero diffs under `packages/cli` + `apps/cli` vs `main` (public CLI surface untouched). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Scenario: PASS certifies one unchanged state | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (6 pass) + guards `config/workflows/task-pipeline.yaml:775-787`, `:813-822`; fresh fingerprint matched canonical digest this run. |
| Scenario: Verification cannot repair its own subject | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (6/6 pass this run) asserts the `--fix none` pinning (R1 case, line 43) and the bounded remediation route (R4 case); anchors: `--fix none` invocation `config/workflows/task-pipeline.yaml:482`, bounded route `:788-800`; this verify ran observe-only. |
| Scenario: Mutation invalidates earlier evidence | MET | command | Midpoint compare fired live this session: `bun .spur/run/lib/proof-digest.ts --task-file <spec> --expect sha256:5bb3…` exited 1 after remediation mutated the tree (drift detected before verify; fresh capture restored the bracket). Guard source: `config/workflows/task-pipeline.yaml:472-475`. |
| Scenario: Baseline rejects regression | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` asserts the baseline pins (`--fix none`, action facts) — passed this run; baseline JSON pins verified directly. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
| ---------- | ----------- | ---------- | ---------- |
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:0503223560f2dfe8f671efd981716d2a2d67954566b52ca052a4818f08903d36 |

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
- 2026-08-29T19:31:00.620Z todo → wip (system)
- 2026-08-29T20:47:30.635Z wip → testing (system)
- 2026-08-29T20:47:31.163Z testing → done (system)
