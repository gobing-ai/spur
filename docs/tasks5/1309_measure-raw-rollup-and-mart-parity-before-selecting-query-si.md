---
schema_version: 1
name: Measure raw rollup and mart parity before selecting query simplification
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.919Z
updated_at: "2026-11-06T08:07:36.683Z"
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
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1309-verdict.json
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

- [x] R1. History parity evidence decides whether consolidation is justified; implement the exact Given/When/Then contract below.

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


#### Repo gate conventions

The post-check preset requires a TSDoc comment on every exported symbol (`every-export-has-tsdoc`),
and per-file line and function coverage must stay at or above 90%. Give each new export a doc
comment and exercise every new branch before reporting done.

### Plan

- [x] 1. Write fixture cases and expected selector/parameter output first; keep production SQL unchanged.
- [x] 2. Run old raw/rollup/mart paths only on semantically comparable requests and record noncomparable cases explicitly.
- [x] 3. Capture timing/row counts/environment and produce the fixed candidate decision artifact with reproducible commands.
- [x] 4. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

Evidence only. Production SQL is unchanged. The candidate is the duplicated lower/upper time-bound assembly in `buildRollupWhere` and `dayClauses`. Whole queries are not treated as equivalent. Status is `go` for that candidate. Task 1310 stays blocked.

`packages/domain/tests/analytics/history-parity-evidence.test.ts:129` compares measures with null distinct from zero, exact integers, and the 1e-9 allocated-token tolerance copied from the rollup equivalence suite.
`packages/domain/tests/analytics/history-parity-evidence.test.ts:143` diffs message-grain model and source totals.
`packages/domain/tests/analytics/history-parity-evidence.test.ts:173` returns `go`, `no-go`, or `inconclusive` from completeness, comparable differences, and surface size.
`packages/domain/tests/analytics/history-parity-evidence.test.ts:224` counts the handwritten `since`/`until` blocks against an unshipped `timeBoundClauses` helper plus two call sites. This run measured 20 current lines and 15 proposed lines.
`packages/domain/tests/analytics/history-parity-evidence.test.ts:369` seeds the 48-hour in-memory fixture (duplicate import, null measures, unknown model, midnight boundary, fresh then stale watermark).
`packages/domain/tests/analytics/history-parity-evidence.test.ts:601` runs the old raw, rollup, and mart reads only when the date predicate and the raw instant predicate select the same rows.
`packages/domain/src/analytics/history-board-rollup.ts:724` and `packages/domain/src/analytics/history-board-marts.ts:300` are the measured assemblies. They were read and hashed, and left as they are.
`docs/reports/1309-analytics-parity.md:5` and `docs/reports/1309-analytics-parity.json:4` record `status: go`, source revision `2f63548bb9239b84925f640ed68d80ddb5c5a111`, source digests, predicate vectors, cases, timings, and the regenerate command. Comparable cases `bounds-null`, `bounds-both-day-aligned`, `grain-daily`, and `filter-same-dimension` have empty differences. Mid-day bounds, subdaily grain, cross-dimension filters, tool and skill filters, and the stale watermark are recorded as noncomparable.

No authority document in `docs/00`–`docs/05` or `docs/99` changed: no mechanism, public surface, or governance fact changed. The evidence owner is the report pair above.

probe: not-applicable (no public surface changed)

Light gate post-check is still red. `coverage-provenance-check` reports a stale tree for the three new paths and names `bun run test:full` as the recovery. That full suite belongs to the pipeline gate, so this implement pass did not run it. Format, pre-check, domain typecheck, and the evidence test passed inside `task gate 1309 light`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/tests/analytics/history-parity-evidence.test.ts:173-201` returns go only when comparable differences are zero and the proposed surface is smaller; `docs/reports/1309-analytics-parity.json:3-4` records candidate time-range-predicates and status go; `docs/reports/1309-analytics-parity.md:45-49` shows empty differences on the comparable daily cases. Focused check in packages/domain, `bun test packages/domain/tests/analytics/history-parity-evidence.test.ts`, exited 0 with 4 pass and 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — History parity evidence decides whether consolidation is justified (req: R1) | MET | test | `packages/domain/tests/analytics/history-parity-evidence.test.ts:369-489` seeds duplicate import, null measures, unknown model, midnight boundary, and fresh then stale watermark; `packages/domain/tests/analytics/history-parity-evidence.test.ts:601-660` compares raw, rollup, and mart on comparable daily requests; `packages/domain/tests/analytics/history-parity-evidence.test.ts:691-710` records two warmups and nine sequential reads; `docs/reports/1309-analytics-parity.md:5-9` records status go, source revision, tool versions, and the regenerate command. The same focused check exited 0 with 4 pass and 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1309

**Scope:** working tree (no `(1309)` commit): `packages/domain/tests/analytics/history-parity-evidence.test.ts`, `docs/reports/1309-analytics-parity.md`, `docs/reports/1309-analytics-parity.json`
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
Confidence: MEDIUM

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | correctness | No P1-P3 defects. Comparable daily cases match, and the go decision covers only the duplicated time-bound assemblies. Cases grain-subdaily, filter-cross-dimension, filter-tool, and filter-skill record selectedCounts of zero without executing those reads; the mart filter cut line and the service summary path are at `packages/domain/src/analytics/history-board-marts.ts:75-80` and `packages/app/src/services/history-board-service.ts:942-950`. Production SQL is outside the diff. Task 1310 remains blocked. | `packages/domain/tests/analytics/history-parity-evidence.test.ts:1044` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/tests/analytics/history-parity-evidence.test.ts:173-201` returns go only when comparable differences are zero and the proposed surface is smaller; `docs/reports/1309-analytics-parity.json:3-4` records candidate time-range-predicates and status go; `docs/reports/1309-analytics-parity.md:45-49` shows empty differences on the comparable daily cases. Focused check in packages/domain, `bun test tests/analytics/history-parity-evidence.test.ts`, exited 0 with 4 pass and 0 fail. |

**Next:** keep 1310 blocked; its scheduling gate is separate from this evidence record.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-05T20:02:17.620Z todo → blocked (system)
- 2026-11-05T20:38:10.158Z blocked → todo (system)
- 2026-11-06T07:54:08.580Z todo → wip (system)
- 2026-11-06T08:05:20.887Z wip → testing (system)
- 2026-11-06T08:07:36.672Z testing → done (system)

