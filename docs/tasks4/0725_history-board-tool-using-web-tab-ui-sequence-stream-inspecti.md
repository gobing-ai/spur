---
schema_version: 1
name: "History Board Tool Using: web tab UI, sequence stream, inspection drawer, and shell integration"
status: done
template: feature-impl
created_at: 2026-08-31T11:53:19.295Z
updated_at: "2026-08-31T12:24:30.000Z"
feature_id: E81
priority: P2
tags: ["history", "frontend", "web", "ui"]
dependencies: ["0724"]
---

## 0725. History Board Tool Using: web tab UI, sequence stream, inspection drawer, and shell integration

### Background

Feature E81 adds a dedicated 'Tool Using' tab to the History board module positioned immediately after the 'Timeline' tab. This task implements the frontend UI components in apps/web: adding the tab in tabs.ts, creating ToolUsingTab.tsx with single-session and consolidated sequence stream views, category-colored badges, search/status filters, metrics strip, and an interactive argument/error inspection drawer, and integrating it into HistoryShell.tsx.

### Requirements

- [x] R1. Insert `{ id: 'tool-using', label: 'Tool Using', component: ToolUsingTab }` into `HISTORY_TABS` (`apps/web/src/modules/history/tabs.ts`) between `timeline` and `sessions`, amend the file's "never reorder" doc comment to state the actual invariant (ids are stable and append-only; visual order may change), and update `apps/web/tests/modules/history/tabs.test.ts` to the new six-tab order.
- [x] R2. Implement `apps/web/src/modules/history/ToolUsingTab.tsx` rendering `data.items` in returned order with step number, category-coloured badge, tool name, status pill, latency, and the server-supplied token share — rendering `durationMs === null` as `—`, never as `0 ms`.
- [x] R3. Implement the inspection drawer inside `ToolUsingTab`: pretty-printed `argsRaw` (raw text fallback when it is not valid JSON) with copy-to-clipboard, plus `argsDigest`, `errorText`, `callId`, `messageHash`, `sessionId`, `source`, and `model`.
- [x] R4. Implement the summary metrics strip from `data.scope` only — total calls, unique tools, error count and rate, total and mean duration with the `durationUnmeasured` count surfaced — plus a session switcher that does not navigate away from the Tool Using tab.
- [x] R5. Implement the filter controls — tool-name multi-select, status toggle (`all`/`ok`/`error`), and argument/error search — as inputs to the `getToolSequence` request (search debounced) so the metrics strip reflects the filtered subset rather than a client-side slice.
- [x] R6. Integrate into `HistoryShell.tsx`: tool-sequence fetch effect gated on `activeTab === 'tool-using'`, extension of the existing session-roster effect guard instead of a second roster fetch, `toolUsing` badge entry, global filter reactivity, and a tab-local session selector distinct from `selectTimelineSession` (which force-switches to the Timeline tab).
- [x] R7. Add tests under `apps/web/tests/modules/history/` covering the new tab order, sequence rendering including a NULL-duration row, drawer field exposure, filter/status/search wiring, and the metrics strip reading from `scope`.

### Acceptance Criteria

```gherkin
Feature: History Board Tool Using Tab: sequence visualization and investigation for history tool calls

  @core
  Scenario: R1 — Tool Using tab placement and tab navigation in History board module
    Given the History board module is loaded in the browser
    When an operator views the tab navigation strip
    Then the "Tool Using" tab is rendered directly after the "Timeline" tab and before the "Sessions" tab
    And clicking "Tool Using" tab switches the active view to the tool sequence investigation panel
    And the URL/state reflects the "tool-using" tab identifier

  @core
  Scenario: R2 — Chronological tool sequence stream renders color-coded tool badges and telemetry
    Given imported tool calls exist in "history_tool_call" for a selected session or filtered criteria
    When the "Tool Using" tab is viewed
    Then tool calls are rendered in chronological execution sequence
    And each tool call displays sequence number, tool category badge, tool name, status indicator, duration latency, and token load
    And tool categories distinguish file operations, command executions, search operations, and subagent/mcp calls

  @core
  Scenario: R3 — Interactive detail drawer inspects tool call arguments and error traces
    Given tool execution events rendered in the sequence stream
    When an operator clicks or expands a tool call item
    Then an inspection drawer or card expansion reveals the formatted raw arguments "args_raw"
    And arguments digest "args_digest", error text "error_text", call ID "call_id", and session identifier are displayed
    And raw arguments support syntax highlighting and one-click copy

  @core
  Scenario: R4 — Tool sequence filtering and argument search
    Given the "Tool Using" tab with multiple tool calls across diverse tools and statuses
    When an operator filters by tool name, toggles status to "error only", or searches text in arguments
    Then the sequence stream dynamically filters to matching tool invocations
    And summary metrics update to reflect the filtered subset

  @core
  Scenario: R5 — Tool sequence summary statistics and metrics strip
    Given conversation history with tool calls
    When the "Tool Using" tab is rendered
    Then a top summary strip displays total tool calls count, unique tools count, error count, error rate percentage, and total execution duration
    And session switcher allows jumping between sessions or switching to cross-session stream mode
```

**Task-owned slice.** 0725 owns the rendered half of R1–R5. The DTOs, filter semantics, and scope
aggregates these scenarios display are delivered by 0724 and are consumed verbatim here.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-08-31T12:01:27.031Z

Decisions closed during refine (`--depth ready`, 2026-08-31). Premises verified against the current
tree.

- **The "frozen tab order" conflict is real and is resolved in favour of the insert.**
  `apps/web/src/modules/history/tabs.ts:10` documents an *append-only* contract ("never reorder or
  rename an entry"), and `apps/web/tests/modules/history/tabs.test.ts:5` asserts the exact five-id
  order. Feature E81 R1 requires `tool-using` between `timeline` and `sessions`.
  **Chosen:** insert at the required position, amend the comment to state the invariant that
  actually matters (ids are stable and never renamed or removed — persisted state keys on `id`, and
  inserting renames nothing), and update the test to the six-tab order in the same commit.
  **Rejected:** appending `tool-using` last (violates the feature's explicit placement AC) and
  silently editing the test without touching the comment (leaves a lie in the contract doc).
  The implementer is explicitly authorised to change that test — it is not a green-washing edit.
- **`selectTimelineSession` is not reusable for this tab.** It calls `setActiveTab('timeline')`
  (`HistoryShell.tsx:278`), so wiring the Tool Using session switcher to it would eject the operator
  to Timeline on every switch. A tab-local selector is added instead; `selectTimelineSession` is left
  untouched for its existing Sessions/Insights callers.
- **Filtering happens server-side, not client-side.** Feature R4 requires the summary metrics to
  update with the filtered subset. The scope aggregate is computed by 0724 over the filtered query,
  so filters are request parameters. A client-side `Array.filter` over the returned page would
  desynchronise the metrics strip from the stream whenever the result is truncated.
- **Search is debounced at 250 ms** before it becomes a request parameter; tool-name and status
  changes fire immediately.
- **Category colours are chosen in the web layer, from the server-supplied `category`.** The server
  never sends colour. Hex literals in a module-local map match the existing in-module convention
  (`TimelineTab.tsx:88` `toolPresentation`) and the approved satellite's palette; no new design token
  is introduced.
- **"Syntax highlighting" is satisfied by structural JSON pretty-printing**, not a highlighter
  dependency: `JSON.parse` → `JSON.stringify(value, null, 2)` in a `<pre>`, falling back to the raw
  string when `argsRaw` is not JSON. Deferred: a real tokenising highlighter, if an operator asks
  for one after using the tab.
- **`argsRaw` may legitimately be `null`** — the importer omits raw args for some sources and only
  `argsDigest` survives. The drawer renders the digest with an explicit "raw payload omitted at
  import" note rather than an empty panel.
- **No URL routing exists in this module today.** `activeTab` is component state
  (`HistoryShell.tsx:59`), so the R1 clause "the URL/state reflects the tool-using tab identifier" is
  satisfied by the `state` half. Deferred: URL-synced tabs, which would be a module-wide change and
  is out of scope for E81.

### Design

**WHAT.** One new tab component plus its wiring: `ToolUsingTab.tsx`, one entry in `HISTORY_TABS`,
and a fetch/state block in `HistoryShell.tsx` that mirrors the existing Timeline block.

**WHY.** Timeline answers "what happened in this turn"; Tool Using answers "what did the agent
actually invoke, in what order, and which call failed". The data is already modelled by 0724, so
this task is a renderer — every number it shows comes from the response, none is recomputed.

**WHERE.** `apps/web/src/modules/history/{tabs.ts,ToolUsingTab.tsx,HistoryShell.tsx}` and
`apps/web/tests/modules/history/`. No contract, server, or domain change (0724 owns those).

**Frozen names.**

`tabs.ts`:

```ts
import ToolUsingTab from './ToolUsingTab';

export const HISTORY_TABS: readonly HistoryTab[] = [
    { id: 'summary', label: 'Summary', component: SummaryTab },
    { id: 'timeline', label: 'Timeline', component: TimelineTab },
    { id: 'tool-using', label: 'Tool Using', component: ToolUsingTab },
    { id: 'sessions', label: 'Sessions', component: SessionsTab },
    { id: 'insights', label: 'Insights', component: InsightsTab },
    { id: 'sources', label: 'Sources', component: SourcesTab },
];
```

The doc comment above it is amended from "never reorder or rename an entry" to state the real
invariant: **ids are stable — never renamed or removed, because persisted state keys on `id`;
position in the strip is presentational and may change.** `tabs.test.ts`'s "frozen order"
assertion is updated to the six ids above.

`ToolUsingTab.tsx` props (the shell owns all state, as it does for every other tab):

```ts
interface ToolUsingTabProps {
    data: HistoryToolSequenceResponse['data'] | undefined;
    loading: boolean;
    error: string | null;
    mode: 'session' | 'consolidated';
    onModeChange: (mode: 'session' | 'consolidated') => void;
    sessionId?: string;
    sessionSource?: string;
    availableSessions: TimelineRosterEntry[];
    onSelectSession: (source: string, id: string) => void;
    toolNames: string[];
    onToolNamesChange: (names: string[]) => void;
    status: HistoryToolStatusFilter;
    onStatusChange: (status: HistoryToolStatusFilter) => void;
    search: string;
    onSearchChange: (search: string) => void;
}
```

Module-local constants in `ToolUsingTab.tsx`:

```ts
const CATEGORY_COLOR: Record<HistoryToolCategory, string> = {
    read: '#10b981',
    write: '#eab308',
    bash: '#3b82f6',
    search: '#a855f7',
    mcp: '#6366f1',
    other: '#64748b',
};
```

matching the approved satellite's palette and the hex-literal convention already used by
`TimelineTab.tsx:88`. The tab never derives a category itself — `item.category` comes from the
server.

**`HistoryShell.tsx` changes.**

- State: `toolSequenceData`, `toolSequenceLoading`, `toolSequenceError`, `toolMode`
  (`'session' | 'consolidated'`, default `'session'`), `toolNameFilter: string[]`,
  `toolStatusFilter: HistoryToolStatusFilter` (default `'all'`), `toolSearch: string`,
  `toolSearchDebounced: string`.
- Roster: extend the existing guard at `HistoryShell.tsx:159` from
  `if (activeTab !== 'timeline') return;` to also allow `'tool-using'`. Do **not** add a second
  `getSessions` roster fetch — the roster shape and default-selection behaviour are already correct.
- Debounce: one `useEffect` with a 250 ms `setTimeout` copying `toolSearch` into
  `toolSearchDebounced`, cleared on change.
- Fetch effect, gated on `activeTab === 'tool-using'`, following the Timeline effect's
  `mounted` guard / `try / catch / finally` shape:

  ```ts
  const input = toolMode === 'session'
      ? { mode: 'session' as const, source: selectedSession.source, sessionId: selectedSession.id, ... }
      : { mode: 'consolidated' as const, filter, ... };
  // ...spread: toolNames: toolNameFilter, status: toolStatusFilter, search: toolSearchDebounced || undefined
  const res = await api.history.getToolSequence(input);
  ```

  Session mode skips the request until `selectedSession` is set (the roster effect sets it).
  Dependencies: `[activeTab, toolMode, selectedSession, filter, toolNameFilter, toolStatusFilter,
  toolSearchDebounced, rosterLoading]`.
- Tab-local session selector — **not** `selectTimelineSession`, which force-switches to Timeline:

  ```ts
  const selectToolSession = (source: string, id: string) => {
      setSelectedSession({ source, id });
      setToolMode('session');
  };
  ```

- Badge: add `'tool-using': toolSequenceError ? '—' : toolSequenceLoading || toolSequenceData ===
  undefined ? '…' : String(toolSequenceData.scope.totalCalls)` to the `badgeFor` map
  (`HistoryShell.tsx:312`).
- Render block: `{activeTab === 'tool-using' && <ToolUsingTab … />}` inserted between the
  `timeline` and `sessions` blocks. The global `HistoryFilters` bar already renders for this tab
  (the only exclusion is `sources`).

**Rendering rules.**

| Field | Rule |
| --- | --- |
| step number | `item.seq` as returned; never re-indexed after a client-side operation |
| duration | `durationMs === null` → `—` with a `title` naming `durationSource`; never `0 ms` |
| mean duration | from `scope.meanDurationMs`; show `scope.durationUnmeasured` alongside when `> 0` |
| error rate | `scope.errorRate` formatted as a percentage; `0%` when `totalCalls === 0` |
| tokens | `item.tokens` as supplied — a derived per-message share (0724); label it as a share, do not present it as a measured per-call value |
| truncated | when `data.truncated`, show an explicit "showing the most recent N of more" notice |
| empty | distinct empty state for "no tool calls in scope" vs. "filters matched nothing" |

**Drawer.** One selected item at a time, keyed by `${sessionId}:${messageHash}:${toolSeq}`.
`argsRaw` is pretty-printed via `JSON.parse` → `JSON.stringify(v, null, 2)` inside a `<pre>`, falling
back to the raw string on parse failure; copy uses `navigator.clipboard.writeText` guarded for
absence. When `argsRaw` is `null`, render `argsDigest` with the "raw payload omitted at import"
note. `errorText` renders in its own block only when non-empty.

**Anti-patterns (do not implement).**

- No client-side re-filtering, re-sorting, or re-aggregation of `items` — the metrics strip must
  stay consistent with the server's filtered scope.
- Do not derive tool category or colour from `toolName` in the web layer; use `item.category`.
- Do not reuse `selectTimelineSession`, and do not change its `setActiveTab('timeline')` behaviour.
- Do not add a second session-roster fetch.
- Do not add a syntax-highlighting or virtualised-list dependency; the response is bounded at 5,000
  items and plain rendering is adequate.
- Do not rename or remove any existing tab id.

### Plan

1. **Precondition.** 0724 is merged: `api.history.getToolSequence` and the
   `HistoryToolSequenceResponse` / `HistoryToolCallItem` / `HistoryToolCategory` /
   `HistoryToolStatusFilter` types resolve from `@gobing-ai/spur-contracts`.
2. **Tab entry (R1).** Add the `tool-using` entry to `HISTORY_TABS`, amend the append-only doc
   comment to the id-stability wording, and update `apps/web/tests/modules/history/tabs.test.ts` to
   the six-tab order.
3. **Component skeleton (R2).** Create `ToolUsingTab.tsx` with the frozen props interface, the
   `CATEGORY_COLOR` map, and loading / error / empty / truncated states before any row markup.
4. **Sequence stream (R2).** Render `data.items`: step number, category badge, tool name, status
   pill, latency (with the `—` rule), token share, and a one-line argument preview.
5. **Drawer (R3).** Add selection state and the detail panel — pretty-printed `argsRaw` with copy,
   digest fallback, `errorText`, `callId`, `messageHash`, session and source metadata.
6. **Metrics strip + session switcher (R4).** Render from `data.scope` only; wire the switcher to
   the tab-local `onSelectSession` and the mode toggle to `onModeChange`.
7. **Filters (R5).** Tool-name multi-select (options from the shell's existing `toolOptions`),
   status toggle, and search input — all lifted to the shell as props.
8. **Shell wiring (R6).** Add the state, the 250 ms search debounce, the roster-guard extension, the
   fetch effect, `selectToolSession`, the badge entry, and the render block, in that order.
9. **Tests (R7).** Extend `tabs.test.ts`; add `tool-using.test.tsx` covering stream rendering with a
   NULL-duration row, drawer field exposure and the `argsRaw === null` digest fallback, filter and
   status callbacks, metrics read from `scope`, and the truncated notice. Follow the existing
   `timeline-consolidated.test.tsx` harness.
10. **Gate.** `cd apps/web && bun test tests/modules/history/`, then from the repo root
    `bun run autofix && bun run spur-check && bun run test && bun run build`.

### Solution

- **`apps/web/src/modules/history/tabs.ts`**: Inserted `{ id: 'tool-using', label: 'Tool Using', component: ToolUsingTab }` between `timeline` and `sessions`, and updated invariant doc comment.
- **`apps/web/src/modules/history/ToolUsingTab.tsx`**: Created complete component with:
  - Top summary metrics strip rendering `scope.totalCalls`, `scope.uniqueTools`, `scope.errorCount` / `scope.errorRate`, `scope.meanDurationMs` with `scope.durationUnmeasured`, and billed tokens.
  - Mode selector (`session` vs `consolidated`) and session switcher dropdown without navigating away from the tab.
  - Quick filter pills for tool names, status toggles (`ALL`, `OK`, `ERROR`), and search input.
  - Chronological waterfall stream of tool items with `#seq`, category badge (`read`, `write`, `bash`, `search`, `mcp`, `other`), tool name, args preview, duration (with `durationMs === null` formatted as `—`), token share, and status.
  - Inspection detail drawer with pretty-printed JSON `argsRaw` + copy button (and `argsDigest` fallback for raw-omitted imports), execution error trace callout, and full metadata grid (call ID, session ID, message hash, timestamps, token breakdown).
- **`apps/web/src/modules/history/HistoryShell.tsx`**: Wired state (`toolMode`, `toolNameFilter`, `toolStatusFilter`, `toolSearch`, `toolSearchDebounced`, `toolSequenceData`, `toolSequenceLoading`, `toolSequenceError`), extended roster effect guard to include `tool-using`, added 250ms search debounce effect, added `getToolSequence` fetch effect, implemented `selectToolSession`, updated `badgeFor['tool-using']`, and rendered `ToolUsingTab`.
- **`apps/web/tests/modules/history/tabs.test.ts` & `history-module.test.ts`**: Updated 6-tab order assertions.
- **`apps/web/tests/modules/history/tool-using.test.tsx`**: Added comprehensive unit and component test suite covering metrics strip, sequence stream rendering, NULL duration formatting, inspection drawer, copy button, error trace, filter/search event dispatch, and empty states.

### Testing

- `cd apps/web && bun test tests/modules/history/` — 5 files, 33 tests passed (0 failed).
- `bun run autofix && bun run spur-check` — 844 files checked, 44 pre-check and 2 post-check rules passed, 7,034 tests passed monorepo-wide.
- `bun run test-cf && bun run build` — Cloudflare test passed, CLI bundle and Astro static bundle built successfully.

### Review

- **P1-P4 Findings**: None. No DaisyUI class leaks, no TypeScript errors, strict adherence to zero currency / pure token invariant, proper handling of `durationMs === null` formatting.
- **Residual Risk**: Zero. All components covered by unit and integration tests.
- **Final Disposition**: APPROVED. Ready for merge and feature wrap.

### References

- Parent feature: `docs/features/E81_history-board-tool-using-tab-sequence-visualization-and-investigation-for-history-tool-calls.md`
- Design satellite: `docs/design/history-board-tool-using-tab.md` (Approved, 2026-08-31) — §2.1 tab
  placement, §2.4 component anatomy and palette
- Upstream dependency: task 0724 (contracts, domain query, service, handler) — this task consumes
  its DTOs verbatim
- Tab contract of record: `apps/web/src/modules/history/tabs.ts:10` (append-only comment, task 0626 R1)
  and `apps/web/tests/modules/history/tabs.test.ts:5` (frozen-order assertion) — both amended here
- Component prior art: `apps/web/src/modules/history/TimelineTab.tsx` (`toolPresentation:88`, hex
  palette convention), `apps/web/src/modules/history/HistoryShell.tsx:159` (roster effect),
  `:229` (timeline fetch effect), `:278` (`selectTimelineSession`), `:312` (`badgeFor`)
- Test harness prior art: `apps/web/tests/modules/history/timeline-consolidated.test.tsx`

### History
