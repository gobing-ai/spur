---
schema_version: 1
name: "Observability shell layout alignment: unified module header, live status chip, and tab consolidation"
status: done
template: feature-impl
created_at: 2026-08-24T06:19:15.168Z
updated_at: "2026-08-25T00:22:29.690Z"
feature_id: J92
priority: P2
---

## 0651. Observability shell layout alignment: unified module header, live status chip, and tab consolidation

### Background
Premise verified against the current web tree on 2026-08-23. `ObservabilityShell.tsx` only owns active-tab state and renders a full-height raw tab strip; it has no module header or `max-w-[1600px]` container. `tabs.ts` currently registers five tabs (`system-events`, `jobs`, `tasks`, `tool-using`, `routing`). SSE connection state and the rolling event rate are already owned by the single `EventSource` in `SystemEventsTab.tsx`.

This task aligns the shell with the existing `HistoryShell.tsx` header pattern and removes legacy tabs from navigation. It must reuse the existing System Events SSE connection for the header chip, not open a second connection.

Rubric: E2 D1 L1 C1 R1 = 6 → decompose.
### Requirements
- [x] R1. Render the Observability module inside `p-4 max-w-[1600px] mx-auto w-full flex flex-col gap-4`; retain a bounded, scrollable tab panel beneath the header.
- [x] R2. Add the History-style header with icon `📡`, title `Observability`, subtitle `System event streams, queue execution telemetry, and routing attribution`, and a text-plus-dot SSE status chip on the left.
- [x] R3. Render the tab buttons on the right in a pill container while preserving `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and the labelled `tabpanel` relationship.
- [x] R4. Register exactly `system-events`, `jobs`, and `routing`, in that order, in `OBSERVABILITY_TABS`; remove `TasksTab` and `ToolUsingTab` imports from the registry.
- [x] R5. Do not edit `RoutingTab.tsx` or change the `routing` tab id, label, component, queries, or behavior.
- [x] R6. Feed the shell chip from the existing `SystemEventsTab` SSE status, rolling 60-second rate, and newest event timestamp through one optional tab callback. Remove the duplicate in-tab liveness strip. When another tab is active, display an honest idle state instead of stale `live` status.
- [x] R7. Update shell and registry tests to assert the exact three-tab contract, accessible tab switching, header content, and live/error/idle chip states.

Non-goals: deleting `TasksTab.tsx` or `ToolUsingTab.tsx`, migrating their standalone tests or functionality, changing the Observability module registration metadata in `index.tsx`, adding another SSE connection, changing backend APIs, or altering any module outside Observability.
### Acceptance Criteria
```gherkin
Feature: Observability shell layout alignment

  Scenario: R1 — Unified module header and navigation
    Given the Observability board module is rendered
    When the operator views its shell
    Then the content uses the max-w-[1600px] centered layout matching History
    And the left side displays 📡, "Observability", the configured subtitle, and a text-labelled SSE status chip
    And the right side displays accessible tab buttons in a pill container
    And selecting a tab updates the labelled tab panel
    And the chip reflects the existing System Events connection, newest event, and rolling rate without opening a second EventSource
    And switching away from System Events changes the chip to an idle live-tail state

  Scenario: R2 — Tab consolidation and legacy tab removal
    Given the Observability tab configuration
    When the tab list is loaded
    Then its ids are exactly "system-events", "jobs", and "routing" in that order
    And "Tasks" and "Tool Using" are absent from the tab strip
    And the existing Routing tab component and behavior remain unchanged
```
### Q&A
- **How does the shell know SSE state?** `SystemEventsTab` reports its existing connection state through an optional callback. A second shell-owned `EventSource` is rejected because it would duplicate traffic and produce conflicting status.
- **What does the chip show off the System Events tab?** `live tail idle`; the System Events component is unmounted, so retaining `live` would be false.
- **Are the legacy component files deleted?** No. J92 removes navigation registration only. Deletion or migration of standalone components/tests is separate cleanup.
- **Does “preserve Routing” allow wrapper or prop changes inside `RoutingTab.tsx`?** No. The registry may pass props that the component ignores, but its source and behavior stay untouched.
### Design
Use `HistoryShell.tsx` only as the visual/layout precedent; keep Observability's existing data-driven tab registry and tab-panel semantics.

In `tabs.ts`, change `ObservabilityTab.component` to `ComponentType<ObservabilityTabProps>` and define the narrow handoff used by the shell:

```ts
export type ObservabilityLiveness = {
    status: 'connecting' | 'live' | 'errored';
    rate: number;
    lastEventAt: string | null;
};

export interface ObservabilityTabProps {
    onLivenessChange?: (next: ObservabilityLiveness) => void;
}
```

`SystemEventsTab` accepts that optional prop and reports changes from its existing `sseStatus`, rolling rate, and newest row. The callback is presentation-only: the current fetch, filter, pagination, SSE parse/gate, and reconnect logic remain in `SystemEventsTab`. `ObservabilityShell` stores the latest report, passes the callback to `<Active />`, and derives the displayed chip state from both the report and `activeId`; a non-System-Events tab always renders `live tail idle`. Remove the old `LivenessStrip` rendering so there is one status presentation and one EventSource.

The shell DOM is: centered outer container → wrapping header row with left identity/status and right tab pill → flexing `tabpanel`. Preserve the current default tab (`OBSERVABILITY_TABS[0]`) and do not add persisted tab state. Keep the status dot redundant with visible text and expose the chip with `role="status"`/polite announcement.

Files: `apps/web/src/modules/observability/{ObservabilityShell.tsx,SystemEventsTab.tsx,tabs.ts}`, `apps/web/tests/modules/observability/{components.test.tsx,tabs.test.ts}`, and the J92 design satellite if the final component contract differs from its current diagram. `RoutingTab.tsx` is a protected non-target.
### Plan
1. Update `tabs.test.ts` and the shell cases in `components.test.tsx` to encode the exact three-tab order, accessible header/tab behavior, one-EventSource invariant, and live/error/idle chip states (R2, R3, R4, R6, R7).
2. Narrow `OBSERVABILITY_TABS` and add the liveness callback prop contract in `tabs.ts`; remove only the two legacy registry imports (R4, R5).
3. Refactor `ObservabilityShell.tsx` to the centered History-style header/pill/tab-panel layout and render the honest liveness chip (R1–R3, R6).
4. Have `SystemEventsTab.tsx` report its existing SSE state/rate/newest timestamp and remove its duplicate liveness strip without changing fetch, pagination, filtering, or SSE ownership (R6).
5. Run the targeted Observability component/registry tests, then web typecheck/lint; confirm `git diff -- RoutingTab.tsx` is empty. Sync the J92 UI design satellite only if implementation details changed (R5, R7).
### Solution
- `apps/web/src/modules/observability/ObservabilityShell.tsx:15`: `ObservabilityShell` implements the centered layout, header/chip, newest-event time, pill navigation, and labelled panel.
- `apps/web/src/modules/observability/tabs.ts:17`: `ObservabilityTabProps` defines the narrow liveness/range handoff; `OBSERVABILITY_TABS` at line 40 contains exactly System Events, Jobs, and Routing.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:773`: `SystemEventsTab` reports its existing SSE state, rate, and newest event without a second connection.
- `apps/web/tests/modules/observability/tabs.test.ts:26`: The registry test locks the exact three-tab order.
- `apps/web/tests/modules/observability/components.test.tsx:275`: The `FakeEventSource` assertion proves the shell adds no second SSE connection; adjacent assertions cover tab/panel relationships and live/error/idle states.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/tests/modules/observability/components.test.tsx:249` |
| R2 | MET | `apps/web/tests/modules/observability/components.test.tsx:249` |
| R3 | MET | `apps/web/tests/modules/observability/components.test.tsx:263` |
| R4 | MET | `apps/web/tests/modules/observability/tabs.test.ts:26` |
| R5 | MET | `apps/web/tests/modules/observability/tabs.test.ts:26` |
| R6 | MET | `apps/web/tests/modules/observability/components.test.tsx:274` |
| R7 | MET | `apps/web/tests/modules/observability/components.test.tsx:249` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Unified module header and navigation | MET | test | `apps/web/tests/modules/observability/components.test.tsx:249`; coverage-enabled J92 gate: 207 pass, 0 fail. |
| Scenario: R2 — Tab consolidation and legacy tab removal | MET | test | `apps/web/tests/modules/observability/tabs.test.ts:26`; coverage-enabled J92 gate: 207 pass, 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|---|---|---|---|
| P4 | Ergonomics | ObservabilityShell.tsx | Module header and liveness chip match History layout and accessibility |
### References
- Parent feature: `J92`
- UI system: `DESIGN.md`
- J92 surface design: `docs/design/observability-frontend-enhancement.md`
- Layout precedent: `apps/web/src/modules/history/HistoryShell.tsx`
- Current targets: `apps/web/src/modules/observability/ObservabilityShell.tsx`, `SystemEventsTab.tsx`, and `tabs.ts`
- Tests: `apps/web/tests/modules/observability/components.test.tsx` and `tabs.test.ts`
### History
- 2026-08-24T15:41:07.727Z todo → wip (system)
- 2026-08-24T15:43:59.739Z wip → testing (system)
- 2026-08-24T15:44:34.278Z testing → done (system)
