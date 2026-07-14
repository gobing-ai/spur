---
schema_version: 1
id: "J"
name: "Observabilities board module"
status: active
priority: P2
tags: []
created_at: "2026-07-03T23:28:28.509Z"
updated_at: "2026-07-14T00:24:03.447Z"
---

# J: Observabilities board module

## Goal
A Spur Board module giving the operator live and historical visibility into the system — v1 ships the module shell with a System Events tab (persisted history + SSE live tail) and an Inbox Messages tab, structured so Jobs (A2) and Process List (G2) tabs slot in as their infrastructure lands.
## Scope
- In:
    - `system_events` table (new `_spur_cli_` migration in `drizzle/`, schema owned by `packages/domain`): id, event_name, occurred_at, actor, payload_json; capped size with insert-time pruning (oldest-first) until the scheduler takes over pruning (feature A2).
    - EventBus tap in the server that persists planning + system events to `system_events` (subscribes the same bus the SSE module reads — `apps/server/src/modules/events/index.ts`).
    - `GET /api/events/history` endpoint with `name`/`since`/`limit` filters, newest first.
    - Web module `observability` under `apps/web/src/modules/` (auto-discovery contract per `docs/help/how_to_add_a_new_ui_module.md`) with a tab layout.
    - System Events tab: renders history from the API and appends live events from the existing `/api/events/planning` SSE stream.
    - Inbox Messages tab: read view over `inbox_messages` (sender, recipient, timestamp, thread) via a new read endpoint.
    - Extension contract: tabs are declared so A2 (Jobs) and G2 (Process List) add theirs without touching the shell.
- Out:
    - Process List tab (ships with feature G2) and Jobs tab (ships with feature A2).
    - Retention configuration surface — the cap is a constant in v1.
    - WebSocket transport; event schema redesign; write actions from the Inbox tab (feature G1 owns message send/reply APIs).
## Acceptance Criteria
```gherkin
Feature: Observabilities board module

  Scenario: Bus events persist to system_events
    Given spur serve is running on Bun
    When a task.updated event fires on the EventBus
    Then a system_events row is written with the event name, payload, and occurred_at timestamp

  Scenario: The event table stays within its cap
    Given system_events holds its maximum row count
    When a new event is persisted
    Then the oldest rows are pruned so the row count stays at or below the cap

  Scenario: Event history is queryable over the API
    Given persisted events exist
    When GET /api/events/history is requested with a since filter
    Then events newer than the filter return newest first

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

  Scenario: Server-native planning write appears in System Events
    Given spur serve has registered the system_events tap and SSE stream
    When a task or feature mutation is executed through the server service/API
    Then a task.* or feature.* event is persisted in system_events
    And the same event is streamable through /api/events/planning

  Scenario: Server-native rule run appears in System Events
    Given a RuleService is obtained from the server context with the canonical server EventBus injected
    When a real rule evaluation runs against a tiny fixture
    Then rule.run.start and rule.run.done are persisted in system_events
    And no direct test-only bus.emit call is needed

  Scenario: Server-native workflow run appears in System Events
    Given a WorkflowAppService is obtained from the server context with events wired to ctx.eventBus()
    When a tiny workflow is run through that service
    Then workflow.run.started and at least one workflow.action.* or workflow.run.* completion event are persisted

  Scenario: Board-triggered queued action does not lose child-process events silently
    Given a task action is queued through the board/server path
    When the action dispatches an agent command or workflow command that runs in a child CLI process
    Then the design explicitly either forwards child process events to the parent server bus or documents that only parent-level agent.invoke/process/queue events are observable
    And tests assert the chosen behavior

  Scenario: No queue-only false green
    Given the System Events test suite runs
    When only queue.* producers are wired correctly
    Then at least one non-queue behavioral regression test fails

  # ── CLI-driven planning events (task 0249) — the CLI counterpart of the
  #    server-native planning scenario above; ts-libs 0049 consumer-owned work. ──

  Scenario: CLI task transition is persisted to system_events
    Given a migrated Spur workspace database
    And spur serve is NOT running
    When the operator runs a CLI task status transition
    Then a task.transitioned (or task.updated) system_events row is written with source planning and a from -> to payload

  Scenario: CLI feature transition is persisted to system_events
    Given a migrated Spur workspace database
    When the operator runs a CLI feature status transition
    Then a feature.transitioned system_events row is written

  Scenario: The tabview history surfaces CLI-originated rows
    Given task/feature status was changed via the CLI while the server was down
    When the server later serves the System Events history endpoint
    Then the CLI-originated task.* / feature.* rows are returned and render under the planning renderer

  Scenario: Sink failure never breaks the mutation
    Given the system_events write will fail
    When the operator runs a CLI task status transition
    Then the task file transition still succeeds and the persistence error is logged, not thrown

  Scenario: No duplicate row on the Board-driven path
    Given the server system-event tap is active
    When a task status change flows through the server API
    Then exactly one system_events row is written for that change
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0189 | Observabilities board module v1: system_events persistence, Events + Inbox tabs | done |
| 0198 | system_events domain, server tap, history + inbox read APIs (0189 wave A) | done |
| 0199 | Observability web module: shell, tabs contract, Events + Inbox tabs (0189 wave B) | done |
| 0220 | System Events completeness, real-time stream, filters, and extensible details | Done |
| 0221 | Complete System Events upstream coverage and bus wiring | done |
| 0226 | System Events real producer wiring review findings | done |
<!-- END AUTO-GENERATED -->

## Notes

## History
- 2026-07-13T23:29:36.969Z backlog → active (system)
