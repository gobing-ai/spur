---
schema_version: 1
name: Integrations Board module on the module-kit shell
status: todo
template: feature-impl
created_at: 2026-11-22T02:10:29.289Z
updated_at: "2026-11-22T04:02:57.380Z"
feature_id: A82
priority: P2
tags: ["integrations", "A82"]

dependencies: ["1423"]
estimate_hours: 8
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

- [ ] R1. An auto-discovered module `apps/web/src/modules/integrations/` (id `integrations`, label `Integrations`), picked up by `apps/web/src/modules/discover.ts`. It renders through `ModuleShell`, `ModuleHeader` (status chip + `TimeRangePresets` for the usage window) and `ModuleTabs`.
- [ ] R2. Tabs come from an append-only `tabs.ts` in the order Summary, MCP, A2A.
- [ ] R3. Summary has one row per surface (project MCP, gateway MCP, A2A inbound, A2A outbound):
  - state `off` / `on` / `on · token unset` (error tone);
  - URL, auth env name and whether it is set;
  - calls, error rate, last call and auth denials in the selected window, from `integrations.usage`;
  - a gateway counters strip when `gateway.served`, and a "counters unavailable" note when `counters` is `null`.
- [ ] R4. The MCP tab has:
  - a tool table with origin and read/write badges (from `annotations.readOnlyHint`) and a schema drawer;
  - a resource list;
  - recent calls (events with `prefix=mcp`) showing tool, duration, outcome and errorCode;
  - a copyable client config snippet with a `${ENV_NAME}` placeholder. It never contains a token.
- [ ] R5. The A2A tab has:
  - inbound member cards with the card URL and a write-fenced badge;
  - A2A tasks (`inbox.requests` rows with `requestKey` starting `a2a:`) with run state, linking to `/board/projects/inbox`;
  - outbound receipts per outbound member;
  - recent `a2a`/`auth` events linking to `/board/observability?tab=system-events&eventName=<name>&runId=<runId>`.
- [ ] R6. Observability applies `eventName`/`runId` from the URL as the initial System Events intent when `tab=system-events`.
- [ ] R7. A loading skeleton; `EmptyState` when every surface is off, naming the config keys; `Diagnostic` with retry when `integrations.status` fails. Semantic tokens only, no hex.

Out of scope: the ADR-133 icon cleanup (A83 1428), live SSE, and editing integration config from the Board.

### Acceptance Criteria

- [ ] AC1 — The Board shows an Integrations module built on the module-kit shell
- [ ] AC2 — The Summary tab shows one health row per surface
- [ ] AC3 — The MCP tab shows the catalog, recent calls and a client config snippet
- [ ] AC4 — The A2A tab shows member cards, A2A tasks and outbound receipts with deep links
- [ ] AC5 — The Integrations module renders empty and diagnostic states when surfaces are off or unreachable

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)

