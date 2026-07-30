---
template: feature-impl
schema_version: 1
name: "FeatureActionResponse contract and FeatureService.fulfillAction"
description: ""
status: done
type: task
profile: standard
feature_id: F83
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-07-29T23:22:42.888Z"
updated_at: "2026-07-30T00:13:26.363Z"
---

## 0385. FeatureActionResponse contract and FeatureService.fulfillAction

### Background
Implements: R1 — Feature action enqueue returns runId and queued status
Implements: R6 — check remains the sole synchronous exception

Parent F83. F81/0352 decided Option A job-queue extension; this task lands the app/contracts half so the server can enqueue without inventing a second response shape.

Service + contract half of R1; R6 documented as the sole sync exception (check is not enqueued through fulfillAction).

Rubric: E3 D1 L2 C0 R0 = 6 → decompose child (contracts + service deliverable).
### Requirements
- [ ] R1. Replace empty `featureActionResponseSchema` data with `{ runId, action, status: 'queued' }` matching TaskActionResult shape.
- [ ] R2. Add `FeatureService.fulfillAction(featureId, action, enqueue, options?)` that validates the feature exists, validates the action allow-list, builds a FeatureActionJob payload, calls enqueue, returns `{ runId, action, status: 'queued' }`.
- [ ] R3. Unsupported action or missing feature throws a clear error (no silent ok).
- [ ] R4. Unit tests cover success path, missing feature, and unsupported action.
- [ ] R5. Document that `check` is not enqueued through fulfillAction (sole sync exception per F81/0352).
### Acceptance Criteria
```gherkin
Scenario: R1 — Feature action enqueue returns runId and queued status
  Given a feature id that exists
  When fulfillAction is called with a supported action and an enqueue stub
  Then the result is { runId, action, status: 'queued' }
  And the FeatureActionResponse contract shape matches TaskActionResult

Scenario: R6 — check remains the sole synchronous exception
  Given FeatureService.fulfillAction is the async enqueue path
  When check is considered for enqueue
  Then check is documented and implemented as not going through fulfillAction
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Approach: Mirror TaskService.fulfillAction (packages/app/src/services/task-service.ts:1016-1035) — service owns validation + job shape; caller supplies enqueue. Contracts cutover is the FeatureActionResponse schema only.
Rejected: Shared ActionRunner extraction (F81 deferred); changing check to async.
Invariants: response shape identical to task side for Board reuse; no deep relative imports across packages.
### Plan
1. Update packages/contracts feature action response schema + export types.
2. Add FeatureActionJob type and fulfillAction on FeatureService.
3. Unit tests in packages/app (and contracts if schema tests exist).
4. `bun run lint` / targeted tests green.
### Solution

- [packages/contracts/src/feature.ts:108](file:///Users/robin/xprojects/spur-new/packages/contracts/src/feature.ts#L108): Defined `featureActionResultSchema` and updated `featureActionResponseSchema` to return `{ runId, action, status: 'queued' }`.
- [packages/app/src/services/feature-service.ts:89](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L89): Added `FeatureActionJob`, `FEATURE_ACTION_NAMES`, `isFeatureActionName`, and `FEATURE_ACTION_COMMANDS`.
- [packages/app/src/services/feature-service.ts:907](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L907): Added `FeatureService.fulfillAction` to validate feature existence & action allow-list and enqueue job.
- [packages/app/src/index.ts:82](file:///Users/robin/xprojects/spur-new/packages/app/src/index.ts#L82): Exported `FeatureActionJob` and action helpers.

### Testing

- `bun test packages/app/tests/services/feature-service.test.ts --coverage` (45 pass, `FeatureService` 97.69% line coverage).

### Review

| Priority | Finding | Action |
| --- | --- | --- |
| P1 | None — FeatureActionResponse schema aligns with TaskActionResult | Verified |
| P2 | None — FeatureService.fulfillAction enforces feature existence and action allow-list | Verified |
| P3 | None — check endpoint explicitly documented as sole sync exception | Verified |
| P4 | None — Unit tests in feature-service.test.ts cover success/error branches | Verified |

### References

F83

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-30T00:13:15.840Z todo → wip (system)
- 2026-07-30T00:13:24.748Z wip → testing (system)
- 2026-07-30T00:13:26.363Z testing → done (system)
