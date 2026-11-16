---
schema_version: 1
id: "G76"
name: "Parallel fleet orchestration: worktree lanes and a gated merge queue"
status: verifying
priority: P2
tags: []
created_at: "2026-11-16T01:08:56.445Z"
updated_at: "2026-11-16T03:39:18.223Z"
---

# G76: Parallel fleet orchestration: worktree lanes and a gated merge queue

## Goal

Run a set of `fleet:auto` tasks on several coding-agent members at once and land each on the base branch with a gated, fast-forward integration. The fleet runtime (`StrategyRuntime`) becomes the single orchestration kernel; worktree setup and landing move from skill prose into code. Decision: [ADR-149](../00_ADR.md#adr-149-the-fleet-runtime-is-the-one-orchestration-kernel-write-dispatch-is-worktree-isolated-and-lands-through-a-gated-queue); contract: [fleet orchestration lanes](../design/fleet-orchestration-lanes.md); plan: [2026-11-15 plan](../plans/2026-11-15-multi-agent-task-orchestration.md).

## Scope

**In scope**

- Per-dispatch worktree lanes with a write slot keyed by worktree realpath; `agent.fleet.maxWriters` (default 1) and `agent.fleet.laneRoot` config keys (operator consent 2026-11-15).
- Lane admission replacing the global `dispatch-in-flight` hold: integrated prerequisites, declared-file overlap, writer cap.
- A serialized integration queue: rebase, re-gate only when the tree hash moved, `--ff-only`, persist run evidence, one feature sync per touched feature, dispose lane.
- `/sp:dev-runall --mode parallel` as a thin client running the same fenced tick in a foreground loop; retire the worktree setup/landing/isolation references after parity.
- Reviewer-role routing to a declared fleet reviewer member inside the pipeline.
- A2A `remoteBranch` results landed through the same queue.
- A `fleet-e2e --perf` batch lane comparing serial fleet, parallel fleet and the retired skill path.

**Out of scope**

- New public nouns or verbs (no status verb, operator decision 2026-11-15).
- Orchestrator-level stage splitting or any new FSM (ADR-022).
- Automatic conflict resolution; speculative or batched merge queues.
- Raising host-wide gate parallelism.

## Acceptance Criteria

```gherkin
Feature: Parallel fleet orchestration: worktree lanes and a gated merge queue

  Scenario: R1 — Independent tasks run concurrently in isolated lanes
    Given agent.fleet.maxWriters is 2 and two coder members are idle
    And three fleet:auto tasks have no dependencies and no shared declared files
    When the strategy ticks
    Then two tasks are dispatched into distinct worktree lanes with overlapping execution windows
    And the third holds with reason writer-cap until a lane frees

  Scenario: R2 — A dependent task waits for integration, not completion
    Given task B depends on task A
    When task A finishes its pipeline but has not landed
    Then task B holds with reason awaiting-integration
    And task B is dispatched only after A's landing receipt exists

  Scenario: R3 — Overlapping declared files serialize
    Given two ready tasks declare the same file
    When one is in flight
    Then the other holds with reason file-overlap naming the in-flight task

  Scenario: R4 — Landing gates the rebased tree and fast-forwards
    Given a finished lane whose base moved since its gate receipt
    When the integration queue processes it
    Then the rebased tree is gated before the base ref fast-forwards
    And no merge commit is created and the lane is disposed

  Scenario: R5 — A conflict retains the lane for the operator
    Given a lane whose rebase conflicts with the base
    When the integration queue processes it
    Then the rebase is aborted, the lane and branch are retained
    And the task holds with reason integration-conflict

  Scenario: R6 — Crash recovery leaves no orphan or duplicate lane
    Given the tick host dies after opening a lane or mid-rebase
    When the next tick host reconciles
    Then the lane is reused or cleanly re-queued and no second lane exists for the same attempt
    And an outcome-unknown writing turn is never re-dispatched automatically

  Scenario: R7 — dev-runall parallel is a thin client
    Given a frozen task set and no running spur serve
    When /sp:dev-runall --mode parallel runs
    Then it tags the set, runs the fenced tick in the foreground and reports from receipts
    And the skill prose contains no git worktree or merge commands

  Scenario: R8 — Review routes to a distinct reviewer member
    Given a P1 task and a declared reviewer member
    When the pipeline reaches review
    Then the review turn runs on the reviewer member in a fresh conversation

  Scenario: R9 — A remote writer's branch lands through the same gate
    Given a fenced A2A member completes a write task with metadata.remoteBranch
    When the integration queue processes it
    Then the branch is fetched, rebased, gated by Spur and fast-forwarded

  Scenario: R10 — Throughput is measured, not asserted
    Given the fleet-e2e --perf batch lane
    When the P2 fixture runs serially and in parallel
    Then the parallel wall time is at most 0.6 of the serial-fleet baseline in the recorded receipt
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1345 | Land A2A remote writer branches through the integration queue | done |
| 1341 | Fleet worktree lanes and concurrent writers | done |
| 1342 | Fleet integration queue and integrated-dependency admission | done |
| 1343 | Thin dev-runall parallel client and retire worktree prose | done |
| 1346 | Measure parallel fleet throughput on the perf lane | done |
| 1344 | Route pipeline review to a declared fleet reviewer member | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-16T02:22:06.225Z backlog → active (system)
- 2026-11-16T03:39:18.223Z active → verifying (system)

