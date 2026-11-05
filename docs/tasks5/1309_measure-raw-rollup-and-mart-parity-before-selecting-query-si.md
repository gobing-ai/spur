---
schema_version: 1
name: Measure raw rollup and mart parity before selecting query simplification
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.919Z
updated_at: "2026-11-05T20:40:02.980Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: E94
priority: P3
tags:
  - simplification-2026-11
  - w7
  - conditional
estimate_hours: 6

dependencies: []
---

## 1309. Measure raw rollup and mart parity before selecting query simplification

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W7; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature E94: History parity evidence decides whether consolidation is justified.

Owned surfaces/callers/fixtures/config/docs: packages/domain/src/analytics/history-board-rollup.ts and history-board-marts.ts; packages/app/src/services/history-board-service.ts; current analytics fixture/benchmark tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- This evidence task can run now on disposable seeded fixtures; W6 output is not a functional dependency. Freeze one candidate for its downstream task instead of leaving candidate selection to that implementer.
- Verified source seams: `packages/domain/tests/analytics/rollup-equivalence.test.ts:35`; `packages/domain/src/analytics/history-board-rollup.ts:711`; `packages/domain/src/analytics/history-board-marts.ts:300`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. History parity evidence decides whether consolidation is justified; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Measure raw rollup and mart parity before selecting query simplification

  Scenario: AC1 — History parity evidence decides whether consolidation is justified (req: R1)
    Given duplicate imports, unknown usage, midnight boundaries, filter combinations and stale-watermark fixtures
    When raw, rollup and mart results and seven-day and all-history workloads are compared
    Then a repeatable artifact records semantic differences, latency, versions and an explicit go or no-go recommendation
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:17.909Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Keep backlog until W6 measurements are available; this task gathers evidence only. Its go/no-go recommendation is reviewed before scheduling analytics consolidation.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:09.572Z

Closed: evidence work is runnable without W6. Preserve 1310 as blocked pending an explicit positive artifact.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Evidence-only production mutationPolicy none. Candidate is ONLY duplicated lower/upper time-bound predicate assembly in buildRollupWhere and dayClauses; do not claim whole queries are equivalent. Seed 48 hours spanning UTC midnight with source/model/tool/skill data, duplicate imports, null measures and both fresh/stale watermarks. Compare old outputs for daily and subdaily requests, null/lower-only/upper-only/both bounds and same/cross-dimension filters. Reuse rollup-equivalence integer-exact and allocated-token 1e-9 relative tolerance. Artifact docs/reports/1309-analytics-parity.md plus JSON contains schemaVersion:1,candidate:"time-range-predicates",status:"go"|"no-go"|"inconclusive",cases,toolVersions,timings,reason. Two warmups and nine measured sequential reads per seven-day/all-history fixture; no real history. Go requires semantic parity and a smaller handwritten predicate surface; inconclusive/no-go leaves 1310 blocked. Both report formats must include sourceRevision (git HEAD), sourceDigests (SHA-256 keyed by each inspected source path), fixture seed and repeatable command; the downstream task rejects evidence if a named source digest changes, even on the same HEAD.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1310 accepts only the fixed candidate artifact above; artifact completion is not automatically a go decision.

#### Boundaries and verification

(cd packages/domain && bun test tests/analytics/rollup-equivalence.test.ts tests/analytics/history-board-rollup.test.ts); (cd packages/app && bun test tests/services/history-board-service.test.ts). Add a fixture evidence test and publish golden predicate vectors.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write fixture cases and expected selector/parameter output first; keep production SQL unchanged.
- [ ] 2. Run old raw/rollup/mart paths only on semantically comparable requests and record noncomparable cases explicitly.
- [ ] 3. Capture timing/row counts/environment and produce the fixed candidate decision artifact with reproducible commands.
- [ ] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:17.620Z todo → blocked (system)
- 2026-11-05T20:38:10.158Z blocked → todo (system)

