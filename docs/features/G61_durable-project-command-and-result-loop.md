---
schema_version: 1
id: "G61"
name: "Durable project command and result loop"
status: done
priority: P1
tags: ["g6-program"]
created_at: "2026-09-12T04:42:40.654Z"
updated_at: "2026-09-13T07:02:13.601Z"
---

# G61: Durable project command and result loop

## Goal

Make one human request travel end to end durably: Board/CLI submission → orchestrator mailbox →
worker agent → existing task workflow → verified outcome correlated back to the requester, with
no silent consumption, no blind replay, and an honest "outcome unknown" state.

This closes the four delivery defects the G6 inventory proved UNMET/ABSENT
([report](../reports/g6-runtime-inventory.md) §3 probes 1, 2, 3, 6).

## Scope

- In:
    - **Commit-after-confirm delivery** — a claimed message becomes `delivered` only after its
      prompt invocation is accepted after process creation (probe 1). Unaccepted claims are released
      within the bounded attempt budget.
    - **Failure path** — wire `InboxMessageDao.markFailed` from the drain/run path with bounded
      attempts; never-started invocations retry within budget, while started invocations settle delivered
      and record their exit separately (probe 2).
    - **Idempotent send** — caller-supplied request/idempotency key so a retried submission returns
      the original receipt instead of duplicating the payload (probe 3). Additive facade change in
      released `@gobing-ai/ts-db`, not a Spur-local workaround.
    - **Completion receipt** — a durable association between `runId`, the originating message, and
      the task, persisted by the sink at `AgentService.executeRun` exit (probe 6). This is the seam every wakeup,
      reconciliation, and Board result state depends on.
    - **Distinct states, not one status** — delivery state, run state, task verification, and hold
      reason stay separate. A zero process exit records `run-exit-only`; only an existing
      workflow verification result completes a task.
    - **Reconciliation on restart** — unfinished requests/runs are reconciled before new dispatch;
      ambiguous work ("agent may have edited files, receipt missing") surfaces as `outcome-unknown`
      and is never blindly requeued.
    - **Operator visibility** — `spur message` exposes receipts, attempts, and failed delivery;
      `spur agent` surfaces the run↔message correlation. Verb additions follow public-surface consent.
- Out:
    - Exactly-once execution of arbitrary coding-agent side effects (at-least-once with safe replay only).
    - Orchestrator strategy, capacity, and write-slot leasing (G62).
    - Any Board UI change (G63) and any surface retirement or config migration (G64).
    - Cross-project message planes, a new broker/daemon, or a second IPC transport.
    - Destructive schema migration — engine changes are additive and reversible.

## Acceptance Criteria

```gherkin
Feature: Durable project command and result loop

  @core
  Scenario: R1 — Delivery is finalized after the invocation is accepted
    Given one queued message for an agent
    When the drain path prepares the run and the invocation fails to start
    Then the message is not left consumed-without-execution
    And a retry can still deliver it within the bounded attempt budget

  @core
  Scenario: R2 — A failing invocation is durably recorded
    Given a drained message whose invocation starts and exits nonzero
    When the agent loop handles the failure
    Then the message remains delivered with its attempt count
    And an errored run receipt records the failure separately
    And the failure is visible to the operator without reading stderr

  @core
  Scenario: R3 — A retried submission is idempotent
    Given a submission carrying a request key that was already accepted
    When the same payload is submitted again
    Then the original receipt is returned and no second request row is created
    And a changed payload under a new key mints a new request identity

  @core
  Scenario: R4 — A finished run is correlated back to its request and task
    Given a worker completes a run started from a request
    When the run exits
    Then a durable receipt links runId, message id, and task id
    And the requester can read the outcome after a process restart

  @core
  Scenario: R5 — Run exit is not task completion
    Given a run that exits zero without a workflow verification result
    When the outcome is reported
    Then it is recorded as run-exit-only and the task is not advanced

  @core
  Scenario: R6 — Ambiguous outcomes hold instead of replaying
    Given a run whose receipt is missing but whose agent may have edited files
    When reconciliation runs at restart
    Then the work is reported as outcome-unknown with its artifacts and run state
    And no automatic requeue occurs

  @core
  Scenario: Attempts are bounded
    Given a claimed message that is never accepted by its invocation
    When the drain repeats across iterations
    Then the claim exhausts its bounded attempt budget and becomes terminal failed
    And the failure reason is queryable by the operator

  @core
  Scenario: Long-lived loops observe the same contract
    Given a long-lived agent loop draining the prompt inbox each iteration
    When an invocation fails and its claim is released
    Then the loop keeps iterating and the message is redelivered within budget
    And no row is lost

  @core
  Scenario: Competing consumers still claim at most once
    Given two consumers racing on the same queued message
    When both perform the claim
    Then exactly one consumer owns the claim
    And the other observes nothing to claim

  @core
  Scenario: Reconciliation precedes new dispatch
    Given unfinished requests and runs at restart
    When the runtime resumes
    Then they are reconciled before any new work is dispatched

  @core
  Scenario: Delivery failure is readable without stderr
    Given a message in a failed delivery state
    When the operator inspects it through the message and agent surfaces
    Then the attempt count, last error, and run correlation are shown

  @core
  Scenario: A run with no originating request still records its outcome
    Given a run started outside the request path
    When it exits
    Then a receipt is written without inventing a request association

  @core
  Scenario: A changed payload mints a new identity
    Given a request key that was already accepted
    When a different payload is submitted under a new key
    Then a new request row is created

  @core
  Scenario: Replay survives a restart
    Given an accepted request key
    When the process restarts and the same key is submitted
    Then the original receipt is returned from durable storage
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0831 | Commit-after-confirm delivery and bounded failure marking in the agent drain path | done |
| 0832 | Idempotency key on message send with receipt replay | done |
| 0833 | Completion receipt: durable run-message-task correlation at run exit | done |
| 0834 | Restart reconciliation and operator-visible delivery failure states | done |
<!-- END AUTO-GENERATED -->

## Notes

Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
(approved 2026-09-11). Evidence: [runtime inventory](../reports/g6-runtime-inventory.md) §3/§5,
[strategy prototype](../reports/g6-strategy-prototype.md) §4.

Frontier slice of the G6 program — G62, G63, and G64 all depend on the completion-receipt seam
delivered here. First slice of the migration order recorded in the design (§ "Migration and delivery order", step 4).

Engine boundary, **corrected during implement-ready refinement (2026-09-11)**: the two storage changes
have different owners, and the earlier note that both were `@gobing-ai/ts-db` facade changes is wrong.

- `inbox_messages` **is** ts-db's (embedded migration `0003_inbox_messages`), so 0832's idempotency key
  and 0831's missing release/requeue verb are additive facade changes in `~/xprojects/ts-libs`
  (installed 0.4.66).
- `coordination_runs` is **Spur-owned** — DAO at `packages/domain/src/dao/coordination-run-dao.ts`,
  DDL in `packages/domain/src/migrations.ts`. 0833's receipt columns are a Spur-local additive
  migration at prefix `0044` (`0043` holds request keys).

Also corrected: `InboxMessageDao.markFailed` is not uncalled. `TeamOrchestrator.flushInbox` in
`@gobing-ai/ts-ai-runner` calls it on the live stdin-injection path; what has no caller is the **CLI
drain path** (`spur agent run --drain`, `spur agent loop`). 0831 brings that path to parity.

Rollback is additive-schema-only: nullable columns and defaults, no config flag (see below).

Preserves existing owners: G1 (message events/API/watch) and G4 (occupant identity, identity-pinned
wait, coordination run records) remain authoritative — reuse them, do not fork a parallel path.
Preserve current spec IDs verbatim: a spec id IS the mailbox identity and the occupant address.

### Decisions closed at refinement (Robin may override)

- **Receipt storage shape → extend `coordination_runs`.** The table is Spur-owned, already holds
  `run_id`, `spec_id`, and artifact refs, and is written by the one sink that runs for every
  invocation. A separate receipt table would duplicate all three. Detail: task 0833 Q&A.
- **Delivery-confirm behind a flag → no flag, default on.** The behavior being replaced is silent
  message loss; a flag preserving it would keep long-lived loops losing work by default. The same
  reasoning retires the "config-flagged sink defaulting off" rollback for 0833's receipts, since every
  downstream feature (0834, 0839, 0844) requires receipts to exist. Detail: tasks 0831 and 0833 Q&A.

- **Failure semantics aligned with task 0831 Q&A/R2.** A started invocation stays delivered even
  after a nonzero exit; its errored receipt owns run failure. Only never-started delivery that
  exhausts the attempt budget becomes failed. The earlier feature/task scenario conflated these
  states and is corrected without changing the settled requirements.
- **Acceptance fix released.** `@gobing-ai/ts-ai-runner@0.4.66` emits invoke.start from process
  onSpawn. Spur only accepts prompt events, excluding readiness/help probes. All catalog ts-*
  packages now use 0.4.66.

## History

- 2026-09-12T05:52:51.881Z backlog → active (system)
- 2026-09-12T08:14:22.119Z active → verifying (system)
- 2026-09-12T08:20:23.131Z verifying → done (system)

