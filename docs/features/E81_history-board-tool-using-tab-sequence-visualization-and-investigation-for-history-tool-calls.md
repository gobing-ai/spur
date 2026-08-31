---
schema_version: 1
id: "E81"
name: "History Board Tool Using Tab: sequence visualization and investigation for history tool calls"
status: backlog
priority: P2
tags: []
created_at: "2026-08-31T11:52:07.159Z"
updated_at: "2026-08-31T11:52:38.609Z"
---

# E81: History Board Tool Using Tab: sequence visualization and investigation for history tool calls

## Goal

Add a dedicated "Tool Using" tab to the History board module in `apps/web` (positioned directly after the "Timeline" tab) to visualize, search, and investigate the sequence of tool calls recorded in `history_tool_call`. Provide end users with an interactive, chronological tool invocation sequence, color-coded tool categories, sequence metrics, status/search filters, and a detailed inspection drawer showing arguments, call IDs, execution latency, error details, and token telemetry.

## Scope

- In:
  - **Web UI (`apps/web`)**:
    - Add `Tool Using` tab entry into `apps/web/src/modules/history/tabs.ts` directly after `Timeline` tab with tab id `tool-using` and label `Tool Using`.
    - Implement `ToolUsingTab.tsx` with dual mode support: Single Session sequence view and Filtered Cross-Session sequence stream.
    - Render sequence visualization / waterfall stream with color-coded tool badges (file read/write, bash/command, grep/search, mcp/subagent, etc.), step sequence number, execution status badge (ok/error), latency duration, and token telemetry.
    - Interactive tool call detail drawer / side sheet displaying formatted raw arguments (`args_raw`), arguments digest (`args_digest`), error text (`error_text`), call ID (`call_id`), message hash, and session metadata.
    - Sequence filtering & search: tool name filter, status filter (all/ok/error), keyword search in arguments / error text, and session switcher.
    - Summary metadata strip on tool sequence: total tool calls, unique tools count, error count & rate, total duration, and avg duration.
    - Integrate `ToolUsingTab` into `HistoryShell.tsx` with filter reactivity, session roster navigation, and badge counts.
    - Align with Open-Design prototype specifications in `spur-board-history-module-8ac9`.
  - **Contracts & oRPC Seam (`packages/contracts`, `apps/server`, `packages/app`)**:
    - Extend `historyContract` in `packages/contracts/src/history.ts` with `getToolSequence` / `getToolCalls` endpoint.
    - Define typed input and output DTO schemas for tool call sequences and filter parameters.
    - Implement server handlers in `apps/server/src/modules/history/handlers.ts`.
    - Implement service method in `LiveHistoryBoardService` (`packages/app/src/services/history-board-service.ts`) and mock service (`history-board-mock-service.ts`).
  - **Database & Domain Queries (`packages/domain`)**:
    - Query functions in `packages/domain/src/analytics/` for retrieving ordered tool call sequences from `history_tool_call` JOIN `history_message` by session or filtered criteria.
    - Bounded query pagination and indexed lookup on `(session_id, seq)` and `(source, session_id)`.
- Out:
  - Direct modification or mutation of historical tool call records (history data is read-only).
  - Modification of raw transcript files on disk.
  - Cloud/multi-tenant synchronization.

## Acceptance Criteria

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

  @core
  Scenario: R6 — oRPC getToolSequence API contract and domain query performance
    Given client requests to "history.getToolSequence" with session or filter parameters
    When the query is executed against "history_tool_call" and "history_message"
    Then the response returns ordered tool call events within <50ms for typical sessions
    And the schema validates tool call sequence events, payload strings, duration, and token telemetry
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0724 | History Board Tool Using: oRPC API contracts, domain query, and service implementation | todo |
| 0725 | History Board Tool Using: web tab UI, sequence stream, inspection drawer, and shell integration | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
