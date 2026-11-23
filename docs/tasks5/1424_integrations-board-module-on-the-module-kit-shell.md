---
schema_version: 1
name: Integrations Board module on the module-kit shell
status: done
template: feature-impl
created_at: 2026-11-22T02:10:29.289Z
updated_at: "2026-11-23T06:14:41.682Z"
feature_id: A82
priority: P2
tags: ["integrations", "A82"]

dependencies: ["1423"]
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
---

## 1424. Integrations Board module on the module-kit shell

### Background

Implements: R10 — The Board shows an Integrations module built on the module-kit shell; R11 — The Summary tab shows one health row per surface; R12 — The MCP tab shows the catalog, recent calls and a client config snippet; R13 — The A2A tab shows member cards, A2A tasks and outbound receipts with deep links; R15 — The Integrations module renders empty and diagnostic states when surfaces are off or unreachable.

Design satellite: docs/design/integrations-module.md §3. Follows DESIGN.md "Product UI — Module Shell" and A81 module-kit (apps/web/src/components/module-kit/). Read DESIGN.md before starting.

**Refine corrections (2026-11-21)**
- "Deep links use the existing nav intents (`ObservabilityNavIntent`)" → that intent is tab-local state inside `ObservabilityShell` (`apps/web/src/modules/observability/ObservabilityShell.tsx:32`). It does not cross modules. The cross-module pattern is a URL: `/board/observability?tab=trace&wbs=…` (`apps/web/src/modules/task-kanban/TaskRunEvidenceLink.tsx:8`). The shell reads only `tab` (:22) and TraceTab reads `wbs` (`TraceTab.tsx:283`). → links are URLs. Add a small seed in `ObservabilityShell` that turns `?tab=system-events&eventName=&runId=` into the initial `navIntent`, so the System Events filter applies on arrival.
- "Projects › Inbox" → the Projects tab comes from the path segment: `/board/projects/inbox` (`apps/web/src/modules/projects/useProjectTab.ts:7`; tab ids `fleet|inbox|database`, `tabs.tsx:7`).
- "A2A tasks (sender `a2a`)" → the inbox carries no sender column for that. A2A-originated work is identified by `requestKey` prefix `a2a:` on `inbox.requests` rows (`packages/contracts/src/inbox.ts:52`; fields `messageId, requestKey, status, runId, runStatus, taskId, outcome`).
- "Outbound receipts (G91)" → there is no receipts list procedure. Each outbound member's traffic is `inbox.list { member, direction: 'in' }`. The exact receipt per message is `inbox.requests { messageId }` (`inbox.ts:132-136`).
- The events-history client is not shared. `SystemEventsTab` builds `${resolveApiUrl()}/events/history` inline (`SystemEventsTab.tsx:138`). → reuse that URL builder by exporting it; do not copy it.
- The Observability module uses `module-kit` (`ObservabilityShell.tsx`, `SystemEventsTab.tsx`). Its current `icon` is an emoji (`index.tsx:15`). This task follows that convention, per the satellite.

### Requirements

- [x] R1. An auto-discovered module `apps/web/src/modules/integrations/` (id `integrations`, label `Integrations`), picked up by `apps/web/src/modules/discover.ts`. It renders through `ModuleShell`, `ModuleHeader` (status chip + `TimeRangePresets` for the usage window) and `ModuleTabs`.
- [x] R2. Tabs come from an append-only `tabs.ts` in the order Summary, MCP, A2A.
- [x] R3. Summary has one row per surface (project MCP, gateway MCP, A2A inbound, A2A outbound):
  - state `off` / `on` / `on · token unset` (error tone);
  - URL, auth env name and whether it is set;
  - calls, error rate, last call and auth denials in the selected window, from `integrations.usage`;
  - a gateway counters strip when `gateway.served`, and a "counters unavailable" note when `counters` is `null`.
- [x] R4. The MCP tab has:
  - a tool table with origin and read/write badges (from `annotations.readOnlyHint`) and a schema drawer;
  - a resource list;
  - recent calls (events with `prefix=mcp`) showing tool, duration, outcome and errorCode;
  - a copyable client config snippet with a `${ENV_NAME}` placeholder. It never contains a token.
- [x] R5. The A2A tab has:
  - inbound member cards with the card URL and a write-fenced badge;
  - A2A tasks (`inbox.requests` rows with `requestKey` starting `a2a:`) with run state, linking to `/board/projects/inbox`;
  - outbound receipts per outbound member;
  - recent `a2a`/`auth` events linking to `/board/observability?tab=system-events&eventName=<name>&runId=<runId>`.
- [x] R6. Observability applies `eventName`/`runId` from the URL as the initial System Events intent when `tab=system-events`.
- [x] R7. A loading skeleton; `EmptyState` when every surface is off, naming the config keys; `Diagnostic` with retry when `integrations.status` fails. Semantic tokens only, no hex.

Out of scope: the ADR-133 icon cleanup (A83 1428), live SSE, and editing integration config from the Board.

### Acceptance Criteria

- [x] AC1 — The Board shows an Integrations module built on the module-kit shell
- [x] AC2 — The Summary tab shows one health row per surface
- [x] AC3 — The MCP tab shows the catalog, recent calls and a client config snippet
- [x] AC4 — The A2A tab shows member cards, A2A tasks and outbound receipts with deep links
- [x] AC5 — The Integrations module renders empty and diagnostic states when surfaces are off or unreachable

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:02:56.982Z

- **Closed: deep links.** URLs, not a shared intent bus. The URL pattern already exists and survives reloads; a bus would be new infrastructure for three links.
- **Closed: outbound receipts.** Read per member through the existing inbox procedures, bounded by declared member count × 20 rows. A dedicated receipts procedure is deferred until a fleet has enough outbound members for this to be slow.

### Design

- **Composition:** `index.tsx` holds the `WebModule` (id, label, emoji `icon` per current convention, component). `IntegrationsModule.tsx` holds `ModuleShell` > `ModuleHeader` > `ModuleTabs`, plus `tabs.ts`, `SummaryTab.tsx`, `McpTab.tsx`, `A2aTab.tsx` and `useIntegrations.ts`. The shell owns the status fetch, the usage window, retry and the tab state.
- **Data:**
  - Typed oRPC client from `apps/web/src/lib/rpc-client.ts`: `integrations.status`, `integrations.usage { since }`, `inbox.requests`, `inbox.list`.
  - Event rows: export the URL builder from `SystemEventsTab.tsx` (:138) as `eventsHistoryUrl(params)` and fetch with `prefix=mcp|a2a|auth` and limit 50.
- **Deep links:** use plain `<a href>` URLs, like `TaskRunEvidenceLink`. The `ObservabilityShell` seed is a lazy `useState` initializer: when `requestedTab === 'system-events'` and `eventName` or `runId` is present, start `navIntent` as `{ tab: 'system-events', eventName, runId }`.
- **State chip rule:** `!enabled` → `off`; `enabled && !auth.tokenPresent` → `on · token unset` (error); otherwise `on`.
- **Frozen names:** module id `integrations`; tab ids `summary|mcp|a2a`; `eventsHistoryUrl`.
- **Anti-patterns:** no hex or raw palette classes; never render `auth.envName`'s value, only its name; no new fetch wrapper; no Settings/Observability sub-tab.
- **Depends on 1423:** the oRPC procedures and the dot-less prefixes. **Leaves for 1425:** the stable route `/board/integrations` and Summary row test ids `integrations-row-<surface>` for the E2E screenshot assertions.

### Plan

Premises (verified 2026-11-21):
- The module-kit exists: `apps/web/src/components/module-kit/{ModuleShell,ModuleHeader,ModuleTabs,TimeRangePresets,Diagnostic,EmptyState}.tsx`.
- Observability reads `?tab` (`ObservabilityShell.tsx:22`) and holds intent locally (:32). The URL deep-link precedent is `TaskRunEvidenceLink.tsx:8`.
- The Projects tab comes from the path (`useProjectTab.ts:7`).
- The inbox request rows carry `requestKey`/`runStatus` (`packages/contracts/src/inbox.ts:52`).

- [ ] 1. Read DESIGN.md "Product UI — Module Shell" and `ObservabilityShell.tsx` as the reference composition.
- [ ] 2. Write failing component tests under `apps/web/tests/modules/integrations/` (happy-dom, mocked rpc client). Cover:
  - the tab order;
  - the three state chips;
  - the token value is absent from the rendered DOM when a known value is set in the fixture;
  - the snippet uses `${ENV_NAME}`;
  - `counters: null` shows the unavailable note;
  - the empty state;
  - the diagnostic with a retry that refetches;
  - the A2A link hrefs;
  - only `a2a:` request rows are listed.

  Also add an Observability test: `?tab=system-events&eventName=a2a.task.cancelled` applies the filter.
- [ ] 3. (R1, R2, R7) Scaffold the module, shell, tabs and states.
- [ ] 4. (R3) Build Summary. (R4) Build MCP. (R5) Build A2A. (R6) Add the Observability seed and export `eventsHistoryUrl`.
- [ ] 5. Browser-check `/board/integrations` in light and dark at 375px and desktop width. Then run `bun run spur-check`.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `apps/web/src/modules/integrations/index.tsx` | `WebModule` id `integrations`, route `integrations`, order 12 | R1: auto-discovered by `discover.ts`, so `/board/integrations` exists without a routing edit |
| `apps/web/src/modules/integrations/tabs.ts` | append-only `INTEGRATIONS_TABS` (summary, mcp, a2a) | R2: contract order, stable ids |
| `apps/web/src/modules/integrations/IntegrationsModule.tsx` | `ModuleShell` > `ModuleHeader` (chip + `TimeRangePresets`) > `ModuleTabs` > panel | R1/R7: one status chip, one window control, loading / empty / diagnostic / tab states |
| `apps/web/src/modules/integrations/helpers.ts` | `surfaceState`, `clientSnippet`, `a2aRequests`, `systemEventLink`, `eventsHistoryUrl` consumers, `projectProtocolEvent` | The rules the task pins, testable without a tree: the frozen `off/on/on · token unset` vocabulary, the `${ENV_NAME}` snippet, the `a2a:` request-key family |
| `apps/web/src/modules/integrations/useIntegrations.ts` | one hook: status + usage + two event families + inbox receipts, retry counter | R3/R4/R5 data; every read is an existing procedure or the existing history endpoint |
| `apps/web/src/modules/integrations/SummaryTab.tsx` | four rows (`integrations-row-<surface>`), gateway strip, counters-unavailable note | R3: state/URL/auth/calls/error-rate/last-call/denials per surface |
| `apps/web/src/modules/integrations/McpTab.tsx` | tool table (origin + read/write badges, schema drawer), resources, recent calls, copyable snippet | R4 |
| `apps/web/src/modules/integrations/A2aTab.tsx` | member cards, A2A tasks → `/board/projects/inbox`, outbound receipts, event links → observability URL | R5 |
| `apps/web/src/modules/observability/events-history.ts` | `historyUrl`/`HISTORY_LIMIT` extracted; `eventsHistoryUrl` exported | R5/Plan: one builder shared with System Events — no copied URL string, and importing the whole tab for one function is avoided |
| `apps/web/src/modules/observability/SystemEventsTab.tsx` | re-exports the moved builder; local import for its own use | Zero behavior change for existing consumers (`JobDetailDrawer`, tests) |
| `apps/web/src/modules/observability/ObservabilityShell.tsx:28-40` | `?tab=system-events&eventName=&runId=` seeds `navIntent` | R6 |
| `apps/web/tests/modules/integrations/integrations-module.test.tsx` | 16 tests: identity, tab order, chips, activity columns, gateway counters, catalog badges, snippet, no token in DOM, A2A rows/links, empty, diagnostic+retry | The task's R1–R7 behaviours |
| `apps/web/tests/modules/observability/url-seed.test.ts` | the URL seed is a lazy initializer, and System Events still reads `navIntent` | R6 |
| `apps/web/tests/modules/registry.test.ts` | enabled order gains `integrations` | Discovery is real: the new module is in the singleton registry |

Notes
- Error rate is failures over total attempts (`failures / (calls + failures)`) so 3 calls + 1 failure reads 25%, not 33%.
- The state chip vocabulary is exactly three values; an unreadable gateway counter set does NOT become `on · token unset` — that spelling is reserved for a missing bearer token, and the counters strip carries the failure.
- Not covered in this task: the heavy browser proof (`apps/web/tests/*.heavy.test.ts`) belongs to 1425's E2E leg; the module was exercised through the DOM suite here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:245` — Auto-discovery and the module-kit identity and tab strip are asserted. |
| R2 | MET | `apps/web/tests/modules/integrations/tabs.test.ts:6` — The three tab IDs and order are pinned. |
| R3 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:305` — The four rows render windowed counts, errors, last calls and denials. Live Summary state and all four row IDs are asserted at apps/web/tests/modules/integrations-browser.heavy.test.ts:41. |
| R4 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:352` — Catalog origin, hints, resources and schema disclosure render. The same suite asserts recent tool name, duration, outcome and error code, and checks the copyable examples and probe. |
| R5 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:378` — Members, requests and deep links render. Outbound receipt assembly is tested at apps/web/tests/modules/integrations/useIntegrations.test.ts:210. |
| R6 | MET | `apps/web/tests/modules/observability/url-seed.test.ts:29` — System Events reads eventName/runId; the initial event-name filter is exercised at line 52. |
| R7 | MET | `apps/web/tests/modules/integrations/integrations-module.test.tsx:416` — Empty guidance and retry states render; the loading branch is in apps/web/src/modules/integrations/IntegrationsModule.tsx:78. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R10 — The Board shows an Integrations module built on the module-kit shell | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:245` — Auto-discovery and the module-kit identity and tab strip are asserted. |
| R11 — The Summary tab shows one health row per surface | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:305` — The four rows render windowed counts, errors, last calls and denials. Live Summary state and all four row IDs are asserted at apps/web/tests/modules/integrations-browser.heavy.test.ts:41. |
| R12 — The MCP tab shows the catalog, recent calls and a client config snippet | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:352` — Catalog origin, hints, resources and schema disclosure render. The same suite asserts recent tool name, duration, outcome and error code, and checks the copyable examples and probe. |
| R13 — The A2A tab shows member cards, A2A tasks and outbound receipts with deep links | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:378` — Members, requests and deep links render. Outbound receipt assembly is tested at apps/web/tests/modules/integrations/useIntegrations.test.ts:210. |
| R15 — The Integrations module renders empty and diagnostic states when surfaces are off or unreachable | MET | test | `apps/web/tests/modules/integrations/integrations-module.test.tsx:416` — Empty guidance and retry states render; the loading branch is in apps/web/src/modules/integrations/IntegrationsModule.tsx:78. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)
- 2026-11-22T06:19:39.086Z todo → wip (system)
- 2026-11-22T06:20:05.331Z wip → testing (system)
- 2026-11-22T06:20:06.954Z testing → done (system)

