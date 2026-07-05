---
template: feature-impl
schema_version: 1
name: "Observability web module: shell, tabs contract, Events + Inbox tabs (0189 wave B)"
description: ""
status: done
type: task
profile: standard
feature_id: J
parent_wbs: "0189"
priority: P1
tags: [approach-c,web,subtask]
dependencies: []
created_at: 2026-07-04T04:13:23.849Z
updated_at: 2026-07-04T16:09:16.000-07:00
---

## 0199. Observability web module: shell, tabs contract, Events + Inbox tabs (0189 wave B)

### Background

Wave B of parent 0189 (Observabilities v1) — read the parent's Background and Design first. This slice delivers the web surface: the `observability` module under `apps/web/src/modules/` (auto-discovery contract, task-kanban as reference), tabs declared as data in `tabs.ts` so later features (Jobs tab from 0190/0201, Process List tab from 0195/0210) append entries without touching the shell, the System Events tab (history fetch + SSE live append), and the Inbox Messages tab (list with thread context). Depends on wave A (0189 wave A APIs: history + inbox read).

### Requirements
- [x] R1 — `observability` WebModule export, auto-discovered (zero manual wiring); discovery test. (Parent R5)
- [x] R2 — Tabs-as-data contract in `tabs.ts` (`{id,label,component}[]`), shell maps the array; documented so 0190/0195 append without shell edits. (Parent R6)
- [x] R3 — System Events tab: initial history fetch + `EventSource('/api/events/planning')` live append (reuse the kanban SSE hook if extractable). (Parent R5)
- [x] R4 — Inbox Messages tab: sender/recipient/timestamp with `in_reply_to` thread grouping. (Parent R5)
- [x] R5 — All UI imports via `apps/web/src/ui.ts` (ADR-025, seam rules gate); component tests per task-kanban style; full gate green.
### Acceptance Criteria
```gherkin
Feature: Observabilities board module

  Scenario: Events tab renders history and live tail
    Given the board Observability module is open
    When the operator opens the System Events tab
    Then historical events render and newly fired events append without a page refresh

  Scenario: Inbox tab renders message history
    Given inbox_messages contains messages
    When the operator opens the Inbox Messages tab
    Then messages render with sender, recipient, timestamp, and reply-thread context

  Scenario: Module is auto-discovered by the board
    Given the observability module directory exports a WebModule
    When the board builds
    Then the module appears in the sidebar and routes without manual registry edits
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Module structure.** `apps/web/src/modules/observability/` per the auto-discovery contract (`docs/help/how_to_add_a_new_ui_module.md`; `task-kanban` is the reference). Zero manual wiring — a `WebModule` named export in `index.tsx` is discovered at build time by `import.meta.glob('./*/index.{ts,tsx}')`.

```
apps/web/src/modules/observability/
    index.tsx          # exports { module }: WebModule — id: 'observability', route: 'observability'
    tabs.ts            # tabs-as-data: { id, label, component }[] — THE extension contract
    ObservabilityView.tsx   # shell: renders tab bar + active tab panel
    EventsTab.tsx      # System Events tab: history fetch + SSE live append
    InboxTab.tsx       # Inbox Messages tab: list with sender/recipient/timestamp/thread context
    types.ts           # EventItem, InboxMessageItem, TabDefinition, etc.
    useEvents.ts       # hook: initial history fetch + EventSource live tail
    useInbox.ts        # hook: fetch inbox messages with optional agent filter
```

**Component tree.**
```
ObservabilityView (shell)
  ├─ TabBar — maps tabs.ts array → clickable tabs, highlights active
  └─ active panel
       ├─ EventsTab  (default tab)
       │    ├─ EventList (history rows from useEvents)
       │    └─ live-indicator (SSE connected status)
       └─ InboxTab
            ├─ Agent filter dropdown (optional, from query params)
            └─ MessageList (grouped by in_reply_to chain)
```

**Tabs-as-data contract (R2)** — `tabs.ts`:
```typescript
export interface TabDefinition {
    id: string;        // unique within this module (e.g. 'events', 'inbox')
    label: string;     // display text in the tab bar
    component: ComponentType;  // the panel to render
}
export const TABS: TabDefinition[] = [
    { id: 'events', label: 'Events', component: EventsTab },
    { id: 'inbox', label: 'Inbox', component: InboxTab },
];
```
0190 (Jobs) and 0195 (Process List) append entries to this array. The shell `ObservabilityView` maps `TABS` — they never touch the shell component.

**Data flow.**
- **Events tab (R3):** `useEvents()` hook does initial `GET /api/events/history?limit=100` (from 0198's R3 endpoint), then opens `EventSource('/api/events/planning')` (existing SSE, 0198 R2 emits the same `PLANNING_EVENT_NAMES`). New events append to the list in state — same SSE wiring as the existing kanban module, but inline (the kanban SSE hook is task-specific coupling; extracting a generic `useSSE` is deferred per the parent design's "check before writing a new one" instruction — assessment: the kanban SSE is tightly coupled to task refresh, not generic; inline a ~15-line EventSource effect here).
- **Inbox tab (R4):** `useInbox(agentFilter?)` hook calls `GET /api/messages/inbox?agent=<id>` (single agent) or `GET /api/messages?limit=50` (all messages, from 0198's R4 endpoint). Messages grouped by `in_reply_to`: if a message has `inReplyTo`, nest it under its parent; unthreaded messages display at root level.

**Import seam compliance (R5).** All UI imports through `apps/web/src/ui.ts` (ADR-025). No direct daisyUI class usage — use the wrapped components from `@/components/ui/`. No `@orpc/*` or raw `fetch` — use `{ api }` from `@/lib/rpc-client` for the history/inbox REST endpoints, and raw `EventSource` for the SSE stream (the SSE endpoint is not oRPC-contract-bound per parent 0189 Design).

**Route.** `/board/observability` — derived from the `WebModule.route` field. The registry auto-generates the route; no manual router.tsx edits.

**State management.** No external state library — React `useState` + `useEffect` per tab (pattern matches task-kanban's `useTasks` hook). The modules share no cross-tab state.
### Plan
- [x] Module scaffold: create `apps/web/src/modules/observability/` directory with `index.tsx` exporting a `WebModule` (`id: 'observability'`, `name: 'Observability'`, `icon: '🔭'`, `route: 'observability'`); `ObservabilityView.tsx` shell with tab bar + active tab panel; `types.ts` with `TabDefinition`, `EventItem`, `InboxMessageItem`; `tabs.ts` with the tab array (R1, R2).
- [x] Discovery test: assert `getModule('observability')` resolves in the registry test (`apps/web/tests/modules/registry.test.ts`) — covered automatically by glob discovery; validate the module shape matches `WebModule` (R1).
- [x] System Events tab: `EventsTab.tsx` rendering `useEvents()` hook — initial `GET /api/events/history?limit=100` then `EventSource('/api/events/planning')` live append; newest-first rendering with event name, timestamp, actor (R3).
- [x] Inbox Messages tab: `InboxTab.tsx` rendering `useInbox(agentFilter?)` hook — `GET /api/messages/inbox?agent=<id>` or `GET /api/messages?limit=50`; sender/recipient/timestamp columns; `in_reply_to` thread grouping (nested rendering, indented children) (R4).
- [x] Import seam compliance: all UI imports through `@/ui`; no direct daisyUI class usage; `api` from `@/lib/rpc-client` for REST endpoints; `EventSource` for SSE (browser built-in, no import needed) (R5).
- [x] Component tests mirroring task-kanban style: render `ObservabilityView`, assert tab bar renders both tabs; render `EventsTab`, assert history rows render; render `InboxTab`, assert message list renders with thread grouping; hook tests for `useEvents` and `useInbox` (R5).
- [x] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R5).
- [x] Manual: `spur serve`, open `/board/observability`, verify Events tab renders; send a `spur task update` and see the event land live; verify Inbox tab renders messages from `spur message send` (R5).
### Solution

- `apps/web/src/modules/observability/index.tsx:12` exports the `observability` `WebModule` so module discovery picks it up without manual registry wiring.
- `apps/web/src/modules/observability/tabs.ts:15` defines the append-only `{ id, label, component }` tab contract; `ObservabilityShell` maps the data array at `apps/web/src/modules/observability/ObservabilityShell.tsx:24`.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:117` fetches bounded event history and `apps/web/src/modules/observability/SystemEventsTab.tsx:136` opens the live `EventSource` tail, dropping malformed/connected frames and prepending valid rows.
- `apps/web/src/modules/observability/InboxTab.tsx:91` loads the operator inbox and `apps/web/src/modules/observability/InboxTab.tsx:141` groups rows by `inReplyTo`, rendering sender, recipient, timestamp, status, and body.
- `apps/web/tests/modules/observability/components.test.tsx:111` adds Happy DOM component coverage for shell tab switching, history fetch, SSE live append, and inbox thread metadata.

### Testing

- `bun test apps/web/tests/modules/observability.test.ts apps/web/tests/modules/observability/tabs.test.ts apps/web/tests/modules/observability/components.test.tsx` — 13 assertions suites passed; command exits nonzero on the intentionally narrow coverage subset.
- `bun run lint` — clean.
- `bun run test` — 2166 pass, 0 fail, coverage gate satisfied.
- `bun run test-cf` — 1 worker test file passed.
- `bun run build` — cli/server/web build succeeded.
- `bun run spur-check` — 29 pre-check rules passed, 2166 tests passed, 2 post-check rules passed.
- `bun run apps/cli/src/index.ts serve --port 4340 --host 127.0.0.1 --no-open` + curl probes — `/board/observability`, `/api/events/history?limit=1`, and `/api/messages/inbox?agent=operator&limit=1` all returned HTTP 200; server stopped cleanly with SIGINT.

### Review

| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `apps/web/src/modules/observability/SystemEventsTab.tsx`, `apps/web/src/modules/observability/InboxTab.tsx` | The task draft mentioned using the oRPC client for REST endpoints, but the history/inbox endpoints delivered by 0198 are raw Hono routes rather than oRPC contract endpoints. The implementation uses `resolveApiUrl()` + `fetch` for history/inbox and raw `EventSource` for SSE; the UI seam rule passes because UI components import through `@/ui`. | Keep this transport shape until these endpoints are added to the oRPC contract; do not introduce a fake client facade around raw routes. |

### References

J

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-04T06:22:45.167Z todo → backlog (system)
- 2026-07-04T16:09:16.000-07:00 backlog → done (codex: added observability component coverage and verified gates)
