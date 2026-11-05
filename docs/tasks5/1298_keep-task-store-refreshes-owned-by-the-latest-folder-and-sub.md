---
schema_version: 1
name: Keep task-store refreshes owned by the latest folder and subscription
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.914Z
updated_at: "2026-11-05T20:37:46.830Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F7
priority: P1
tags:
  - simplification-2026-11
  - w2
  - approved
estimate_hours: 6

dependencies: []
---

## 1298. Keep task-store refreshes owned by the latest folder and subscription

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W2; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F7: Task folder selection owns every committed response; Task refresh bursts retain eventual freshness.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/task-kanban/useTasks.ts; existing useTasks tests; FeatureDetail generation-token precedent; task folder switch and planning-event consumers.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Generation ownership and burst coalescing must distinguish a folder change from another request in the same generation. Do not serialize a new folder behind a hung old request.
- Verified source seams: `apps/web/src/modules/task-kanban/useTasks.ts:86`; `apps/web/src/modules/task-kanban/useTasks.ts:113`; `apps/web/src/modules/features/FeatureDetail.tsx:133`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Task folder selection owns every committed response; implement the exact Given/When/Then contract below.
- [ ] R2. Task refresh bursts retain eventual freshness; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Keep task-store refreshes owned by the latest folder and subscription

  Scenario: AC1 — Task folder selection owns every committed response (req: R1)
    Given request A starts for one task folder before request B for a newly selected folder
    When B completes before either a successful or failed A and the final view unsubscribes
    Then only B can update visible state and callbacks from prior generations or a disposed subscription cannot overwrite it

  Scenario: AC2 — Task refresh bursts retain eventual freshness (req: R2)
    Given one hundred planning events while task refresh work is in flight
    When the events are coalesced at the existing store boundary
    Then redundant identical requests do not overlap and the last visible state includes the final relevant change
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:46.547Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

Keep TaskStore and ListFn signatures. Add sourceGeneration, activeRequest token, pendingRefresh and disposed/lifetime generation private state. A folder change invalidates old callbacks and starts the new source immediately; repeated same-generation refresh triggers coalesce behind the active promise and schedule at most one trailing request. Commit results/errors only for current generation/lifetime. On final unsubscribe invalidate lifetime and clear timers/pending work. Preserve explicit setTasks before/without subscribers and hook-local/default singleton behavior. Retain polling every 5s and current public connected/lastSyncAt semantics.

#### Dependencies and handoff

Direct prerequisites: none. This slice has no functional upstream prerequisite; program wave order is scheduling guidance, not a fabricated dependency.

Output/handoff: 1301 replaces stream ownership while retaining TaskStore freshness/coalescing semantics.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/task-kanban/useTasks.test.ts). Add a rendered folder-switch case and save request counts/final DOM state with controlled promises rather than real timer waits.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write deferred A/B success/error, source-switch, final-unsubscribe and 100-event tests first.
- [ ] 2. Add ownership checks before state writes/emits and coalesce only same-source refreshes.
- [ ] 3. Verify a trailing event is never lost and source B can finish while A remains unresolved.
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
