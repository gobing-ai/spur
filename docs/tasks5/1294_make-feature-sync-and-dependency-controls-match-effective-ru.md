---
schema_version: 1
name: Make feature sync and dependency controls match effective runner behavior
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.909Z
updated_at: "2026-11-05T20:37:38.581Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F8
priority: P1
tags:
  - simplification-2026-11
  - w0
  - approved
estimate_hours: 4

dependencies: []
---

## 1294. Make feature sync and dependency controls match effective runner behavior

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W0; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F8: Feature sync defaults to the supported direction and preserves drafts; Feature dependency controls reflect effective action semantics.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/features/FeatureDetail.tsx; apps/web/src/lib/feature-client.ts; apps/server/src/modules/feature/handlers.ts; packages/app feature-action queue/runner; existing feature-client/action/handler tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E4 D1 L2 C0 R1 = 8. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

Already implemented in the starting uncommitted review diff: default pull, disabled push and feature-sync.test.ts. Preserve and verify that work; do not claim it is missing or recreate it.

**Refine corrections (2026-11-05)**

- The pull default and disabled push already exist in the starting diff; retain them and add the missing draft-preservation assertion. skipDeps is serialized but runFeatureActionJob never consumes it. The chosen fix is removal of the inert feature-action checkbox, not a new bypass or additional UI state.
- Verified source seams: `apps/server/src/serve.ts:623`; `apps/web/src/modules/features/FeatureDetail.tsx:95`; `apps/web/src/modules/features/FeatureDetail.tsx:900`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Preserve supported pull sync, unavailable push and the unsaved feature draft across metadata reload.
- [ ] R2. Remove the feature-action dependency checkbox because the current runner has no effective bypass; preserve accepted HTTP input compatibility.

### Acceptance Criteria

```gherkin
Feature: Make feature sync and dependency controls match effective runner behavior

  Scenario: AC1 — Feature sync defaults to the supported direction and preserves drafts (req: R1)
    Given an active feature with an unsaved body draft
    When the operator opens Sync and dispatches the default direction
    Then the Board sends pull, cannot select unavailable push, reports the real outcome and reloads metadata without replacing the draft

  Scenario: AC2 — Feature dependency controls reflect effective action semantics (req: R2)
    Given a feature action with dependency controls and a dependency-blocked fixture
    When the operator changes and dispatches the option or uses an unsupported option
    Then a supported choice reaches and affects the existing runner with a safe false default or the unsupported control is removed with truthful guidance
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:38.301Z

Closed: remove the unsupported control. Do not add dependency skipping to the runner.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

No new API or config. Remove only the skip-dependencies label/Checkbox in the feature action dialog and the Checkbox import if then unused. Keep optional skipDeps in the HTTP/queue contract for compatibility; no new runtime interpretation. Keep supported action channels and the sync direction enum/refusal. Extend the existing rendered test to enter edit mode, change draftBody, sync, and verify the editor value survives the metadata reload. Preserve current controlled sync state.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1303 does not consume this task; this is a complete F8 behavior fix.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/features/feature-sync.test.ts tests/lib/feature-client.test.ts tests/modules/features/feature-actions.test.ts); (cd apps/server && bun test tests/modules/feature/handlers.test.ts tests/modules/feature/transition-gate.test.ts). Save feature-sync JUnit and draft DOM assertions.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write draft-retention and absence-of-inert-control DOM regressions before editing the dialog.
- [ ] 2. Remove the inactive control; preserve pull default/disabled push and existing queue payload/API compatibility.
- [ ] 3. Exercise metadata reload, HTTP push refusal and guard denial without mocking the collaborator whose behavior is asserted.
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
