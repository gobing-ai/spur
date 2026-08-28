---
schema_version: 1
name: "Replace docs-pipeline synthetic PASS with measured verification"
status: todo
template: issue
created_at: 2026-08-28T23:03:05.597Z
updated_at: "2026-08-28T23:09:17.613Z"
priority: P0
tags: ["harness", "verdict-integrity", "workflow", "documentation"]
dependencies: ["0703"]
feature_id: A6
ac_altitude: task-local
---

## 0704. Replace docs-pipeline synthetic PASS with measured verification

### Background

`docs-pipeline.yaml` currently writes a hard-coded `verdict: PASS` artifact in its done state because it does not run semantic verification. The preceding `task check` validates task structure, not whether the documentation satisfies its requirements and acceptance criteria. The artifact is shaped like a normal verification verdict and is accepted by the same completion guard, so downstream consumers cannot distinguish measured evidence from a manufactured success.

The pipeline already has the necessary primitives: `agent.run`, answer-file capture, `spur task verdict`, proof fingerprinting, task checks, and run artifacts. This task composes those primitives into a truthful docs-only completion path without importing the full code quality pipeline.

### Requirements

- [ ] R1. Remove the hard-coded PASS JSON writer from `docs-pipeline.yaml`; no terminal state may manufacture a successful verdict.
- [ ] R2. Add read-only evidence-based verification of the documentation task's Requirements and Acceptance Criteria using the existing verifier answer schema and `spur task verdict`.
- [ ] R3. Keep deterministic `spur task check` as a structural input to verdict derivation; do not treat structural validity as semantic success.
- [ ] R4. Capture and compare the proof-input digest around verification so document or task-spec mutation during certification fails closed.
- [ ] R5. Missing answer files, malformed tables, absent evidence, PARTIAL, FAIL, or a digest mismatch must route to the pipeline's failed state and must not register a PASS artifact.
- [ ] R6. Interactive human docs approval remains an additional gate, never a substitute for measured verification; auto mode skips only HITL.
- [ ] R7. Reuse the normal verdict artifact contract and completion guard. Do not create a weaker docs assurance class or a second verdict schema.
- [ ] R8. Update the workflow composition baseline and negative tests so the synthetic-PASS pattern cannot return.

Non-goals: running the full code quality suite for docs-only work, adding a new public command, or requiring a human reviewer in auto mode.

### Acceptance Criteria

```gherkin
Feature: Truthful docs-only verdicts

  Scenario: Satisfied docs task completes
    Given a docs task whose deliverable satisfies every requirement and AC
    When docs-pipeline runs in auto mode
    Then a read-only verifier produces the standard answer schema
    And `spur task verdict` derives PASS
    And the registered verdict names the unchanged proof digest
    And the task may transition to done

  Scenario: Semantic failure blocks completion
    Given a structurally valid document that fails one acceptance criterion
    When docs-pipeline verifies it
    Then the verdict is non-PASS
    And the run reaches failed
    And no synthetic PASS artifact exists

  Scenario: Malformed evidence fails closed
    Given the verifier omits its verdict line or traceability table
    When verdict derivation runs
    Then it exits non-zero and the task remains non-done

  Scenario: Human approval is additive
    Given interactive profile and a semantically valid draft
    When the operator rejects docs review
    Then the run fails even though automated verification could pass
```

### Q&A

**Q: Should docs-only work run the full code pipeline?** No. It needs the structural task gate plus read-only semantic
verification of the document. Lint/build/test stages remain out unless the task itself requires them.

**Q: Is human docs approval enough?** No. HITL expresses an operator decision and is skipped in auto mode; it is not a
machine-readable requirements/AC traceability result. Interactive approval remains additive.

**Q: Should docs get a separate verdict schema?** No. One standard verdict keeps the completion guard honest. Evidence
rows may identify docs-specific check types, but PASS semantics remain identical.

**Q: What if a task has no meaningful AC?** An implementation-ready docs task must have verifiable requirements/AC. The
pipeline should fail with an actionable task-spec error instead of inventing success.

### Design

Insert a `verify` state between `record` and `done`. The state captures the current proof digest, dispatches `/sp:dev-verify <wbs> --auto --fix none --focus all` with an answer file, derives the standard verdict with `spur task verdict`, compares the digest, and registers the standard `verify-verdict` artifact. Record remains responsible for task narrative/status preparation; done performs only guarded transition and notification.

The verifier must cite the changed documentation and task AC directly. A docs-only evidence tag may describe check type, but it cannot bypass a requirement or AC row. Existing task-check and verdict parsers remain the deterministic gate.

Failure routing is exhaustive: an action-level error, non-PASS verdict, or changed digest reaches `failed`. Keep the current HITL route and task lifecycle semantics.

### Plan

1. Add a failing workflow-definition test that locates the hard-coded PASS writer.
2. Add `verify` state/actions using the existing answer-file and `task verdict` pattern.
3. Add proof fingerprint capture/comparison around the read-only verifier.
4. Move verdict artifact registration out of the synthetic done block and into measured verification.
5. Add explicit PASS/non-PASS transition guards and a terminal failure route.
6. Extend the composition baseline with docs-pipeline evidence requirements.
7. Add negative fixtures for missing answer, malformed answer, unmet AC, and verifier mutation.
8. Update workflow design documentation to state the new measured contract.
9. Run targeted workflow tests, link/format checks, and the source-local task gate.

### Root Cause

`config/workflows/docs-pipeline.yaml` has no verification state. Its `done` state writes a literal JSON object whose
verdict is always PASS, registers that file as `verify-verdict`, and then asks the normal done guard to accept it. The
preceding `spur task check` only establishes corpus structure and lifecycle section completeness. It does not evaluate
whether the delivered document satisfies task requirements or acceptance criteria.

The artifact deliberately mimics the standard verdict shape, so `packages/app/src/services/done-transition-guard.ts`
cannot distinguish it from evidence derived by `spur task verdict`. The root cause is therefore an equivalence error in
the workflow: structural readiness and optional human approval are represented as semantic verification.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `docs/report/2026-08-28-harness-engineering-playbook-vs-spur.md` — M2 and Wave 0.
- `config/workflows/docs-pipeline.yaml` — current synthetic verdict writer.
- `config/workflows/task-pipeline.yaml` — existing answer-file and `task verdict` composition pattern.
- `docs/design/workflow-shell-ownership.md` — current docs-pipeline ownership description.
- `packages/app/src/services/done-transition-guard.ts`
- `apps/cli/src/commands/task.ts` — `task verdict` and done transition.
- `packages/app/tests/workflow/composition-baseline.test.ts`
- `config/workflow-composition-baseline.json`
### History
- 2026-08-28 — created from the approved harness comparison implementation lane; researched, decomposed, linked to A6, and passed the task-local readiness gate.
