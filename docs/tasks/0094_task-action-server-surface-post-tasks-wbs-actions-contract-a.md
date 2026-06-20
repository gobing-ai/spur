---
schema_version: 1
name: "Task action server surface: POST /tasks/{wbs}/actions contract and orchestrator-runner binding"
status: todo
template: standard
created_at: 2026-06-20T05:06:46.368Z
updated_at: 2026-06-20T15:57:13.991Z
feature_id: F7
priority: P1
tags: ["task-kanban", "wave-2", "api", "orpc", "orchestrator", "spike"]
---

## 0094. Task action server surface: POST /tasks/{wbs}/actions contract and orchestrator-runner binding

### Background

Implements gap-analysis §4.1 (Task Action Handlers) + Wave 2. Effort: ~14h (design spike + thin vertical slice — the riskiest task; may split if the orchestrator integration proves deep). The legacy board triggered workflow actions (Refine, Plan, Run, Verify, Decompose, Evaluate) via /tasks/:wbs/actions delegating to the orchestrator; the migrated oRPC API has no action route, so the automation loop is CLI-only. Actions like Run/Decompose are long-running, so a synchronous handler is wrong — this likely needs job-queue wiring (the server context already exposes a jobQueue facility). This task: (1) a short design spike to choose sync-vs-async action semantics and the action→workflow mapping, then (2) implement the action contract route + handler binding it to the orchestrator/task-pipeline runner for at least one action end to end. Grounds against config/workflows/task-pipeline.yaml (verified to exist). UI buttons are 0095. Ordering: before 0095.

### Requirements
- [ ] R1. Design spike (recorded in Design): decide synchronous vs job-queue-backed action execution, the action-name→workflow/step mapping, and the response shape (immediate result vs run-id to poll/stream). Pick one with a one-line rationale; note rejected alternatives.
- [ ] R2. Add an action route to packages/contracts (POST /tasks/{wbs}/actions) with a Zod input enumerating the supported actions and a typed response per the spike decision (transport DTOs only).
- [ ] R3. Implement the handler binding the action to the orchestrator/task-pipeline runner (config/workflows/task-pipeline.yaml) via packages/app — the handler is transport-only (ADR-021); long-running actions route through the server jobQueue rather than blocking the request.
- [ ] R4. At least one action (e.g. Run or Verify) works end to end from contract to a started/queued run, returning a run identifier the UI can track; unsupported/invalid actions are rejected with a clear error.
- [ ] R5. Tests: contract binding, a handler test for the happy path + an invalid-action rejection, and a service/integration test that the action starts the expected workflow run. Gate green including test-cf (the action surface must not break the Worker build).
### Acceptance Criteria
Core scenarios (must pass):

```gherkin
Scenario: R1 — the spike decision is recorded
  Given the action-execution design question
  When the Design section is read
  Then it states the chosen sync-vs-async model, the action→workflow mapping, and the response shape, with a one-line rationale and rejected alternatives

Scenario: R2 — the action route exists in the contract
  Given the task contract
  When I inspect packages/contracts
  Then POST /tasks/{wbs}/actions is defined with a Zod input enumerating the supported actions and a typed response

Scenario: R3 — the handler binds the action to the orchestrator runner via the app layer
  Given the action handler
  When an action is requested
  Then it delegates to packages/app (transport-only handler, ADR-021)
  And long-running actions are enqueued via the server jobQueue rather than blocking the request

Scenario: R4 — one action works end to end
  Given a supported action (e.g. Run or Verify) on a task
  When it is invoked through the route
  Then the expected workflow run is started/queued and a run identifier is returned
  And an unsupported/invalid action is rejected with a clear error
```

Edge cases (advisory):

```gherkin
Scenario: R5 — the action surface keeps the Worker build green
  Given the new action route
  When test-cf runs
  Then the server still builds and runs under the Cloudflare Worker runtime
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Spike decision — actions enqueue a `task-pipeline.yaml` workflow run via the server `jobQueue`; the route returns a run-id immediately (async, fire-and-track). No synchronous execution.**

The legacy `/tasks/:wbs/actions` delegated to the orchestrator. Actions like Run/Decompose are long-running (agent invocations), so a synchronous handler that blocks the HTTP request is wrong. The server context already exposes `jobQueue(): Promise<ServerJobQueue>` (a `DBJobQueue` over `QueueJobDao`, opt-in via `jobQueueEnabled`) — the right primitive.

**Chosen model: async via jobQueue.**
- The handler enqueues a job describing `{ wbs, action }`; a worker runs the corresponding workflow (`WorkflowAppService.run(task-pipeline.yaml, { vars: { wbs, profile } })`).
- The route returns `{ runId }` immediately. The UI (0095) tracks the run; progress streams later via SSE (0097) or is polled.
- Rejected — synchronous handler: blocks the request for the full agent run (minutes); breaks HTTP timeouts and the Worker model.
- Rejected — direct in-handler workflow run: couples transport to long-running execution; violates ADR-021 and the jobQueue exists precisely for this.

**Action→workflow mapping.** `task-pipeline.yaml` already encodes the dev loop (precheck → implement → test → review → …) driven by `--vars '{"wbs"}'`. For the first slice, map a coarse action (e.g. `run` → the full pipeline; `verify` → the verify-only profile). The fuller per-action mapping (Refine/Plan/Decompose/Evaluate → specific `/sp:dev-*` commands) is enumerated in the contract but only the proven action is wired end-to-end in this task; the rest return "not yet implemented" until their workflow profile lands. **This task delivers the spike + one vertical slice, not all six actions** (effort 14h; full coverage may split out).

**Contract (transport DTOs only):**
```ts
taskActionInput = z.object({ wbs: z.string().regex(/^\d{4}$/), action: z.enum(['refine','plan','run','verify','decompose','evaluate']) })
taskActionResponse = apiSuccessSchema(z.object({ runId: z.string(), action: z.string(), status: z.literal('queued') }))
// route: POST /tasks/{wbs}/actions
```

**Handler (ADR-021).** Projection only; delegates to a packages/app method that enqueues the job. Worker-compat: enqueue is DB-backed, no Bun-only API in the handler — `test-cf` must stay green (R5). If jobQueue is disabled, return a clear 503-style error rather than blocking.

**Invariant.** The handler never runs the agent inline; it enqueues. Run identity (`runId`) is the seam the UI (0095) and SSE (0097) build on. **Open decision flagged for review:** whether `verify` should be synchronous (it is fast, no agent) while `run`/`decompose` are async — resolve in the spike based on which actions are agent-backed.
### Plan
1. Spike (record outcome in Design as finalized): confirm sync-vs-async per action — agent-backed actions (run/decompose/refine/plan/evaluate) async via jobQueue; resolve whether `verify` is fast enough to run inline. Finalize the action→workflow/profile mapping.
2. Add `taskActionInput` / `taskActionResponse` Zod schemas + the `POST /tasks/{wbs}/actions` route to `packages/contracts`.
3. Add a packages/app method that, given `{ wbs, action }`, enqueues a job (via the server jobQueue handle) to run `task-pipeline.yaml` with `--vars`; return a `runId`.
4. Implement the server handler via `implement(contract)` — projection only, delegate to the app method; if jobQueue is disabled, return a clear error.
5. Wire ONE action end to end (recommend `run` or `verify`) and verify it starts/queues the expected run with a returned `runId`; unsupported actions rejected.
6. Tests: contract binding, handler happy-path + invalid-action rejection, an integration test that the action enqueues/starts the expected workflow run. Run the gate including `test-cf` (R5).
### History
