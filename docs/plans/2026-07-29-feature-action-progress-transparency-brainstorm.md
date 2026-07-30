# Brainstorm: Feature detail action progress transparency

**Date:** 2026-07-29  
**Source idea:** Add transparency of action handlers on the dynamic buttons in the feature detail page — leverage existing SSE streaming for real-time progress, with a closable floating UI layer.

---

## Overview

The Features detail panel (`FeatureDetail.tsx`) already has dynamic status-gated action buttons, confirmation modals for several ops, and an in-panel `actionFeedback` banner. What it still lacks is **progress transparency while an action is running**.

Parent design map **F81** (done, design-only) already decided:

| Decision | Ticket | Outcome |
| --- | --- | --- |
| Async-by-default runner | 0352 | Option A: job-queue extension (`FeatureService.fulfillAction` mirrors `TaskService`); post-click `{ runId, action, status: 'queued' }`; sole sync exception = `check` |
| Confirm matrix | 0353 | hard/soft/none; **confirm before enqueue only** |
| Observability contract | 0354 | lifecycle via `queue_jobs` + `queue.job.*` SSE; MV ship = status chip + global error toast; runId = jobId correlation |
| IA prototype | 0355 | primary/overflow/in-flight zones |

**Implementation was never shipped.** Evidence in the current tree:

- Feature action oRPC handler is still a stub: `apps/server/src/modules/feature/handlers.ts:95-100` returns `{ ok: true, data: {} }` with a "deferred" comment.
- `FeaturesShell` SSE filter admits only `feature.*` (`FeaturesShell.tsx:94`) — drops every `queue.job.*` event already streamed server-side.
- Feedback is fire-and-forget: per-button `…` spinner + one-shot `actionFeedback` banner; no `runId` retention, no live lifecycle.
- F81 R2 deferred a richer feature-scoped activity surface; the operator now asks for a **closable floating progress layer** — a deliberate upgrade of that deferred surface into the ship set.

This idea is therefore **not greenfield product design**. It is the **implementation + UX upgrade** of F81's deferred contracts, with the floating layer as the primary progress surface instead of (or wrapping) the minimal status chip.

---

## Approaches

### Approach 1: Floating Action Progress Layer + F81 runner ⭐ Recommended

**Description:** Implement the F81 async runner contract (enqueue feature actions into the existing job queue, return `FeatureActionResponse { runId, action, status: 'queued' }`), widen the Features SSE client to admit `queue.job.*` (and keep `feature.*` for detail refresh), and add a **closable floating progress panel** that tracks the active action(s) by `runId` through queued → running → succeeded | failed | retrying.

**Trade-offs:**
- **Pros:**
  - Directly answers the operator's progress-transparency ask
  - Reuses proven seams: `TaskService.fulfillAction`, `queue.job.*` catalog, `/api/events/planning` SSE, Jobs/System Events drill-down
  - Closable panel lets operators keep working while long agent runs (brainstorm/plan) continue
  - Honor F81 confirm-before-enqueue and atomicity rules
- **Cons:**
  - Cross-layer: contracts + FeatureService + server handler + web SSE + new UI component
  - Must not invent a second progress transport (no parallel WebSocket)
  - Floating layer is richer than F81 MV chip — needs explicit AC so implementers do not ship both poorly

**Implementation Notes:**
- Server: `FeatureService.fulfillAction` + job kind `feature-action` (mirror task path); cut over `POST /features/{id}/action` from stub to enqueue; keep `check` as the sole sync exception.
- Client: store `runId` after dispatch; match `payload.jobId` on SSE; panel state machine from 0354 R1.
- UI: fixed bottom/corner floating card(s), dismissible without cancelling the job; re-open from status chip if dismissed while still running.
- Filter: widen `FeaturesShell` (or hoist SSE subscription to a shared board hook that both tree refresh and the progress panel consume).

**Confidence:** HIGH  
**Sources:** F81 Solutions 0352/0354; `handlers.ts:95-100`; `FeaturesShell.tsx:94`; `task-service.ts:1004-1035`; `event-names.ts` queue.job.* catalog (verified 2026-07-29)

### Approach 2: Strict F81 minimum (status chip + error toast only)

**Description:** Ship exactly what 0354 named as MV: per-button textual state chip, one Board-shell `api-error` toast listener, SSE filter widen. No floating layer.

**Trade-offs:**
- **Pros:**
  - Smallest ship; fully specified already
  - Less UI invention risk
- **Cons:**
  - Does **not** meet the operator's floating-layer ask
  - Chip is easy to miss on long agent runs once the button spinner clears after enqueue returns
  - Still requires the full async runner backend — savings are UI-only

**Implementation Notes:** Same backend as Approach 1; UI limited to chip + toast.

**Confidence:** HIGH  
**Sources:** 0354 Solution R2 (verified 2026-07-29)

### Approach 3: Client-only progress illusion (no runner cutover)

**Description:** Keep the action stub / fire-and-forget RPC; show a floating panel that fakes progress or only shows "dispatched" until `feature.updated` arrives.

**Trade-offs:**
- **Pros:**
  - UI-only; fastest apparent demo
- **Cons:**
  - Lies about state (stub returns ok with no job)
  - No real failure/retry signal
  - Conflicts with F81 async model decision
  - Agent actions still do nothing server-side

**Implementation Notes:** Reject for production path.

**Confidence:** HIGH (that it is wrong)  
**Sources:** handler stub `handlers.ts:95-100`

---

## Recommendations

**Ship Approach 1.** The floating layer is the operator-visible product; the F81 runner + SSE widen is the load-bearing substrate. Approach 2 is a fallback if UX capacity is tight, but it does not satisfy the stated idea. Approach 3 is out.

**Scope package for the feature:**

1. **Backend async cutover** — `FeatureActionResponse`, `FeatureService.fulfillAction`, job consumer for `feature-action`, un-stub the oRPC action handler (and migrate remaining FeatureDetail dispatch paths that still await long work synchronously where 0352 requires async).
2. **SSE client correlation** — admit `queue.job.*`; retain `runId`; match job lifecycle events to the active action.
3. **Floating progress UI** — closable panel; lifecycle labels; link into Jobs/System Events for drill-down; dismiss ≠ cancel.
4. **Failure toast** — mount the dead-lettered `api-error` listener (0354 R2) as the terminal failure surface if the panel is closed.
5. **Confirm order** — preserve/complete 0353 confirm-before-enqueue (do not regress cancel/agent modals).

**Parent placement:** new child under **F8** (Features board module), sibling of F81/F82 — e.g. **F83**. F81 stays the design map (done); this feature is the **implementation + floating progress UX**.

---

## Design Summary

| Item | Choice |
| --- | --- |
| Problem | Feature detail action buttons lack live progress; F81 designed async+observability but did not implement; operator wants a closable floating progress layer over SSE |
| Approach | Floating Action Progress Layer + F81 job-queue runner (Approach 1) |
| Transport | Existing `/api/events/planning` SSE only — widen client filter for `queue.job.*` |
| Correlation | `runId` = `queue_jobs` job id = `payload.jobId` |
| Lifecycle states | confirmed → queued → running → succeeded \| failed \| retrying (cancelled reserved) |
| Sync exception | `check` only (0352) |
| Confirm order | confirm before enqueue (0353) — unchanged |
| Dismiss behavior | panel close hides UI; job continues; re-open from chip while non-terminal |
| Non-goals | New WebSocket; feature-scoped full activity stream tab; distributed tracing; bulk multi-feature actions; cancelling in-flight jobs in v1 |
| Subsystems touched | `packages/contracts` (FeatureActionResponse), `packages/app` FeatureService, `apps/server` feature handlers + job consumer, `apps/web` FeaturesShell/FeatureDetail + new progress component |
| `needs_design` | **true** — multi-subsystem, contract + job kind + board UI surface |

---

## Next Steps

1. Idea-eval taste gate (approve/reject this evaluation).
2. Create feature (proposed id under F8, e.g. F83).
3. Author AC for runner cutover, SSE correlation, floating layer, dismiss semantics, failure toast.
4. System design note (short design satellite) covering job kind, event filter, panel component ownership.
5. Decompose into implementable tasks (service/contract → server enqueue → SSE client → floating UI → tests).

---

**Generated by:** sp:brainstorm (idea-pipeline discovery)  
**Research:** codebase inventory of F81 Solutions 0352–0354, FeatureDetail, FeaturesShell, feature handlers, TaskService.fulfillAction (2026-07-29)
