---
schema_version: 1
name: Explain ready work, blocking dependencies and paused runs in planning views
status: todo
template: feature-impl
created_at: 2026-11-05T20:01:23.916Z
updated_at: "2026-11-06T02:52:44.567Z"
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


#### Verified surfaces (2026-11-06)

The readiness read is additive on the existing task contract, so its declared surfaces include the
contract and barrel files the first pipeline run was refused for touching:

- `packages/contracts/src/task.ts` — `taskReadinessResponseSchema` plus its DTO.
- `packages/contracts/src/index.ts` and `packages/app/src/index.ts` — re-exports only.
- `apps/server/src/modules/task/handlers.ts` and `apps/server/tests/modules/task/handlers.test.ts` — one read-only
  procedure over the readiness projection, plus its handler test.
- `packages/app/src/services/planning-readiness.ts` — the projection owner.
- `apps/web/src/modules/task-kanban/PlanningReadinessPanel.tsx` — the rendering surface.

No mutation, no schema change to an existing payload, and no new public flag or noun.

### Plan

- [x] 1. Write fixtures for ready, missing/undone dependency, blocked, terminal, incomplete and paused-run cases before code.
- [x] 2. Implement the deterministic application projection and additive contracted HTTP read, preserving current task list DTOs.
- [x] 3. Render blockers/paused links/next action in existing views with the shared planning subscription.
- [x] 4. Prove displayed next action is legal and incomplete state cannot become ready.
- [x] 5. Run the exact focused checks above, inspect the diff against R-items/feature AC, synchronize owners and record evidence through the task pipeline; do not fabricate completion.

Implement-step focused checks, five workspace typechecks, changed-file lint, and the combined CLI/HTTP/DOM fixture passed. The light gate ran and recorded FAIL because sandbox Git object writes prevent tree capture/coverage provenance. Chromium did not expose a DevTools port. Evidence and exact commands are recorded in Solution; the calling pipeline owns the full gate, Testing/Review and lifecycle completion. No task commit is possible under the same Git metadata restriction.

### Solution

> SUPERSEDED 2026-11-06: this change map describes a reverted attempt (scope guard refusal).
> The current run must rewrite this section for the code it actually lands.


| Requirement | Implementation and rationale |
| --- | --- |
| R1 | `packages/app/src/services/planning-readiness.ts:33` gives the existing task checker an operation-scoped snapshot filesystem view; evidence reads retain the existing filesystem seam. `packages/app/src/services/planning-readiness.ts:68` resolves all configured folders before display filtering, orders rows deterministically and returns exact dependency/status/check blockers. Missing required sections, ambiguous/unreadable inputs, unavailable policy/run reads, orphan links and bounded run-link pages suppress ready actions. Paused runs block additional starts for their linked task. Only a ready todo task gets the displayed existing `/sp:dev-run <wbs>` command. |
| R1 | `packages/contracts/src/task.ts:155` defines the additive task.readiness response and GET route without changing task.list. `packages/contracts/src/index.ts:71` and `packages/app/src/index.ts:559` export the new DTO/schema and projection. `apps/server/src/context.ts:555` composes the projection from existing folders, matrix and run store; `apps/server/src/modules/task/handlers.ts:39` is the thin read-only procedure. |
| R1 | `apps/web/src/modules/task-kanban/PlanningReadinessPanel.tsx:13` renders a native keyboard-accessible disclosure with blockers, diagnostics, display-only commands and existing run progress links. Shared event/connection subscriptions coalesce bursts, abort on teardown/scope change, reject stale responses and clear old recommendations while refreshing. `apps/web/src/modules/task-kanban/TasksShell.tsx:203` mounts the folder-scoped panel; `apps/web/src/modules/features/FeatureDetail.tsx:790` scopes it to the existing linked-task set. |
| R1 | `packages/app/tests/services/planning-readiness.test.ts:5`, `apps/server/tests/modules/task/readiness.test.ts:12` and `apps/web/tests/modules/task-kanban/readiness.test.ts:22` exercise readiness policy, real HTTP/context/database wiring, rendering, stale responses and 100-event trailing refreshes. `apps/web/tests/lib/planning-source.fixture.ts:2` supplies the missing shared transport fixture already referenced by prerequisite 1301's committed tests. `docs/design/planning-record-contracts.md:23` synchronizes the actual surface contract; the existing architecture description already matches this mechanism. |

Implementation evidence (the parent pipeline owns Testing, Review, the full quality gate and lifecycle transitions):

- Tests preceded production changes. The first real HTTP probe returned 400 for the absent readiness procedure; the new service/panel imports were absent. Fixture corrections during iteration selected the actual `standard` matrix variant and awaited the asynchronous fetch start; no assertion or gate was suppressed.
- App focused: `(cd packages/app && bun test tests/services/planning-readiness.test.ts tests/services/planning-snapshot.test.ts tests/services/task-check.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/app-focused.xml)` — 219 pass, 0 fail.
- Server focused: `(cd apps/server && bun test tests/modules/task/readiness.test.ts tests/modules/task/handlers.test.ts tests/router.test.ts tests/openapi.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/server-focused.xml)` — 33 pass, 0 fail.
- Board focused: `(cd apps/web && bun test tests/modules/task-kanban/readiness.test.ts tests/modules/task-kanban/tasks-shell.test.ts tests/modules/features/planning-live-views.test.ts tests/lib/planning-events.test.ts tests/modules/task-kanban/useTasks.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/web-focused.xml)` — 35 pass, 0 fail. Feature detail consumer: `(cd apps/web && bun test tests/modules/features/feature-sync.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/feature-consumer.xml)` — 2 pass, 0 fail, including preservation of unsaved drafts.
- CLI consumers: `(cd apps/cli && bun test tests/commands/task/check.test.ts tests/commands/task/list.test.ts --reporter=junit --reporter-outfile=../../.spur/run/1302/cli-focused.xml)` — 38 pass, 0 fail.
- Public-surface probe: `(cd apps/web && bun test ../../.spur/run/1302/readiness-journey.test.ts)` — 1 pass, 0 fail, 11 assertions. One throwaway project drives a real source-local CLI target-todo check, contracted GET /api/tasks/readiness and the rendered panel. Ready work, cross-folder dependencies, exact missing-dependency/required-section blockers, paused-run links and display-only next actions are proved together. The recorded result has modelDispatches=0 and finalStreamClosed=true. Exact subprocess command/stdout/stderr, HTTP payload and rendered DOM are saved in `.spur/run/1302/readiness-journey.json`; the repeatable probe source is `.spur/run/1302/readiness-journey.test.ts`.
- `bun run --filter @gobing-ai/spur-app --filter @gobing-ai/spur-contracts --filter @gobing-ai/spur-server --filter @gobing-ai/spur-web --filter @gobing-ai/spur typecheck` — PASS for all five workspaces. Changed-file Biome and `git diff --check` — PASS.
- `bun apps/cli/src/index.ts task gate 1302 light` — receipt FAIL. Formatting/lint, all 51 pre-check rules, four workspace typechecks and related tests PASS. Post-check coverage provenance is blocked by sandbox Git object-write permissions: tree capture's `git add -A` returns Operation not permitted. Evidence: `.spur/run/1302-check-receipt.json` and `.spur/run/1302-light-gate.log`. No full-suite run, gate weakening or provenance bypass was attempted in implement mode. The same Git restriction prevents a task commit; changes remain a reviewable diff, including new untracked source/tests.
- Real Chromium probe unavailable: the installed engine did not report a DevTools port. `.spur/run/1302/browser-status.json` records that failure; the DOM journey uses happy-dom and is not a real-browser PASS.

API evidence: https://react.dev/reference/react/useEffect (cleanup and stale-response rejection); https://orpc.dev/docs/client/async-iterator-object (AbortSignal call option), checked against existing repository clients and installed contract/client types. Confidence is high for the tested fixture contract; canonical full-gate and real-browser results remain unverified.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
