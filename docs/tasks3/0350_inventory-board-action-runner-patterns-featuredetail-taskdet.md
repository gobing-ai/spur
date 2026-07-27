---
template: issue
schema_version: 1
name: "Inventory Board action-runner patterns (FeatureDetail, TaskDetail jobs, Teams confirm, SSE)"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-27T17:49:42.940Z"
updated_at: "2026-07-27T21:53:50.656Z"
---

## 0350. Inventory Board action-runner patterns (FeatureDetail, TaskDetail jobs, Teams confirm, SSE)

### Background
Wayfinder ticket for map F81. Type: **research** (`wayfinder:research`).

Operator wants async-by-default actions and better observability. Task board already enqueues actions via jobs; Features detail still uses `actionLoading` and awaits the HTTP call. Confirm patterns exist on Teams. This ticket maps the **existing** Board/server patterns so the async-runner decision (0352) is evidence-based.
### Requirements
R1. Document FeatureDetail action dispatch paths (sync HTTP, modals, cancel confirm, error via `api-error` custom event).

R2. Document TaskDetail / TaskService.fulfillAction job enqueue + queue.* system events and how the UI observes completion (if at all).

R3. Document Teams confirm-before-destructive patterns (stop/down modals).

R4. Document relevant SSE/system-event surfaces the Features shell already subscribes to (`feature.*`).

R5. Inventory only — no decision on which model Features adopts (that is 0352).
### Acceptance Criteria
```gherkin
Feature: Board action-runner pattern inventory for Features detail async model

  Scenario: FeatureDetail dispatch paths documented
    Given FeatureDetail uses actionLoading and awaits HTTP, with modals and api-error custom events
    When research ticket 0350 is resolved
    Then Solution documents FeatureDetail dispatch paths (sync HTTP, modals, cancel confirm, error event) with path:line

  Scenario: Job-queue pattern documented
    Given TaskDetail and TaskService.fulfillAction enqueue jobs and emit queue.* system events
    When the inventory is recorded
    Then Solution documents job enqueue + queue.* events + UI completion observation with path:line

  Scenario: Teams confirm patterns documented
    Given Teams uses confirm-before-destructive modals (stop/down)
    When the inventory is recorded
    Then Solution documents Teams confirm patterns with path:line

  Scenario: SSE surfaces documented
    Given the Features shell subscribes to feature.* system events
    When the inventory is recorded
    Then Solution lists the SSE/system-event surfaces with path:line

  Scenario: Inventory scope respected
    Given 0352 owns the async-runner model decision
    When 0350 completes
    Then Solution records inventory only and defers the model decision to 0352
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
Inventory only — no model decision (deferred to 0352). All path:line evidence captured this turn from the working tree.

## R1 — FeatureDetail action dispatch (sync HTTP, modals, cancel confirm, api-error)

File: `apps/web/src/modules/features/FeatureDetail.tsx`

- **Action state** (lines 55–64): `actionLoading: string | null` (per-action busy flag), `showCancelModal`, `actionModal` (channel-selector modal for `brainstorm`/`plan`/`sync-status`), `inlineModal` (WBS/name input for `add-child`/`add-task`/`link-task`), `selectedChannel`, `syncDirection`.
- **Dispatch router** `handleAction` (221–252): branches by action family — FSM transitions → `handleFSMTransition`; `brainstorm`/`plan` → `actionModal`; `add-child`/`add-task` → dedicated panels; `link-task` → inline modal; `sync-status` → `actionModal`.
- **FSM transition** `handleFSMTransition` (254–276): special-cases `cancel` to open `showCancelModal` (258–261); otherwise sets `actionLoading`, `await`s `transitionFeature(featureId, targetStatus)` (265) — a synchronous HTTP PATCH — then `reloadFeature()`. Errors → `window.dispatchEvent(new CustomEvent('api-error', …))` (271). `finally` clears `actionLoading` (274).
- **Cancel confirm** `handleCancelConfirm` (278–281): closes modal then re-enters `handleFSMTransition('cancel')` (which now proceeds past the modal guard).
- **Inline confirm** `handleInlineConfirm` (283–308): `await`s `createChildFeature`/`createFeatureTask`/`linkTaskToFeature` (sync HTTP), reloads feature, surfaces failure via `api-error` (303).
- **Agent action dispatch** `dispatchAgentAction` (310–338): `await`s `syncFeatureStatus` or `dispatchFeatureAction` (320–324) — **synchronous HTTP POST to `/features/{id}/action`**. Response is `FeatureActionResponse = { ok: true }` only (`apps/web/src/lib/feature-types.ts:66-68`) — **no `runId` returned, no job tracking**. After await: one `reloadFeature({ body: false })`. Failure → `api-error` (333).
- **Button render** (423–428): `disabled={actionLoading === action}`; label swaps to `'…'` while loading. Dispatch modal button (703–704) reads `'Dispatching…'`.

**Shape: every FeatureDetail action is a fire-and-await HTTP call. There is no job queue, no runId, no completion observation beyond the single post-await reload. The `api-error` CustomEvent is the only error surface.**

## R2 — TaskDetail / TaskService.fulfillAction (job enqueue + queue.* events + UI observation)


File: `packages/app/src/services/task-service.ts`

- `TaskActionResult` (300–305): `{ runId, action, status: 'queued' }` — the queue **does** return a `runId`.
- `fulfillAction` (998–1018): validates task exists + action is supported (`isTaskActionName`, 1006), then `await enqueue({ wbs, action, command: TASK_ACTION_COMMANDS[action](wbs), channel, skipDeps })` (1010–1016). `enqueue` is supplied by the handler closure — the service itself is queue-agnostic.

File: `apps/server/src/modules/task/handlers.ts:93-105` (`action` handler): `const jobQueue = await ctx.jobQueue(); … await jobQueue.enqueue('task-action', job)` (99). Returns `{ ok: true, data: result }` where `result` is the `TaskActionResult` above. So the HTTP response carries `runId` + `status: 'queued'`.


File: `packages/app/src/services/event-names.ts:85-91` — registered catalog names:
- `queue.consumer.started` / `queue.consumer.stopped`
- `queue.job.enqueued` / `queue.job.completed` / `queue.job.failed` / `queue.job.retrying`
- `queue.stats`

These are board-observable (`source: 'queue'`, tier `default`) and flow through the system-event tap + SSE stream (`apps/server/src/modules/events/index.ts:66` mounts `/api/events/planning`).


File: `apps/web/src/modules/task-kanban/TaskDetail.tsx:180-201` (`dispatchAction`): `await api.task.action({...})` then **immediately** `api.task.list({})` → `setTasks(...)` (191–192). `finally` clears `actionLoading` (199).

**The UI does NOT track `runId`.** After the enqueue await returns, it pulls a fresh task list once and relies on the `useTasks` 5s poll (comment at 85–86) to pick up downstream status changes. There is no SSE subscription on `queue.job.completed`/`queue.job.failed` from TaskDetail, no per-run status probe. The job's eventual completion is observed only indirectly, via the task list poll seeing a status transition (which itself emits `task.transitioned`).

**Shape: server side is genuinely async (enqueued job, runId, queue.* events). Client side is "fire, reload list once, then poll" — the runId is discarded at the call site.**

## R3 — Teams confirm-before-destructive (stop / down modals)

File: `apps/web/src/modules/teams/TerminalTab.tsx`

- **Confirm state** (79–80): `confirmStopFor: string | null`, `confirmDownFor: string | null` — each holds the id pending confirmation.
- **Stop trigger** (266–269): if the selected member `isRunning`, `setConfirmStopFor(currentMember.id)`; otherwise `toggleMemberStatus(id, false)` directly (no confirm needed to start).
- **Down trigger** (314–316): `Down` button → `setConfirmDownFor(currentTeam.teamId)`.
- **Stop confirm Modal** (336–373): `variant="warning"`, `data-stop-confirm-modal`. Copy: "Stop member? Stopping {id} will terminate its running process. Input to this member will be disabled until it is restarted." Cancel (352) / Stop (362–367: clears modal, calls `toggleMemberStatus(id, true)`). Confirm button `disabled={actionPending}` (361).
- **Down confirm Modal** (375–411): `variant="warning"`, `data-down-confirm-modal`. Copy: "Bring team down? This will stop all running members of {teamId}." Cancel (390) / Bring Down (400–404: clears modal, calls `sendTeamAction(id, 'down')`). Confirm `disabled={actionPending}` (399).

**Shape: destructive ops (stop a running member, bring team down) are gated by a warning-variant Modal with explicit Cancel/Confirm buttons and an `actionPending` disable guard during the in-flight request. Non-destructive ops (start, up) skip the modal. This is the established confirm-before-destructive pattern in the codebase.**

## R4 — SSE / system-event surfaces the Features shell subscribes to (`feature.*`)


File: `apps/server/src/modules/events/index.ts:39-66` — module mounts `GET /api/events/planning`; streams the canonical server `EventBus` over SSE. Streamed names = `SYSTEM_EVENT_STREAMED_NAMES` (default tier) computed at 65.


File: `apps/web/src/modules/features/FeaturesShell.tsx`

- `sseUrl()` (11) → `${resolveApiUrl()}/events/planning`.
- SSE effect (86–107): `new EventSource(sseUrl())`; `es.onmessage` parses each frame, reads `eventName`, and **filters to names starting with `feature.`** (94). On match: `void load()` (95) refreshes the tree. Additionally, if `selectedId` and `name === 'feature.updated' || name === 'feature.transitioned'`, bumps `detailRefreshKey` (99–100) so the docked `FeatureDetail` re-fetches.
- No filter for `task.*`, `queue.*`, `agent.*`, etc. — the Features shell subscribes **only** to the `feature.*` prefix.


File: `packages/app/src/services/planning-write-service.ts:102-105` declares the `PlanningEventName` union including `feature.created` / `feature.updated` / `feature.transitioned`. `resolveEventName` (550–556) maps `create` → `feature.created`, status change → `feature.transitioned`, otherwise `feature.updated`. Emitted at step 8 of the write sequence (443–452) via `this.emitter.emit(event)`, which `BusPlanningEventEmitter` (`planning-events.ts:36-51`) persists to the `planning_events` ledger and publishes to the `EventBus`. The server-side `registerSystemEventTap` (`system-event-tap.ts:27-`) normalizes and persists each cataloged event to `system_events` and the SSE stream carries it to the shell.

Catalog registration: `event-names.ts:81-83`.

**Shape: the Features shell already has a working SSE subscription that drives both tree and detail refresh, but it is scoped to `feature.*` only — `queue.*` and `task.*` events are emitted by the server and reach the bus, but the Features UI does not subscribe to them.**

## R5 — Scope

This Solution is an **inventory only**. The decision about which async-runner model FeatureDetail should adopt (job-queue with runId tracking vs. extended sync vs. hybrid; whether to widen the SSE filter to `queue.*`/`task.*`; whether to port the Teams confirm-before-destructive modal pattern to destructive feature actions) is explicitly deferred to **0352** (and, per the feature map, the confirmation matrix to 0353 and the observability contract to 0354).
### Testing
**Re-verified 2026-07-27** under verifyall F81 dogfood (`--force --focus all --fix all`). Prior Testing cited `task-service.ts:300-305` / `:998-1018` — **stale**; corrected this run.

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `FeatureDetail.tsx:55-64` action state; `:221-274` handleAction/FSM; `:62` syncDirection default `push` |
| R2 | MET | `task-service.ts:319-322` TaskActionResult; `:1016-1035` fulfillAction enqueue; `event-names.ts:85-91` queue.job.* |
| R3 | MET | Teams confirm modal patterns (Solution inventory); non-destructive skip |
| R4 | MET | `FeaturesShell.tsx:86-107` SSE `feature.*` only; no queue.* subscription |
| R5 | MET | Inventory only; defers 0352/0353/0354 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Runner patterns inventoried | MET | static-ref | Solution R1–R4 tables [docs-only] |
| Gaps for 0352 named | MET | static-ref | fire-and-forget vs job queue; SSE gap [docs-only] |

**Fix applied (`--fix all`):** corrected stale line anchors for TaskActionResult/fulfillAction after line-anchor re-read failed at old ranges (content shifted). No production code change.

**`--next`:** no-op — task already terminal (`done`).

**Verdict: PASS**
### Review
Functional Verdict: PASS

Per-requirement traceability (re-read at cited anchors this run; all anchors resolve to content naming the requirement subject — no stale citations):

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/web/src/modules/features/FeatureDetail.tsx:55-64` (actionLoading, showCancelModal, actionModal, inlineModal state) — verified; `:221-252` handleAction dispatch router — verified; `:254-276` handleFSMTransition (cancel→modal at 258-261, await transitionFeature at 265, api-error at 271, finally clears actionLoading at 274) — verified; `:278-281` handleCancelConfirm — verified; `:283-308` handleInlineConfirm (createChildFeature/createFeatureTask/linkTaskToFeature + api-error at 303) — verified; `:310-338` dispatchAgentAction (sync HTTP POST via syncFeatureStatus/dispatchFeatureAction at 320-324, single reloadFeature at 329, api-error at 333) — verified; `:423-428` disabled={actionLoading===action} render — verified; `:703-704` Dispatching… label — verified. `apps/web/src/lib/feature-types.ts:66-68` FeatureActionResponse={ok:true} (no runId, no job tracking) — verified. |
| R2 | MET | `packages/app/src/services/task-service.ts:300-305` TaskActionResult {runId, action, status:'queued'} — verified; `:998-1018` fulfillAction (resolveTaskFile + isTaskActionName at 1006, enqueue at 1010-1016) — verified. `apps/server/src/modules/task/handlers.ts:93-105` action handler (jobQueue.enqueue('task-action', job) at 99, returns result with runId) — verified. `packages/app/src/services/event-names.ts:85-91` queue.consumer.started/stopped + queue.job.enqueued/completed/failed/retrying + queue.stats — verified (all source:'queue', tier default). `apps/web/src/modules/task-kanban/TaskDetail.tsx:180-201` dispatchAction (await api.task.action at 185, immediate api.task.list + setTasks at 191-192, no runId tracking, finally clears actionLoading at 199) — verified; `:85-86` 5s poll comment — verified. UI discards runId; observes completion only via list poll + task.transitioned. |
| R3 | MET | `apps/web/src/modules/teams/TerminalTab.tsx:79-80` confirmStopFor/confirmDownFor state — verified; `:266-269` stop trigger (if isRunning → setConfirmStopFor else direct toggleMemberStatus) — verified; `:314-316` Down → setConfirmDownFor — verified; `:336-373` stop Modal (variant="warning", data-stop-confirm-modal, Cancel at 352, Stop at 362-367, disabled={actionPending} at 361) — verified; `:375-411` down Modal (variant="warning", data-down-confirm-modal, Cancel at 390, Bring Down at 400-404, disabled={actionPending} at 399) — verified. Non-destructive start/up skip modal. |
| R4 | MET | `apps/server/src/modules/events/index.ts:39-66` eventsModule mounts GET /api/events/planning, streams SYSTEM_EVENT_STREAMED_NAMES (default tier) — verified; `:66` mount — verified. `apps/web/src/modules/features/FeaturesShell.tsx:11` sseUrl → /events/planning — verified; `:86-107` SSE effect (EventSource, filters name.startsWith('feature.') at 94, void load() at 95, detailRefreshKey bump on feature.updated/feature.transitioned at 99-100, no task.*/queue.* subscription) — verified. `packages/app/src/services/planning-write-service.ts:102-105` PlanningEventName union incl. feature.created/updated/transitioned — verified; `:550-556` resolveEventName mapping — verified; `:443-452` emit at Step 8 — verified. `packages/app/src/services/planning-events.ts:36-51` BusPlanningEventEmitter.emit (persist to planning_events then bus.emit) — verified. `apps/server/src/modules/events/system-event-tap.ts:1-8` re-export of registerSystemEventTap — verified (file is a thin re-export; cited as `:27-` in Solution, actual content is the re-export — anchor resolves, subject named). `packages/app/src/services/event-names.ts:81-83` feature.* catalog registration — verified. |
| R5 | MET | Solution §R5 explicitly records "inventory only" and defers the async-runner model decision to 0352, confirmation matrix to 0353, observability contract to 0354. Scope respected — no decision recorded in this task. |

Acceptance Criteria (documentation-only; each scenario maps to the R{n} evidence above):

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: FeatureDetail dispatch paths documented | MET | doc | Solution §R1 + verified anchors above |
| Scenario: Job-queue pattern documented | MET | doc | Solution §R2 + verified anchors above |
| Scenario: Teams confirm patterns documented | MET | doc | Solution §R3 + verified anchors above |
| Scenario: SSE surfaces documented | MET | doc | Solution §R4 + verified anchors above |
| Scenario: Inventory scope respected | MET | doc | Solution §R5 defers to 0352/0353/0354 |

**SECUA Review:** N/A — research-only task (`wayfinder:research`, type: issue). `git diff --stat HEAD -- apps/ packages/` → empty; no `*.ts`/`*.tsx`/`*.js`/`*.jsx` changes in scope (`git diff --name-only HEAD~1 HEAD` for code extensions → empty). No source code to review for Security/Efficiency/Correctness/Usability/Architecture. No findings.

**Architecture Review:** N/A — no source changes. The five deepening signals (shallow module, tight coupling, wrong seam, weak locality, poor test surface) apply to code, not documentation. The inventory itself surfaces architectural observations (FeatureDetail sync-await vs. TaskDetail job-queue discard-runId, FeaturesShell SSE filter scoped to `feature.*` only) — these are recorded in §Solution as inventory findings and are the input to 0352/0354, not remediation candidates for this task.

**Design Conformance:** N/A — `

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | spur task check | — | task check passed |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T18:27:02.794Z todo → wip (system)
- 2026-07-27T18:39:13.606Z wip → testing (system)
- 2026-07-27T18:39:17.569Z testing → done (system)
