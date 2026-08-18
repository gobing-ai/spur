---
template: issue
schema_version: 1
name: "Decide the unified async action-runner model for Features detail actions"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0350"]
created_at: "2026-07-27T17:49:46.654Z"
updated_at: "2026-08-18T04:42:48.186Z"
---

## 0352. Decide the unified async action-runner model for Features detail actions

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Most feature actions are time-consuming; the operator wants **async-by-default** and a **unified** way to handle all button-group triggers so the UI does not block. Task board already has a job path; Features does not.
### Requirements
R1. Decide the unified action-runner model for Features detail: (A) extend task-style job queue to feature actions, (B) client fire-and-forget with optimistic UI + SSE, (C) hybrid (sync for cheap FSM, async for agent/sync/check), or a named third option.

R2. Define the request/response contract the Board uses after click (e.g. `{ runId, status: queued }`) and what "done" means for the user still on the page vs navigated away.

R3. State which ops may remain synchronous exceptions (if any) and why.

R4. Bound reuse of TaskService.fulfillAction vs a new FeatureService.fulfillAction / shared ActionRunner.

R5. Decision only — no implementation. Depends on 0350 patterns inventory.
### Acceptance Criteria
```gherkin
Feature: Unified async action-runner model for Features detail actions

  Scenario: Runner model decided
    Given the Board action-runner pattern inventory from 0350
    When decision ticket 0352 is resolved
    Then Solution names the chosen model (job-queue extension | optimistic + SSE | hybrid | named third) with rationale

  Scenario: Request/response contract defined
    Given the Board dispatches an action after click
    When the model is recorded
    Then Solution defines the post-click contract (e.g. { runId, status: queued }) and what "done" means for on-page vs navigated-away users

  Scenario: Synchronous exceptions bounded
    Given some ops may stay synchronous
    When the model is finalized
    Then Solution states which ops (if any) remain synchronous and why

  Scenario: Reuse boundary stated
    Given TaskService.fulfillAction exists and a shared ActionRunner is possible
    When the model is decided
    Then Solution bounds reuse of TaskService.fulfillAction vs a new FeatureService.fulfillAction / shared runner

  Scenario: Decision only — no implementation
    Given 0352 is a decision ticket
    When it completes
    Then Solution records the decision only and defers implementation to later tickets
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Decision only — no implementation (R5). All path:line anchors re-verified this turn against the working tree.

**Decision: Option A — extend the task-style job queue to feature actions.** Reuse the existing `JobQueue<unknown>` + injected-`enqueue` pattern that `TaskService.fulfillAction` already proves, namespaced under a new `'feature-action'` job kind. Feature detail actions dispatch via `FeatureService.fulfillAction` → server handler enqueues → in-process worker consumer executes → `queue.*` events flow over the existing SSE tap. The Board observes completion by widening the FeaturesShell SSE filter to include `queue.*` (and/or a derived `feature.action.*` re-emission), not by polling.

**Why A, not B or C:**

| Option | Verdict | Reason |
|---|---|---|
| **A. Job-queue extension (chosen)** | ✅ | The queue is already generic (`JobQueue<unknown>`, `enqueue(kind, payload)` — `apps/server/src/context.ts:98,205,489-503`); the task side is a working, shipped precedent with a clean queue-agnostic service seam (`TaskService.fulfillAction` takes `enqueue` as an injected closure — `packages/app/src/services/task-service.ts:1016-1035`); the feature handler already leaves the seam open with a "needs job queue wiring" TODO (`apps/server/src/modules/feature/handlers.ts:95-100`). Reuses the worker consumer registration pattern (`registry.register('task-action', …)` — `apps/server/src/serve.ts:322-325`) one-for-one under a new kind string. No new infrastructure, no new transport. |
| **B. Client fire-and-forget + optimistic UI + SSE** | ❌ | "Fire-and-forget" describes the *current* feature path and is the problem, not the solution. It loses server-side durability: if the Board tab closes between click and the (currently missing) server receipt, the action is lost. B also requires inventing a second, parallel "did it run?" channel that duplicates `queue.job.*`. Rejected on durability and duplication grounds. |
| **C. Hybrid (sync FSM, async agent/sync/check)** | ❌ as primary | Splitting the dispatch path by op class doubles the contracts the Board must know (R2) and the observability surface (0354). The async job queue handles cheap FSM transitions fine — enqueue cost is one DB row + one event emit, well under the HTTP round-trip budget — so there is no performance reason to keep a sync path. Sync stays only as a narrow **exception** (see R3), not as a parallel model. A hybrid of *transports* is the wrong axis; the right axis is one transport, op-specific exception list. |

**R2 — Request/response contract (post-click).** The Board's post-click contract mirrors the task contract exactly so the client can share tracking logic:

```ts
// Response to POST /features/{id}/action (replaces today's { ok: true })
interface FeatureActionResponse {
  runId: string;        // queue run id — same shape as TaskActionResult.runId
  action: string;       // echo of the dispatched action (e.g. 'sync', 'brainstorm')
  status: 'queued';     // only terminal client-facing status at enqueue time
}
```

This is `TaskActionResult` verbatim (`packages/app/src/services/task-service.ts:319-322`) under a feature namespace. The HTTP handler returns `{ ok: true, data: FeatureActionResponse }` to match the oRPC envelope used elsewhere.

**"Done" semantics — two cases:**

| User state | How "done" is observed |
|---|---|
| **Still on the page** | SSE delivers `queue.job.completed` (or a derived `feature.action.completed`) → FeaturesShell (with widened filter) bumps `detailRefreshKey` exactly as it does today for `feature.updated`/`feature.transitioned` (`apps/web/src/modules/features/FeaturesShell.tsx:99-100`). The action button transitions `queued → running → settled` off the same stream. No polling, no `runId` probe. |
| **Navigated away / re-entered later** | The `runId` is not required for correctness: the job is server-durable in `queue_jobs`, runs to completion regardless of client presence, and the resulting feature mutation emits `feature.updated`/`feature.transitioned` through `PlanningWriteService` (`packages/app/src/services/planning-write-service.ts:443-456,550-556`). On re-entry, `FeatureDetail`'s normal load reflects the post-action state. `runId` is retained in the response only for a future per-run status probe (0354) and for log correlation — it is **not** a client-side correctness dependency. |

Implication: the client does **not** need to track `runId` in a ref/store to be correct (this is the same finding 0350 recorded for TaskDetail — `apps/web/src/modules/task-kanban/TaskDetail.tsx:180-201` discards the runId today and relies on the list poll). The shared abstraction should *expose* `runId` but not *require* the caller to use it for the basic path.

**R3 — Synchronous exceptions (bounded).** The default is **all feature detail actions go through the queue.** Sync exceptions are allowed only when an op meets *all three* tests: (a) sub-round-trip latency, (b) idempotent / no side-effect ordering concerns, and (c) failure mode is fully described by a synchronous error (no deferred failure the user must be told about later).

The only op that currently qualifies:

| Op | Sync? | Why |
|---|---|---|
| **Read-only `check` (feature check)** | ✅ sync | Already a pure read over `FeatureCheckService` (`apps/server/src/modules/feature/handlers.ts:74-87`); returns findings inline; no state mutation; no deferred outcome. Queueing it would add latency for zero durability benefit. |
| `transition` (FSM) | ❌ async | Even though individual transitions are fast today (`handleFSMTransition` awaits `transitionFeature`), queueing unifies the contract and lets lifecycle guards + history + events run off the worker without holding the HTTP request. Keeps one dispatch path. |
| `sync` (pull status from tasks) | ❌ async | Touches N tasks, re-derives status, can transition — exactly the kind of op that must be durable and observable. Today it's a sync thrower (`feature/handlers.ts:121-136`, push unimplemented) — queueing it is the fix, not the exception. |
| `brainstorm` / `plan` (agent dispatch) | ❌ async | Agent runs are long by definition; the whole motivation for this ticket. |
| `add-child` / `add-task` / `link-task` | ❌ async | Mutate corpus + emit events; belong on the durable path. |

**Net: one named exception (`check`), everything else async.** The exception list is recorded in the contract, not inferred per-call-site, so 0353 (confirmation matrix) and 0354 (observability) can reason over a closed set.

**R4 — Reuse boundary: `TaskService.fulfillAction` vs `FeatureService.fulfillAction` vs shared `ActionRunner`.** Decision: `FeatureService.fulfillAction` mirrors `TaskService.fulfillAction`; a shared `ActionRunner` is deferred (extract-later), not built now.

Rationale, in priority order:

1. **The inject-`enqueue` seam is already the right abstraction.** `fulfillAction(wbs, action, enqueue, options)` (`packages/app/src/services/task-service.ts:1016`) is deliberately queue-agnostic: the service owns *domain validation* (does this entity exist, is this action supported) and the handler owns *transport* (how the job is persisted). `FeatureService.fulfillAction` reuses this seam by structural copy, not by inheritance — feature validation differs (entity is a feature ID, action set is the feature action catalog from 0349/0351).

2. **Premature shared `ActionRunner` is the wrong move now.** A generic `ActionRunner<TEntity, TAction>` would today have exactly two specializations (Task, Feature) and a divergent pair of validation rule sets. Two similar lines beat a premature abstraction (per house style). The feature map explicitly lists "Shared abstraction with Task detail action group now vs Features-only first, extract later" under *Not yet specified* and resolves it: **Features-only first, extract later** when a third consumer appears.

3. **What *is* shared, and where it lives:**
   - **`FeatureActionResponse` type** — same shape as `TaskActionResult` (`{ runId, action, status: 'queued' }`). Define in `packages/contracts/src/feature.ts` (the transport DTO home per AGENTS.md oRPC rules). Do **not** import `TaskActionResult` across domains.
   - **Worker consumer registration** — one new `registry.register('feature-action', …)` line in `apps/server/src/serve.ts` next to the existing `TASK_ACTION_JOB` registration (322-325). Same pattern, new kind.
   - **SSE widening** — FeaturesShell's `name.startsWith('feature.')` filter (`apps/web/src/modules/features/FeaturesShell.tsx:94`) gains `queue.job.*` (decided shape in 0354). Shared infra, feature-side config.
   - **Job payload shape** — `{ featureId, action, command }` mirroring `{ wbs, action, command }`. The `command` field keeps the same "precompiled CLI invocation" contract so the worker can dispatch through the same AgentService facade (`createTaskActionAgentService` pattern, `serve.ts:129-135`).

**Boundary statement (the R4 deliverable):** `TaskService.fulfillAction` is **not** extended to take features. A new `FeatureService.fulfillAction` is added with the same signature shape but feature-domain validation. The queue, the worker registry, the SSE tap, and the `FeatureActionResponse` shape are reused. A shared `ActionRunner` is an explicit follow-up, gated on a third consumer — not in scope for F81's Features-first delivery.

**R5 — Scope confirmation.** Decision only. No code is changed by this ticket. Implementation is sequenced into later tickets under F81 (worker consumer registration, `FeatureService.fulfillAction` body, handler cutover from the `{ ok: true }` stub, SSE filter widening, client `FeatureActionResponse` adoption). This Solution records the model, the contract, the exception list, and the reuse boundary so those tickets have a single decision to implement against.
### Testing
**Mode:** decision / wayfinder (no runtime code change). Re-verified 2026-07-27 under `/sp-dev-verify 0352 --auto --next --force --focus all --fix all`.

**Method:** Line-anchor re-read of Solution Option A decision against JobQueue, TaskService.fulfillAction, feature action stub, check handler, serve registry, FeaturesShell SSE, planning-write emit this run.

**Coverage:** N/A (decision-only; no production path added by this ticket).

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Solution names **Option A** (job-queue extension) with Why A/B/C table; anchors: `apps/server/src/context.ts:98` `ServerJobQueue = JobQueue<unknown>`; `:205` jobQueue(); `:489-503` createJobQueue; `packages/app/src/services/task-service.ts:1016-1035` inject-enqueue fulfillAction; `handlers.ts:95-100` open stub; `serve.ts:322-325` TASK_ACTION_JOB registry pattern |
| R2 | MET | Solution §R2 `FeatureActionResponse { runId, action, status: 'queued' }` mirrors `TaskActionResult` `packages/app/src/services/task-service.ts:319-322`; on-page done via SSE widen (FeaturesShell currently `feature.*` only `:94-99`); navigated-away via durable queue + `packages/app/src/services/planning-write-service.ts:443-452` emit / `:549-557` resolveEventName |
| R3 | MET | Default all-async; sole sync exception **check** `handlers.ts:74-87` pure FeatureCheckService read; push remains broken until impl (`handlers.ts:122-124`) |
| R4 | MET | FeatureService.fulfillAction mirrors TaskService; TaskService NOT extended; ActionRunner deferred; queue/registry/SSE/`FeatureActionResponse` in contracts reused |
| R5 | MET | Decision only; no production code by this ticket; depends on 0350 (done); F81 map Decisions gist recorded this run |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Runner model decided | MET | static-ref | Solution Option A + rationale table [docs-only] |
| Scenario: Request/response contract defined | MET | static-ref | Solution §R2 FeatureActionResponse + done semantics [docs-only] |
| Scenario: Synchronous exceptions bounded | MET | static-ref | Solution §R3 check-only exception [docs-only] |
| Scenario: Reuse boundary stated | MET | static-ref | Solution §R4 boundary statement [docs-only] |
| Scenario: Decision only — no implementation | MET | static-ref | Solution §R5; no *.ts change owned by this ticket [docs-only] |

**SECUA (`--focus all`):** N/A decision-only. Architecture note: one transport (queue) + closed sync exception list is the correct axis vs hybrid dual-contract (documented in Solution Why C rejected).

**`--fix all`:**
1. Corrected stale Solution anchors `packages/app/src/services/task-service.ts:300-305` → `:319-322`, `:998-1018` → `:1016-1035` (line drift).
2. Added F81 Notes Decisions one-line gist for Option A.

**`--next`:** no-op — task already terminal (`done`).

**Verdict artifact:** `.spur/run/0352-verdict.json` (this run).

**Verdict: PASS**
### Review
Functional Verdict: PASS (re-audited 2026-07-27, this turn)

Per-requirement traceability — every cited anchor re-read at the cited lines this run; content at each anchor names the requirement's subject (no stale citations):

| Req | Status | Evidence (re-verified this turn) |
|-----|--------|----------------------------------|
| R1 | MET | Solution §Decision names Option A (job-queue extension) with rationale. Anchors re-read: `apps/server/src/context.ts:98` (`export type ServerJobQueue = JobQueue<unknown>` — generic queue confirmed); `:205` (`jobQueue(): Promise<ServerJobQueue>`); `:489-503` (lazy `createJobQueue` over DB + EventBus). Precedent: `packages/app/src/services/task-service.ts:1016-1035` (`fulfillAction` with injected `enqueue` closure at `:1016`). Open seam: `apps/server/src/modules/feature/handlers.ts:95-100` (`action` handler returns `{ ok: true }` with "needs job queue wiring" comment). |
| R2 | MET | Solution §R2 defines `FeatureActionResponse { runId, action, status: 'queued' }` mirroring `TaskActionResult` at `packages/app/src/services/task-service.ts:319-322` (re-read: exact shape match). Done-semantics: on-page via SSE — `apps/web/src/modules/features/FeaturesShell.tsx:94` (`name?.startsWith('feature.')` filter) + `:99-100` (`detailRefreshKey` bump on `feature.updated`/`feature.transitioned`); navigated-away via server-durable `queue_jobs` + `feature.*` emission through `packages/app/src/services/planning-write-service.ts:443-452` (Step 8 emit) and `:549-557` (`resolveEventName` → `feature.transitioned`/`feature.updated`). |
| R3 | MET | Solution §R3 names `check` as the single sync exception. Anchor re-read: `apps/server/src/modules/feature/handlers.ts:74-87` — pure read over `FeatureCheckService`, no mutation, returns findings inline. All other ops async with per-op reasoning (transition, sync, brainstorm/plan, add-child/add-task/link-task). Push-direction sync currently throws (`feature/handlers.ts:121-123`), correctly flagged as needing the queue + push impl together. |
| R4 | MET | Solution §R4 bounds reuse. Anchors re-read: `packages/app/src/services/task-service.ts:1016` (`enqueue` injection point — the seam to mirror); `apps/server/src/serve.ts:322-325` (`registry.register(TASK_ACTION_JOB, …)` — pattern for new `'feature-action'` kind); `:129-135` (`createTaskActionAgentService` facade pattern). Boundary: TaskService NOT extended; `FeatureService` already exists at `packages/app/src/services/feature-service.ts:97` and will host `fulfillAction`. Shared `ActionRunner` deferred (two consumers, divergent validation — correct call). |
| R5 | MET | Decision only. `git diff --name-only` for this task's working tree touches only `docs/tasks3/0352_*.md` (no `*.ts`/`*.tsx`/`*.js`/`*.jsx`). Dependency 0350 status `done` confirmed via `spur task show 0350 --json`. |

Acceptance Criteria (5 scenarios, decision-only; each maps to the R{n} evidence above):

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Runner model decided | MET | doc | Solution §Decision (Option A named with rationale; B/C rejected) |
| Scenario: Request/response contract defined | MET | doc | Solution §R2 (`FeatureActionResponse` + two-row done-semantics table) |
| Scenario: Synchronous exceptions bounded | MET | doc | Solution §R3 (one named exception: `check`; three-test gate) |
| Scenario: Reuse boundary stated | MET | doc | Solution §R4 (TaskService NOT extended; FeatureService mirrors; ActionRunner deferred) |
| Scenario: Decision only — no implementation | MET | doc | Solution §R5 (no code changed; deferred to later F81 tickets) |

**SECUA Review:** N/A — decision/issue ticket (`wayfinder:grilling`, R5 explicit "decision only — no implementation"). No source code in scope: `git diff --name-only` for this task touches only `docs/tasks3/0352_*.md`. No `*.ts`/`*.tsx`/`*.js`/`*.jsx`. No findings.

**Architecture Review (of the decision itself):** The chosen Option A is the boring, reuse-first path — it extends a proven pattern (`fulfillAction` + `registry.register` + SSE tap) rather than introducing a new transport (B) or a parallel sync/async split (C). The deferred shared `ActionRunner` is the correct call at two consumers with divergent validation rule sets; extracting now would be a premature abstraction over exactly two specializations. Residual risks (recorded for implementing tickets, not blocking this one):

- The deferred `ActionRunner` should be revisited if a third action-runner consumer appears — flag in 0354 or the implementation ticket.
- SSE filter widening (`queue.*` into FeaturesShell's `name.startsWith('feature.')` guard at `FeaturesShell.tsx:94`) is a cross-module observability change; exact event-shape decision owned by 0354.
- Push-direction sync is unimplemented today (`feature/handlers.ts:121-123` throws); queueing it per R3 must carry the push-direction implementation, not just the runner swap — the implementing ticket must not ship a queue job that still throws.

**Design Conformance:** N/A — decision ticket; no surface code changed this turn. The decision's `FeatureActionResponse` shape is recorded for `packages/contracts/src/feature.ts` (which exists and is covered 100% per this turn's coverage run) but not written there by this ticket.

**Pipeline gate evidence (this turn):**

- `spur task check 0352`: **PASS** (0 errors, 0 missing sections; 5 L4.uncovered-task-scenario warnings are the known F81 placeholder feature-level "Basic acceptance" AC stub artifact, not a defect of this task).
- Verdict artifact `.spur/run/0352-verdict.json`: `verdict: PASS`, 5 requirements, 1 check — present and consistent.
- `bun test apps/web/tests/modules/features/ --coverage` (this turn): **39 pass / 0 fail**, 206 expect() calls. `src/modules/features/feature-actions.ts` (the action-group guardrail R3's sync-exception rests on): **100% Funcs / 100% Lines**. The 6-test `feature-actions.test.ts` validates that every surfaced FSM button is a legal transition under `config/workflows/feature-lifecycle.yaml` — the invariant the Option-A dispatch model inherits.
- Coverage target N/A for the decision itself (no runtime code path added by this ticket).

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | spur task check | — | task check passed; no P1–P3 findings |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T18:58:00.680Z todo → wip (system)
- 2026-07-27T18:58:00.798Z wip → testing (system)
- 2026-07-27T18:58:01.089Z testing → done (system)
- 2026-07-27T18:58:17.495Z done → wip (system)
- 2026-07-27T19:00:01.549Z wip → testing (system)
- 2026-07-27T19:13:07.583Z testing → done (system)
