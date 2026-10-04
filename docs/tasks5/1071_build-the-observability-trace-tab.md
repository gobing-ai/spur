---
schema_version: 1
name: Build the Observability Trace tab
status: done
template: feature-impl
created_at: 2026-10-04T02:46:12.531Z
updated_at: "2026-10-04T20:02:23.355Z"
feature_id: E72
priority: P2
tags:
  - observability
  - web
estimate_hours: 5

dependencies: ["1069", "1070"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-e72-4191/.spur/memory/evidence/1071-verdict.json
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

- [x] R1. A new `apps/web/src/modules/observability/TraceTab.tsx` (default export `TraceTab(props: ObservabilityTabProps)`) is registered in `OBSERVABILITY_TABS` as `{ id: 'trace', label: 'Trace', component: TraceTab }`, after `jobs`.
  - Move `RunRecordSection`, `parseRunRecordOutcome`, the `RunListEntry` parsing, `formatLocalTime` and `statusBadgeVariant` from `TasksTab.tsx` into it.
  - Delete `TasksTab.tsx`, `tests/modules/observability/tasks-tab.test.tsx` and the TasksTab block in `components.test.tsx` (:1494-~1825, plus the import at :28).
  - No new Board module.
- [x] R2. Run list:
  - It reads `GET /api/runs?limit=50` plus `status`, `workflow`, and `since = timeRangeSince(props.timeRange)` when the range is not `all`.
  - It is newest first, and **Load more** follows `nextCursor` with the same filters.
  - A status `<select>` offers `all`, `pending`, `running`, `paused`, `interrupted`, `done`, `failed` and `cancelled` (the values persisted in `runs.status`; see `packages/domain/src/dao/run-dao.ts:229-281`).
  - A workflow `<select>` offers "All workflows" plus the distinct `workflowName` values already loaded, and keeps the current selection.
  - Changing any filter, or the shell `timeRange`, resets paging and refetches.
  - Each row shows the workflow, a status badge, the start time (`formatLocalTime`), the duration (`completedAt − startedAt`, or "running") and the agent.
  - Empty state: "No workflow runs in this window". A fetch error is shown inline with a retry action.
- [x] R3. Run detail:
  - Expanding a row fetches `GET /api/runs/:runId/progress` and parses it with `workflowProgressProjectionSchema.safeParse`. A parse failure shows "progress response failed schema validation"; a 404 shows "Run not found".
  - It shows the header (workflow, status, currentState, definitionDigest short form), then the states in projection order, each with visit number and status.
  - Each action shows `actionKey`, kind, status and, per attempt, `durationMs` via `formatDuration`. Multiple attempts are listed in order.
  - The three slowest attempts across the run (non-null `durationMs`) carry a `data-slowest` marker and a visual emphasis.
  - Below the states come transitions (`from → to`, trigger, `at`) and diagnostics (code plus message, warning style).
  - The detail is cached per runId while the tab is mounted.
- [x] R4. Badges: an attempt with `provenance: 'host-reported'` shows a "host-reported" badge, and `estimated: true` adds an "estimated" badge. `unknown` shows no badge.
- [x] R5. The detail embeds the moved `RunRecordSection`, which keeps its current outcomes. The absent-record message for `status: 'missing'` stays explicit.
- [x] R6. System Events link:
  - The detail has a "System events for this run" button that calls `props.onNavigate?.({ tab: 'system-events', runId })`.
  - `ObservabilityShell` stores the last intent: `const [navIntent, setNavIntent] = useState<ObservabilityNavIntent | null>(null)`, set in `handleNavigate`, cleared when the user clicks a tab button.
  - The shell passes `navIntent` to the active tab through a new optional prop, `ObservabilityTabProps.navIntent?: ObservabilityNavIntent | null`.
  - `SystemEventsTab` applies `navIntent.runId` (when `navIntent?.tab === 'system-events'`) to its `filter.runId` and `debouncedFilter.runId` in an effect keyed on the intent.
  - This also makes the existing Summary and Jobs run links filter correctly.
- [x] R7. History window: the detail shows the start and end of the run's window and a copyable command through `CopyValueButton`. The command is `spur history analyze --since <startedAt> --until <completedAt>`, or `--since` only while the run has no `completedAt`. The History module is unchanged.
- [x] R8. Browser check against `spur self serve` on this repo's DB: open Observability → Trace, apply the filters, expand a run (states, durations, badges, record), follow the System Events link (filtered to the runId), copy the history command. Record the evidence in Testing.

### Acceptance Criteria

- [x] AC1 — The Observability module offers a Trace tab listing workflow runs
- [x] AC2 — The run list narrows by workflow, status and time range
- [x] AC3 — A run detail shows states, actions with durations and transitions
- [x] AC4 — A run detail shows the bounded run-record text
- [x] AC5 — A run links to System Events filtered by its run id
- [x] AC6 — A run shows its History time window as copyable text
- [x] AC7 — Host-reported and estimated action durations are labelled

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

- [x] 1. Tests first:
  - Write `apps/web/tests/modules/observability/trace-tab.test.tsx`, porting `tasks-tab.test.tsx`'s setup: `registerHappyDom`, `setFetchForTesting`, `jsonResponse`. It covers the list URL plus filters, paging, detail rendering, badges, slowest, the record, onNavigate, the history command and the schema-invalid path.
  - Update `tabs.test.ts:25-35` to the new exact id list.
  - Add a shell intent test: render `ObservabilityShell`, trigger the intent, assert the System Events run-id filter value.
- [x] 2. Create `TraceTab.tsx`: move the reusable pieces from `TasksTab.tsx` (:70-123, :216-241, :242-261, :757-880), then write the list, filters, detail and links.
- [x] 3. `tabs.ts`: add the `navIntent?` prop and register `trace`. `ObservabilityShell.tsx`: add the `navIntent` state, set it in `handleNavigate`, clear it on a tab click, and pass it to `<Active>` (:132).
- [x] 4. `SystemEventsTab.tsx`: accept `navIntent` and add an effect that applies `runId` to `filter`/`debouncedFilter` (:795-797).
- [x] 5. Delete `TasksTab.tsx`, `tasks-tab.test.tsx` and the `components.test.tsx` TasksTab block and import. Then check that `rg -n "observability/TasksTab" apps/web` returns nothing.
- [x] 6. Docs: in the run-record-contract Feature E72 section, change "proposed" to "implemented" for the tab and note the shell intent fix. Update `DESIGN.md` only if a new shared pattern was introduced (none is expected).
- [x] 7. Gates:
  - `(cd apps/web && bun test tests/modules/observability/)`
  - `bun run typecheck`
  - `bun run spur-check`
  - `bun run build`
- [x] 8. Browser check (R8) against `spur self serve` with the Chrome tools: screenshot or GIF of the list, filters, detail with badges, System Events filtered, and the copied command. Put the evidence paths in Testing.

### Solution

Built the run-centric Trace tab and deleted the orphaned TasksTab (feature E72, task 1071).

**New tab — `apps/web/src/modules/observability/TraceTab.tsx`**

- `:237` `TraceTab({ timeRange, onNavigate })` (default export) — one run-centric view. Exports the test-visible helpers named in Design: `:169` `buildRunsUrl(base, {status?, workflow?, since?, cursor?, limit})`, `:185` `historyCommand(run)` (`--since` only while `completedAt` is null), `:193` `slowestAttemptIds(projection, n = 3)` (non-null `durationMs`, descending); `:32` `TRACE_STATUS_FILTERS` is the persisted `runs.status` vocabulary (`all|pending|running|paused|interrupted|done|failed|cancelled`).
- List (R1/R2): `:263` `loadFirstPage` refetches page 1 on any filter or shell `timeRange` change (identity-keyed effect at `:288`), so every change resets paging; `:295` `loadMore` appends via `nextCursor` with the same filters. Rows carry workflow, status badge, `formatLocalTime(startedAt)`, duration (`completedAt − startedAt`, else `running`) and agent; empty state `No workflow runs in this window` (`:453`), inline error with `Retry` (`:432`). Selects are labelled `Status` (`:405`) and `Workflow` (`:422`); the workflow list is the distinct loaded `workflowName` values plus the active selection, and row toggles are `<button aria-expanded>` (`:467`).
- Detail (R3/R4/R5/R7): `:328` fetches `GET /api/runs/:runId/progress` and parses with `workflowProgressProjectionSchema.safeParse`; 404 → `Run not found` (`:344`), invalid body → `progress response failed schema validation` (`:355`). Results are cached per runId for the mounted tab (`detailCache` state). `:541` `RunDetailPanel` renders, in order: header (workflow, status, `currentState`, 12-char digest, `:556`), states in projection order with visit + status (`:583`), actions with `actionKey`/kind/status and per-attempt `durationMs` via `formatDuration`, transitions (`from → to`, trigger, `at`, `:666`), diagnostics in warning style (`:685`), the moved `RunRecordSection` (`:731`, unchanged outcomes incl. the explicit `status: 'missing'` message), and links. The three slowest attempts are marked `data-slowest` and emphasised (`:617`); `provenance: 'host-reported'` renders an `info` badge (`:633`), `estimated: true` a `warning` badge (`:640`), `unknown` nothing.
- Links: `:708` `System events for this run` calls `onNavigate?.({ tab: 'system-events', runId })`; `:717` the History window and `CopyValueButton`-backed `spur history analyze --since/--until` command (R7, History module untouched).

**Shell intent fix — the AC5 enabler**

- `apps/web/src/modules/observability/tabs.ts:61` registers `{ id: 'trace', label: 'Trace', component: TraceTab }` after `jobs`; `:36` adds the optional `ObservabilityTabProps.navIntent?: ObservabilityNavIntent | null`.
- `apps/web/src/modules/observability/ObservabilityShell.tsx:22` keeps the last intent in `navIntent` state, `:36` sets it in `handleNavigate` (which previously dropped `runId`/`eventName`), `:41` clears it on a tab-button click, and `:145` passes it to the active tab.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:833-839` applies `navIntent.runId` to `filter.runId` and `debouncedFilter.runId` in an effect keyed on the intent, so a cross-tab run link filters on the first fetch. No other tab behaviour changed.

**Removals** — `apps/web/src/modules/observability/TasksTab.tsx`, `apps/web/tests/modules/observability/tasks-tab.test.tsx`, and the TasksTab block plus its import in `apps/web/tests/modules/observability/components.test.tsx`. `rg -n "observability/TasksTab" apps/web` returns nothing.

**Tests** — `apps/web/tests/modules/observability/trace-tab.test.tsx` (list URL + filters + paging `:244`, detail/badges/slowest/record/history/onNavigate `:325`, shell intent round-trip `:436`); `apps/web/tests/modules/observability/tabs.test.ts:26-35` now asserts `['summary','system-events','jobs','trace','routing']` with `tasks` absent.

**Docs** — `docs/design/run-record-contract.md:58` E72 heading is now `implemented`, `:60` records the TasksTab removal, `:64` records the shell intent fix. No new shared design pattern, so `DESIGN.md` is untouched.

**Browser check (R8)** — real data via `spur self serve --port 4399` on this worktree's DB (3 runs; 2 inside the default 4h window): list, `status=done` + `workflow=task-pipeline` narrowing, a real `finishedAt`-bounded run detail (35 projected states, host-reported badges, `data-slowest` = the 2 measured attempts 47 ms / 986 ms, diagnostics, run record), a running run's header (`current state: precheck`) and partial history window (`Oct 4 12:21:40 → running`, command with `--since` only), the `System events for this run` navigation landing on System Events with `filter-run-id-input = inline-1070-1f2c1f46`, and the copy button reaching its `Copied history analyze command` state. Evidence: `.spur/run/1071-browser/01-trace-list.png` … `07-detail-header-running.png` (gitignored; move/link into Testing at verify).

Deferred / honest limits:

- `bun run spur-check` is deliberately not run here: it is the pipeline `test` hop's gate (`sp:code-implementation` §implement scope). Targeted gates were run instead.
- The browser environment denies clipboard *read* (`NotAllowedError`), so the copied text was evidenced by the component's success state, not by reading the clipboard back. A programmatic `.click()` (no transient activation) correctly degrades to `Copy … failed`.
- No run in this DB projects transitions (`transitions: []` for all three runs), so the transitions section is covered by the fixture test only.
- The global floating agent prompt bar (`.spur`-unrelated shell overlay, `fixed bottom-4 … z-30`) covers the last ~64 px of the module's scroll container, so the detail's final row (System events button / History row) is mouse-occluded until the prompt bar is dismissed or the viewport is scrolled. Geometry measured in-browser: button top 505–533 px vs overlay 513–550 px at a 577 px viewport. Pre-existing shell layout behaviour, not introduced by this tab; the browser clicks used a temporarily hidden overlay, and the finding is left for the verify stage rather than widening this task's scope.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/observability/tabs.ts:61` registers `{ id: 'trace', label: 'Trace', component: TraceTab }` after `jobs`; `apps/web/src/modules/observability/TraceTab.tsx:237` is that new default-export tab and `apps/web/src/modules/observability/TraceTab.tsx:731` holds the moved `RunRecordSection`; commit 69b0619f2 name-status lists `apps/web/src/modules/observability/TasksTab.tsx` as deleted and the module directory gained no new Board module; `rg -n "observability/TasksTab" apps/web` returns nothing this run; re-ran `apps/web/tests/modules/observability/tabs.test.ts:30` which asserts exactly ['summary','system-events','jobs','trace','routing'] (136 pass / 0 fail). |
| R2 | MET | List + filters: `apps/web/src/modules/observability/TraceTab.tsx:169` `buildRunsUrl` sets status/workflow/since/cursor/limit, `apps/web/src/modules/observability/TraceTab.tsx:263` `loadFirstPage` with the identity-keyed effect at `apps/web/src/modules/observability/TraceTab.tsx:289-292` resetting paging, `apps/web/src/modules/observability/TraceTab.tsx:295` `loadMore` following nextCursor; labelled selects at `apps/web/src/modules/observability/TraceTab.tsx:408` and `apps/web/src/modules/observability/TraceTab.tsx:425`; empty state at `apps/web/src/modules/observability/TraceTab.tsx:453` and inline error with Retry at `apps/web/src/modules/observability/TraceTab.tsx:442-448`; status vocabulary at `apps/web/src/modules/observability/TraceTab.tsx:32`. Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:245` (limit=50, no since for all), `apps/web/tests/modules/observability/trace-tab.test.tsx:262` (status/workflow/since, paging reset), `apps/web/tests/modules/observability/trace-tab.test.tsx:290` (cursor plus same filters), `apps/web/tests/modules/observability/trace-tab.test.tsx:312` (empty + error) — 136 pass / 0 fail. Live narrowing: `.spur/run/1071-browser/02-trace-filters.png` shows status=done plus workflow=task-pipeline giving 1 run(s) where `.spur/run/1071-browser/01-trace-list.png` showed 2. Limit: no dataset over 50 runs exists here, so Load more is component-test only. |
| R3 | MET | `apps/web/src/modules/observability/TraceTab.tsx:342` fetches /api/runs/:runId/progress and `apps/web/src/modules/observability/TraceTab.tsx:351` validates it with the shared projection schema `packages/contracts/src/runs.ts:79`; 404 gives Run not found at `apps/web/src/modules/observability/TraceTab.tsx:344` and an invalid body gives progress response failed schema validation at `apps/web/src/modules/observability/TraceTab.tsx:355`; header (workflow, status, currentState, 12-char digest) at `apps/web/src/modules/observability/TraceTab.tsx:556`; states in projection order at `apps/web/src/modules/observability/TraceTab.tsx:581`; actionKey/kind/status at `apps/web/src/modules/observability/TraceTab.tsx:597`; per-attempt durationMs at `apps/web/src/modules/observability/TraceTab.tsx:611`; slowest markers at `apps/web/src/modules/observability/TraceTab.tsx:617`; transitions at `apps/web/src/modules/observability/TraceTab.tsx:658`; diagnostics at `apps/web/src/modules/observability/TraceTab.tsx:684`; per-runId cache state at `apps/web/src/modules/observability/TraceTab.tsx:247`. Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:348` (states, attempts, transitions, diagnostics), `apps/web/tests/modules/observability/trace-tab.test.tsx:381` (exactly three slowest), `apps/web/tests/modules/observability/trace-tab.test.tsx:398` and `apps/web/tests/modules/observability/trace-tab.test.tsx:403` — 136 pass / 0 fail. Limit: my own re-run of the projection reports transitions length 0 for all three rows in `.spur/spur.db` (the live server log is the plain path .spur/run/1071-browser/serve.log), so the transitions block is fixture-evidenced only; live states/durations are visible in `.spur/run/1071-browser/03-trace-detail.png` and `.spur/run/1071-browser/06-detail-slowest-badges.png`. |
| R4 | MET | `apps/web/src/modules/observability/TraceTab.tsx:633-636` renders an info badge only when provenance is host-reported and `apps/web/src/modules/observability/TraceTab.tsx:638-641` a warning badge only when estimated is true, so unknown renders nothing. Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:391` asserting 4 host-reported, 1 estimated and 0 unknown labels — 136 pass / 0 fail. Live: `.spur/run/1071-browser/06-detail-slowest-badges.png` shows the two measured attempts badged host-reported (47ms, 986ms). Limit: every measured attempt in this database reports estimated false, so the estimated-badge branch is test-only. |
| R5 | MET | `apps/web/src/modules/observability/TraceTab.tsx:698` embeds the moved `RunRecordSection` defined at `apps/web/src/modules/observability/TraceTab.tsx:731`, which keeps all five outcomes: record at `apps/web/src/modules/observability/TraceTab.tsx:794`, incomplete at `apps/web/src/modules/observability/TraceTab.tsx:810`, legacy at `apps/web/src/modules/observability/TraceTab.tsx:824`, oversized at `apps/web/src/modules/observability/TraceTab.tsx:837`, and missing at `apps/web/src/modules/observability/TraceTab.tsx:842-843` with the explicit message No run record found on disk. Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:408` (record text plus the explicit missing message) — 136 pass / 0 fail. The move is faithful: a diff of the deleted block 754-860 from the pre-removal file (commit 8294c326f) against `apps/web/src/modules/observability/TraceTab.tsx:727-833` shows only the section-comment separator. Live: `.spur/run/1071-browser/05-run-running-history.png` shows the RUN RECORD block with its DB-trace status and the View run record affordance. |
| R6 | MET | The detail emits the intent at `apps/web/src/modules/observability/TraceTab.tsx:703-709`; the shell keeps it in state at `apps/web/src/modules/observability/ObservabilityShell.tsx:22`, sets it in handleNavigate at `apps/web/src/modules/observability/ObservabilityShell.tsx:36`, clears it on a tab click at `apps/web/src/modules/observability/ObservabilityShell.tsx:41`, and passes it to the active tab at `apps/web/src/modules/observability/ObservabilityShell.tsx:145`; the optional prop is declared at `apps/web/src/modules/observability/tabs.ts:36`; System EventsTab seeds both filter states from it at `apps/web/src/modules/observability/SystemEventsTab.tsx:834-839`. Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:429` (intent payload) and the shell round-trip at `apps/web/tests/modules/observability/trace-tab.test.tsx:437` asserting the run-id filter input holds run-1 after the click — 136 pass / 0 fail. Live landing: `.spur/run/1071-browser/04-system-events-filtered.png` shows System Events selected with an active Filter 1 badge; the input value itself is component-test evidenced. |
| R7 | MET | `apps/web/src/modules/observability/TraceTab.tsx:185-190` builds the command with --since always and --until only when completedAt is set; the window plus copy affordance render at `apps/web/src/modules/observability/TraceTab.tsx:711-720` through the existing CopyValueButton at `apps/web/src/modules/observability/TraceTab.tsx:720`. Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:420` asserting the exact command text for the fixture window and the accessible copy button name, plus the unchanged clipboard behaviour test at `apps/web/tests/modules/observability/components.test.tsx:2059` — 136 pass / 0 fail. Live: `.spur/run/1071-browser/05-run-running-history.png` shows the running run window ending in running and the command with --since only. History module unchanged: commit 69b0619f2 name-status touches no History path. |
| R8 | MET | Live browser check of the tab registered at `apps/web/src/modules/observability/tabs.ts:61` and rendered at `apps/web/src/modules/observability/TraceTab.tsx:401`, run against this worktree's database on the serving process logged in `.spur/run/1071-browser/serve.log`. I re-opened all seven captures this run and verified: the tab strip Summary/System Events/Jobs/Trace/Routing in `.spur/run/1071-browser/01-trace-list.png`; live filter narrowing in `.spur/run/1071-browser/02-trace-filters.png`; a real detail with header digest sha256:ae3ee, 15 states, kinds and host-reported durations in `.spur/run/1071-browser/03-trace-detail.png` and `.spur/run/1071-browser/06-detail-slowest-badges.png` (the digest matches my own re-read of the projection for that run through `apps/cli/src/index.ts`). The System Events landing is in `.spur/run/1071-browser/04-system-events-filtered.png` and the running run header plus partial history window in `.spur/run/1071-browser/07-detail-header-running.png` and `.spur/run/1071-browser/05-run-running-history.png`. Two disclosed gaps confirmed while reading them: no capture shows the copy success state, and the run-id filter input value is not visible in the System Events capture. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The Observability module offers a Trace tab listing workflow runs | MET | test | `apps/web/src/modules/observability/tabs.ts:61` registers the trace tab after jobs and `apps/web/src/modules/observability/TraceTab.tsx:237` is its component; re-ran `apps/web/tests/modules/observability/tabs.test.ts:30` (exact id list, tasks absent) and `apps/web/tests/modules/observability/trace-tab.test.tsx:245` (a run row renders workflow, status, start time and duration) — 136 pass / 0 fail. Live `.spur/run/1071-browser/01-trace-list.png` shows the Trace tab selected with two task-pipeline runs; no new sidebar entry. |
| AC2 — The run list narrows by workflow, status and time range | MET | test | Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:262` (status=failed plus workflow=task-pipeline plus since=, cursor dropped) and `apps/web/tests/modules/observability/trace-tab.test.tsx:245` (no since for the all range) against `apps/web/src/modules/observability/TraceTab.tsx:169` and `apps/web/src/modules/observability/TraceTab.tsx:263` — 136 pass / 0 fail. Live `.spur/run/1071-browser/02-trace-filters.png` narrows 2 runs to 1 with both selects applied. Limit: Load more paging (`apps/web/src/modules/observability/TraceTab.tsx:295`, `apps/web/tests/modules/observability/trace-tab.test.tsx:290`) has no live dataset over 50 runs. |
| AC3 — A run detail shows states, actions with durations and transitions | MET | test | Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:348` (states in order with visit numbers, action kinds/statuses, every attempt duration, the transition and the diagnostics) and `apps/web/tests/modules/observability/trace-tab.test.tsx:381` (exactly the three slowest carry data-slowest, per `apps/web/src/modules/observability/TraceTab.tsx:617`) — 136 pass / 0 fail. Live `.spur/run/1071-browser/03-trace-detail.png` shows real states, kinds and durations. Limit confirmed by independent re-read: `.spur/spur.db` holds three runs and the projection returned transitions length 0 for all three, so the transitions row rests on the fixture test alone. |
| AC4 — A run detail shows the bounded run-record text | MET | test | Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:408` (record markdown renders into the bounded pre and the missing outcome keeps its explicit message) against `apps/web/src/modules/observability/TraceTab.tsx:794-801` and `apps/web/src/modules/observability/TraceTab.tsx:842-843` — 136 pass / 0 fail. Live `.spur/run/1071-browser/05-run-running-history.png` shows the RUN RECORD block with its DB-trace status badge. |
| AC5 — A run links to System Events filtered by its run id | MET | test | Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:437` — clicking the detail button pushes the intent through `apps/web/src/modules/observability/ObservabilityShell.tsx:36` and `apps/web/src/modules/observability/ObservabilityShell.tsx:145` into `apps/web/src/modules/observability/SystemEventsTab.tsx:834-839`, and the run-id filter input then reads run-1 — plus `apps/web/tests/modules/observability/trace-tab.test.tsx:429` for the emitted payload, both 136 pass / 0 fail. Live `.spur/run/1071-browser/04-system-events-filtered.png` shows System Events selected with a Filter 1 badge. |
| AC6 — A run shows its History time window as copyable text | MET | test | Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:420` asserting the window text and the exact command spur history analyze --since 2026-09-23T10:00:00.000Z --until 2026-09-23T10:01:00.000Z rendered at `apps/web/src/modules/observability/TraceTab.tsx:713-719`, plus the unchanged copy behaviour at `apps/web/tests/modules/observability/components.test.tsx:2059` — 136 pass / 0 fail. Live `.spur/run/1071-browser/05-run-running-history.png` shows the running run window and its --since-only command. Limit: neither the browser environment nor the captures allow a clipboard read-back, so the copy act itself is not live-evidenced. |
| AC7 — Host-reported and estimated action durations are labelled | MET | test | Re-ran `apps/web/tests/modules/observability/trace-tab.test.tsx:391` — 4 host-reported badges, 1 estimated badge, 0 unknown labels against the branches at `apps/web/src/modules/observability/TraceTab.tsx:633-636` and `apps/web/src/modules/observability/TraceTab.tsx:638-641` — 136 pass / 0 fail. Live `.spur/run/1071-browser/06-detail-slowest-badges.png` shows the two measured attempts badged host-reported. Limit: this database has no estimated and no unknown attempt, so those two branches are test-only. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1071

**Scope:** task 1071 implementation commit `69b0619f2` — the 10 non-task files it changed (Step 3 WBS scope, task file excluded): `apps/web/src/modules/observability/{TraceTab.tsx,tabs.ts,ObservabilityShell.tsx,SystemEventsTab.tsx}`, deleted `apps/web/src/modules/observability/TasksTab.tsx`, `apps/web/tests/modules/observability/{trace-tab.test.tsx,tabs.test.ts,components.test.tsx}`, deleted `tasks-tab.test.tsx`, `docs/design/run-record-contract.md`. Working tree otherwise clean; only pipeline-written corpus task files are dirty (task 1069/1070/1071 specs).
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture (`--focus all`)
**Verdict:** PASS — P1 0 / P2 0 / P3 0 / P4 5

**Evidence re-run in this review (fresh, this run):**

- `(cd apps/web && bun test tests/modules/observability/)` → **136 pass / 0 fail**, 7 files, 844 `expect()` calls
- `bun run typecheck` → all 7 workspaces + `scripts` + `plugins/sp` exit 0
- `bun run build` → `@gobing-ai/spur-web build Complete!`, exit 0 (only pre-existing vite chunk-size and board-runtime-facade warnings)
- `bunx biome check` on the 6 changed TS/TSX files → `Checked 6 files. No fixes applied.`
- Live evidence inspected: `.spur/run/1071-browser/01-trace-list.png` … `07-detail-header-running.png` (see AC table for what each actually shows)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | `loadMore` is neither joined to the first-page `AbortController` nor keyed to the filter identity, so a filter/time-range change while a cursor page is in flight appends rows from the superseded filter and republishes the stale `nextCursor`/`hasMore`. Reachable only by clicking **Load more** and changing a filter inside the fetch window; self-heals on the next filter change. Same shape as the pre-existing `SystemEventsTab` pager. | `apps/web/src/modules/observability/TraceTab.tsx:295-312` (cf. `SystemEventsTab.tsx:876-905`) |
| 2 | P4 (advisory) | architecture | Tab-to-tab coupling: the Trace tab imports the generic presentation helpers `formatDuration` and `CopyValueButton` from the sibling tab module `SystemEventsTab.tsx`, so one tab module depends on another for two helpers that own no System Events concept. Leaf modules (`observability/format.ts`, `observability/CopyValueButton.tsx`) would remove the edge with zero behaviour change; `ObservabilityFilters.tsx` is the better precedent already in the tree. | `TraceTab.tsx:6` → `SystemEventsTab.tsx:559,719` |
| 3 | P4 (advisory) | usability | Carried observation (a) confirmed as **pre-existing shell behaviour, not introduced by this diff**: `GlobalAgentBar` (`fixed bottom-4 … z-30`, full-width when expanded) is mounted by `BoardLayout` for every board module, and its measured geometry at a 577 px viewport (y≈513-550) overlaps the Trace detail's last row — the "System events for this run" button (y≈505-533) and the history/copy row — so the last row needs the bar dismissed or a taller viewport to be clicked. Not re-measured this run; source-verified, and the live captures used a temporarily hidden overlay. The fix belongs to the shell (bottom padding / overlay collision), not to this tab. | `apps/web/src/components/GlobalAgentBar.tsx:372`, `apps/web/src/components/BoardLayout.tsx:189`; live `07-detail-header-running.png` |
| 4 | P4 (advisory) | documentation | The commit promoted the satellite to implemented but left the design index roll-up on the old status, so the two owners disagree one line apart. Defensible while E72 is unverified (1069 `wip`, 1070 `todo`), but it must not outlive the feature's verify; `sp:doc-evolve` sync-check / the wrap stage owns the refresh. | `docs/04_DESIGN.md:81` ("…Trace tab + run progress route — **proposed**") vs `docs/design/run-record-contract.md:58` ("**implemented**, 2026-10-04") |
| 5 | P4 (advisory) | usability | The row toggle exposes `aria-expanded` but no `aria-controls`/region link to the detail it expands, so assistive tech announces state without a reachable target. An `id` on the detail container plus `aria-controls` closes it. | `TraceTab.tsx:464-470` |

##### AC Verification

| Req | Status | Evidence |
|-----|--------|----------|
| AC1 — Trace tab lists workflow runs | MET | `apps/web/src/modules/observability/tabs.ts:61` registers `{ id: 'trace', label: 'Trace', component: TraceTab }` after `jobs`; `apps/web/tests/modules/observability/tabs.test.ts` asserts the exact id list `['summary','system-events','jobs','trace','routing']` (136 pass this run); the scope list above contains no new module/sidebar entry; live `01-trace-list.png` shows the tab strip `Summary / System Events / Jobs / Trace / Routing` with two runs |
| AC2 — run list narrows by workflow, status and time range | MET | `TraceTab.tsx:169` `buildRunsUrl`, `:263` `loadFirstPage` (filter-identity effect resets paging), `:295` `loadMore`; tests `buildRunsUrl carries the active filters, cursor and limit`, `applying status and workflow filters refetches with since and resets paging`, `follows nextCursor with the same filters on Load more`, `lists runs … omits since for the all range`; live `02-trace-filters.png`: `status=done` + `workflow=task-pipeline` → `1 run(s)`. Caveat: paging is component-test-only (no live dataset > 50 runs) |
| AC3 — detail shows states, actions with durations and transitions | MET | `TraceTab.tsx:541` `RunDetailPanel`: states in projection order `:565-585`, per-attempt `formatDuration` `:611-646`, transitions `:660-680`, diagnostics `:685-696`, `data-slowest` `:617`; tests `renders states in order with attempts, transitions and diagnostics` and `marks exactly the three slowest attempts`. Live `03`/`06`/`07` show states, kinds, statuses and durations on real runs; **transitions are fixture-only** — no run in this DB projects any (implementer's disclosure reproduced: no Transitions block renders for the three real runs) |
| AC4 — detail shows the bounded run-record text | MET | `TraceTab.tsx:731` `RunRecordSection` is a byte-identical move of the removed `TasksTab.tsx` block (diffed `git show 8294c326f:…/TasksTab.tsx` against the new block: identical modulo the dropped trailer); `:843` keeps the explicit `No run record found on disk.` message; test `loads the moved run record and keeps the explicit missing message`; live `05-run-running-history.png` shows `RUN RECORD — status (DB trace): running` and the `View run record` affordance |
| AC5 — a run links to System Events filtered by its run id | MET | `TraceTab.tsx:704-710` button → `onNavigate({ tab: 'system-events', runId })`; `ObservabilityShell.tsx:22,36,41,145` keeps/sets/clears/passes the intent; `tabs.ts:36` adds the prop; `SystemEventsTab.tsx:833-839` seeds both filter states, and the tab's `fetchIdRef` stale guard (`SystemEventsTab.tsx:846,871`) stops the mount-time unfiltered response from overwriting the filtered one; tests `the System events link emits the run-id navigation intent` and `carries the Trace run link into the System Events run-id filter` (asserts `filter-run-id-input === 'run-1'`); live `04-system-events-filtered.png` shows System Events selected with the filter badge `Filter 1` |
| AC6 — a run shows its History time window as copyable text | MET | `TraceTab.tsx:185` `historyCommand` (`--since` only while `completedAt` is null) and `:713-720` window + `CopyValueButton value={command} label="history analyze command"`; test `shows the run history window with the copyable analyze command` asserts the exact string `spur history analyze --since 2026-09-23T10:00:00.000Z --until 2026-09-23T10:01:00.000Z`; clipboard behaviour is the unchanged component's, covered by `apps/web/tests/modules/observability/components.test.tsx:2059`; live `05-run-running-history.png` shows `History window: Oct 4 12:21:40 → running` and `spur history analyze --since 2026-10-04T19:21:40.796Z`. Limit: the browser denies clipboard read, so the live pass evidences the component's own success state, not a read-back |
| AC7 — host-reported and estimated durations are labelled | MET | `TraceTab.tsx:633-645`: `provenance === 'host-reported'` → `info` badge, `estimated` → `warning` badge, `unknown` → no badge; test `labels host-reported and estimated attempts and leaves unknown unlabelled` (4 / 1 / 0); live `06-detail-slowest-badges.png` shows real inline rows with `47ms host-reported` / `986ms host-reported` |

##### Dimension Notes

- **Security — clear.** No `dangerouslySetInnerHTML`; run-record/markdown text is rendered as escaped React text; the only interpolations are React-escaped strings plus the `runId` path segment taken from the server's own `/api/runs` rows; no secrets, tokens or new external calls in the diff; clipboard write occurs only on explicit click.
- **Efficiency — clear.** One list request per filter change (superseded page-1 fetches aborted, `TraceTab.tsx:264-266`), one detail request per run cached for the tab's lifetime (`:318-360`), page appends de-duplicated by id (`:304-307`). Removing `TasksTab` deleted its per-WBS `/api/runs/by-wbs` fan-out.
- **Correctness — one advisory.** Both reads are schema-first (narrowing guards for the list `:63-104`, `workflowProgressProjectionSchema.safeParse` for the detail `:350`), with explicit 404 / parse-failure / error branches; the only gap is finding 1.
- **Usability — two advisories.** Labelled selects, `aria-expanded` row toggles, explicit empty state `:453`, inline error with `Retry` `:432`; findings 3 and 5.
- **Architecture — one advisory.** The tab consumes the shared projection contract instead of a second parser and the shell fix is the minimal change that makes the existing `ObservabilityNavIntent` mean what its type declares; the 903-line dead `TasksTab` and its tests are gone (`rg "observability/TasksTab" apps/web` → only the historical comment in `tabs.ts:55`). Finding 2 is the remaining seam.

##### Residual Risk

- Finding 3 is shell-wide: every board module's last row shares the overlay occlusion; nothing in this diff can fix it locally.
- Transitions (AC3) and the copy read-back (AC6) are fixture/component-evidenced only — no live run and no readable clipboard in this environment.
- List paging is exercised by component tests only; the worktree DB holds 3 runs, so no live cursor page was available.
- Findings 1, 2, 4, 5 are non-blocking and none changes an AC outcome.

**Next:** proceed to verify (`/sp:dev-verify 1071 --auto --fix none --focus all`); the five advisories can be dispositioned at record/wrap, with finding 3 routed as a shell-level follow-up.

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

- 2026-10-04T19:40:48.732Z todo → wip (system)
- 2026-10-04T20:02:14.794Z wip → testing (system)
- 2026-10-04T20:02:23.351Z testing → done (system)

