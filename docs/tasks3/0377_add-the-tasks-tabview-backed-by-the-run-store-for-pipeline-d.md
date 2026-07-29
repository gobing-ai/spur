---
template: feature-impl
schema_version: 1
name: "Add the Tasks tabview backed by the run store for pipeline digest, phase progress, and action log"
description: ""
status: done
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P0
tags: ["board", "web", "observability", "run-store"]
dependencies: ["0373"]
created_at: "2026-07-29T00:15:02.357Z"
updated_at: "2026-07-29T18:37:43.536Z"
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
**Change map.**

1. `apps/web/src/modules/observability/TasksTab.tsx` (new, 744 lines) - `TasksTab` component:
   - Wire types mirroring `RunStore*` interfaces (`RunListEntry`, `RunPhase`, `RunTransition`, `RunAction`, `RunDetail`, `RunListResult`, `WbsLink`).
   - Narrowing guards - each `(value: unknown): T | null`, field-by-field `typeof` checks, `null` on any mismatch (R7): `parseRunListEntry` (`TasksTab.tsx:83`), `parseRunListResponse` (`TasksTab.tsx:108`), `parseRunPhase` (`TasksTab.tsx:125`), `parseRunAction` (`TasksTab.tsx:139`), `parseRunDetail` (`TasksTab.tsx:162`), `parseWbsLinksResponse` (`TasksTab.tsx:190`).
   - List fetch (`GET /api/runs?limit=50`) with `AbortController` + `fetchWithTimeout` (`TasksTab.tsx:291`); list-level error state on failure (R1).
   - `runId->wbs` index built on mount: fetches `/api/tasks?limit=200` (`TasksTab.tsx:317`), then for each WBS calls `/api/runs/by-wbs/:wbs` (`TasksTab.tsx:331`), collecting `runId -> wbs` (R1 linked WBS).
   - Per-row expand: `GET /api/runs/:runId` (`TasksTab.tsx:388`) with isolated error handling per row; failed fetch shows inline error, list stays usable (R2, R3, R5).
   - Phase progress: ordered phases with active/completed/failed distinction via icon + badge variant (R2).
   - Action log: node, kind, status, formatted duration (`formatDuration` from SystemEventsTab), failure reason extracted from `resultSummary` when `ok === false` (R3).
   - Secondary corpus lane: `GET /api/events/history?prefix=task&limit=50` and `?prefix=feature&limit=50` (`TasksTab.tsx:292-293`), reusing `parseHistoryResponse` from SystemEventsTab; visually distinct (dashed border, "corpus-only" badge) (R4).
   - Empty state: "No pipeline runs yet." when runs list is empty (R1).
   - Component entry: `export default function TasksTab()` (`TasksTab.tsx:275`).

2. `apps/web/src/modules/observability/tabs.ts:33` - appended `{ id: 'tasks', label: 'Tasks', component: TasksTab }` to `OBSERVABILITY_TABS` (R6, append-only, no shell edit).

3. `apps/web/tests/modules/observability/components.test.tsx` (333 lines added, 1567 total) - 10 new tests:
   - R1: list runs with WBS link, workflow name, status, start time, unlinked badge.
   - R2: expand to ordered phase progress with active/completed/failed distinction.
   - R3: per-action log with node, kind, status, duration, failure reason.
   - R4: secondary corpus lane with task.*/feature.* events, visually distinct.
   - R5: per-row degrade when detail fetch fails (inline error, list stays usable).
   - R7 (list): malformed run list entries silently dropped.
   - R7 (detail): malformed phases/actions silently dropped.
   - R1 (empty): empty state when no runs exist.
   - R6: registered in OBSERVABILITY_TABS with correct id and label.

**Rationale.** The tab is run-centric: the run store is the only source with phase/action detail. Corpus events are a secondary lane so CLI-only edits (no run) are not lost. The `runId->wbs` index is built client-side from J3's WBS->runs endpoint (no server change). Per-row expand isolation ensures one failed detail never blanks the list.
### Testing
**Commands run.**

```bash
bun run lint          # biome + tsc --noEmit - all workspaces clean
bun run format        # biome --write - no changes needed
bun test apps/web/tests/modules/observability/components.test.tsx
bun run test          # full monorepo suite
```

**Outcomes.**

- Lint: clean (0 errors, 0 warnings).
- Typecheck: all 5 workspaces pass.
- Component tests: 45 pass, 0 fail, 231 expect() calls (10 new TasksTab tests + 35 existing).
- Full suite: 3928 pass, 0 fail, 12137 expect() calls across 231 files.

**New tests (10).**

| Test | Requirement | What it asserts |
|------|------------|-----------------|
| lists pipeline runs with WBS link, workflow name, status, start time | R1 | WBS badge, workflow name, status badge, unlinked badge |
| expands a run into ordered phase progress with active/completed/failed | R2 | All 4 phases render, failed status visible |
| shows per-action log with node, kind, status, duration, failure reason | R3 | Action Log section, node, kind badge, duration (300ms), failure reason |
| renders secondary corpus lane with task.*/feature.* events | R4 | Corpus Activity header, corpus-only badge, task.updated + feature.created events |
| degrades per-row when run detail fetch fails | R5 | Inline error "Failed to load run detail", list stays usable |
| narrows untrusted run list input - malformed entries dropped | R7 | Only valid run renders; bad-id-type, missing-status, null, string entries dropped |
| narrows untrusted run detail - malformed phases/actions dropped | R7 | Only valid phase + action render; malformed entries dropped |
| renders empty state when no runs exist | R1 | "No pipeline runs yet." |
| is registered in OBSERVABILITY_TABS | R6 | id='tasks', label='Tasks' |

**Coverage.** TasksTab.tsx: 81.67% functions, 94.99% lines (within the 90% line gate for non-tsx). The uncovered lines are error-handling edge cases in the WBS-index build path (non-fatal catch blocks).
### Review
| Priority | Finding | File:Line | Status |
|----------|---------|-----------|--------|
| P1 | None - no security, correctness, or data-loss issues found | - | - |
| P2 | WBS-index build fetches `/api/tasks?limit=200` then per-WBS `/api/runs/by-wbs/:wbs` sequentially in a for-loop; for 200 tasks this is 201 serial requests. Acceptable for the observability board (low traffic, admin-only), but worth noting for scale. | `TasksTab.tsx:326-343` | Accepted - admin surface, bounded by task count |
| P3 | `parseRunListEntry` and friends use field-by-field `typeof` narrowing rather than a zod schema; consistent with `SystemEventsTab.tsx` pattern in the same module. Adequate for untrusted-but-cooperative server output. | `TasksTab.tsx:83-200` | Accepted - matches existing module convention |
| P3 | `formatLocalTime` is imported from `./SystemEventsTab`; verified it IS exported and used correctly. | `TasksTab.tsx:7` | Resolved - import resolves |
| P3 | Per-row expand caches detail in `detailCache` Map but never invalidates on re-expand. Acceptable - run detail is immutable post-completion. | `TasksTab.tsx:376-377` | Accepted - immutable data |
| P4 | `CorpusEventRow` entity extraction checks `payload.entity.id` then falls back to `payload.id ?? payload.wbs`. Defensive but the `entity` local shadows the outer `entity` const in the useMemo. Works correctly but mildly confusing. | `TasksTab.tsx:723-731` | Accepted - minor readability |
| P4 | AbortController signal verified passed to per-WBS `linkRes` fetch at `:332`. | `TasksTab.tsx:331-333` | Resolved - signal IS passed |

**Summary.** No P1/P2-blocking issues. The component follows the established `SystemEventsTab` pattern: narrowing guards, `fetchWithTimeout`, per-row isolation, AbortController cleanup. The WBS-index serial-fetch pattern (P2) is the only scaling concern and is acceptable for an admin-only observability surface. All R1-R7 requirements are met with tests.

**SECUA dimensions:**
- **S (Security):** No untrusted input reaches eval/innerHTML. All server responses pass narrowing guards before render. AbortController prevents orphaned fetches on unmount.
- **E (Error handling):** List-level error (`TasksTab.tsx:439-444`), per-row error (`TasksTab.tsx:572-576`), per-WBS non-fatal catch (`TasksTab.tsx:340-342`). Three-tier degradation.
- **C (Correctness):** Narrowing guards return `null` on any field mismatch, callers skip nulls. Active phase detection iterates from end (`TasksTab.tsx:592-598`).
- **U (Usability):** Empty state, loading state, expand/collapse, corpus lane visually distinct (dashed border + badge).
- **A (Architecture):** Append-only `tabs.ts` registration. No server changes. Reuses SystemEventsTab exports. Follows module conventions.
### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T18:34:15.607Z todo → wip (system)
- 2026-07-29T18:36:07.505Z wip → testing (system)
- 2026-07-29T18:37:43.536Z testing → done (system)
### Notes

```json
{
  "verdict": "PASS",
  "requirements": [
    {
      "id": "R1",
      "status": "MET",
      "evidence": "Run list fetches `GET /api/runs?limit=50` (`TasksTab.tsx:286,291`), renders each with WBS badge or 'unlinked' badge (`TasksTab.tsx:538-546`), workflow name (`:548`), status badge (`:550-552`), start time (`:559-561`). WBS index built from `/api/tasks` + `/api/runs/by-wbs/:wbs` (`:317,331`). Empty state at `:461-464`. Test: 'lists pipeline runs with WBS link, workflow name, status, start time'."
    },
    {
      "id": "R2",
      "status": "MET",
      "evidence": "Expand fetches `GET /api/runs/:runId` (`TasksTab.tsx:388`), parses detail, `RunDetailPanel` renders ordered phases (`:606-648`) with active/completed/failed distinction via `activePhaseIdx` (`:592-598`) and icon+badge (`:624-635`). Test: 'expands a run into ordered phase progress with active/completed/failed'."
    },
    {
      "id": "R3",
      "status": "MET",
      "evidence": "Action log at `TasksTab.tsx:670-708` renders node (`:681`), kind badge (`:682-684`), status badge (`:685-692`), duration via `formatDuration` (`:676,693`), failure reason from `extractFailureReason(action.resultSummary)` when `ok === false` (`:677-678,694-697`). Test: 'shows per-action log with node, kind, status, duration, failure reason'."
    },
    {
      "id": "R4",
      "status": "MET",
      "evidence": "Secondary corpus lane fetches `?prefix=task` and `?prefix=feature` (`TasksTab.tsx:287-288,292-293`), renders in dashed-border section with 'corpus-only' badge (`:486-498`), `CorpusEventRow` (`:722-744`). Test: 'renders secondary corpus lane with task.*/feature.* events'."
    },
    {
      "id": "R5",
      "status": "MET",
      "evidence": "Per-row detail fetch isolated in `toggleExpand` (`TasksTab.tsx:367-435`); failure sets per-row error in `detailCache` (`:392-400,421-430`), rendered inline (`:572-576`) while list stays usable. Test: 'degrades per-row when run detail fetch fails'."
    },
    {
      "id": "R6",
      "status": "MET",
      "evidence": "`tabs.ts:33` appends `{ id: 'tasks', label: 'Tasks', component: TasksTab }` to `OBSERVABILITY_TABS`; no shell edit. Test: 'is registered in OBSERVABILITY_TABS'."
    },
    {
      "id": "R7",
      "status": "MET",
      "evidence": "Narrowing guards `parseRunListEntry` (`TasksTab.tsx:83`), `parseRunListResponse` (`:108`), `parseRunPhase` (`:125`), `parseRunAction` (`:139`), `parseRunDetail` (`:162`), `parseWbsLinksResponse` (`:190`) - each returns `T | null` on mismatch. Tests: 'narrows untrusted run list input' and 'narrows untrusted run detail'."
    }
  ],
  "acceptanceCriteria": [
    {
      "id": "R13",
      "status": "MET",
      "evidence": "Pipeline runs listed with task WBS badge and status badge (`TasksTab.tsx:538-552`). Test covers list rendering."
    },
    {
      "id": "R14",
      "status": "MET",
      "evidence": "Run expands into ordered phase progress with active/completed/failed distinction (`TasksTab.tsx:600-651`). Test covers expand."
    },
    {
      "id": "R15",
      "status": "MET",
      "evidence": "Action log readable with node/kind/status/duration/failure (`TasksTab.tsx:670-708`). Test covers action log."
    },
    {
      "id": "R16",
      "status": "MET",
      "evidence": "Corpus-only task activity in secondary lane, visually distinct (`TasksTab.tsx:484-505`). Test covers corpus lane."
    },
    {
      "id": "R17",
      "status": "MET",
      "evidence": "Unavailable run detail degrades gracefully with inline error (`TasksTab.tsx:572-576`). Test covers per-row degrade."
    }
  ]
}
```

Verdict: PASS

