---
schema_version: 1
name: Consolidate only proven equivalent history selectors and measures
status: wip
template: feature-impl
created_at: 2026-11-05T20:01:23.919Z
updated_at: "2026-11-07T07:18:34.391Z"
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

- [x] R1. Equivalent analytics definitions are consolidated without changing results; implement the exact Given/When/Then contract below.

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

- [x] 1. Confirm the positive 1309 artifact and source digest before starting; retain blocked status if absent/stale/no-go.
- [x] 2. Write parity tests for predicate strings/parameter order and golden query outputs before extracting the helper.
- [x] 3. Replace the two duplicated time-bound blocks and prove no extra abstraction or route/measure changes.
- [x] 4. Repeat the same golden/timing fixture and report handwritten source delta; retain evidence for differences.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Entry condition was met: `docs/reports/1309-history-parity.json` records schemaVersion 1, candidate `time-range-predicates`, status `go`, and all four source digests match.

- New `packages/domain/src/analytics/selector-time-range.ts:14` exports `buildTimeRangeClauses({since,until},{column,grain})`.
  - Inclusive `>=`/`<=` comparisons; `DATE(?)` for day grain and `strftime('%Y-%m-%dT%H:%M:%SZ', ?)` for timestamp grain.
  - Parameters stay in since-then-until order. Only `null` means no bound.
  - The column must match a fixed `[alias.]identifier` pattern; callers pass only constants.
- `packages/domain/src/analytics/history-board-rollup.ts:723` (`buildRollupWhere`) and `packages/domain/src/analytics/history-board-marts.ts:302` (`dayClauses`) now call the helper for their time bounds only.
  - Source/model/tool/skill predicates and mart/raw routing are untouched. Public query and result types are unchanged.
- `packages/domain/tests/analytics/history-parity-evidence.test.ts` (the 1309 proof) now measures source at the frozen report's `sourceRevision`, using `git show`.
  - The 1309 decision stays reproducible after this consolidation consumed it.
- Emitted SQL is byte-identical to the 1309 predicate vectors, so read latency cannot regress.
- Handwritten source delta: the readers lost 25 lines and gained 7 (`history-board-rollup.ts` +5/−14, `history-board-marts.ts` +2/−11), plus the 31-line helper. The 1309 golden fixture reran unchanged; the 1309 test produced 4 passes with equal cases and predicate vectors.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/selector-time-range.ts:14` single inclusive since/until builder; `packages/domain/src/analytics/history-board-rollup.ts:723` and `packages/domain/src/analytics/history-board-marts.ts:302` call it for time bounds only; `packages/domain/tests/analytics/rollup-equivalence.test.ts:431` incremental rollups byte-identical to full rebuild; `packages/domain/tests/analytics/history-parity-evidence.test.ts:1178` 1309 proof still reproduces at its frozen revision; `.spur/run/1310-focused.junit.xml` 78 tests / 0 failures; domain analytics suite 446 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Equivalent analytics definitions are consolidated without changing results | MET | test | `packages/domain/tests/analytics/selector-time-range.test.ts:31` both bounds keep since-then-until order with the pre-1310 golden predicates; `packages/domain/tests/analytics/selector-time-range.test.ts:49` non-identifier columns refused; `packages/domain/tests/analytics/rollup-equivalence.test.ts:454` seeded off-by-one fails equivalence; mutation `>=`→`>` produced 2 failures and was reverted — pass this session. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:19.395Z todo → blocked (system)
- 2026-11-07T07:07:48.832Z blocked → todo (system)
- 2026-11-07T07:07:49.053Z todo → wip (system)
- 2026-11-07T07:17:04.343Z wip → testing (system)
- 2026-11-07T07:18:34.391Z testing → wip (system)

