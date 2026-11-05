---
schema_version: 1
name: Reject incomplete planning inputs before deriving feature state
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.912Z
updated_at: "2026-11-05T20:37:42.693Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F22
priority: P1
tags:
  - simplification-2026-11
  - w1
  - approved
estimate_hours: 6

dependencies: []
---

## 1296. Reject incomplete planning inputs before deriving feature state

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W1; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F22: Incomplete planning input cannot silently drive lifecycle state.

Owned surfaces/callers/fixtures/config/docs: packages/app/src/services/task-query-ops.ts; packages/app/src/services/feature-service.ts; packages/app/src/services/task-locator.ts; packages/contracts planning read DTOs and CLI/server consumers; associated task/feature service tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C1 R2 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The earlier text called TaskLocator an error-taxonomy precedent but it actually treats ENOTDIR as missing. Keep its unrelated lookup behavior intact here; fail closed at the list/feature-derivation read seam instead. Freeze all-or-error transport now; a tolerant new DTO is not required for containment.
- Verified source seams: `packages/app/src/services/task-query-ops.ts:90`; `packages/app/src/services/feature-service.ts:892`; `packages/app/src/services/task-locator.ts:50`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Incomplete planning input cannot silently drive lifecycle state; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Reject incomplete planning inputs before deriving feature state

  Scenario: AC1 — Incomplete planning input cannot silently drive lifecycle state (req: R1)
    Given a done task and an unreadable todo task linked to the same feature
    When CLI or Board reads that feature or derives its status
    Then the failed read is diagnosed and no complete status is inferred from only the readable task
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:42.409Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New internal PlanningReadError in packages/app/src/errors.ts with readonly path:string and cause:unknown. In TaskQueryOps.list and FeatureService.list/collectTasksByFeature, wrap unexpected read/parse failures with the path; only ENOENT for an optional registered folder is empty. Do not silently skip a file lost between enumeration and read: fail and let the caller retry. Use existing transport error paths with the actionable message; do not add a list success-envelope field or change successful array/Map return types. A failing collect aborts sync before a transition/write. Parseable legacy status aliases keep taskMetadata handling; this is not a new whole-corpus schema-policy gate.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1297 consumes unchanged successful projections and PlanningReadError; 1302 may expose incomplete diagnostic state separately.

#### Boundaries and verification

(cd packages/app && bun test tests/services/task-query-ops.test.ts tests/services/feature-service.test.ts tests/services/task-locator.test.ts); (cd apps/server && bun test tests/modules/task/handlers.test.ts tests/modules/feature/handlers.test.ts). Add a disposable-project CLI/HTTP refusal proof and assert corpus bytes unchanged.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. First reproduce EACCES/EIO/ENOTDIR and unreadable-todo/readable-done cases through app and fixture HTTP/CLI.
- [ ] 2. Replace broad read/parse catches on the named list/collection paths with narrow missing-folder handling and PlanningReadError.
- [ ] 3. Verify refresh/syncFingerprintInputs/sync callers propagate incomplete input and cannot apply a status transition.
- [ ] 4. Confirm valid legacy aliases, optional ENOENT folders and successful list/Map JSON shapes are unchanged.
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
