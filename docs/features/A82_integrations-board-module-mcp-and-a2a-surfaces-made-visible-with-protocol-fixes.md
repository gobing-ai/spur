---
schema_version: 1
id: "A82"
name: "Integrations Board module: MCP and A2A surfaces made visible, with protocol fixes"
status: backlog
priority: P2
tags: []
created_at: "2026-11-22T02:05:52.821Z"
updated_at: "2026-11-22T04:46:50.215Z"
---

# A82: Integrations Board module: MCP and A2A surfaces made visible, with protocol fixes

## Goal

Give Spur Board users one native place — the **Integrations** module — to see which agent-protocol surfaces the served project exposes (project MCP, gateway-root MCP, A2A inbound, A2A outbound and cross-project), whether each is on and correctly secured, what each offers, and what recently happened on it; and make the MCP and A2A protocol behavior those views report truthful.

## Scope

**In scope**
- MCP protocol fixes: every argument-validation failure classifies as `invalid_arguments`; tool descriptors carry read/write annotations (`readOnlyHint` / `destructiveHint`).
- A2A protocol fixes: the Agent Card route is public while every other `/a2a` route stays bearer-only; card `skills` populated from the member declaration; `remoteBranch` read from the member's own working tree; CancelTask stops only the run behind that task.
- One always-mounted, read-only status contract (oRPC in `packages/contracts`, logic in `packages/app`) covering project MCP, gateway MCP and A2A: enabled, path/URL, auth variable name and token-present flag (never the value), MCP catalog with annotations and namespace, inbound member cards, outbound/cross-project members, gateway counters when served under the gateway.
- Activity read from the existing `/api/events/history` ledger (mcp.*, a2a.*, auth.denied).
- New Board module `integrations` ("Integrations") on the A81 module-kit and the DESIGN.md Module Shell contract, with Summary, MCP and A2A tabs and deep links into Projects and Observability.
- One E2E proof that leaves a repeatable artifact.

**Out of scope**
- Per-client caller identity (one shared bearer token per surface).
- A new activity table, live SSE counters, or gateway persistence (ADR-151 keeps the gateway stateless).
- Access control in front of public cards (planned via Cloudflare Zero Trust, outside Spur).
- Migrating other Board modules to module-kit and wider Board cleanup (separate "Board maturity sweep" feature).

## Acceptance Criteria

```gherkin
Feature: Integrations Board module with MCP and A2A protocol fixes

  @core
  Scenario: R1 — MCP argument-validation failures classify as invalid_arguments
    # covers: I2
    Given the project MCP server is enabled with a valid bearer token
    When a client calls tools/call for "sp_task_list" with an unknown argument "bogus"
    And a client calls "sp_task_transition" with a status value outside its enum
    And a client calls "sp_workflow_run" with a non-string "name"
    Then each response is a tool error with errorCode "invalid_arguments"
    And no response carries errorCode "tool_error"

  @core
  Scenario: R2 — MCP tool descriptors declare read and write annotations
    # covers: I3
    Given the project MCP server is enabled
    When a client calls tools/list
    Then "sp_task_show", "sp_task_list", "sp_feature_check" and "sp_workflow_status" carry annotations.readOnlyHint true
    And "sp_task_create", "sp_task_update", "sp_task_transition", "sp_workflow_run" and "sp_workflow_continue" carry annotations.readOnlyHint false
    And every tool descriptor carries an explicit destructiveHint

  @core
  Scenario: R3 — The A2A Agent Card is public while other A2A routes stay bearer-only
    # covers: I4
    Given the A2A listener is enabled and member "dev" is declared
    When an unauthenticated client GETs "/a2a/members/dev/.well-known/agent-card.json"
    Then the response is 200 with the member's Agent Card
    And an unauthenticated client POSTs "/a2a/members/dev/message:send"
    Then the response is 401 and an "auth.denied" event with surface "a2a" is recorded
    And the route comment in the A2A module states that only the card is public

  @core
  Scenario: R4 — The A2A Agent Card lists skills from the member declaration
    # covers: I5
    Given member "dev" is declared with role "implementer" and a description
    When a client fetches the member's Agent Card
    Then the card's skills array contains at least one skill whose id, name and description derive from that declaration
    And a member with no declared role still yields one default skill rather than an empty array

  @core
  Scenario: R5 — A2A remoteBranch reports the member's own working-tree branch
    # covers: I6
    Given the server runs on branch "main" and member "dev" works in a worktree on branch "lane/dev"
    When a client fetches an A2A task created for member "dev"
    Then the task metadata reports remoteBranch "lane/dev"
    And it does not report the server's branch "main"

  @core
  Scenario: R6 — A2A CancelTask stops only the run behind that task
    # covers: I7
    Given member "dev" is running A2A task "t1" and has A2A task "t2" queued behind it
    When a client POSTs "/a2a/members/dev/tasks/t1:cancel" with a valid bearer token
    Then task "t1" reports state "canceled" and its run is stopped
    And the member loop stays up and goes on to run task "t2"
    And an "a2a.task.cancelled" event names task "t1"

  @core
  Scenario: R7 — The integrations status contract reports each surface without leaking tokens
    # covers: I8
    Given project MCP is enabled with authEnv "SPUR_MCP_TOKEN" set and A2A is disabled
    When the Board calls the integrations status procedure
    Then the project MCP entry reports enabled true, its path, authEnv "SPUR_MCP_TOKEN" and tokenPresent true
    And the A2A entry reports enabled false
    And no field of the response contains the token value
    And the procedure is defined in packages/contracts and implemented in packages/app

  @core
  Scenario: R8 — The integrations status contract carries catalogs, members and gateway counters
    # covers: I9
    Given project MCP and A2A are enabled and the project is served under the gateway
    When the Board calls the integrations status procedure
    Then the MCP entry lists every tool with its annotations and origin (built-in or workflow), every spur:// resource template, and the gateway namespace
    And the A2A entry lists inbound members with card URLs and outbound a2a and cross-project members
    And the gateway entry reports the counters exposed by /api/health
    And with the project served standalone
    Then the gateway entry reports not served under a gateway

  @core
  Scenario: R9 — Integrations activity reads protocol events from the event history ledger
    # covers: I10
    Given the event catalog is loaded
    When the Board requests /api/events/history with prefixes "mcp.", "a2a." and "auth."
    Then each request returns 200 rather than 400 for an uncataloged prefix
    And a recorded "mcp.tool.called" event appears in the MCP activity list

  @core
  Scenario: R10 — The Board shows an Integrations module built on the module-kit shell
    # covers: I1, I11
    Given the Board is open
    When the user opens the sidebar
    Then an "Integrations" entry is listed with a ModuleIcon
    And the module renders through ModuleShell, ModuleHeader and ModuleTabs with a status chip in the header
    And its tabs are declared in an append-only tabs.ts in the order Summary, MCP, A2A
    And it uses semantic tokens only with no hex colors

  @core
  Scenario: R11 — The Summary tab shows one health row per surface
    # covers: I12
    Given project MCP is enabled with its token unset and A2A is enabled with its token set
    When the user opens Integrations › Summary
    Then project MCP shows state "on · token unset" styled as an error
    And A2A shows state "on" with its endpoint URL and authEnv name
    And each row shows 24h calls, error rate, last call time and auth denials
    And gateway counters appear when the project is served under the gateway

  @core
  Scenario: R12 — The MCP tab shows the catalog, recent calls and a client config snippet
    # covers: I13
    Given project MCP is enabled and one "sp_task_list" call was recorded
    When the user opens Integrations › MCP
    Then each tool shows a built-in or workflow badge and a read or write badge
    And selecting a tool opens a drawer with its input schema
    And the spur:// resource templates are listed
    And the recent-calls list shows "sp_task_list" with duration, outcome and errorCode
    And a copyable client config snippet names the endpoint URL and the authEnv variable, not the token value

  @core
  Scenario: R13 — The A2A tab shows member cards, A2A tasks and outbound receipts with deep links
    # covers: I14
    Given member "dev" is inbound, one A2A task from sender "a2a" exists, and one cross-project receipt was recorded
    When the user opens Integrations › A2A
    Then member "dev" is listed with its public card URL
    And the A2A task is listed with its run state and a link that opens Projects › Inbox
    And the cross-project receipt is listed
    And an event row links to Observability › System Events filtered by its event name and run id

  @core
  Scenario: R14 — An E2E proof exercises the protocol fixes and the module and leaves an artifact
    # covers: I15
    Given a served project with MCP and A2A enabled
    When the E2E script calls MCP with a bad argument, fetches the public card, sends and cancels an A2A task, and loads the Integrations module
    Then it asserts R1, R3, R6, R7 and R11 outcomes
    And it writes a repeatable JSON receipt and a Summary screenshot under docs/reports

  @edge
  Scenario: R15 — The Integrations module renders empty and diagnostic states when surfaces are off or unreachable
    # covers: I11, I12
    Given MCP and A2A are both disabled
    When the user opens Integrations › Summary
    Then an empty state explains how to enable each surface
    And with the status procedure failing
    Then a Diagnostic panel shows the error and a retry action
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1423 | Integrations status and usage oRPC contract | todo |
| 1424 | Integrations Board module on the module-kit shell | todo |
| 1425 | Integrations E2E proof with a repeatable receipt | todo |
| 1421 | MCP error codes, MCP tool annotations, and A2A public card, card skills and lane branch | todo |
| 1422 | A2A CancelTask stops only the run behind the task | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-22T02:19:02.338Z moved S → A82 (system)

