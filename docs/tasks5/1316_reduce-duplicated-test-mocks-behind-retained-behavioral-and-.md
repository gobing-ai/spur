---
schema_version: 1
name: Reduce duplicated test mocks behind retained behavioral and gate evidence
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.921Z
updated_at: "2026-11-05T20:38:25.527Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: H16
priority: P3
tags:
  - simplification-2026-11
  - w8
  - conditional
estimate_hours: 6

dependencies: ["1295"]
---

## 1316. Reduce duplicated test mocks behind retained behavioral and gate evidence

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W8; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature H16: Test scaffolding shrinks only behind equivalent behavioral evidence.

Owned surfaces/callers/fixtures/config/docs: measured duplicated rpc/editor/EventSource test mocks and brittle source-text assertions; apps/web/tests/test-helpers; affected script tests; existing isolation/discovery and gate timing owners.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- A concrete duplicated family is now identified: the shared rpc-client mock duplicates fetch timeout/cancellation code and diverges (10s vs 30s, missing pre-abort/reason/listener cleanup). This is no longer blocked on discovering a candidate or on SSE migration.
- Verified source seams: `apps/web/tests/test-helpers/rpc-client-mock.ts:32`; `apps/web/src/lib/rpc-client.ts:42`; `apps/web/src/lib/rpc-client.ts:61`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Test scaffolding shrinks only behind equivalent behavioral evidence; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Reduce duplicated test mocks behind retained behavioral and gate evidence

  Scenario: AC1 — Test scaffolding shrinks only behind equivalent behavioral evidence (req: R1)
    Given an inventory of duplicated mocks and brittle source-text assertions with their contract owners
    When a measured approved candidate is replaced with shared behavior-oriented proof
    Then the old duplicate is removed while boundary assertions, ordinary discovery, coverage floors and failure sensitivity remain preserved
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:02:27.891Z

Scheduling decision recorded on 2026-11-05: preserve this conditional task but do not dispatch implementation.

Keep backlog until a measured duplicated family and stronger behavior proof are identified; no blanket deletion campaign.

The task is blocked on that evidence/decision condition; dependencies alone do not grant a go decision. The standard CLI created the fully specified capture as todo, so the legal todo-to-blocked transition is used instead of a raw status rewrite to backlog. Use the harness to resume only after the condition is satisfied.

#### Q&A entry — 2026-11-05T20:38:24.939Z

Closed: use the existing duplicated fetch seam as the measured candidate; preserve production behavior and remove the mock copy. This task can be todo after 1295.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal dependency-free apps/web/src/lib/rpc-fetch.ts owns DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, apiFetchWithTimeout, setFetchForTesting and resetFetchForTesting moved unchanged from rpc-client.ts. rpc-client imports/reexports those same symbols, preserving all existing callers and public browser helper paths. The test mock imports the shared functions directly from rpc-fetch; it keeps api/resolveApiUrl mock behavior and never recursively imports the mocked rpc-client. Delete its duplicate timeout/seam functions. Keep the 30s production default and caller-abort reasons/preaborted signal/listener cleanup exactly. No new package, no API stub expansion, no broad assertion deletion. Record net handwritten delta and before/after focused-suite timing.

#### Dependencies and handoff

Direct prerequisites: 1295. 1295 ensures the real-renderer safety proof stays in ordinary discovery while shared test plumbing changes.

Output/handoff: No dependency on 1301 and no unselected cleanup campaign remains.

#### Boundaries and verification

(cd apps/web && bun test tests/lib/rpc-client.test.ts tests/rpc-client.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-sync.test.ts). Add tests/lib/rpc-fetch.test.ts with controlled timeout/abort fixtures. Repeat ordinary discovery and preserve source-boundary tests.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write failure-sensitive timeout/caller-abort/preaborted/listener-cleanup proofs using the real fetch seam, before moving code.
- [ ] 2. Move the dependency-free fetch code with unchanged behavior and reexport from rpc-client.
- [ ] 3. Import it into buildFullRpcMock and remove the divergent duplicate; preserve module isolation and api fixtures.
- [ ] 4. Run paired real-client/mocked-client and sibling tests and publish code/timing delta without relaxing thresholds.
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

- 2026-11-05T20:02:27.600Z todo → blocked (system)
- 2026-11-05T20:38:25.527Z blocked → todo (system)

