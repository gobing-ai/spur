---
doc: design/feature-action-progress-transparency
feature_id: F83
owns: SURFACE + mechanism for Features detail action progress (async runner + SSE + floating layer)
authority: derived (F81 Solutions 0352–0354 are the decision SSOT; this satellite is the ship shape)
updated_at: 2026-07-29
---

# Feature detail action progress transparency — system design (feature F83)

## 1. Problem

Features detail dynamic buttons confirm and dispatch actions, but operators cannot monitor progress:

- `POST /features/{id}/action` is a **stub** (`handlers.ts`) returning empty `data`.
- Client feedback is fire-and-forget (`actionLoading` + one-shot banner).
- Features SSE filter drops `queue.job.*` (`FeaturesShell.tsx`), so job lifecycle never reaches the UI.

F81 decided the model (job queue, confirm-before-enqueue, queue.* observability) but shipped no implementation. F83 implements that model and upgrades the MV status chip to a **closable floating progress layer**.

## 2. Decision

| Choice | Decision | Why |
| --- | --- | --- |
| Runner | Mirror `TaskService.fulfillAction` on `FeatureService` + job kind `feature-action` | F81/0352 Option A; proven path; no shared ActionRunner yet |
| Response | `FeatureActionResponse = { runId, action, status: 'queued' }` | Matches `TaskActionResult`; enables client correlation |
| Sync exception | `check` only | F81/0352 R3 |
| Transport | Existing `/api/events/planning` SSE only | `queue.job.*` already catalogued and streamed server-side |
| Client filter | Admit `feature.*` **and** `queue.job.*` | One-line barrier today; no server change |
| Correlation | `runId` ≡ `queue_jobs` id ≡ `payload.jobId` | F81/0354 R3 |
| Primary UI | Closable floating progress layer + compact re-open chip | Operator request; dismiss ≠ cancel |
| Failure when panel closed | Board-shell `api-error` toast listener | Closes dead-letter gap (0354 R2) |
| Confirm order | Confirm **before** enqueue | F81/0353; keep existing modals |

**Rejected:** client-only fake progress (lies while stub exists); new WebSocket; cancelling in-flight jobs in v1; extracting shared ActionRunner in this feature.

## 3. Contracts

### 3.1 Feature action response (cutover)

```typescript
// packages/contracts — replace empty data schema
export const featureActionResponseSchema = apiSuccessSchema(
    z.object({
        runId: z.string(),
        action: z.string(),
        status: z.literal('queued'),
    }),
);
```

Input schema may stay brainstorm/plan for the action endpoint; other lifecycle ops that become async enqueue through the same fulfill path (or thin wrappers) should return the same shape. FSM transitions that remain cheap may still use `transition` RPC but **if** enqueued, they use the same response shape — implementers follow 0352: async-by-default for non-check ops that use the action runner.

### 3.2 Job payload

```typescript
// apps/server — parallel to task-action
export const FEATURE_ACTION_JOB = 'feature-action';

interface FeatureActionJob {
    featureId: string;
    action: string; // brainstorm | plan | … (validated allow-list)
    command: string; // mapped CLI / agent invocation string
    channel?: string;
    skipDeps?: boolean;
}
```

Consumer: `runFeatureActionJob` registered beside `runTaskActionJob` in serve bootstrap. On success, feature mutations emit existing `feature.updated` / `feature.transitioned` via PlanningWriteService.

### 3.3 Lifecycle states (UI)

| State | Source | UI |
| --- | --- | --- |
| confirmed | POST returned `status: 'queued'` | layer opens / chip armed |
| queued | `queue.job.enqueued` | layer: Queued |
| running | derived (enqueued seen, no terminal) until `queue.job.started` exists | layer: Running |
| retrying | `queue.job.retrying` | layer: Retrying (no toast) |
| succeeded | `queue.job.completed` (+ optional `feature.*` refresh) | layer: Done; auto-collapse optional |
| failed | `queue.job.failed` | layer: Failed; toast if layer closed |

`cancelled` reserved; no UI affordance in F83.

## 4. Module boundaries

```
packages/contracts   FeatureActionResponse shape
packages/app         FeatureService.fulfillAction (+ command map)
apps/server          feature handler cutover; feature-action job consumer
apps/web             SSE filter widen; runId store; FloatingActionProgress; api-error toast
docs/design          this satellite (F81 remains decision SSOT)
```

| Concern | Owner |
| --- | --- |
| DTO | `packages/contracts/src/feature.ts` |
| Validate feature exists + enqueue | `FeatureService.fulfillAction` |
| Job registration + agent dispatch | `apps/server` serve bootstrap |
| Tree refresh on `feature.*` | existing `FeaturesShell` |
| Progress correlation + floating UI | `apps/web` features module (new component + store/hook) |
| Global error toast | Board shell mount once |

**Do not** put business validation in the Hono handler beyond context wiring. **Do not** invent a parallel EventSource per panel if a shared subscription can fan out (prefer one Features-module subscription that both tree refresh and progress hook consume).

## 5. UI surface

### FloatingActionProgress

- Position: fixed bottom-right (or bottom of board chrome), `z-index` above detail modals' backdrop peers but below confirm dialogs.
- Content: action label, feature id, state badge, optional short error message, link "Open in Jobs" (navigate Observability Jobs tab if available).
- Controls: close (dismiss), optional expand for last event timestamp.
- Multi-run: support a small stack (newest on top) if two actions enqueue before the first completes; cap display (e.g. 3) to avoid clutter.

### Compact chip

- Lives on the detail action group while any non-terminal run is tracked for the **selected** feature.
- Click re-opens the floating layer.

### Dismiss semantics

Dismiss is client-only UI state. Server job continues. Clearing the chip only happens on terminal success/failure (or navigation away — re-entry does not require runId for correctness; F81/0352).

## 6. Implementation sequence (task sketch)

1. Contract + `FeatureService.fulfillAction` + tests  
2. Server handler cutover + `feature-action` consumer  
3. Web SSE widen + runId correlation hook  
4. Floating layer + chip + api-error toast  
5. Wire FeatureDetail dispatch paths to retain runId and open layer  

Vertical slices preferred over pure horizontal layering when task sizing allows: e.g. "brainstorm enqueue + layer shows queued/done for that run" as an end-to-end thin slice, then expand actions.

## 7. Testing

- Contract / service unit: enqueue returns runId; missing feature throws; unsupported action throws.
- Handler: stub removed; response shape; consumer exit codes map to queue.job.completed/failed.
- Web: SSE filter admits queue.job.*; unmatched jobId ignored; dismiss does not clear server-side expectation; toast fires when layer closed on failed.
- No flaky real-agent e2e required for gate — mock job events + fake EventSource.

## 8. Open points (refine-time)

- Exact command map for brainstorm/plan (which `spur` / agent invocation the job runs) — follow task-action command map pattern.
- Whether FSM transitions also enqueue in F83 or only agent actions on the action endpoint first, with other ops following the same runner in a follow-up task under the same feature.
- Auto-dismiss delay on success (suggested 3–5s) vs require manual close.
