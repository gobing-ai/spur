---
schema_version: 1
id: "G62"
name: "Project fleet, orchestrator binding, and rest/GTD strategy runtime"
status: backlog
priority: P2
tags: ["g6-program"]
created_at: "2026-09-12T04:42:44.011Z"
updated_at: "2026-09-12T04:45:07.878Z"
---

# G62: Project fleet, orchestrator binding, and rest/GTD strategy runtime

## Goal

Give each project a declared agent fleet, one explicitly bound orchestrator, and a persisted
dispatch strategy (`rest` / `gtd`) that decides what gets dispatched — with capacity, a single
write slot per worktree, fencing across restarts, and event-driven wakeups instead of a hot poll.

The orchestrator is a real fleet member holding the active strategy; the harness validates scope,
capacity, and task eligibility before any dispatch.

## Scope

- In:
    - **Project-scoped fleet declaration** — one project-local declaration of desired members
      (role, executor, capabilities, enabled) replacing `agent.team.<id>` as the authoring surface.
      Generated specs stay a projection, never a second editable roster. Existing member/spec IDs
      survive executor replacement and roster reorder (frozen-index `<role>-<n>` derivation).
    - **Orchestrator binding** — one explicitly configured orchestrator per project, bound to a
      real member. Decide and implement its carrier: a persisted `purpose` field versus a config-side
      annotation on a planner-role instance. `orchestrator` is NOT in the closed role vocabulary
      (`packages/config/src/index.ts:153–156`); adding a role value is a separate consented change.
    - **Persisted strategy with an extension point** — `rest` and `gtd` only, as a declared selection
      over the existing gates. `rest` accepts input, drains running work, and starts nothing
      (including queued-unstarted). `gtd` selects already-authorized, ready, dependency-satisfied
      work ordered priority → WBS. Strategy survives Board start and process restart.
    - **Capacity resolution** — intersection of task readiness, role-compatible available executors,
      an idle managed instance, permitted capabilities, and a free write slot. **One write slot per
      project worktree** in v1; read-only concurrency requires capability evidence, never a role name.
    - **Fencing and leases** — per-project write-slot lease with `ownerEpoch` and `strategyVersion`;
      a decision that went stale between select and claim re-evaluates instead of dispatching;
      results from a replaced owner are downgraded to diagnostics, never advancing a task.
    - **Wakeups** — wake on human input, strategy change, task/capacity change, and completion
      receipt (from G61). No hot LLM polling loop; no runnable work produces a durable, actionable
      hold reason. The current 2000 ms drain poll is replaced or deduped, not merely wrapped.
    - **Managed loop lifecycle** — start/stop/restart and diagnostics stay on `spur agent` or the
      Projects UI; config alone is not an operator surface. Reuse `SupervisorService` backoff,
      identity env stamps, and the existing role-propagation path (`SPUR_ROLE`, `SPUR_SPEC_ID`).
    - Validate actual cwd and storage root at registration and launch — an env string is context,
      not proof of ownership.
- Out:
    - A global broker/daemon, cross-project dispatch, or cloud/multitenant execution.
    - Dynamic strategy plugin loading, a second workflow engine, or a separate backlog model.
    - Adoption of already-open native terminal sessions; terminal scraping or synthetic keystrokes.
    - Replacing task readiness/verification ownership — `gtd` selects within existing gates and
      does not replace `/sp:dev-gtd` or `task-pipeline.yaml`.
    - Delivery/receipt mechanics (G61), Board UI (G63), retirement/migration (G64).

## Acceptance Criteria

```gherkin
Feature: Project fleet, orchestrator binding, and rest/GTD strategy runtime

  @core
  Scenario: R1 — A project declares its fleet and one orchestrator
    Given a project with a declared fleet and a bound orchestrator member
    When the runtime resolves the project
    Then each member has a stable instance id, role, executor, and capabilities
    And exactly one member is the project's orchestrator

  @core
  Scenario: R2 — GTD dispatches only eligible authorized work
    Given strategy gtd and a mix of authorized, unauthorized, unready, and blocked tasks
    When the orchestrator selects next work
    Then only authorized, ready, dependency-satisfied tasks dispatch, ordered by priority then WBS
    And every skipped task records an actionable hold reason

  @core
  Scenario: R3 — Rest drains without starting new work
    Given running work and queued unstarted assignments
    When the strategy changes to rest
    Then no further dispatch starts, queued-unstarted assignments do not begin
    And running work finishes and reconciles, keeping its slot until reconciliation

  @core
  Scenario: R4 — One writer per worktree
    Given a project whose write slot is held
    When a second write-capable dispatch is attempted for the same worktree
    Then the dispatch is refused with a capacity hold
    And a read-only assignment proceeds only with capability evidence

  @core
  Scenario: R5 — Stale decisions and replaced owners cannot act
    Given a dispatch decision taken before a strategy change or owner replacement
    When the claim is attempted
    Then the decision is declared stale and re-evaluated
    And a result arriving from the replaced owner is recorded as a diagnostic without advancing the task

  @core
  Scenario: R6 — Restart resumes persisted state before dispatching
    Given a persisted strategy, fleet, and in-flight assignments
    When the runtime restarts
    Then strategy and ownership are restored and reconciled before any new dispatch
    And starting the Board does not reset the active strategy

  @core
  Scenario: R7 — Idle costs nothing
    Given no eligible work and no new input
    When the orchestrator idles across several wakeup intervals
    Then no model call and no dispatch occur
    And the current hold reason is readable by the operator
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0835 | Project fleet declaration with stable instance identity | todo |
| 0836 | Orchestrator binding with a single active owner | todo |
| 0837 | Per-project write-slot lease with ownerEpoch and strategyVersion fencing | todo |
| 0838 | Persisted rest and GTD strategy runtime with restart resume | todo |
| 0839 | Event-driven orchestrator wakeup replacing the drain poll | todo |
<!-- END AUTO-GENERATED -->

## Notes

Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md)
§ "Strategy and capacity". Executable traces for every scenario above already exist as a prototype
controller: [strategy prototype](../reports/g6-strategy-prototype.md) (23 tests, 109 assertions,
`apps/cli/tests/commands/g6-strategy-prototype.test.ts`) — production implementation should carry
those cases over as real tests, including the guard tripwires (duplicate assignment, cross-project
delivery, dispatch-after-rest, double writer, stale-owner advancement).

Depends on G61: selective wakeups and result reconciliation are impossible without the completion
receipt seam. Robin approved the rest/GTD semantics, the managed-loop v1 boundary, and one write
slot per worktree on 2026-09-11.

### Open decisions (Robin)

- Lease storage shape for `ownerEpoch`/`strategyVersion`: extend `coordination_runs` or add a fleet
  table (additive-only either way).
- Whether `orchestrator` becomes a persisted `purpose` column or stays a config-side annotation in v1.
- Wake semantics: replace the 2000 ms drain poll with receipt-triggered wake, or keep the poll and
  add dedup — cutover risk for already-promoted long-lived loops.
- What receipt format counts as a "verified" outcome for a real coding agent.

## History
