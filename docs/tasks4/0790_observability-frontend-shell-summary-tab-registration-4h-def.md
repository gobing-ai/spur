---
schema_version: 1
name: "Observability frontend shell: Summary tab registration, 4h default range, and retention badge"
status: todo
template: feature-impl
created_at: 2026-09-06T21:42:37.707Z
updated_at: "2026-09-06T22:07:11.994Z"
feature_id: J93
priority: P2
tags: ["observability", "web", "ui"]
---

## 0790. Observability frontend shell: Summary tab registration, 4h default range, and retention badge

### Background

Covers feature J93 scenarios R1, R3, R9 (retention badge only), and R10. This is the **shell-only**
task: it opens the seams that 0791 and 0792 fill. Verified against the tree at refine time
(2026-09-06):

**Tab registry.** `apps/web/src/modules/observability/tabs.ts:40-44` declares
`OBSERVABILITY_TABS: readonly ObservabilityTab[]` as `[system-events, jobs, routing]`, each entry
`{ id, label, component }` where `component: ComponentType<ObservabilityTabProps>` is a **real
imported module** (`tabs.ts:2-4`). Registering `summary` therefore requires a `SummaryTab` component
file to exist at this task's commit — see `### Q&A` D1.

**Default tab is already derived, not hard-coded.** `ObservabilityShell.tsx:16` is
`useState<string>(OBSERVABILITY_TABS[0]?.id ?? '')`. Putting `summary` first in the registry is
sufficient for feature R1; **no shell edit is needed for the default tab**. Task 0790's original R3
("default activeId to 'summary'") overstates the change — the only shell line that must change is
`:17`, `useState<ObservabilityTimeRange>('24h')` → `'4h'`.

**Time-range presets.** The union lives at `tabs.ts:7`
(`'30s' | '5m' | '1h' | '24h' | '7d' | 'all'` — no `4h`). The runtime lists live at
`ObservabilityFilters.tsx:31` (`TIME_RANGES`) and `:33-39` (`TIME_RANGE_MS`), and `timeRangeSince`
(`:42-46`) reads `TIME_RANGE_MS`, so adding `'4h'` in those three places is the whole change.
`TIME_RANGE_MS` is a total `Record<ObservabilityTimeRange, …>`, so a missing `'4h'` key is a compile
error — the type does the enforcing.

**Where the filter bar actually renders.** `ObservabilityFilters` (the default export) is rendered
in exactly one place today: `SystemEventsTab.tsx:1021`. `JobsTab.tsx:4` imports only the
`timeRangeSince` helper and renders its own controls. So a badge placed inside the
`ObservabilityFilters` body appears on System Events **only** — it would not satisfy feature R9,
which puts the retention notice on the **Jobs** tab. See `### Q&A` D2.

**Correction to the design satellite and to this task's original R5.**
`docs/design/observability-module-refactor.md` §2.7 and the mermaid node
`system_events Table (telemetry log, 7d quota)` both describe events as retained for 7 days. That is
false. `system_events` retention is a **per-prefix row-count quota** —
`DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA = 10_000` rows per prefix
(`packages/app/src/services/system-event-retention.ts:11`), applied by `SystemEventDao.pruneQuotas`
(`packages/domain/src/dao/system-event-dao.ts:215`). There is no time-based event purge at all. Only
`queue_jobs` has a time cutoff, and only for terminal rows: `QUEUE_JOB_RETENTION_DAYS = 30`
(`packages/domain/src/retention.ts:25,221`). The badge copy is corrected in `### Requirements` R5;
shipping the `7d` wording would put a false claim in the operator's UI.

**Routing tab.** `RoutingTab` is registered at `tabs.ts:43` and covered by
`apps/web/tests/modules/observability/routing-tab.test.tsx`. Feature R10 requires it to keep working
unchanged; the registry reorder is the only thing that touches it, and the exact-list test at
`tabs.test.ts:26-35` (`expect(ids).toEqual([...])`) is the intentional-change gate that must be
updated in this task.

### Requirements

- [ ] R1. `apps/web/src/modules/observability/tabs.ts` registers `{ id: 'summary', label: 'Summary',
      component: SummaryTab }` as the **first** entry of `OBSERVABILITY_TABS`, giving the order
      `summary, system-events, jobs, routing`. The existing three entries keep their `id` and
      `label` verbatim.
- [ ] R2. `ObservabilityTimeRange` in `tabs.ts:7` becomes
      `'30s' | '5m' | '1h' | '4h' | '24h' | '7d' | 'all'`.
- [ ] R3. `ObservabilityShell.tsx:17` defaults `timeRange` to `'4h'`. The default **tab** needs no
      code change — `:16` already derives it from `OBSERVABILITY_TABS[0]`, which R1 makes `summary`.
- [ ] R4. `ObservabilityFilters.tsx` adds `'4h'` to `TIME_RANGES` in position between `'1h'` and
      `'24h'`, and `TIME_RANGE_MS['4h'] = 4 * 60 * 60_000` (14,400,000). `timeRangeSince('4h')`
      consequently returns `now - 14_400_000` with no change to its body.
- [ ] R5. `ObservabilityFilters.tsx` exports a `RetentionBadge` component rendering the **truthful**
      copy `Retention: events capped at 10,000 rows per prefix · terminal jobs pruned after 30d`
      (with an `ℹ️` affordance and `data-testid="observability-retention-badge"`), and renders it in
      the `ObservabilityFilters` controls bar. The numbers are imported/derived, not re-typed as
      literals in JSX where they can drift.
- [ ] R6. `apps/web/src/modules/observability/SummaryTab.tsx` exists as a
      `ComponentType<ObservabilityTabProps>` placeholder — correct props, module framing, and an
      empty-state panel — so the registry in R1 compiles and the tab renders. It contains **no** KPI
      cards, charts, or fetching; task 0791 replaces its body.
- [ ] R7. `RoutingTab.tsx`, `SystemEventsTab.tsx`, and `JobsTab.tsx` are unmodified except where a
      compile error forces it; `routing-tab.test.tsx` passes untouched.
- [ ] R8. Tests updated/added under `apps/web/tests/modules/observability/`: the exact-list assertion
      at `tabs.test.ts:30` becomes `['summary', 'system-events', 'jobs', 'routing']`; a shell test
      asserts `summary` is the active tab on mount; `components.test.tsx:2116` gains a `'4h'`
      `timeRangeSince` case; and a new case asserts the retention badge renders the corrected copy.

**Out of scope (non-goals).** No Summary tab content — no KPIs, charts, severity bars, or failure
feed (0791). No Jobs tab redesign, schedules card, or detail drawer (0792). No server, domain, or
contracts change (0789). No routing logic change. No URL/query-param tab persistence — the shell
keeps its in-memory `useState`, and feature R1 explicitly describes the "no active tab specified"
path. No time-range persistence across reloads.

### Acceptance Criteria
```gherkin
Feature: Observability frontend shell

  Scenario: R1 — Summary tab as the first and default view
    Given the Observability board module is rendered
    When the module initializes without an active tab specified in the URL
    Then the active tab defaults to "Summary"
    And the tab order is "Summary", "System Events", "Jobs", and "Routing"

  Scenario: R3 — 4h time range preset and module-wide default
    Given the Observability module controls
    When the time range selector renders
    Then presets include 30s, 5m, 1h, 4h, 24h, 7d, and all
    And 4h is selected as the default time range across all Observability tabs
    And timeRangeSince('4h') resolves to exactly 14,400,000 ms before the supplied instant

  Scenario: R9 — Status filter chips, inline error preview, and retention notice
    Given the Observability controls bar
    When the filter bar renders
    Then a retention policy badge clarifies the pruning cutoff for events and terminal jobs
    And the badge states that events are capped by a per-prefix row quota rather than a time window

  Scenario: R10 — Routing tab preserved unchanged
    Given the Observability board module
    When the operator navigates to the Routing tab
    Then the routing attribution view and its backend queries function exactly as before without modification
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-06T22:03:34.221Z

**D1 — 0790 ships a placeholder `SummaryTab.tsx`; 0791 replaces its body.** `ObservabilityTab.component`
is a real component reference (`tabs.ts:29-33`), so `summary` cannot be registered against nothing —
and feature R1 (default tab) is this task's, while feature R2 (KPI content) is 0791's. Splitting at
the file boundary lets 0790 land and be verified alone. The placeholder must keep the exact export
shape 0791 will replace: `export default function SummaryTab(props: ObservabilityTabProps)`.
*Rejected:* deferring the registry entry to 0791 — that would strand feature R1 in a task whose AC
does not cover it, and leave 0790 with nothing observable to verify.

**D2 — `RetentionBadge` is exported from `ObservabilityFilters.tsx` and rendered in two places.**
`ObservabilityFilters` renders only inside `SystemEventsTab` (`SystemEventsTab.tsx:1021`), but
feature R9 places the notice on the **Jobs** tab. A named export gives one definition of the copy
with two render sites: 0790 renders it in the filter bar, and 0792 imports the same component into
the Jobs controls bar. *Rejected:* duplicating the string in `JobsTab.tsx` — two copies of a
retention claim drift the moment a quota changes.

**D3 — the badge copy is corrected, not carried over.** The design satellite's `7d` figure for
events is factually wrong (see `### Background`). Frozen copy:
`Retention: events capped at 10,000 rows per prefix · terminal jobs pruned after 30d`. The `10,000`
comes from `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA` and the `30` from `QUEUE_JOB_RETENTION_DAYS`;
render them from imported constants where the import is clean, otherwise from a single local
`RETENTION_COPY` const in `ObservabilityFilters.tsx` with a comment naming both source files.
⚠️ `docs/design/observability-module-refactor.md` §2.7 and its mermaid `7d quota` node still carry
the wrong figure — flag the satellite correction at wrap (T3: surface code and `04` change together).

**D4 — `'4h'` sits between `'1h'` and `'24h'` in `TIME_RANGES`.** The array drives the segmented
selector's render order; ascending duration is the existing convention and the only ordering a user
would read as correct.

**D5 — the exact-list test is updated, not relaxed.** `tabs.test.ts:26-35` asserts
`ids).toEqual(['system-events','jobs','routing'])` and the registry comment
(`tabs.ts:26-27`) declares that intentional registry changes update the exact-list test. So update
the array to the new four; do **not** convert it to a `toContain` check, which would stop guarding
order — and order *is* feature R1's assertion.
### Design
**WHAT.** Four small edits to two existing files, one new placeholder component, one new exported
badge, and the test updates that lock them. No new data flow, no fetching, no server contact.

**WHY here.** The registry and the shared `timeRange` state are the module's only cross-tab seams;
changing them once, in isolation, keeps 0791 and 0792 pure content tasks that never touch shell
plumbing. Registering `summary` first is also the *entire* implementation of feature R1, because the
shell already derives its default from index 0.

**Frozen names** — 0791 and 0792 import exactly these; do not rename.

| Symbol | Location | Owner |
| --- | --- | --- |
| `ObservabilityTimeRange` (now including `'4h'`) | `apps/web/src/modules/observability/tabs.ts:7` | 0790 |
| `OBSERVABILITY_TABS` entry `{ id: 'summary', label: 'Summary', component: SummaryTab }` | `tabs.ts:40` | 0790 |
| `TIME_RANGES`, `TIME_RANGE_MS` (both gaining `'4h'`) | `ObservabilityFilters.tsx:31,33` | 0790 |
| `RetentionBadge` (named export) | `ObservabilityFilters.tsx` | 0790, rendered again by 0792 |
| `RETENTION_COPY` | `ObservabilityFilters.tsx` | 0790 |
| `export default function SummaryTab(props: ObservabilityTabProps)` | `apps/web/src/modules/observability/SummaryTab.tsx` (new) | 0790 creates, **0791 replaces the body** |

**Precedence / exact edits.**
1. `tabs.ts:7` — insert `'4h'` into the union between `'1h'` and `'24h'`.
2. `tabs.ts:2-4` — add `import SummaryTab from './SummaryTab';` in alphabetical position.
3. `tabs.ts:40-44` — prepend the `summary` entry; leave the other three lines byte-identical.
4. `ObservabilityShell.tsx:17` — `useState<ObservabilityTimeRange>('24h')` → `('4h')`. **This is the
   only line in the shell that changes.** Do not touch `:16`; rewriting it to a literal `'summary'`
   would duplicate the registry's authority and silently break if the registry is reordered again.
5. `ObservabilityFilters.tsx:31` — `['30s','5m','1h','4h','24h','7d','all']`.
6. `ObservabilityFilters.tsx:33-39` — add `'4h': 4 * 60 * 60_000,` between `'1h'` and `'24h'`.
   `TIME_RANGE_MS` is a total `Record`, so TypeScript fails the build if this is forgotten;
   `timeRangeSince` needs no edit at all.
7. `ObservabilityFilters.tsx` — add `RETENTION_COPY` + `RetentionBadge` near `SegmentedToggle`
   (`:59`), and render `<RetentionBadge />` in the controls row of the `ObservabilityFilters` body
   (`:138+`), adjacent to the live pause/resume control.

**Placeholder `SummaryTab.tsx` contract.** It must be a real, mountable component so the shell test
can select it: same `data-*`/section framing idiom as the other tabs, an empty-state message
(e.g. "Summary metrics arrive with task 0791"), and it accepts but does not use `timeRange` /
`onTimeRangeChange` / `onLivenessChange`. It must **not** call `onLivenessChange`, because the shell
chip logic (`ObservabilityShell.tsx:32-42`) treats any non-`system-events` tab as `idle` and a
liveness push from Summary would be dead state.

**Retention copy, frozen.**
`Retention: events capped at 10,000 rows per prefix · terminal jobs pruned after 30d`
Derive `10,000` from `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA`
(`packages/app/src/services/system-event-retention.ts:11`) and `30` from `QUEUE_JOB_RETENTION_DAYS`
(`packages/domain/src/retention.ts:25`) if either import is clean from `apps/web`; otherwise define
`RETENTION_COPY` once in `ObservabilityFilters.tsx` with a comment citing both `path:line`s. Never
inline the numbers at the JSX site.

**Anti-patterns — do not do these.**
- Do **not** ship the satellite's `events retained 7d` wording. It is false (`### Background`), and a
  wrong retention claim in the UI is worse than no badge.
- Do **not** hard-code `'summary'` as the shell's default `activeId`. The registry is the single
  source of tab order.
- Do **not** relax `tabs.test.ts:30` from `toEqual` to `toContain` — order is feature R1's assertion.
- Do **not** implement any Summary content here, and do **not** fetch `/api/observability/summary` —
  that endpoint is 0789's and its consumer is 0791's.
- Do **not** add URL/query-param tab or range persistence; it is out of scope and would change the
  "initializes without an active tab specified" path that feature R1 tests.
- Do **not** edit `RoutingTab.tsx` or `routing-tab.test.tsx` (feature R10).

**Primary file targets.**
- `apps/web/src/modules/observability/tabs.ts`
- `apps/web/src/modules/observability/ObservabilityShell.tsx` (one line)
- `apps/web/src/modules/observability/ObservabilityFilters.tsx`
- `apps/web/src/modules/observability/SummaryTab.tsx` (new placeholder)
- `apps/web/tests/modules/observability/{tabs.test.ts, components.test.tsx}` (+ a shell test)

**Handoffs.**
- **→ 0789** — none in either direction. 0790 makes no server call; the two tasks are independent
  and may land in either order.
- **→ 0791** — inherits `SummaryTab.tsx` (replace the body, keep the default-export signature) and
  the `'4h'`-widened `ObservabilityTimeRange` it receives via `props.timeRange`. 0791 must not
  re-register the tab, reorder `OBSERVABILITY_TABS`, or change the shell's `useState` defaults.
  **One agreed exception:** 0791 adds the optional member
  `onNavigate?: (intent: ObservabilityNavIntent) => void` to `ObservabilityTabProps` (plus the
  matching handler in `ObservabilityShell.tsx`) to satisfy feature R2's one-click filtering — it is
  additive and optional, so nothing 0790 ships breaks. See 0791 `### Q&A` D3.
- **→ 0792** — imports `RetentionBadge` from `./ObservabilityFilters` for the Jobs controls bar
  (feature R9) and receives `timeRange` defaulted to `'4h'`. 0792 must not redefine the copy.
### Plan
1. **(R6)** Create `apps/web/src/modules/observability/SummaryTab.tsx` as a placeholder
   `ComponentType<ObservabilityTabProps>` with module framing and an empty-state panel; no fetching,
   no `onLivenessChange` call.
   *Test intent:* it mounts without throwing when given no props and when given a `timeRange`.
2. **(R1, R2)** Edit `tabs.ts`: import `SummaryTab`, widen `ObservabilityTimeRange` with `'4h'`, and
   prepend the `summary` registry entry, leaving the other three entries byte-identical.
   *Test intent:* update `tabs.test.ts:30` to
   `expect(ids).toEqual(['summary','system-events','jobs','routing'])`; the existing per-tab shape
   and uniqueness tests must pass unchanged.
3. **(R3)** Change `ObservabilityShell.tsx:17` to `useState<ObservabilityTimeRange>('4h')`. Leave
   `:16` alone.
   *Test intent:* a shell render test asserting the tab with `aria-selected="true"` on mount is
   `observability-tab-summary`, and that the tab strip renders the four labels in order.
4. **(R4)** Edit `ObservabilityFilters.tsx`: add `'4h'` to `TIME_RANGES` (between `'1h'` and
   `'24h'`) and `'4h': 4 * 60 * 60_000` to `TIME_RANGE_MS`.
   *Test intent:* extend `components.test.tsx:2116` with
   `expect(timeRangeSince('4h', fixedNow)).toBe(new Date(fixedNow - 14_400_000).toISOString())`, and
   assert `TIME_RANGES` order so the selector cannot silently reshuffle.
5. **(R5)** Add `RETENTION_COPY` + the exported `RetentionBadge` and render it in the
   `ObservabilityFilters` controls row.
   *Test intent:* render the filter bar and assert `observability-retention-badge` contains both
   `10,000` and `30d`, and does **not** contain the string `7d` (the regression this task exists to
   prevent).
6. **(R7)** Diff-check that `RoutingTab.tsx`, `SystemEventsTab.tsx`, and `JobsTab.tsx` are untouched,
   and run `routing-tab.test.tsx` unmodified.
7. **(R8)** Run the gate from inside the workspace: `cd apps/web && bun test tests/modules/observability`,
   then the repo gate `bun run lint`, `bun run test`, `bun run build`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/J93_observability-module-refactor-summary-tab-4h-range-default-queue-jobs-table-and-schedule-tracing.md` (scenarios R1, R3, R9-badge, R10)
- Design satellite: `docs/design/observability-module-refactor.md` §2.1, §2.2, §2.7 — ⚠️ §2.7 and the mermaid `system_events (7d quota)` node are factually wrong; `### Q&A` D3 records the corrected copy and the satellite fix owed at wrap
- Dependent tasks: 0791 (replaces `SummaryTab.tsx`'s body), 0792 (renders `RetentionBadge` in the Jobs controls bar)
- `apps/web/src/modules/observability/tabs.ts:7,26-27,29-33,40-44` — time-range union, the "intentional registry changes update the exact-list test" contract, `ObservabilityTab`, and the registry
- `apps/web/src/modules/observability/ObservabilityShell.tsx:16-17` — index-0-derived default tab and the `'24h'` default range
- `apps/web/src/modules/observability/ObservabilityFilters.tsx:31,33-39,42-46,59,138` — `TIME_RANGES`, `TIME_RANGE_MS`, `timeRangeSince`, `SegmentedToggle`, and the controls-bar render site
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1021` — the only current render site of `ObservabilityFilters`
- `apps/web/tests/modules/observability/tabs.test.ts:26-35` — the exact-list gate this task updates
- `apps/web/tests/modules/observability/components.test.tsx:2115-2123` — the `timeRangeSince` preset table this task extends
- `packages/app/src/services/system-event-retention.ts:11` — `DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA = 10_000` (per-prefix rows)
- `packages/domain/src/retention.ts:25,221` — `QUEUE_JOB_RETENTION_DAYS = 30` and the terminal-row purge
- `apps/web/src/modules/history/HistoryShell.tsx:64` — the `'4h'` default this task mirrors
### History
