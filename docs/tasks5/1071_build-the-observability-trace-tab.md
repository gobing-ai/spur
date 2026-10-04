---
schema_version: 1
name: Build the Observability Trace tab
status: todo
template: feature-impl
created_at: 2026-10-04T02:46:12.531Z
updated_at: "2026-10-04T03:05:41.401Z"
feature_id: E72
priority: P2
tags:
  - observability
  - web
estimate_hours: 5

dependencies: ["1069", "1070"]
---

## 1071. Build the Observability Trace tab

### Background

Implements feature E72:

- R1, "The Observability module offers a Trace tab listing workflow runs"
- R2, "The run list narrows by workflow, status and time range"
- R3, "A run detail shows states, actions with durations and transitions"
- R4, "A run detail shows the bounded run-record text"
- R6, "A run links to System Events filtered by its run id"
- R7, "A run shows its History time window as copyable text"
- R8, "Host-reported and estimated action durations are labelled" (Board half)

Depends on 1069 (progress route, `workflowProgressProjectionSchema`, list filters) and 1070 (`provenance`/`estimated` on attempts). Design satellite: `docs/design/run-record-contract.md` § Feature E72. UI tokens and components: root `DESIGN.md`.

Verified current state (2026-10-03):

- `apps/web/src/modules/observability/tabs.ts`:
  - `ObservabilityTimeRange` (:8)
  - `ObservabilityNavIntent` (:18-20): `{tab:'jobs';jobId?} | {tab:'system-events';eventName?;runId?}`
  - `ObservabilityTabProps` (:29-33): `onLivenessChange?`, `timeRange` (required, shell-owned), `onNavigate?`
  - `OBSERVABILITY_TABS` (:52-57): summary, system-events, jobs, routing
- `TasksTab.tsx` (903 lines) has been unregistered since df9b03b68. It is self-contained, and its only importers are tests:
  - types :1-69
  - `parseRun*` and `parseRunRecordOutcome` helpers :70-241 (`parseRunRecordOutcome` at :216)
  - formatting helpers :242-307 (`formatLocalTime` :242, `statusBadgeVariant` :253)
  - the task-centric `TasksTab` :308-546 (runs plus WBS links plus a corpus lane)
  - `RunRow` :547
  - `RunDetailPanel` :623
  - `RunRecordSection({runId, traceStatus})` :757, which reads `GET /api/observability/run-record/:runId` and handles the outcomes missing, oversized, legacy, incomplete and record
  - `CorpusEventRow` :881
- Tests that import `TasksTab`:
  - `apps/web/tests/modules/observability/tasks-tab.test.tsx`: the whole file is the run-record test (happy-dom plus `setFetchForTesting`).
  - The block `apps/web/tests/modules/observability/components.test.tsx:1494-~1825`, with its import at :28.
  - `tests/modules/observability/tabs.test.ts:25-35` asserts the exact id list `['summary','system-events','jobs','routing']`. This changes intentionally.
- **Gap found:**
  - `ObservabilityShell.tsx:33-35` `handleNavigate` only calls `setActiveId(intent.tab)` and **drops `runId`/`eventName`**.
  - `SystemEventsTab` (:773) keeps its filter in local state (`useState(DEFAULT_FILTER)` :795; `runId` field :206) and never receives the intent.
  - The run-id links that already exist (`SummaryTab.tsx:290`, `JobDetailDrawer.tsx:167`) therefore switch tabs without filtering. R6 needs this fixed.
- Reusable pieces:
  - `timeRangeSince(range)` (`ObservabilityFilters.tsx:41`)
  - `formatDuration(ms)` (`SystemEventsTab.tsx:559`)
  - `CopyValueButton({value,label})` (`SystemEventsTab.tsx:719`)
  - `Badge`/`Button`/`Loading` from `@/ui`
  - `fetchWithTimeout`/`resolveApiUrl` from `../../lib/rpc-client`
  - The web already depends on `@gobing-ai/spur-contracts` (JobsTab imports it).
- `GET /api/runs` returns `{runs:[{id,workflowName,status,mode,agent,startedAt,completedAt}], count, nextCursor, hasMore}`. With 1069 it also takes `status`, `workflow`, `since`, `limit` and `cursor`.
- History: `spur history analyze` takes `--since <iso>`, `--until <iso>` (both inclusive on message timestamp) and `--run <runId>` (checked with `spur history analyze --help`, 2026-10-03). History has no URL or searchParams contract, so the link is text.

### Requirements

- [ ] R1. A new `apps/web/src/modules/observability/TraceTab.tsx` (default export `TraceTab(props: ObservabilityTabProps)`) is registered in `OBSERVABILITY_TABS` as `{ id: 'trace', label: 'Trace', component: TraceTab }`, after `jobs`.
  - Move `RunRecordSection`, `parseRunRecordOutcome`, the `RunListEntry` parsing, `formatLocalTime` and `statusBadgeVariant` from `TasksTab.tsx` into it.
  - Delete `TasksTab.tsx`, `tests/modules/observability/tasks-tab.test.tsx` and the TasksTab block in `components.test.tsx` (:1494-~1825, plus the import at :28).
  - No new Board module.
- [ ] R2. Run list:
  - It reads `GET /api/runs?limit=50` plus `status`, `workflow`, and `since = timeRangeSince(props.timeRange)` when the range is not `all`.
  - It is newest first, and **Load more** follows `nextCursor` with the same filters.
  - A status `<select>` offers `all`, `pending`, `running`, `paused`, `interrupted`, `done`, `failed` and `cancelled` (the values persisted in `runs.status`; see `packages/domain/src/dao/run-dao.ts:229-281`).
  - A workflow `<select>` offers "All workflows" plus the distinct `workflowName` values already loaded, and keeps the current selection.
  - Changing any filter, or the shell `timeRange`, resets paging and refetches.
  - Each row shows the workflow, a status badge, the start time (`formatLocalTime`), the duration (`completedAt − startedAt`, or "running") and the agent.
  - Empty state: "No workflow runs in this window". A fetch error is shown inline with a retry action.
- [ ] R3. Run detail:
  - Expanding a row fetches `GET /api/runs/:runId/progress` and parses it with `workflowProgressProjectionSchema.safeParse`. A parse failure shows "progress response failed schema validation"; a 404 shows "Run not found".
  - It shows the header (workflow, status, currentState, definitionDigest short form), then the states in projection order, each with visit number and status.
  - Each action shows `actionKey`, kind, status and, per attempt, `durationMs` via `formatDuration`. Multiple attempts are listed in order.
  - The three slowest attempts across the run (non-null `durationMs`) carry a `data-slowest` marker and a visual emphasis.
  - Below the states come transitions (`from → to`, trigger, `at`) and diagnostics (code plus message, warning style).
  - The detail is cached per runId while the tab is mounted.
- [ ] R4. Badges: an attempt with `provenance: 'host-reported'` shows a "host-reported" badge, and `estimated: true` adds an "estimated" badge. `unknown` shows no badge.
- [ ] R5. The detail embeds the moved `RunRecordSection`, which keeps its current outcomes. The absent-record message for `status: 'missing'` stays explicit.
- [ ] R6. System Events link:
  - The detail has a "System events for this run" button that calls `props.onNavigate?.({ tab: 'system-events', runId })`.
  - `ObservabilityShell` stores the last intent: `const [navIntent, setNavIntent] = useState<ObservabilityNavIntent | null>(null)`, set in `handleNavigate`, cleared when the user clicks a tab button.
  - The shell passes `navIntent` to the active tab through a new optional prop, `ObservabilityTabProps.navIntent?: ObservabilityNavIntent | null`.
  - `SystemEventsTab` applies `navIntent.runId` (when `navIntent?.tab === 'system-events'`) to its `filter.runId` and `debouncedFilter.runId` in an effect keyed on the intent.
  - This also makes the existing Summary and Jobs run links filter correctly.
- [ ] R7. History window: the detail shows the start and end of the run's window and a copyable command through `CopyValueButton`. The command is `spur history analyze --since <startedAt> --until <completedAt>`, or `--since` only while the run has no `completedAt`. The History module is unchanged.
- [ ] R8. Browser check against `spur self serve` on this repo's DB: open Observability → Trace, apply the filters, expand a run (states, durations, badges, record), follow the System Events link (filtered to the runId), copy the history command. Record the evidence in Testing.

### Acceptance Criteria

- [ ] AC1 — The Observability module offers a Trace tab listing workflow runs
- [ ] AC2 — The run list narrows by workflow, status and time range
- [ ] AC3 — A run detail shows states, actions with durations and transitions
- [ ] AC4 — A run detail shows the bounded run-record text
- [ ] AC5 — A run links to System Events filtered by its run id
- [ ] AC6 — A run shows its History time window as copyable text
- [ ] AC7 — Host-reported and estimated action durations are labelled

Task-local verification (happy-dom component tests with `setFetchForTesting`, following `tests/modules/observability/tasks-tab.test.tsx:1-60`):

- `tabs.test.ts`: the exact id list becomes `['summary','system-events','jobs','trace','routing']`, and `tasks` stays absent.
- The list request URL contains `status=failed&workflow=task-pipeline&since=` after the filters change. `timeRange='all'` sends no `since`. **Load more** sends `cursor=` plus the same filters.
- Expanding a run renders the states, action durations and transitions from a projection fixture. The slowest attempt has `data-slowest`. A schema-invalid body shows the validation message.
- The host-reported and estimated badges render for stamped attempts, and no badge renders for `unknown`.
- The run record still loads, and the missing outcome shows the explicit message.
- Clicking "System events for this run" calls `onNavigate({tab:'system-events', runId:'run-1'})`. In a shell test, the System Events filter input then holds `run-1`.
- The history command text equals `spur history analyze --since 2026-09-23T10:00:00.000Z --until 2026-09-23T10:01:00.000Z` for the fixture run.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-04T03:01:12.623Z

- **Q: Re-register `TasksTab` or build a new tab?** A: Build `TraceTab` from TasksTab's run pieces and delete the rest. The task-centric list, the WBS fan-out (one `/api/runs/by-wbs` request per task) and the corpus lane are the §6.3 gap that got TasksTab removed.
- **Q: Detail source: `/api/runs/:runId` or `/progress`?** A: `/progress` (1069). It is the projection the CLI reads, and R5/AC "one progress projection" depends on it. `/api/runs/:runId` stays for the existing consumers.
- **Q: Where do the workflow filter options come from?** A: The distinct `workflowName` values already loaded. `/api/workflows` reads and renders every YAML (`apps/server/src/modules/health/index.ts:738-800`), which is too heavy for a filter. ponytail: a workflow absent from the loaded pages is not offered. Add a distinct-names endpoint if that turns out to matter.
- **Q: Why the shell intent fix?** A: Without it, AC5 cannot pass. `handleNavigate` drops `runId` today (`ObservabilityShell.tsx:33-35`). The fix is the smallest change that makes the existing intent type mean what it says: one state value and one optional prop.
- **Q: A `{ tab: 'trace'; runId }` intent?** A: Dropped. No producer exists yet. Add it when System Events or History links back to a run.
- **Q: A History deep link?** A: Not in this task. History has no searchParams contract and the feature keeps History unchanged. Copyable text built from `spur history analyze --since/--until` (flags verified with `--help`) gives the window today. `--run` is left out, because inline run→session linkage is a separate follow-up.
- **Q: Status filter values?** A: The run-store status vocabulary that `/api/runs?status=` already accepts. The select only constrains what the user can pick.

### Design

- Chosen:
  - One run-centric `TraceTab` in the existing Observability module.
  - The list comes from `/api/runs` with server-side filters, and the detail from `/api/runs/:runId/progress`, validated with the shared contract schema.
  - The moved `RunRecordSection`.
  - A shell intent fix so cross-tab run links filter.
  - History as copyable CLI text.
- Rejected:
  - Re-registering TasksTab as-is.
  - A new Board module.
  - A web-side parser duplicating the projection shape (the contract schema is the single shape).
  - Client-side filtering (breaks paging).
  - A History deep link (no contract).
- Invariants:
  - Read-only.
  - The shell owns `timeRange`; tabs only read it.
  - The Summary, System Events, Jobs and Routing behaviour is unchanged apart from the intent filter now applying.
  - No tab keeps its own time-range state.
- Key signatures:
  ```ts
  // tabs.ts
  export interface ObservabilityTabProps { onLivenessChange?; timeRange: ObservabilityTimeRange; onNavigate?; navIntent?: ObservabilityNavIntent | null; }
  export const OBSERVABILITY_TABS = [summary, system-events, jobs, { id: 'trace', label: 'Trace', component: TraceTab }, routing];

  // TraceTab.tsx
  export default function TraceTab({ timeRange, onNavigate }: ObservabilityTabProps): JSX.Element;
  export function buildRunsUrl(base: string, f: { status?: string; workflow?: string; since?: string; cursor?: string; limit: number }): string; // exported for tests
  export function historyCommand(run: { startedAt: string; completedAt: string | null }): string;
  export function slowestAttemptIds(p: WorkflowProgressProjectionDto, n = 3): Set<string>;
  ```
- Component layout:
  - Filter bar: status select, workflow select, count.
  - Run table: a row button toggles the detail.
  - Detail sections, in order: header, States, Transitions, Diagnostics (when non-empty), Run record, Links (System events button, History window plus copy).
  - Badges use the `statusBadgeVariant` vocabulary: `neutral|info|success|warning|error`. host-reported is `info`; estimated is `warning`.
- Accessibility: each row toggle is a `<button aria-expanded>`, the selects have `<label>`s, and the copy button carries the existing `aria-label` pattern.

### Plan

- [ ] 1. Tests first:
  - Write `apps/web/tests/modules/observability/trace-tab.test.tsx`, porting `tasks-tab.test.tsx`'s setup: `registerHappyDom`, `setFetchForTesting`, `jsonResponse`. It covers the list URL plus filters, paging, detail rendering, badges, slowest, the record, onNavigate, the history command and the schema-invalid path.
  - Update `tabs.test.ts:25-35` to the new exact id list.
  - Add a shell intent test: render `ObservabilityShell`, trigger the intent, assert the System Events run-id filter value.
- [ ] 2. Create `TraceTab.tsx`: move the reusable pieces from `TasksTab.tsx` (:70-123, :216-241, :242-261, :757-880), then write the list, filters, detail and links.
- [ ] 3. `tabs.ts`: add the `navIntent?` prop and register `trace`. `ObservabilityShell.tsx`: add the `navIntent` state, set it in `handleNavigate`, clear it on a tab click, and pass it to `<Active>` (:132).
- [ ] 4. `SystemEventsTab.tsx`: accept `navIntent` and add an effect that applies `runId` to `filter`/`debouncedFilter` (:795-797).
- [ ] 5. Delete `TasksTab.tsx`, `tasks-tab.test.tsx` and the `components.test.tsx` TasksTab block and import. Then check that `rg -n "observability/TasksTab" apps/web` returns nothing.
- [ ] 6. Docs: in the run-record-contract Feature E72 section, change "proposed" to "implemented" for the tab and note the shell intent fix. Update `DESIGN.md` only if a new shared pattern was introduced (none is expected).
- [ ] 7. Gates:
  - `(cd apps/web && bun test tests/modules/observability/)`
  - `bun run typecheck`
  - `bun run spur-check`
  - `bun run build`
- [ ] 8. Browser check (R8) against `spur self serve` with the Chrome tools: screenshot or GIF of the list, filters, detail with badges, System Events filtered, and the copied command. Put the evidence paths in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/O_observability-trace-tab-for-workflow-run-inspection.md`, R1-R4, R6, R7, R8.
- Design: `docs/design/run-record-contract.md` § Feature E72 (and §6.3, the TasksTab WBS gap); root `DESIGN.md` (tokens and components).
- Tab registry and props: `apps/web/src/modules/observability/tabs.ts:8,18-20,29-33,52-57`.
- Shell: `apps/web/src/modules/observability/ObservabilityShell.tsx:18,33-35,110,132`.
- Source of the moved pieces: `apps/web/src/modules/observability/TasksTab.tsx:70-123,216-261,547,623,757-880`.
- Helpers: `ObservabilityFilters.tsx:31-45` (`TIME_RANGE_MS`, `timeRangeSince`); `SystemEventsTab.tsx:559` (`formatDuration`), :719 (`CopyValueButton`), :773/:795 (tab and filter state), :206 (`runId` default).
- Existing run-id intent producers: `SummaryTab.tsx:290`, `JobDetailDrawer.tsx:167`.
- Tests: `apps/web/tests/modules/observability/{tabs.test.ts,tasks-tab.test.tsx,components.test.tsx:28,1494-1825}`.
- Upstream: 1069 (route, schema, filters), 1070 (attempt provenance).
- CLI parity: `spur workflow progress <run-id>`; `spur history analyze --since/--until` (from `--help`).

### History
