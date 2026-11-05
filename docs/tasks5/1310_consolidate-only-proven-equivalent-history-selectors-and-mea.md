---
schema_version: 1
name: Consolidate only proven equivalent history selectors and measures
status: blocked
template: feature-impl
created_at: 2026-11-05T20:01:23.919Z
updated_at: "2026-11-05T20:38:12.259Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: E94
priority: P3
tags:
  - simplification-2026-11
  - w7
  - conditional
estimate_hours: 8

dependencies: ["1309"]
---

## 1310. Consolidate only proven equivalent history selectors and measures

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W7; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature E94: Equivalent analytics definitions are consolidated without changing results.

Owned surfaces/callers/fixtures/config/docs: only the exact raw/rollup/mart query definitions and callers selected by the parity evidence task; existing analytics golden fixtures and architecture owner.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The previous design allowed an unknown future consolidation target. Freeze only the existing duplicated time bounds and exclude token aggregates/filter routing.
- Verified source seams: `packages/domain/src/analytics/history-board-rollup.ts:711`; `packages/domain/src/analytics/history-board-marts.ts:300`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Equivalent analytics definitions are consolidated without changing results; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Consolidate only proven equivalent history selectors and measures

  Scenario: AC1 — Equivalent analytics definitions are consolidated without changing results (req: R1)
    Given a recorded go decision naming equivalent measures and selectors
    When the selected definitions are consolidated and the old duplicate path is removed
    Then golden results and fallback semantics remain equal and measured latency and maintenance cost do not regress
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:19.688Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Requires an explicit recorded go decision identifying equivalent definitions and a net maintenance benefit; implementation remains backlog until then.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:11.967Z

Deferred with explicit owner: task 1309 provides the go/no-go artifact. Implementation shape is frozen; scheduling remains blocked until a go exists.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. The only scheduling gate is the explicitly named prerequisite artifact; remain blocked until its current positive result exists.

### Design

#### Frozen implementation contract

Conditional implementation with no unresolved API choice: new internal analytics/selector-time-range.ts exports buildTimeRangeClauses({since,until},{column,grain:"day"|"timestamp"}):{clauses:string[],params:unknown[]}. Validate column/alias through fixed caller-owned constants, not user identifiers. Preserve DATE(?) for day grain, strftime conversion for timestamp grain, inclusive comparison and parameter order exactly. Replace just time-bound branches in buildRollupWhere/dayClauses; leave source/model/tool/skill predicates and mart/raw routing untouched. Entry condition: read 1309 decision JSON, require schemaVersion1/candidate time-range-predicates/status go and matching source revision/digests. Any other result stays blocked with evidence, not a speculative implementation. No generic SQL builder, new package, renamed scenario or changed analytics measure.

#### Dependencies and handoff

Direct prerequisites: 1309. 1309 must deliver a current positive decision for this exact candidate; its done status alone is insufficient.

Output/handoff: No changes to public query/result types or read-path selection.

#### Boundaries and verification

(cd packages/domain && bun test tests/analytics/rollup-equivalence.test.ts tests/analytics/history-board-rollup.test.ts); add selector-time-range tests. Use exact integer/null equality and existing 1e-9 allocated-token tolerance.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Confirm the positive 1309 artifact and source digest before starting; retain blocked status if absent/stale/no-go.
- [ ] 2. Write parity tests for predicate strings/parameter order and golden query outputs before extracting the helper.
- [ ] 3. Replace the two duplicated time-bound blocks and prove no extra abstraction or route/measure changes.
- [ ] 4. Repeat the same golden/timing fixture and report handwritten source delta; retain evidence for differences.
- [ ] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:19.395Z todo → blocked (system)

