---
schema_version: 1
name: Converge planning Board procedures on existing validated oRPC transport
status: done
template: feature-impl
created_at: 2026-11-05T20:01:23.915Z
updated_at: "2026-11-06T01:28:56.178Z"
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
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1300-verdict.json
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

- [x] R1. Planning Board reads use validated shared transport contracts; implement the exact Given/When/Then contract below.

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

- [x] 1. Write success/404/traversal/malformed-output/abort contract tests against the current raw routes first.
- [x] 2. Extract the current document read service and bind the exact paths/shapes with oRPC; keep legacy aliases.
- [x] 3. Replace manual client fetching behind existing helper exports and remove replaced parsing/error branches.
- [x] 4. Verify actual HTTP behavior plus typed-client output and retain error decoding/cancellation.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

### Solution

| File | What changed and why |
| --- | --- |
| `packages/contracts/src/planning-documents.ts:1-82` | New planList/planShow/designList/designShow contracts on the existing `/project/plans[/file]` and `/project/designs[/file]` paths with the exact pre-contract success payloads. |
| `packages/contracts/src/index.ts:44` | Registers `planningDocuments` in the public contract and re-exports its DTOs. |
| `packages/app/src/services/planning-document-service.ts:1-182` | One application owner for the allowlists, directory walk, title derivation and refusal codes; plans list newest-first, design satellites alphabetically, absent directories list empty. |
| `apps/server/src/modules/planning-documents/handlers.ts:1-45` | Thin oRPC procedures mapping each refusal code to its HTTP status. |
| `apps/server/src/context.ts:186,503-506` | `planningDocumentService()` accessor built from the context's own fs/cwd. |
| `apps/server/src/modules/health/index.ts:700-794` | The four raw plan/design handlers delegate to the service; the `/api/plans` and `/api/designs` aliases and their envelopes are retained. |
| `apps/web/src/lib/plan-client.ts:1-45` | Helpers now call the typed client and keep their exported signatures plus one narrow shape guard. |
| `apps/web/src/lib/design-client.ts:1-45` | Same convergence for the design helpers. |
| `packages/app/tests/services/planning-document-service.test.ts:1-116` | Shipping order, traversal refusal, missing-path, not-found and unavailable-context proofs. |
| `apps/server/tests/modules/planning-documents/handlers.test.ts:1-70` | oRPC payload plus 403/404 status-mapping proof. |

Verification evidence:
- `(cd apps/server && bun test tests/modules/plans.test.ts tests/modules/designs.test.ts tests/modules/feature/handlers.test.ts)` — 26 pass, 0 fail (legacy aliases and envelopes unchanged).
- `(cd apps/web && bun test tests/lib/plan-client.test.ts tests/lib/design-client.test.ts tests/lib/feature-client.test.ts)` — 42 pass, 0 fail.
- `packages/app` planning-document-service suite — 7 pass; oRPC handler suite — 2 pass.
- Typechecks for contracts, app, cli, server and web all exit 0; light-gate format, pre-rules and related tests PASS.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/contracts/src/planning-documents.ts:1-87` defines the four read contracts on the existing paths; `packages/app/src/services/planning-document-service.ts:1-183` owns allowlists, ordering and refusals; `apps/server/src/modules/planning-documents/handlers.ts:1-45` and the retained aliases at `apps/server/src/modules/health/index.ts:700-794` both delegate to it; `apps/web/src/lib/plan-client.ts:1-45` and `apps/web/src/lib/design-client.ts:1-45` use the typed client. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Planning Board reads use validated shared transport contracts (req: R1) | MET | test | `apps/server/tests/modules/planning-documents/handlers.test.ts:1-70` proves every refusal code maps to its documented status; `apps/server/tests/modules/plans.test.ts` and `apps/server/tests/modules/designs.test.ts` prove the legacy aliases and envelopes are unchanged (26 pass); `apps/web/tests/lib/plan-client.test.ts` and `apps/web/tests/lib/design-client.test.ts` prove cancellation and error decoding through the typed client (42 pass). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1300
**Scope:** plan/design read convergence — contract, app service, oRPC procedures, legacy aliases, two web clients
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence: MEDIUM**

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | architecture | The legacy `/api/plans` and `/api/designs` aliases still format their own `{ok,error}` envelopes around the shared service. That duplication is deliberate: the pre-contract wire shape is a published surface this task must not change. | `apps/server/src/modules/health/index.ts:742-752` | ACCEPTED |
| 2 | P4 (advisory) | correctness | Clients keep one narrow `Array.isArray` / `typeof content` guard because the typed client does not validate responses client-side; removing it would turn a malformed payload into a silent type lie. | `apps/web/src/lib/plan-client.ts:33-44` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/contracts/src/planning-documents.ts:1-87` adds the four read contracts on the existing paths; `packages/app/src/services/planning-document-service.ts:1-183` is the single owner of allowlists, ordering and refusal codes; both the raw aliases at `apps/server/src/modules/health/index.ts:700-794` and the oRPC procedures in `apps/server/src/modules/planning-documents/handlers.ts` delegate to it; `apps/web/src/lib/plan-client.ts:1-45` and `apps/web/src/lib/design-client.ts:1-45` use the typed client. |

**Next:** close through record/done; both accepted P4s record deliberate compatibility boundaries.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-06T01:11:22.235Z todo → wip (system)
- 2026-11-06T01:28:54.232Z wip → testing (system)
- 2026-11-06T01:28:56.173Z testing → done (system)

