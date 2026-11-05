---
schema_version: 1
name: Preserve bounded exact-search failures and skipped fuzzy outcomes
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.914Z
updated_at: "2026-11-05T20:37:48.904Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: A34
priority: P1
tags:
  - simplification-2026-11
  - w2
  - approved
estimate_hours: 6

dependencies: []
---

## 1299. Preserve bounded exact-search failures and skipped fuzzy outcomes

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W2; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature A34: Bounded exact search never reports lost matches as an empty success; Auto search preserves skipped fuzzy outcomes.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/search.ts; packages/app/src/services/search-zg.ts; packages/app/tests/services/search.test.ts; apps/cli/tests/commands/self/search.test.ts; server search handler tests; hybrid-search contract.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Both defects reproduced again during this audit: output overflow returns successful zero hits; auto skipped fuzzy returns []. Unknown-status and missing-index failure fixtures must be explicit; nonempty status output is currently optimistically ready. Freeze an explicit error at the cap instead of a new streaming implementation.
- Verified source seams: `packages/app/src/services/search.ts:189`; `packages/app/src/services/search.ts:67`; `packages/app/src/services/search-zg.ts:115`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Bounded exact search never reports lost matches as an empty success; implement the exact Given/When/Then contract below.
- [ ] R2. Auto search preserves skipped fuzzy outcomes; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Preserve bounded exact-search failures and skipped fuzzy outcomes

  Scenario: AC1 — Bounded exact search never reports lost matches as an empty success (req: R1)
    Given matching generated source lines exceeding the process output cap
    When exact search requests a limited result set
    Then the response contains a complete hit or an explicit bounded output-limit failure and preserves distinct timeout and no-match outcomes

  Scenario: AC2 — Auto search preserves skipped fuzzy outcomes (req: R2)
    Given absent, missing-index, unknown-status, failed and successfully empty fuzzy backends
    When the same auto request is evaluated against each deterministic fixture
    Then skipped routes remain null with the correct reason while successfully executed zero-match routes remain empty arrays
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:48.619Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

No response schema change. Preserve fuzzy.hits in groups.fuzzy and use fuzzy.hits ?? [] only for markOverlaps. Extend internal SearchDeps.run result with outcome?:string and outputTruncated?:boolean (mapped from the installed executor result when available); otherwise detect its max-buffer failure outcome before treating exitCode as success. runExact checks timeout, cap/failure and malformed matching JSON events before exit 1/no-match handling. Throw existing SearchError rg-failed with bounded actionable reason; no new public code. Keep 2 MiB cap. Add a fixture zg executable for missing index/unknown status/failure tests so PATH installations cannot determine expected test results; production status remains unknown on failed probes, never invented missing. Streaming is out of this fix.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: No Board transport prerequisite; clients retain the same contracted SearchResponse.

#### Boundaries and verification

(cd packages/app && bun test tests/services/search.test.ts tests/services/search-zg.test.ts); (cd apps/cli && bun test tests/commands/self/search.test.ts); (cd apps/server && bun test tests/modules/search/handlers.test.ts). Save two-3MB-lines repro and bounded error result.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write cap, malformed-event, timeout, valid no-match and all fuzzy outcome fixture cases before code.
- [ ] 2. Preserve process outcome through defaultSearchDeps and reject incomplete exact output explicitly.
- [ ] 3. Fix the null/empty distinction in auto mode; keep optional-backend degradation and unknown status truthful.
- [ ] 4. Replace host-dependent CLI expectations with fixture binaries and keep a separately reported optional real-tool probe.
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
