---
schema_version: 1
id: "G8"
name: Named-agent dispatch with A2A as a hidden transport
status: active
priority: P2
tags: []
created_at: "2026-11-15T03:24:20.264Z"
updated_at: "2026-11-15T05:38:15.900Z"
---

# G8: A2A outbound executor edge for workflow agent.run

## Goal

Let a user hand a task to a named coding agent, manually or automatically, without learning how the work travels. Spur chooses the delivery — a warm fleet turn, an Agent2Agent (A2A) v1.0 turn for agents it does not run itself, or a cold subprocess when nothing is running — and every path returns the same durable receipt. The inbox and fleet stay; A2A becomes a transport underneath them.

## Scope

**In scope**

- Addressing a fleet member by its id in `spur agent run --agent <member>` and in workflow dispatch.
- Dispatch that works with no `spur serve` running: a local member that is not live runs cold on the subprocess surface by default, and the receipt says so.
- Fleet members declared with an A2A Agent Card (`a2a`, optional `authEnv`), delivered over the installed `a2a` binary as the member's turn driver.
- Mapping of A2A task states and artifacts onto the existing run receipt outcomes.
- Storing the remote A2A task id on the run before waiting, so a restart re-attaches instead of re-sending.
- A refusal of worktree-mutating work for A2A members.
- A doctor report that says, per member, which delivery it will take and why.
- Hiding the fleet plumbing verbs `join`, `leave`, `wait` and `report` from default `spur agent --help`; they keep working.
- ADR-148 (amending ADR-057 and ADR-126) and the owning design satellite.

**Out of scope**

- Replacing or bypassing `spur message`, the inbox or the fleet dispatcher.
- A user-visible transport choice: no flag, step option or run variable names A2A.
- Routing same-machine members over A2A, or wrapping local agents in `a2a server --exec`.
- `spur serve` as an A2A server (cross-machine Spur fleets) — feature G9.
- Push notifications, gRPC and JSON-RPC bindings, multi-turn `INPUT_REQUIRED` / `AUTH_REQUIRED` round trips.
- New `spur` nouns or verbs; removing any existing `spur agent` verb.
- Pipeline performance work and the real-agent latency baseline (task 1331, low priority, not a prerequisite).

## Acceptance Criteria

```gherkin
Feature: Named-agent dispatch with A2A as a hidden transport

  @core
  Scenario: R1 — A task dispatched to a named local agent completes with no daemon running
    # covers: I8, I9
    Given a fleet member named coder with a local executor and no spur serve process
    When the user runs spur agent run --agent coder with a prompt
    Then the prompt runs on the member's executor and the command exits zero
    And the receipt records that the cold path ran and why

  @core
  Scenario: R2 — The same dispatch uses the warm member when one is live
    # covers: I8, I9
    Given the member coder is live under spur serve
    When the user runs the same spur agent run --agent coder command
    Then the work is delivered as a keyed inbox request and completed by the live member
    And the receipt has the same shape as the cold-path receipt

  @core
  Scenario: R3 — A member declared with an A2A card receives work over A2A
    # covers: I2, I4, I7, I9
    Given a fleet member named reviewer declared with an A2A Agent Card
    When the user dispatches a read-only prompt to reviewer with the same command form
    Then the remote task reaches TASK_STATE_COMPLETED and its artifact text is the turn output
    And no flag, step option or run variable named a transport

  @core
  Scenario: R4 — A2A task states map onto the existing receipt outcomes
    # covers: I4
    Given an A2A member whose task ends failed, rejected, canceled, input-required or auth-required
    When the dispatch resolves
    Then the receipt is failed with a reason naming the remote state
    And an input-required or auth-required task is canceled remotely

  @core
  Scenario: R5 — An A2A wait that times out is outcome unknown and is never re-sent
    # covers: I4, I8
    Given an A2A member whose task has an id but no terminal state by the deadline
    When the wait ends
    Then the receipt is outcome-unknown and carries the remote task id
    And no second message is sent for that request key

  @core
  Scenario: R6 — A restarted dispatch re-attaches to the recorded remote task
    # covers: I4
    Given a run that stored a remote task id and was interrupted before a terminal state
    When the dispatch resumes
    Then it reads the stored task and sends nothing

  @core
  Scenario: R7 — Worktree-mutating work is refused for an A2A member
    # covers: I4, I8
    Given work that declares expected files, a required diff or owned sections
    When it is dispatched to an A2A member
    Then it is refused before anything is sent with an error naming the member and the reason

  @core
  Scenario: R8 — A workflow step dispatches to a member by name
    # covers: I2, I9
    Given a workflow agent.run step that names the member reviewer
    When the workflow runs with fleet dispatch
    Then the step completes through that member's delivery and passes the existing post-conditions and gates

  @extended
  Scenario: R9 — Doctor says which delivery each member will take
    # covers: I8
    Given members that are live, local and not live, A2A-reachable, and A2A-unreachable
    When the user runs spur agent doctor
    Then each member is listed with its delivery and an actionable reason when it cannot take work

  @extended
  Scenario: R10 — A2A credentials come from the environment only
    # covers: I4
    Given an A2A member with authEnv naming an environment variable
    When work is dispatched to it
    Then the credential value appears in no config file, receipt, trace or log
    And an unset variable yields not-started with a message naming the variable

  @extended
  Scenario: R11 — Default agent help shows only the daily verbs
    # covers: I8
    Given the fleet plumbing verbs join, leave, wait and report
    When the user runs spur agent --help
    Then none of the four is listed
    And each still runs and prints its own help when invoked by name
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1331 | Publish a real-agent fleet latency baseline by phase | blocked |
| 1335 | Hide fleet plumbing verbs from default spur agent help | done |
| 1332 | Add the a2a executor surface to workflow agent.run | cancelled |
| 1333 | Dispatch to a named fleet member with no daemon running | done |
| 1334 | Deliver work to A2A-declared fleet members | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-15T05:38:15.900Z backlog → active (system)

