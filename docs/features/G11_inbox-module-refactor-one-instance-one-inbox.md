---
schema_version: 1
id: "G11"
name: "Inbox module refactor — one fleet member, one inbox"
status: backlog
priority: P2
tags: []
created_at: "2026-10-20T06:57:26.966Z"
updated_at: "2026-10-20T17:57:47.698Z"
---

# G11: Inbox module refactor — one instance, one inbox

## Goal

Make the inbox the single, Spur-owned message plane between the operator, the system and every fleet member, with one inbox per fleet member. A fleet member is a declared member slot in a project, addressed by `<project-slug>-<member-id>`. It is never a process, run or generation. Every message sent to or from a member is durably recorded in that member's inbox and buffered there for its next action, across process restarts. Every mutation commits the message row and its event atomically. The operator reaches the fleet through one identity, from either the CLI or the Board global input. Each member's two-direction thread is visible and answerable from the Projects → Inbox tab.

## Scope

- In:
    - Drop-and-recreate `inbox_messages` (migration 0054) with a Spur-owned schema and `InboxDao`. Drop the ts-db `InboxMessageDao` import and delete `InboxRecentDao`/`InboxUnfinishedDao`.
    - `InboxService` in `packages/app` as the only inbox writer and reader, with guarded transitions, a claim lease plus sweeper, and an atomic row + `system_events` write.
    - Reserved identities: `operator` for the human, `spur` for the system. Retire `board-operator`, `terminal` and null senders.
    - An oRPC inbox contract and server handler replacing `/api/messages*` and `/api/project/requests`.
    - CLI: drain/settle moves into the service; `message send` defaults to the orchestrator; `message inbox` becomes read-only; new `message show` and `message read` verbs; help docs updated.
    - Board: an Inbox tab laid out as member list → thread → composer; GlobalAgentBar sends as `operator`; MemberTerminal stops double-posting.
    - Cleanup of stale inbox code, CSS, routes, tests, and the superseded design and architecture docs.
- Out:
    - Migrating existing inbox data (operator decision A6: drop it).
    - Upstream ts-db deprecation of `InboxMessageDao` and its migrations.
    - Message retention/compaction, attachments, and cross-machine transport.
    - Changes to the terminal stdin pipe beyond removing the duplicate enqueue.

## Acceptance Criteria

```gherkin
Feature: Inbox module refactor — one fleet member, one inbox

  Scenario: R1 — A sent message and its event commit atomically
    # covers: I1, I2
    Given an empty project database migrated through 0054
    When the inbox service sends a message from operator to a fleet member
    Then exactly one inbox_messages row and one message.sent system_events row exist
    And when the event insert fails, neither row exists

  Scenario: R2 — Only the inbox data-access layer touches the inbox table
    # covers: I1, I2
    Given the refactored source tree
    When the source outside packages/domain InboxDao is searched for inbox_messages and InboxMessageDao
    Then no production module references either

  Scenario: R3 — Status transitions are guarded
    # covers: I2
    Given a message already delivered
    When a late settle marks it failed or a release requeues it
    Then the row keeps its delivered status and no transition event is written

  Scenario: R4 — An expired claim is requeued and eventually fails
    # covers: I2
    Given a claimed message whose claim lease has expired
    When the sweeper runs
    Then the message returns to queued with a message.requeued event
    And after the maximum attempts it becomes failed with a message.failed event

  Scenario: R5 — A repeated request key produces one message
    # covers: I2
    Given a message sent with request key k1
    When the same body is sent again with request key k1
    Then one row exists and the second send returns the first message id

  Scenario: R6 — A reply always reaches the original sender
    # covers: I3
    Given a message from operator to the orchestrator member
    When the orchestrator runs spur message reply on it
    Then the reply lands in the operator inbox in the same thread

  Scenario: R7 — System-originated messages use the spur sender
    # covers: I3
    Given a workflow with executor=fleet sends a task request to a member
    When the message is stored
    Then its sender is spur, its kind is request, and its task_id and parent_run_id columns are set
    And a strategy dispatch keeps the orchestrator member as sender, with kind request and task_id set

  Scenario: R8 — Chat messages are never reported as unresolved work
    # covers: I2, I3
    Given a delivered chat message and a delivered request message with no verified run
    When unresolved requests are listed for the orchestrator
    Then only the request message is returned

  Scenario: R9 — The inbox API is a typed contract with read-only reads
    # covers: I4
    Given spur serve is running
    When a client lists, threads, sends, replies to and reads messages through the oRPC inbox contract
    Then each call round-trips through the typed client
    And list and thread calls write nothing
    And /api/messages and /api/project/requests no longer respond

  Scenario: R10 — CLI send defaults to the orchestrator as operator
    # covers: I5
    Given a project with a resolved orchestrator member
    When the operator runs spur message send with a body and no --to
    Then the message is stored from operator to the orchestrator member

  Scenario: R11 — CLI shows a thread and marks a message read
    # covers: I5
    Given a message with one reply
    When the operator runs spur message show and then spur message read on it
    Then show prints both directions in order and read sets read_at with a message.read event

  Scenario: R12 — CLI inbox listing writes nothing
    # covers: I5
    Given an inbox containing queued messages past their attempt limit
    When the operator runs spur message inbox --json
    Then the database is unchanged after the command

  Scenario: R13 — Agent runs claim and settle through the service
    # covers: I5, I2
    Given queued messages for a fleet member
    When spur agent run drains its inbox into the prompt and the run exits
    Then the messages move claimed then delivered through the inbox service and the run links their ids

  Scenario: R14 — The Inbox tab shows one fleet member's two-direction thread
    # covers: I6
    Given messages to and from two fleet members
    When the operator selects one fleet member in the Projects Inbox tab
    Then the thread shows only that member's sent and received messages in order

  Scenario: R15 — The Inbox tab replies and marks read inline
    # covers: I6
    Given an unread message from a fleet member to operator
    When the operator replies from the composer and marks the message read
    Then the reply appears in the thread and the unread marker clears without a reload

  Scenario: R16 — The Board global input sends as operator to the orchestrator
    # covers: I7
    Given the Board global input with a project selected
    When the operator submits text
    Then one message is stored from operator to the orchestrator member with no body envelope

  Scenario: R17 — Terminal input is not duplicated into the inbox
    # covers: I7
    Given a member terminal attached to a fleet member
    When the operator types a line
    Then the line reaches the process stdin and no inbox message is created

  Scenario: R18 — Stale inbox code and docs are gone
    # covers: I8, I9
    Given the refactored tree
    When the web, server and docs trees are searched for the request envelope, board-operator, dead tab ids, the inbox CSS scope and the superseded inbox board design
    Then none remain and the architecture and control-plane docs describe the inbox service

  Scenario: R19 — Queued messages survive a member process restart
    # covers: I1, I2
    Given two queued messages in a fleet member's inbox and its agent process exits before claiming them
    When a new process for the same member starts and drains its inbox
    Then it claims both messages under the same member address and no message is stranded

  Scenario: R20 — A fleet dispatch completes a round trip through the member inbox
    # covers: I1, I2
    Given a strategy tick or a workflow agent.run with executor fleet dispatches a task to a fleet member
    When the member's spur agent loop claims the message, runs, and exits
    Then the message is delivered and the run receipt links the message id and task_id
    And the dispatcher receipt resolves and the strategy or workflow advances
    And nothing reaches the member except through its inbox

  Scenario: R21 — Every member consumer claims and settles through the inbox service
    # covers: I2
    Given queued messages for a fleet member and for a guest occupant
    When spur agent loop, spur agent run, and the guest pull via spur agent wait --inbox consume them
    Then each claim and settle goes through the inbox service and the keyed write-slot hold reads task_id from its column
    And retiring the guest returns its claimed messages to queued
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1266 | Inbox domain schema and InboxService as the single writer | todo |
| 1267 | Inbox oRPC contract and server handler | todo |
| 1268 | spur message CLI on InboxService with show and read verbs | todo |
| 1269 | Projects Inbox tab redesign and stale inbox cleanup | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
