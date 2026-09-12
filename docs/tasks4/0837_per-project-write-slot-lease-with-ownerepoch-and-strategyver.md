---
schema_version: 1
name: Per-project write-slot lease with ownerEpoch and strategyVersion fencing
status: todo
template: feature-impl
created_at: 2026-09-12T04:53:38.724Z
updated_at: "2026-09-12T04:58:47.404Z"
feature_id: G62
priority: P2
tags:
  - g6-program

dependencies: ["0835"]
---

## 0837. Per-project write-slot lease with ownerEpoch and strategyVersion fencing

### Background

No per-process lease or leader primitive exists. `generation` is monotonic per spec inside one
database, and a restarted supervisor mints a fresh `SPUR_RUN_ID` per child without linking it to the
previous child's run (`packages/app/src/services/supervisor-service.ts:212-216`); the shared-generation
refinement is explicitly deferred in source (`packages/app/src/services/agent-service.ts:1080-1084`).
See `docs/reports/g6-runtime-inventory.md` §5.2.5.

Meanwhile the repository invariant is one writer per working tree (AGENTS.md, Conventions &
boundaries), so fleet size can never equal write capacity — the fleet needs a real slot, not a
convention.

The strategy prototype models the target mechanics and proves them negatively as well as positively:
forcing a second writer throws `single-writer`, and a result from a replaced owner is downgraded to
`stale-owner-rejected` without advancing the task
(`docs/reports/g6-strategy-prototype.md` §3.1).

### Requirements

- **R1** — A durable per-project write-slot lease, defaulting to one write slot per worktree in v1.
- **R2** — Claiming is atomic across instance and slot: no interleaving can produce two holders.
- **R3** — Owner replacement increments `ownerEpoch`; a result arriving from a stale owner is recorded
  as a diagnostic and never advances a task.
- **R4** — Decisions are pinned to `strategyVersion`: a decision taken before a strategy change
  re-evaluates at claim time instead of dispatching.
- **R5** — Read-only assignments may run concurrently only with capability evidence from the fleet
  declaration.
- **R6** — Lease storage is additive and reversible; the shape (extend `coordination_runs` versus a new
  fleet table) is Robin's open decision recorded on G61/G62.

### Acceptance Criteria

```gherkin
Feature: Per-project write-slot lease with ownerEpoch and strategyVersion fencing

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
  Scenario: Claiming is atomic across instance and slot
    Given two claimants racing for the same write slot
    When both claim at once
    Then exactly one holds the slot and no interleaving produces two holders
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: [G62 — Project fleet, orchestrator binding, and rest/GTD strategy runtime](../features/G62_project-fleet-orchestrator-binding-and-rest-gtd-strategy-runtime.md)
- Design authority: [Projects and agent fleet unification](../plans/2026-09-11-project-agent-fleet-brainstorm.md) § "Strategy and capacity"
- Evidence: [G6 strategy prototype](../reports/g6-strategy-prototype.md) §3.1 guard tripwires (single-writer, stale-owner-rejected)
- Evidence: [G6 runtime inventory](../reports/g6-runtime-inventory.md) §5.2.5 shared-generation gap
- Code: `packages/app/src/services/supervisor-service.ts:212-216`; `packages/app/src/services/agent-service.ts:1080-1084`
- Invariant: one writer per working tree (AGENTS.md § "Conventions & boundaries")

### History
