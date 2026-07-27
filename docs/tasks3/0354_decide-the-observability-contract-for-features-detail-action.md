---
template: issue
schema_version: 1
name: "Decide the observability contract for Features detail action lifecycle"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0352"]
created_at: "2026-07-27T17:49:50.605Z"
updated_at: "2026-07-27T22:43:03.128Z"
---

## 0354. Decide the observability contract for Features detail action lifecycle

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Operator wants better observability of button-group action handling — track status and feedback effectively. Today: button-local `…` spinner and global `api-error` events.
### Requirements
R1. Define the observable lifecycle states for a feature action (e.g. confirmed → queued → running → succeeded | failed | cancelled) and where each is stored (client-only, system events, job row).

R2. Decide user-facing feedback surfaces on Board (in-panel banner, toast, activity stream, status chip on the feature) — minimum viable set for ship.

R3. Define correlation id / runId propagation from click → event stream → UI.

R4. State how failures surface (recoverable vs terminal) and whether partial results of sync/check are shown.

R5. Decision only. Depends on 0352 async model.
### Acceptance Criteria
```gherkin
Feature: Observability contract for Features detail action lifecycle

  Scenario: Observable lifecycle states defined
    Given a feature action flows from click to terminal outcome
    When decision ticket 0354 is resolved
    Then Solution defines the observable states (confirmed → queued → running → succeeded | failed | cancelled) and where each is stored (client-only, system events, job row)

  Scenario: User-facing feedback surfaces chosen
    Given the Board needs minimum viable feedback for ship
    When the contract is recorded
    Then Solution names the feedback surfaces (in-panel banner, toast, activity stream, status chip) with the minimum viable set

  Scenario: Correlation id propagation defined
    Given a click produces a run that emits events the UI observes
    When the contract is finalized
    Then Solution defines runId/correlation-id propagation from click → event stream → UI

  Scenario: Failure surfacing defined
    Given actions can fail recoverably or terminally, and sync/check may partial
    When the contract is decided
    Then Solution states how failures surface and whether partial results are shown

  Scenario: Decision only — depends on 0352
    Given 0352 owns the async model
    When 0354 completes
    Then Solution records the observability decision only and references 0352
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

**Decision: the observability contract reuses the server-side event stream as the single source of truth, and adds one minimum-viable client surface (a feature-scoped status chip + a global error toast) on top of it.** No new transport, no new persistence. The job row (`queue_jobs`) is the durable lifecycle record; the system-event stream (`queue.*` + `feature.*`) is the live signal; the client observes via the existing SSE subscription on `/api/events/planning`. The one true gap the contract must close is that the Features SSE filter today drops every non-`feature.*` event and the global `api-error` CustomEvent has no production listener — so the minimum viable ship set is (a) widen the client filter and (b) render the error channel that already exists.

---

**R1 — Observable lifecycle states and where each is stored.**

| State | Source of truth | Where stored | Surfaced to Board via |
|---|---|---|---|
| **confirmed** | client click handler resolves `POST /features/{id}/action` with `status: 'queued'` (`FeatureActionResponse` from 0352) | client-only (transient; not persisted) | per-button spinner (`actionLoading` in `FeatureDetail.tsx:56`) flips from "clicking" to "queued" |
| **queued** | job row inserted into `queue_jobs` by the server handler | **job row** (durable) | `queue.job.enqueued` system event (`db-job-queue.ts:30,39`; catalog `packages/app/src/services/event-names.ts:87`) — already in `SYSTEM_EVENT_STREAMED_NAMES` and already streamed over `/api/events/planning` |
| **running** | job row transitions to in-flight when the worker consumer picks it up | **job row** (durable) | worker consumption is implicit — there is no dedicated `queue.job.started` event today, so "running" is derived client-side as "queued seen, terminal not yet seen". `queue.stats` periodic snapshots (`event-names.ts:91`) corroborate. A future `queue.job.started` is a non-blocking enhancement, not required for ship. |
| **succeeded** | job row reaches terminal success; `runTaskActionJob` returns exit code 0 (`apps/server/src/serve.ts:156-187`) | **job row** (durable) + the resulting feature mutation emits `feature.updated`/`feature.transitioned` through `PlanningWriteService` (`packages/app/src/services/planning-write-service.ts:443-452,549-557`) | `queue.job.completed` (`db-job-queue.ts:189`; catalog `event-names.ts:88`) **and** the derived `feature.*` event. The feature-side refresh is what bumps `detailRefreshKey` (`FeaturesShell.tsx:99-100`). |
| **failed** | `runTaskActionJob` throws on non-zero exit (`serve.ts:184-186`); job row marked failed | **job row** (durable) | `queue.job.failed` (`db-job-queue.ts:206`; catalog `event-names.ts:89`) |
| **cancelled** | user-initiated cancel of an in-flight job (if/when supported) | **job row** (durable) | `queue.job.failed` with a cancellation discriminator in the payload, **or** a future `queue.job.cancelled`. **Today there is no cancel affordance on feature actions**, so `cancelled` is a reserved state in the contract — it is named here so the implementing UI does not need to re-derive the state space, but no ship-path surfaces it yet. |

**Key reuse finding (load-bearing):** every `queue.*` event above is **already** in `SYSTEM_EVENT_CATALOG` at tier `default` (`packages/app/src/services/event-names.ts:85-91`, confirmed by `event-names.test.ts:27-31`) and therefore **already** in `SYSTEM_EVENT_STREAMED_NAMES` and **already** streamed server-side by the SSE handler at `apps/server/src/modules/events/index.ts:66`. The server needs **no widening**. The only barrier is the client-side filter `name?.startsWith('feature.')` at `apps/web/src/modules/features/FeaturesShell.tsx:94`, which drops every `queue.*` event before it reaches the refresh logic. The contract's R3 work is therefore a one-line client filter change, not a server change.

---

**R2 — User-facing feedback surfaces (minimum viable set for ship).**

Inventory of surfaces that exist today:

| Surface | Exists? | Where |
|---|---|---|
| Per-button spinner (`actionLoading`) | ✅ ships | `FeatureDetail.tsx:56,274,306,336` |
| Global `api-error` CustomEvent | ⚠️ fires but **has no production listener** — dead-letter today | dispatched at `rpc-client.ts:75-79` and `FeatureDetail.tsx:212,271,303,333`; the only `addEventListener('api-error', …)` calls are in **test files** (`rpc-client.test.ts:85`, `new-task-panel.test.tsx:196`, `task-detail.test.tsx:177,470`, `index.test.tsx:29`). `grep` of `apps/web/src` for a production listener returns nothing. |
| System Events tab (live tail + history) | ✅ ships | `apps/web/src/modules/observability/SystemEventsTab.tsx` — full ledger, color-coded by prefix, filterable |
| Jobs tab (job stats + event history) | ✅ ships | `apps/web/src/modules/observability/JobsTab.tsx` |
| Activity timeline / Teams Activity | ✅ ships | observability `InboxTab.tsx` (SSE-driven refetch) |
| Toast / inline banner / status chip on feature | ❌ does not exist | no `Toast`/`Banner`/`StatusChip` component in `apps/web/src` (grep returns no matches) |

**Minimum viable set for ship (the R2 deliverable):**

1. **Status chip on the feature detail action group** — the per-button spinner stays, but it gains a textual state (`queued` / `running` / `done` / `failed`) driven off the SSE stream after the `FeatureActionResponse` returns. This is the primary in-panel feedback. Lives in `FeatureDetail.tsx` alongside `actionLoading`.
2. **Global error toast (render the `api-error` channel that already exists).** The `api-error` CustomEvent is already dispatched on every RPC failure and every action catch — it just has no listener. The minimum-viable ship mounts **one** `useEffect` listener at the Board shell level (`BoardApp` / a new `<ErrorToast />` mounted once) that renders the event as a transient toast. This is the failure surface for R4 and is explicitly **not** a new event channel — it closes the dead-letter gap.
3. **Drill-down via existing tabs** — System Events tab and Jobs tab remain the deep-dive surfaces for correlation and history. No new tab is built for ship.

**Explicitly deferred (named so implementing tickets know they are out of scope for the minimum-viable ship):**

- A dedicated **Activity Stream** widget scoped to a single feature (the InboxTab is global, not feature-scoped). Deferred until a third consumer of feature-scoped events appears.
- A **status chip on the feature list/tree row** (cross-feature observability at a glance). Deferred; the detail-level chip is the minimum.
- **Toasts for non-error lifecycle transitions** (success notifications). Deferred — success is signaled by the chip clearing + the detail refreshing; a success toast is noise for ship.

---

**R3 — Correlation id / runId propagation (click → event stream → UI).**

Propagation chain:

```
click
  → POST /features/{id}/action
  → server handler enqueues job → queue_jobs row gets a runId (job id)
  → FeatureActionResponse { runId, action, status: 'queued' } returned to client   [0352 contract]
  → client stores runId in per-action state (ref/store keyed by action)            [client-only, transient]
  → job runs; emits queue.job.enqueued / .completed / .failed with payload.jobId = runId
  → SSE delivers event to client (after R1 filter widening)
  → client matches event.payload.jobId === stored runId to scope chip transition
  → resulting feature mutation also emits feature.updated / feature.transitioned
  → FeaturesShell bumps detailRefreshKey (existing path, FeaturesShell.tsx:99-100)
```

**runId is the correlation id.** It is the `queue_jobs` job id, echoed in `FeatureActionResponse.runId` (mirroring `TaskActionResult.runId`, `packages/app/src/services/task-service.ts:319-322`) and in every `queue.job.*` event's `payload.jobId` (confirmed shape via `apps/web/tests/modules/observability/components.test.tsx:72-76` — `{ jobId: 'job-1', … }`).

**Critical reuse rule (carried forward from 0352 R2):** the client does **not** need to track `runId` for correctness. The job is server-durable; on re-entry the feature loads its post-action state regardless of whether the client still holds the runId. runId is retained for two narrow purposes only: (1) **scoping the status chip** while the user remains on the detail page (so an event for feature A doesn't flip the chip on feature B when two details are mounted — currently only one detail is mounted at a time, but the contract is forward-compatible); (2) **log/event correlation** in the System Events and Jobs tabs (the drill-down surfaces from R2).

**What changes server-side: nothing.** `queue.*` events already carry `jobId` and are already streamed (R1 finding). **What changes client-side:** (a) the `FeaturesShell.tsx:94` filter widens to admit `queue.*` (and/or a derived `feature.action.*` re-emission if the implementing ticket prefers a feature-namespaced event — either is conformant, the contract does not mandate which); (b) the detail panel keeps the most-recent `runId` per action in a `useRef`/local state to match incoming events.

**Non-goal:** end-to-end distributed tracing (W3C traceparent / OpenTelemetry). The Board is a single-process local server; a job id is a sufficient correlation token. A trace-id layer can be layered on later without contract change.

---

**R4 — Failure surfacing (recoverable vs terminal) and partial results.**

Two failure classes, mapped to events:

| Class | Event | Meaning | Surface |
|---|---|---|---|
| **Recoverable (retrying)** | `queue.job.retrying` (`db-job-queue.ts:218`; catalog `event-names.ts:90`) | job hit a transient error and the queue will retry it | status chip shows `retrying`; **no toast** (the user does not need to act) |
| **Terminal (failed)** | `queue.job.failed` (`db-job-queue.ts:206`; catalog `event-names.ts:89`) | retries exhausted (or non-retryable error); `runTaskActionJob` threw | status chip shows `failed`; **global error toast fires** — either via the existing `api-error` path (if the failure is surfaced back through the RPC catch) or via a dedicated `queue.job.failed` SSE handler that dispatches the same `api-error` payload. The implementing ticket picks one; the contract requires only that a terminal failure reaches the R2 toast. |

**Cancellation** is a terminal state in the lifecycle (R1) but is **not a failure** — it surfaces only as the chip returning to idle. No toast. (And per R1, cancel is reserved, not shipped.)

Partial results of `sync` / `check`:

| Op | Partial-results policy | Rationale |
|---|---|---|
| **`check` (read-only)** | **No partial results shown for failure.** `check` is the single sync exception from 0352 R3 (`apps/server/src/modules/feature/handlers.ts:74-87`); it either returns findings inline or throws a synchronous error that the RPC catch surfaces via `api-error`. There is no deferred/partial path to observe. |
| **`sync` (pull status from tasks)** | **No partial results shown.** `sync` is async under 0352 R3 and is all-or-nothing: it re-derives feature status from its task set and emits one terminal event. If it fails midway, no intermediate mutation is committed to the feature row (the implementing ticket must ensure the sync job is atomic — failure rolls back; this is a contract requirement on the implementation, recorded here). The user sees either the refreshed status or a failed toast — never a half-applied status. |
| Agent dispatches (`brainstorm`, `plan`) | **No partial results.** These produce artifacts written to the feature/task corpus; on failure, no artifact is linked. The detail refresh on `feature.updated` reflects only committed artifacts. |

**Contract rule:** partial/intermediate results are **never** surfaced for feature actions. Every op is atomic from the feature-row perspective: either the mutation commits and `feature.updated` fires, or it doesn't and `queue.job.failed` fires. This is a constraint on implementing tickets (the `sync` job must be transactional/rollback-safe), not just a UI rule.

**Recoverable→terminal transition:** if `queue.job.retrying` is followed (after exhaustion) by `queue.job.failed`, the chip must transition `retrying → failed` and the toast must fire exactly once on the terminal event. The implementing ticket owns de-duplication (the SSE stream may redeliver; the client dedups on `jobId + terminal-seen`).

---

**R5 — Scope confirmation.**

Decision only. No code is changed by this ticket. Implementation is sequenced into later tickets under F81:

- client filter widening in `FeaturesShell.tsx:94` (admit `queue.*`);
- per-action `runId` ref + status chip in `FeatureDetail.tsx`;
- one global `api-error` listener mounted at the Board shell (closes the dead-letter gap from R2);
- `FeatureActionResponse` adoption (the `{ ok: true }` → `{ runId, action, status }` cutover owned by 0352's implementation tickets);
- atomicity guarantee on the `sync` job (R4 contract requirement).

This Solution records the state space (R1), the minimum-viable surface set (R2), the correlation chain and the "client doesn't need runId for correctness" rule (R3), the failure taxonomy and no-partial-results contract (R4), and the scope gate (R5) so the implementing tickets have a single observability decision to build against. It references 0352 (async model) as the upstream contract for the `FeatureActionResponse` shape and the sync-exception list, and reuses 0352's finding that `runId` is exposed-but-not-required for the basic path.
### Testing
**Mode:** decision / wayfinder (no runtime code change). Re-verified 2026-07-27 under `/sp-dev-verify 0354 --auto --next --force --focus all --fix all`.

**Method:** Line-anchor re-read of observability contract against event-names catalog, FeaturesShell filter, planning SSE mount, TaskActionResult shape (corrected `:319-322`), serve runTaskActionJob paths.

**Coverage:** N/A (decision-only).

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Solution §R1 six states confirmed→queued→running→succeeded|failed|cancelled with storage mapping; `event-names.ts:85-91` queue.* catalog; `events/index.ts:66` SSE; `serve.ts` success/fail paths |
| R2 | MET | Solution §R2 min-viable: status chip + global error toast + existing observability tab drill-down; in-panel strip optional |
| R3 | MET | Solution §R3 runId = job id = queue.job.*.payload.jobId; client filter widen `FeaturesShell.tsx:94`; mirrors `task-service.ts:319-322` |
| R4 | MET | Solution §R4 recoverable (retrying chip-only) vs terminal (chip+toast); partial results never for check/sync/agent per contract |
| R5 | MET | Decision only; depends on 0352 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Observable lifecycle states defined | MET | static-ref | Solution §R1 [docs-only] |
| Scenario: User-facing feedback surfaces chosen | MET | static-ref | Solution §R2 [docs-only] |
| Scenario: Correlation id propagation defined | MET | static-ref | Solution §R3 [docs-only] |
| Scenario: Failure surfacing defined | MET | static-ref | Solution §R4 [docs-only] |
| Scenario: Decision only — depends on 0352 | MET | static-ref | Solution §R5 [docs-only] |

**SECUA (`--focus all`):** N/A decision-only. Load-bearing finding: server already streams queue.*; only client filter blocks Board observation.

**`--fix all`:** corrected stale `task-service.ts:300-305` → `:319-322` in Solution/Testing prose.

**`--next`:** no-op — already terminal (`done`).

**Verdict: PASS**
### Review
Functional Verdict: PASS (2026-07-27, this turn)

Per-requirement traceability — every cited anchor re-read at the cited lines this run; content at each anchor names the requirement's subject (no stale citations):

| Req | Status | Evidence (re-verified this turn) |
|-----|--------|----------------------------------|
| R1 | MET | Solution §R1 defines all six lifecycle states with a source-of-truth/storage/surface mapping. Anchors re-read: `apps/server/src/serve.ts:156-187` (`runTaskActionJob` — exit-code-0 success path, throw-on-failure at `:184-186`); `packages/app/src/services/event-names.ts:85-91` (catalog: `queue.job.enqueued`/`completed`/`failed`/`retrying`/`queue.stats`, all tier `default`); `event-names.test.ts:27-31` (asserts the catalog contents — load-bearing for the "already streamed" claim); `apps/server/src/modules/events/index.ts:66` (SSE handler subscribes to `SYSTEM_EVENT_STREAMED_NAMES`); `packages/app/src/services/planning-write-service.ts:443-452,549-557` (feature mutation → `feature.updated`/`feature.transitioned` emission). `cancelled` explicitly named as reserved (no ship-path surface). |
| R2 | MET | Solution §R2 inventories existing surfaces (spinner ✅; `api-error` dead-letter ⚠️; System Events/Jobs/Inbox tabs ✅; toast/banner/chip ❌) with file:line for each, then names the minimum-viable ship set: (1) status chip on feature detail action group, (2) global error toast closing the `api-error` dead-letter gap, (3) drill-down via existing tabs. Deferrals explicitly named (feature-scoped activity stream, list-row chip, success toasts). **Load-bearing finding verified:** `grep` of `apps/web/src` for a production `api-error` listener returns no matches — only test files (`rpc-client.test.ts:85`, `new-task-panel.test.tsx:196`, `task-detail.test.tsx:177,470`, `index.test.tsx:29`) attach one. |
| R3 | MET | Solution §R3 traces click → POST → job row → `FeatureActionResponse.runId` → `queue.job.*.payload.jobId` → SSE → client match → `detailRefreshKey` bump, with each hop anchored. `runId` shape mirrors `TaskActionResult` (`packages/app/src/services/task-service.ts:319-322`); event payload shape `{ jobId }` confirmed via `apps/web/tests/modules/observability/components.test.tsx:72-76`. Reuses 0352 R2's "client doesn't need runId for correctness" rule. Server-side change: none (events already streamed, R1 finding). Client-side change: one filter line (`FeaturesShell.tsx:94`) + per-action `runId` ref. Distributed tracing explicitly named as a non-goal. |
| R4 | MET | Solution §R4 maps recoverable (`queue.job.retrying`) vs terminal (`queue.job.failed`) to surfaces (chip-only vs chip+toast) with event anchors (`db-job-queue.ts:218,206`; catalog `event-names.ts:90,89`). Partial-results policy is "never surfaced" for all three op classes (`check` sync exception, `sync` async, agent dispatches), with a contract-level atomicity requirement placed on the `sync` implementing ticket. Cancellation distinguished from failure. Recoverable→terminal transition de-dup rule recorded. |
| R5 | MET | Decision only. `git diff --name-only` for this task's working tree touches only `docs/tasks3/0354_*.md` (no `*.ts`/`*.tsx`/`*.js`/`*.jsx`). Dependency 0352 status `done` confirmed. Implementation sequenced to five named follow-up tickets under F81. |

Acceptance Criteria (5 scenarios, decision-only; each maps to the R{n} evidence above):

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Observable lifecycle states defined | MET | doc | Solution §R1 (six-state table with storage + surface per state) |
| Scenario: User-facing feedback surfaces chosen | MET | doc | Solution §R2 (inventory + minimum-viable set: status chip + global error toast + existing-tab drill-down) |
| Scenario: Correlation id propagation defined | MET | doc | Solution §R3 (click→UI chain; runId = job id; server change none, client filter + ref) |
| Scenario: Failure surfacing defined | MET | doc | Solution §R4 (recoverable vs terminal table; no-partial-results contract rule; atomicity requirement) |
| Scenario: Decision only — depends on 0352 | MET | doc | Solution §R5 (no code changed; references 0352; five named follow-ups) |

**SECUA Review:** N/A — decision/issue ticket (`wayfinder:grilling`, R5 explicit "decision only"). No source code in scope: `git diff --name-only` for this task touches only `docs/tasks3/0354_*.md`. No `*.ts`/`*.tsx`/`*.js`/`*.jsx`. No findings.

**Architecture Review (of the decision itself):** The chosen contract is reuse-first — it treats the server-side event stream as the SSOT and adds only the minimum client surface needed to render the states it already emits. The two load-bearing findings (queue events already streamed server-side; `api-error` is a dead-letter channel with no production listener) mean the contract's implementation cost is dominated by one client filter change + one shell-mounted listener, not by any new transport or persistence. This is the boring, correct call. Residual risks (recorded for implementing tickets, not blocking this one):

- The global error toast (R2) must be mounted exactly once at the Board shell level. A per-module listener would double-fire toasts. The implementing ticket owns singleton mounting.
- The `sync` atomicity requirement (R4) is a contract on the implementing ticket, not a UI rule — a non-transactional `sync` job would violate the no-partial-results contract even if the UI never shows intermediate state.
- SSE redelivery de-dup for the recoverable→terminal transition (R4) is owned by the implementing ticket; the contract specifies the behavior (`retrying → failed`, toast fires once on terminal), not the mechanism.
- A future `queue.job.started` event (R1) is a non-blocking enhancement; if added, the "running" derivation changes from client-side inference to direct observation with no contract break.
- `cancelled` is a reserved state (R1) with no ship surface; if a cancel affordance is added later, it must not reuse the failure toast.

**Design Conformance:** N/A — decision ticket; no surface code changed this turn. The `FeatureActionResponse` shape referenced in R3 is recorded for `packages/contracts/src/feature.ts` but not written there by this ticket (owned by 0352's implementation tickets).

**Pipeline gate evidence (this turn):**

- `spur task check 0354`: **PASS** (0 errors, 0 missing sections; 5 `L4.uncovered-task-scenario` warnings are the known F81 placeholder feature-level "Basic acceptance" AC stub artifact — identical to 0352's check result, not a defect of this task).
- `bun test apps/web/tests/modules/features/ --coverage` (this turn): **39 pass / 0 fail**.
- `bun test packages/app/src/services/event-names.test.ts` (this turn): green — confirms the R1 load-bearing catalog claim.
- Coverage target N/A for the decision itself (no runtime code path added by this ticket).

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | spur task check | — | task check passed; no P1–P3 findings |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T19:37:36.087Z todo → wip (system)
- 2026-07-27T19:37:39.634Z wip → testing (system)
- 2026-07-27T19:37:43.427Z testing → done (system)
- 2026-07-27T19:38:03.455Z done → wip (system)
- 2026-07-27T19:38:49.589Z wip → testing (system)
- 2026-07-27T19:57:20.387Z testing → done (system)
