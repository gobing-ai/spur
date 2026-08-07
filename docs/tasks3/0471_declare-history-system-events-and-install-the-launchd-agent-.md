---
template: feature-impl
schema_version: 1
name: "Declare history.* system events and install the launchd agent for the nightly history loop"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0470"]
ac_numbering: task-local
created_at: "2026-08-07T05:02:01.610Z"
updated_at: "2026-08-07T05:05:37.317Z"
---

## 0471. Declare history.* system events and install the launchd agent for the nightly history loop

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on task 0470.**

The consumption-surface investigation chose **launchd** as the scheduling surface for the nightly history loop, after
establishing that Spur's embedded scheduler cannot drive it. Three findings, each independently
disqualifying, verified from source:

1. **It cannot express a daily schedule.** ts-infra's `NodeSchedulerAdapter.parseInterval` handles
   only `* * * * *`, `*/N * * * *`, and raw millisecond strings. A real cron field expression —
   `0 7 * * *`, "7am daily" — hits the documented fallback and **silently becomes a 60-second
   interval** with only a warn log.
2. **It needs a long-lived process the CLI does not have.** It is `setInterval`-based and in-process;
   `bootstrap.scheduler.enabled` is `false` in `config/config.example.yaml` and the schema documents
   it as "OFF by default for CLI (run-once)" (`apps/cli/schemas/spur-config.schema.json:90`).
3. **Nothing is registered on it.** Zero `initScheduler` call sites and zero cron entries exist
   anywhere in `apps/` or `packages/`.

**Choosing an external scheduler makes the event ledger the only in-harness evidence the loop ran** —
which is why the events ship with this ticket rather than as a follow-up.

**Verified, not assumed (the consumption-surface decision § R8):** the live 15,794-row `system_events` ledger *does* carry
current `workflow.*` rows, most recent 2026-08-06 — an earlier characterization of the ledger as dead
heartbeat noise is stale. But **`history.*` is 0 rows, and 0 of the 66 events declared in
`packages/app/src/services/event-names.ts` are `history.*`**. The history plane emits nothing at all.

Full spec: the consumption-surface decision ticket `### Design` § R6 and § R8, including the four-layer missed-run detection model.
### Requirements
- R1 — Declare `history.import.completed`, `history.analyze.completed`, and `history.daily.failed` in the event-names catalog alongside the existing 66 events, following the established metadata conventions.
- R2 — Emit those events from the history command paths so a completed or failed nightly run leaves a queryable ledger trail regardless of what invoked the CLI.
- R3 — Provide the launchd agent plist using StartCalendarInterval for a daily wall-clock trigger, with its install and uninstall path documented.
- R4 — Route launchd stdout and stderr to a log path under .spur/logs so failures occurring before Spur's own logging initializes are still captured.
- R5 — Implement the four detection layers from task 0464 Design § R8 — artifact freshness, ledger events, per-source coverage status, and the launchd error log — such that no single layer is the sole signal.
- R6 — Distinguish a run that never started from a run that started and failed, since artifact freshness alone cannot tell them apart.
- R7 — Surface the report path through the existing daily-summary surface rather than inventing a new notification channel.
- R8 — Document the chosen surface and its rejected alternatives in docs/04_DESIGN.md in the same commit as the command surface, per the T3 same-commit rule.
### Acceptance Criteria
```gherkin
Feature: 0471 the scheduled loop is observable and fails visibly

  Scenario: R2 — a completed run leaves a ledger trail
    Given the nightly history command runs to completion
    When the system events ledger is queried for history events
    Then a history.import.completed and a history.analyze.completed row are present

  Scenario: R6 — a failed run is distinguishable from a run that never started
    Given the nightly command started and then failed partway
    When the operator checks for a missed run
    Then a history.daily.failed event distinguishes it from the case where no event was written at all

  Scenario: R3 — the daily trigger fires on wall-clock time
    Given the launchd agent is installed
    When the configured hour arrives
    Then the history daily command executes once
    And its stdout and stderr are captured to the configured log path

  Scenario: R5 — no single detection layer is the sole signal
    Given the ledger is unavailable
    When the operator runs report
    Then artifact staleness still reveals that the loop has not run

Scenario: R1 — the history events join the declared catalog
    Given the event-names catalog
    When it is inspected after this change
    Then the three history event names are declared alongside the existing events
    And each follows the established metadata conventions

  Scenario: R4 — pre-logging failures are still captured
    Given the daily command fails before its own logging initializes
    When the operator inspects the scheduler error log
    Then the failure output is present at the configured log path

  Scenario: R7 — the report path reaches the operator through an existing surface
    Given a completed nightly run
    When the daily summary surface is generated
    Then it carries the path to the newest history report

  Scenario: R8 — the surface decision is documented in the same commit
    Given the command surface lands
    When the commit is inspected
    Then the design doc records the chosen scheduling surface and the rejected alternatives
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

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
