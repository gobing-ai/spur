---
template: feature-impl
schema_version: 1
name: "Add the Tasks tabview backed by the run store for pipeline digest, phase progress, and action log"
description: ""
status: todo
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P0
tags: ["board", "web", "observability", "run-store"]
dependencies: ["0373"]
created_at: "2026-07-29T00:15:02.357Z"
updated_at: "2026-07-29T05:56:26.495Z"
---

## 0377. Add the Tasks tabview backed by the run store for pipeline digest, phase progress, and action log

### Background

The operator asked for a task digest with progress and log, noting the Tasks module shows task detail but never pipeline progress. That data has never been on the Board: it lives in the run store (390 runs, 501 action runs with node/kind/status/duration, 412 task_run_links joining WBS to run id) which had no HTTP surface until J3's runs API. Building this on the event ledger instead — the obvious symmetry with the Jobs tab — would yield almost nothing, because `task.*` is 9 percent of a heavily-evicted ledger and carries only status flips, no phase or action detail. The 2026-07-28 decision therefore made the run store the primary backing, with corpus events as a secondary lane so CLI-only edits that never triggered a run are not lost.

### Requirements
- [ ] R1. List pipeline runs with their linked task WBS, workflow name, status, and start time, including runs with no task link.
- [ ] R2. Expand a run into its ordered phase progress, distinguishing the active phase from completed and failed ones.
- [ ] R3. Show the per-action log for a run with node, kind, status, and duration, and the reason for a failed action.
- [ ] R4. Provide a secondary lane of `task.*` and `feature.*` corpus events for work with no associated run, visually distinguishable from run-backed activity.
- [ ] R5. Degrade per-row: a run whose detail request fails or returns not-found shows an inline error while the rest of the list stays usable.
- [ ] R6. Follow the module's existing tab contract — append to `OBSERVABILITY_TABS` as data with a stable id, without modifying the shell.
- [ ] R7. Apply the same untrusted-input narrowing discipline used by the other tabs to the new runs API responses.
### Acceptance Criteria
```gherkin
Scenario: R13 — Pipeline runs are listed with their task and status
Scenario: R14 — A run expands into phase progress
Scenario: R15 — A run's action log is readable
Scenario: R16 — Corpus-only task activity is not lost
Scenario: R17 — A run whose detail is unavailable degrades gracefully
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Add a `TasksTab` React component and append it to `OBSERVABILITY_TABS` (`apps/web/src/modules/observability/tabs.ts:29`) as `{ id: 'tasks', label: 'Tasks', component: TasksTab }` — data-only, no `ObservabilityShell` edit (R6; append-only contract at `tabs.ts:13-15`). The tab is run-centric: the spine is `GET /api/runs` (newest-first, keyset-paged, `RunStoreListResult` — `packages/app/src/services/run-store-service.ts:97-102`), which inherently includes runs with no `task_run_links` row (R1 "including runs with no task link"). Each `RunStoreListEntry` (`run-store-service.ts:27-35`) supplies `workflowName`, `status`, `mode`, `agent`, `startedAt`, `completedAt`.

**Linked-task WBS enrichment.** J3 exposes `task_run_links` only as WBS→runs (`GET /api/runs/by-wbs/:wbs` → `RunStoreWbsLink[]`, `run-store-service.ts:77-82,333-354`); the reverse (runs→WBS) is not an HTTP surface. To attach a WBS to each linked run without a server change, the tab builds a `runId→wbs` index client-side on mount: fetch the task WBS list via the existing oRPC tasks contract (`api.tasks.list()` → `TaskSummary[]` with `wbs`, `packages/contracts/src/task.ts:9-27,153-160`; client at `apps/web/src/lib/rpc-client.ts:84-90`), then for each WBS call `/api/runs/by-wbs/:wbs` and collect `link.runId → wbs`. The index is bounded by the task count (not the run count) and rebuilt only on tab activation. Runs whose id is absent from the index render a muted "unlinked" badge — satisfying R1's "including runs with no task link." This trades N bounded requests on tab open for zero server-side changes; a future bulk reverse endpoint would remove the chatter.

**Phase progress + action log (expand).** Expanding a row fetches `GET /api/runs/:runId` → `RunStoreDetail` (`run-store-service.ts:69-74`): `phases[]` (`RunStorePhase` phase/status/startedAt/completedAt, `:38-43`), `transitions[]` (`:46-50`), `actions[]` (`RunStoreAction` id/node/kind/status/durationMs/ok/resultSummary/startedAt/completedAt, `:56-66`). Phases render in the server's `created_at` order (`phase-run-dao.ts:44-47`): the active phase is the last non-terminal, completed phases dimmed, failed phases flagged. The action log renders node/kind/status/duration (R3) plus the failure reason from `resultSummary` when `ok === false`.

**Secondary lane (R4).** A visually distinct lower lane fetches corpus events with no run: `GET /api/events/history?prefix=task` and `?prefix=feature` (prefix filter at `apps/server/src/modules/events/index.ts:268-279`; `task`/`feature` are cataloged prefixes — `packages/app/src/services/event-names.ts:52,82-87`). These `task.*`/`feature.*` events (`task.created/updated/transitioned`, `feature.created/updated/transitioned`) carry `entity.id` = WBS in payload but no runId — so they represent CLI-only edits that never triggered a run. The lane is styled apart from the run-backed list (muted border, "corpus-only" tag) so operators never confuse the two sources.

**Per-row degrade (R5).** The run-detail fetch is per-row and isolated: a 404 (`RunStoreNotFoundError` → `{ error, code: 'RUN_NOT_FOUND', runId }`, `run-store-service.ts:104-111`; server maps to 404 at `apps/server/src/modules/runs/index.ts:69-74`) or a network failure renders an inline error inside that row's expand panel while the rest of the list stays interactive. The list-level fetch has its own error boundary (same pattern as `SystemEventsTab` `:561-567`).

**Untrusted-input narrowing (R7).** Every runs-API response is narrowed through `parseXxx(value: unknown): T | null` guards returning `null` on any shape mismatch — mirroring `SystemEventsTab.parseHistoryResponse` (`SystemEventsTab.tsx:118-134`) and `JobsTab.parseStatsResponse` (`JobsTab.tsx:32-53`). A single bad run row nulls only that entry; a malformed envelope nulls the whole fetch into the error state. The secondary-lane events reuse `SystemEventRow` + `parseHistoryRow` (`SystemEventsTab.tsx:137-169`) directly.

**Invariants.**
- The shell is never edited (R6); the tab is pure data in `OBSERVABILITY_TABS` — append-only, stable id `tasks`.
- Runs API responses are never trusted raw — always narrowed before render (R7).
- A failed/not-found run detail never blanks the list (R5).
- The secondary lane never masquerades as run-backed activity (R4 visual distinction).
- The `runId→wbs` index is derived only from J3 surfaces; no direct DB/SQL in the web client.

**Impacted surfaces.**
- `apps/web/src/modules/observability/TasksTab.tsx` — new component (run list + expand + phase/action detail + secondary lane + narrowing guards).
- `apps/web/src/modules/observability/tabs.ts:29` — append one entry to `OBSERVABILITY_TABS`.
- `apps/web/src/modules/observability/index.tsx` / `ObservabilityShell.tsx` — no change (shell maps the array; auto-discovery unchanged).
- Reuses `fetchWithTimeout`/`resolveApiUrl` (`apps/web/src/lib/rpc-client.ts:32-56`), `SystemEventRow`/`parseHistoryRow`/`formatDuration`/`formatLocalTime` (`SystemEventsTab.tsx`), and the oRPC `api` client for the task WBS list (`rpc-client.ts:84-90`).
### Plan
1. **Create `TasksTab.tsx` skeleton** — default-export React component with `useState` for: runs list, expanded-run id, per-row detail/error map, secondary-lane events, list-level error. Import `fetchWithTimeout`, `resolveApiUrl` from `../../lib/rpc-client`; import `SystemEventRow`, `parseHistoryRow`, `parseHistoryResponse`, `formatDuration`, `formatLocalTime` from `./SystemEventsTab`; import `api` from `../../lib/rpc-client` for the task list. *(R1, R6)*
2. **Define wire types + narrowing guards (R7)** — mirror `RunStoreListEntry` (`run-store-service.ts:27-35`), `RunStoreDetail` (`:69-74`), `RunStorePhase` (`:38-43`), `RunStoreAction` (`:56-66`), `RunStoreListResult` (`:97-102`), `RunStoreWbsLink` (`:77-82`). Write `parseRunListResponse`, `parseRunDetail`, `parseRunPhase`, `parseRunAction`, `parseWbsLinksResponse` — each `(value: unknown): T | null`, field-by-field `typeof` checks, `null` on any mismatch. Follow `SystemEventsTab.parseHistoryResponse` (`:118-134`) and `JobsTab.parseStatsResponse` (`:32-53`). *(R7)*
3. **List fetch (R1)** — `useEffect` on mount: `GET /api/runs?limit=50` via `fetchWithTimeout(new Request(url, { signal }))` with `AbortController` (pattern `SystemEventsTab.tsx:432-451`). Narrow with `parseRunListResponse`; on `null`/non-ok → list-level error state (`:561-567` pattern). Store `runs`, `nextCursor`, `hasMore`. *(R1)*
4. **Build `runId→wbs` index (R1 linked WBS)** — on mount, call `api.tasks.list({})` (contract `taskListResponseSchema` → `TaskSummary[]`, `packages/contracts/src/task.ts:9-27,153-160`); for each `TaskSummary.wbs` call `GET /api/runs/by-wbs/:wbs`, narrow with `parseWbsLinksResponse`, collect `link.runId → wbs` into a `Map<string,string>`. Join to the run list: rows with a map entry show the WBS; absent → muted "unlinked" badge. *(R1 "including runs with no task link")*
5. **Render run list rows (R1, R13)** — table/list of `RunListEntry`: columns WBS (or muted badge), `workflowName`, status badge, `startedAt` (local `MMM D HH:mm:ss` via `formatLocalTime`), `mode`/`agent`. Clicking a row toggles expand. *(Scenario R13)*
6. **Expand → phase progress (R2, R14)** — on expand, `GET /api/runs/:runId`; narrow with `parseRunDetail`. Render `phases[]` in server order: active = last non-terminal, completed = dimmed, failed = flagged. Render `transitions[]` as a compact `from→to` strip. *(R2, Scenario R14)*
7. **Expand → action log (R3, R15)** — render `actions[]`: `node`, `kind`, `status`, `durationMs` (via `formatDuration`), and when `ok === false` show the failure reason from `resultSummary`. *(R3, Scenario R15)*
8. **Per-row degrade (R5, R17)** — wrap the detail fetch per row: 404 (`code: 'RUN_NOT_FOUND'`, `run-store-service.ts:104-111`) or network error → inline error inside that row's expand panel; the list and other rows stay usable. Never clear the runs list on a detail failure. *(R5, Scenario R17)*
9. **Secondary corpus lane (R4, R16)** — fetch `GET /api/events/history?prefix=task&limit=50` and `?prefix=feature&limit=50` (prefix filter `apps/server/src/modules/events/index.ts:268-279`; cataloged prefixes `event-names.ts:82-87,52`). Narrow with the reused `parseHistoryResponse`/`parseHistoryRow`. Render in a visually distinct lower lane (muted border + "corpus-only" tag) — never reads as run-backed activity. These events carry no runId → work with no run. *(R4, Scenario R16)*
10. **Append to `OBSERVABILITY_TABS` (R6)** — add `{ id: 'tasks', label: 'Tasks', component: TasksTab }` to the array in `apps/web/src/modules/observability/tabs.ts:29` (append-only; do not reorder/rename existing ids; no `ObservabilityShell.tsx` or `index.tsx` edit). *(R6)*
11. **Smoke check** — board dev server, activate the Tasks tab: list loads from `/api/runs`; WBS badges appear for linked runs and "unlinked" for orphans; expand shows ordered phases + action log with durations; a stopped/missing run shows an inline error while the list stays usable; the corpus lane shows `task.*`/`feature.*` events visually distinct from runs. *(R1–R7, R13–R17)*
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
