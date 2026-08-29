---
schema_version: 1
name: "Enforce database single-flight for every history refresh producer"
status: todo
template: feature-impl
created_at: 2026-08-29T23:11:49.388Z
updated_at: "2026-08-29T23:11:49.390Z"
feature_id: E31
priority: P1
tags: ["history", "reliability", "sqlite"]
---

## 0716. Enforce database single-flight for every history refresh producer

### Background

Implements feature scenarios R3 — All producers share one pending-or-processing invariant and R4 — Concurrent producers cannot bypass single-flight. The current pending-only index protects completion-trigger bursts, but schedule and Board manual producers call raw queue enqueue, while processing rows remain outside the uniqueness domain. This task owns the complete producer-to-database behavior, including the Board response status.

Rubric: E6 D1 L4 C1 R2 = 14 → decompose (force: R=high). The `--auto` pre-batch quiz was skipped. Runs before the child-process task because its active-row invariant becomes that task's execution precondition.

### Requirements

- [ ] R1. Route schedule, completion, and Board manual refresh requests through one app-layer enqueue function that returns `enqueued`, `coalesced`, or `already-running`; pending payload merge keeps the earliest start/latest end, `full` dominates `incremental`, completion debounce remains intact, and immediate requests never delay an earlier due time.
- [ ] R2. Replace the pending-only history-refresh index with migration 0027's pending-or-processing unique index, deterministically retire pre-existing duplicate active rows, and prove two SQLite connections cannot create or claim concurrent active refreshes; expose the closed outcome through existing events and the Board import response.

### Acceptance Criteria

```gherkin
Feature: Database single-flight history refresh

  @core
  Scenario: R1 — All producers share one pending-or-processing invariant
    Given a history refresh is pending or processing for a project
    When scheduled, operation-completion, or manual producers request another refresh
    Then no second pending refresh is created
    And no second refresh starts concurrently
    And the producer receives an observable coalesced or already-running outcome

  @core
  Scenario: R2 — Concurrent producers cannot bypass single-flight
    Given no history refresh is pending or processing
    When two independent producers enqueue at the same time
    Then the database admits exactly one pending refresh
    And both producers receive deterministic outcomes without an unhandled uniqueness error
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Approach: extend the existing `enqueueCoalesced`/`enqueueHistoryRefresh` path instead of adding a lock service. SQLite remains the cross-process authority through one partial unique index covering `history.refresh` rows in `pending` or `processing`; guarded insert/update logic maps conflicts to deterministic outcomes. All producers reuse that path, and the Board DTO narrows `status` to `queued | coalesced | already-running`.

Rejected: an in-memory mutex protects only one server process; retaining one pending follow-up during processing permits a second consumer to claim it concurrently; separate schema/DTO tasks would be horizontal fragments below the two-hour floor.

Invariants: at most one active history refresh row per project; other queue job types retain multiplicity; migration preserves an auditable terminal record for retired duplicates; enqueue uniqueness errors never escape as producer failures.

### Plan

1. Add the 0027 migration and active-row race/migration tests.
2. Extend the existing coalescing writer with processing detection and deterministic due-time/payload merge semantics.
3. Route completion, schedule, and Board manual producers through the shared writer.
4. Narrow the Board response status and update producer/event tests plus the accepted design docs if as-built shapes differ.
5. Run targeted domain/app/server/contracts/web tests, then workspace gates.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
