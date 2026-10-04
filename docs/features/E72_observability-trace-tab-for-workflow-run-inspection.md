---
schema_version: 1
id: "E72"
name: "Observability Trace tab for workflow run inspection"
status: active
priority: P2
tags: []
created_at: "2026-10-04T02:33:42.928Z"
updated_at: "2026-10-04T07:10:00.249Z"
---

# E72: Observability Trace tab for workflow run inspection

## Goal

Let Board users diagnose a slow or failed workflow run without the CLI: an Observability **Trace** tab lists runs and shows one run's structured progress — the same projection `spur workflow progress <runId>` prints — with per-action durations whose provenance (engine-measured vs host-reported/estimated) is visible.

## Scope

**In scope**

- A run-centric `Trace` tab registered in the existing Observability module (`OBSERVABILITY_TABS`), built from the orphaned TasksTab's run parsers, run detail panel and run-record section; the task-centric TasksTab is removed.
- Run list filtered by workflow, status and the shell-owned time range.
- Run detail: state visits in order, per-action attempts with `durationMs`, transitions, diagnostics, and the bounded run-record text E7 serves.
- One read-only route serving `projectWorkflowProgress` output, with its response schema in `packages/contracts` and the existing runs server module as the handler; the CLI and the route share that one implementation.
- Run → System Events navigation filtered by runId through the existing Observability nav intent.
- Run → History shown as copyable text: the run's time window and the `spur history analyze` command.
- An additive provenance stamp on action rows written by the inline host driver (host-reported, optionally estimated), surfaced by the projection and labelled in the tab; engine-written rows are unchanged.

**Out of scope**

- A new Board module, and any change to the History or Projects modules (including History URL deep-linking).
- Fixing the inline run → history session linkage (separate follow-up).
- Changing how the engine measures or persists its own action rows.
- Live streaming/follow of a running trace in the Board (the CLI `trace --follow` keeps that role).

## Acceptance Criteria

```gherkin
Feature: Observability Trace tab for workflow run inspection

  @core
  Scenario: R1 — The Observability module offers a Trace tab listing workflow runs
    # covers: I1, I2
    Given the project database holds completed, failed and running workflow runs
    When the user opens the Observability module and selects the Trace tab
    Then the runs appear newest first with workflow name, status, start time and duration
    And no separate Board module is added to the sidebar

  @core
  Scenario: R2 — The run list narrows by workflow, status and time range
    # covers: I3
    Given runs of task-pipeline and idea-pipeline exist with mixed statuses across several days
    When the user picks workflow task-pipeline, status failed and the 24h time range
    Then only failed task-pipeline runs started within the last 24 hours are listed
    And clearing the filters restores the full list

  @core
  Scenario: R3 — A run detail shows states, actions with durations and transitions
    # covers: I4
    Given a completed task-pipeline run whose test action took 346000 ms
    When the user opens that run in the Trace tab
    Then the states appear in visit order with each action's kind, status and durationMs
    And the transitions and projection diagnostics for the run are shown
    And the slowest actions of the run are identifiable without opening a terminal

  @core
  Scenario: R4 — A run detail shows the bounded run-record text
    # covers: I2, I4
    Given a run whose run-record file exists under the project's run memory
    When the user opens that run in the Trace tab
    Then the redacted, size-capped run-record text from the existing run-record endpoint is displayed
    And a run without a run-record file shows an explicit absent-record message

  @core
  Scenario: R5 — The Board and the CLI read one progress projection
    # covers: I5
    Given a persisted workflow run
    When a client requests the run's progress from the server's read-only progress route
    Then the response validates against the progress schema published in packages/contracts
    And its states, actions and transitions equal the output of spur workflow progress for the same run
    And an unknown run id returns a not-found response instead of an empty projection

  @core
  Scenario: R6 — A run links to System Events filtered by its run id
    # covers: I6
    Given the user is viewing a run in the Trace tab
    When the user activates the run's system-events link
    Then the System Events tab opens with its run id filter set to that run

  @core
  Scenario: R7 — A run shows its History time window as copyable text
    # covers: I7
    Given the user is viewing a run with a start and end time
    When the run detail renders
    Then it shows the run's time window and a spur history analyze command for that window that the user can copy
    And the History module itself is unchanged

  @core
  Scenario: R8 — Host-reported and estimated action durations are labelled
    # covers: I8
    Given an inline run whose host driver recorded one action as estimated and another as measured
    And an engine run whose actions were recorded by the workflow engine
    When the user opens each run in the Trace tab
    Then the inline actions are labelled host-reported and the estimated one is labelled estimated
    And the engine run's actions carry no host-reported or estimated label

  @edge
  Scenario: R9 — Rows recorded before the provenance stamp read as unlabelled
    # covers: I8
    Given action rows persisted before the provenance stamp existed
    When their run is projected
    Then the projection reports their provenance as unknown and the tab shows no label for them
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1069 | Serve the run progress projection and run list filters | wip |
| 1070 | Stamp inline action provenance and project it | todo |
| 1071 | Build the Observability Trace tab | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-04T03:05:09.524Z moved O → E72 (system)
- 2026-10-04T07:10:00.249Z backlog → active (system)

