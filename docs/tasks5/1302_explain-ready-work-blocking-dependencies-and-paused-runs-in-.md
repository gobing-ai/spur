---
schema_version: 1
name: Explain ready work, blocking dependencies and paused runs in planning views
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.916Z
updated_at: "2026-11-05T20:37:55.167Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: F73
priority: P2
tags:
  - simplification-2026-11
  - w3
  - approved
estimate_hours: 8

dependencies: ["1297", "1301"]
---

## 1302. Explain ready work, blocking dependencies and paused runs in planning views

### Background

Approved program: `docs/plans/2026-11-05-simplification-and-product-enhancement.md`, package W3; evidence and defect/candidate mapping: `docs/reports/2026-11-05-codebase-review.md`.

Robin approved this plan and requested feature updates/new features and implementation tasks on 2026-11-05; continued the same corpus conversion in the next message. Approval covers planning this scope, not deployment, new public verbs, new dependencies, gate weakening, or production data changes.

Implements feature F73: Daily readiness explains work and exact blockers.

Owned surfaces/callers/fixtures/config/docs: existing task/feature shells and detail panels; shared planning read projection and diagnostics; existing task/run/check contracts; related CLI/Board integration fixtures.

Duplicate review: source-local task list over all five configured folders found no nonterminal task owning this work; the four legacy blocked records are unrelated. Historical done tasks remain intact.

Rubric: E8 D1 L2 C0 R1 = 12. Keep this candidate as one cohesive deliverable with one review/rollback boundary. The overall program exceeds 16 hours and spans independent owners, so its feature/task split is justified. Sequential same-file work is ordered explicitly rather than run concurrently.

**Refine corrections (2026-11-05)**

- The first design did not freeze a readiness algorithm or response. Use existing deterministic checks and task/run data, not a second advice engine. Add a read-only procedure rather than changing task.list success shapes.
- Verified source seams: `packages/app/src/services/planning-preflight.ts:27`; `packages/app/src/services/task-check.ts:480`; `packages/app/src/services/run-store-service.ts:260`; `packages/contracts/src/task.ts:155`.
- One worktree at the audited HEAD; no wip task was reported. Preserve the prior review source diff and concurrent edits; recheck before implementation.

### Requirements

- [ ] R1. Daily readiness explains work and exact blockers; implement the exact Given/When/Then contract below.

### Acceptance Criteria

```gherkin
Feature: Explain ready work, blocking dependencies and paused runs in planning views

  Scenario: AC1 — Daily readiness explains work and exact blockers (req: R1)
    Given ready tasks, blocked dependencies, incomplete inputs and paused work in a fixture project
    When the operator opens the existing task or feature readiness view
    Then the view deterministically explains ready work, exact blockers and a valid existing next action without a foreground model call
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-05T20:37:54.879Z

Closed: use the frozen contract and installed dependencies above; no alternative architecture is delegated to the implementer.

Dependency status is scheduling, not a missing design decision. Ready specification does not mean upstream tasks are already complete. Start only when direct prerequisite tasks are integrated; no additional unrecorded go/no-go question remains.

### Design

#### Frozen implementation contract

New application PlanningReadinessService and task.readiness GET /tasks/readiness with optional existing folder filter. Return {ok:true,data:{tasks:[{wbs,state:"ready"|"blocked"|"not-startable",reasons:[{code,message,relatedWbs?}],nextAction:null|{kind:"run-task",wbs,command}}],pausedRuns:[{runId,wbs}],diagnostics:[{path,message}]}}. A task is ready only when status todo, all declared dependencies resolve to done, its target-todo check has no errors and the relevant snapshot is complete. Missing/deprecated/undone dependencies and blocked status explain why; incomplete data never yields ready. Existing state done/cancelled/deprecated is not-startable. nextAction only for ready rows, using existing /sp:dev-run <wbs>; it is displayed, never executed. Use current TaskCheckService policy against 1297 snapshot input, not private regex checks. Add a compact keyboard-accessible panel to current TasksShell/FeatureDetail; no new module or model invocation.

#### Dependencies and handoff

Direct prerequisites: 1297, 1301. 1297 supplies complete operation-scoped records/diagnostics; 1301 supplies shared live invalidation.

Output/handoff: No dependency on recovery UX; link existing run routes now and let 1307 improve them later.

#### Boundaries and verification

Add packages/app/tests/services/planning-readiness.test.ts, apps/server/tests/modules/task/readiness.test.ts and apps/web/tests/modules/task-kanban/readiness.test.ts. Save a single fixture CLI-check/HTTP/DOM journey and zero-model-dispatch assertion.

No production implementation occurs during this refinement. No new dependency, public noun/verb, workflow/IAM/env edit, production migration or new control guarantee is implied. Preserve successful outputs, validation, errors, redaction, proof freshness, cancellation, accessibility and one writer per tree. New unit or isolated policy failure cases must precede production code; prefer cross-layer/fixture journeys. Use the applicable harness gate once after focused checks and record real implementation results through Spur. Update owning contracts for actual surface changes, architecture for mechanisms, and an ADR before lasting boundary reversal. Save repeatable JUnit/JSON proof under the task run directory and durable evidence in the task Testing record. Scope is the named source seams and necessary callers/tests/docs; no speculative framework or broad cleanup.

### Plan

- [ ] 1. Write fixtures for ready, missing/undone dependency, blocked, terminal, incomplete and paused-run cases before code.
- [ ] 2. Implement the deterministic application projection and additive contracted HTTP read, preserving current task list DTOs.
- [ ] 3. Render blockers/paused links/next action in existing views with the shared planning subscription.
- [ ] 4. Prove displayed next action is legal and incomplete state cannot become ready.
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
