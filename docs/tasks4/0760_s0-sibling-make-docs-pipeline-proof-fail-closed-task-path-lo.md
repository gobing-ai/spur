---
schema_version: 1
name: "S0-sibling: make docs-pipeline proof fail-closed (task-path lookup)"
status: todo
template: feature-impl
created_at: 2026-09-03T23:07:43.354Z
updated_at: "2026-09-04T00:01:59.648Z"
feature_id: D9
ac_altitude: task-local
---

## 0760. S0-sibling: make docs-pipeline proof fail-closed (task-path lookup)

### Background

0751's review surfaced three residual findings, consolidated into this single follow-up task:

1. **docs-pipeline carries the same suppressed task-path lookup 0751 R2 removed from
   task-pipeline** — `config/workflows/docs-pipeline.yaml:145` swallows lookup failure
   (`2>/dev/null`, `|| true`, forced `exit 0`), while the resolved `taskSpecPath` folds into the
   docs-pipeline proof digest via `taskFile:` (docs-pipeline.yaml:155, :191), so a silent miss
   degrades the proof to tree-only.
2. **The first R1 rejection assertion in proof-input-fingerprint.test.ts is never awaited**
   (`packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244`) — bun:test may settle
   before the matcher runs, so a regression back to the `''` sentinel could pass vacuously.
3. **Feature D9's acceptance criteria lack gherkin scenarios for proofBinding enforcement
   (0751 R4) and no-new-bypass (0751 R6)** — 0751's verify stage had to cite a companion table
   instead of exact AC labels, which the verify-stage AC-label matching contract expects.

One theme: 0751's fail-closed proof work left one sibling pipeline de-suppressed-late, one test
assertion unenforced, and the feature AC surface incomplete. They ship together as one task
because each is small, they share the 0751 review provenance, and the combined diff is one
reviewable unit.

### Requirements

- [ ] R1. `config/workflows/docs-pipeline.yaml:145` task-path lookup is de-suppressed the same way task-pipeline was in 0751 R2: drop `2>/dev/null`, drop `|| true`, drop the forced `exit 0`; an empty resolved path exits non-zero naming the unresolved task. The resolved `taskSpecPath` folds into the docs-pipeline proof digest via `taskFile:` (docs-pipeline.yaml:155, :191), so a silent miss degrades proof to tree-only.
- [ ] R2. Regression pin mirrors `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-237` for docs-pipeline.
- [ ] R3. No new bypass introduced (0751 R6 semantics).
- [ ] R4. `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244`: the first R1 regression assertion `expect(createGitAlternateTree(...)).rejects.toBeInstanceOf(...)` gains `await` (sibling tests use the awaited `.catch(e => e)` pattern); after the fix the test still fails against pre-0751 code, so the git-failure path stays exercised.
- [ ] R5. Feature D9 acceptance criteria (`docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`) gain gherkin scenarios covering proofBinding enforcement (0751 R4) and no-new-bypass (0751 R6); scenario titles match the verify-stage AC-label matching contract (exact label = scenario title text), so future verify answer files cite exact AC labels instead of a companion table.

### Acceptance Criteria

```gherkin
Scenario: docs-pipeline proof fails closed on unresolved task path
  Given a wbs that does not resolve to a task file
  When the docs-pipeline task-path capture step runs
  Then the step exits non-zero naming the unresolved task
  And no tree-only proof digest is produced

Scenario: the R1 git-failure rejection assertion cannot pass vacuously
  Given pre-0751 fingerprint code with the '' sentinel fallback
  When the proof-input-fingerprint test suite runs
  Then the first git-failure test fails on its awaited rejection assertion

Scenario: D9 verify answers cite exact AC labels for 0751 R4 and R6
  Given the D9 feature acceptance criteria
  When a verify answer cites the proofBinding-enforcement and no-new-bypass scenarios
  Then exact-label matching resolves each citation to a scenario title
```

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

- Task 0751 (S0a: workflow proof fail-closed) — provenance for all three merged findings
- ADR-071 — proof-chain symmetry
- Feature D9 workflow-seam-stabilization-and-proportional-gate-rollout
- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-237` — pin template for R2
- docs/04_DESIGN.md — verify-stage AC-label matching contract

### History
