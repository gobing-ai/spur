---
schema_version: 1
name: Converge planning Board procedures on existing validated oRPC transport
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.915Z
updated_at: "2026-11-05T20:37:50.983Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F73
priority: P2
tags:
  - simplification-2026-11
  - w3
  - approved
estimate_hours: 8

dependencies: []
---

## 1300. Converge planning Board procedures on existing validated oRPC transport

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W3; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F73: Planning Board reads use validated shared transport contracts.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/lib/feature-client.ts, plan-client.ts, design-client.ts, rpc-client.ts; packages/contracts; apps/server handlers/router; feature/plan/design client tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Plans/designs are read-only raw Hono routes in health/index.ts, not missing mutation APIs. Their response shapes differ from the feature envelope. No dependency on corpus containment or search is necessary; remove those artificial edges.
- Verified source seams: `apps/web/src/lib/plan-client.ts:23`; `apps/web/src/lib/design-client.ts:23`; `apps/server/src/modules/health/index.ts:951`; `packages/contracts/src/index.ts:25`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Planning Board reads use validated shared transport contracts; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Converge planning Board procedures on existing validated oRPC transport

  Scenario: AC1 — Planning Board reads use validated shared transport contracts (req: R1)
    Given feature, plan, and design reads and mutations exposed through existing Board surfaces
    When the operator uses those surfaces successfully or encounters a domain or transport error
    Then runtime validation, cancellation and actionable domain errors are consistent through shared oRPC contracts without duplicated handwritten envelopes
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:50.697Z

Closed: retain Hono aliases but give each read one application owner; no TanStack dependency pilot in this task.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Add contracts planningDocuments.planList/planShow/designList/designShow with the EXISTING /project/plans[/file] and /project/designs[/file] routes and exact existing outputs: {files:PlanFileSummary[]}, {files:DesignFileSummary[]}, and {ok,path,title,content}. Use new internal application PlanningDocumentService for the current filesystem/path-allowlist logic, thin oRPC handlers, and retained /api/plans and /api/designs legacy aliases that call the same service. Delete duplicate raw primary handlers only after route wiring; keep path allowlists and missing-file 404 unchanged. Feature helpers delegate api.feature while preserving their current return signatures. No plan/design mutations, no new CLI verb, no library adoption, and no blanket normalization of old wire envelopes.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: Stable existing helper signatures and exact wire paths; 1302 can add its separately owned readiness procedure.

#### Boundaries and verification

(cd apps/server && bun test tests/modules/plans.test.ts tests/modules/designs.test.ts tests/modules/feature/handlers.test.ts); (cd apps/web && bun test tests/lib/plan-client.test.ts tests/lib/design-client.test.ts tests/lib/feature-client.test.ts). Add fixture HTTP-to-real-client proof and update owning contracts.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write success/404/traversal/malformed-output/abort contract tests against the current raw routes first.
- [ ] 2. Extract the current document read service and bind the exact paths/shapes with oRPC; keep legacy aliases.
- [ ] 3. Replace manual client fetching behind existing helper exports and remove replaced parsing/error branches.
- [ ] 4. Verify actual HTTP behavior plus typed-client output and retain error decoding/cancellation.
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
