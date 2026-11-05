---
schema_version: 1
name: Share planning-event invalidation across task and feature views
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.915Z
updated_at: "2026-11-05T20:37:53.064Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F73
priority: P2
tags:
  - simplification-2026-11
  - w3
  - approved
estimate_hours: 6

dependencies: ["1298"]
---

## 1301. Share planning-event invalidation across task and feature views

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W3; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F73: Planning live updates share one owned subscription.

Owned surfaces/callers/fixtures/config/docs: apps/web/src/modules/task-kanban/useTasks.ts; apps/web/src/modules/features/FeaturesShell.tsx and useFeatureActionProgress.ts; planning-event helpers and shell ownership; related hook/rendered tests.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E6 D1 L2 C0 R1 = 10. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- Transport conversion is independent of event connection ownership. Remove dependency 1300; retain 1298 because the new stream invalidation must use its source/lifetime and trailing-refresh rules.
- Verified source seams: `apps/web/src/modules/features/FeaturesShell.tsx:105`; `apps/web/src/modules/features/useFeatureActionProgress.ts:39`; `apps/web/src/modules/task-kanban/useTasks.ts:157`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Planning live updates share one owned subscription; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Share planning-event invalidation across task and feature views

  Scenario: AC1 — Planning live updates share one owned subscription (req: R1)
    Given task and feature views mounted in one Board session
    When one hundred planning events arrive and views mount or unmount
    Then one planning stream coalesces affected-query refreshes and final state is fresh without leaking subscriptions or modifying process stream cursors
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:52.778Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New browser-only lib/planning-events.ts exports subscribePlanningEvents(listener):unsubscribe and subscribePlanningConnection(listener):unsubscribe over one lazily created EventSource at resolveApiUrl()+/events/planning. Parse each frame once into {eventName,payload}; ignore invalid frames; deliver only task.*, feature.* and queue.job.* planning frames to interested listeners. Retain connection state callbacks and close on last listener. Consumers own query-specific invalidation; TaskStore retains its coalescer, feature shell uses a same-generation trailing reload, progress reducer still matches job/run IDs. Do not introduce a cache/query library or merge process/history streams.

#### Dependencies and handoff

Direct prerequisites: 1298. 1298 owns per-store source generation and coalesced/trailing refresh; reuse it rather than rebuilding ownership.

Output/handoff: 1302 subscribes to the same planning source; process output remains separately addressed.

#### Boundaries and verification

(cd apps/web && bun test tests/modules/task-kanban/useTasks.test.ts tests/modules/features/useFeatureActionProgress.test.ts tests/modules/features/sse-helpers.test.ts); add tests/lib/planning-events.test.ts and rendered multi-view proof.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write a rendered multi-consumer connection/ref-count/invalid-frame/action-progress proof first.
- [ ] 2. Create the one subscription owner and migrate TaskStore, FeaturesShell and action progress without changing their data ownership.
- [ ] 3. Test unmount, reconnection notification, irrelevant events and 100-event final freshness; record 60-second request/connection counts.
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
