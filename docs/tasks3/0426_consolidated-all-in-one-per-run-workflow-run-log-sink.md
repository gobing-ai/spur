---
template: feature-impl
schema_version: 1
name: "Consolidated all-in-one per-run workflow run log sink"
description: ""
status: todo
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "observability", "log", "sink"]
dependencies: []
created_at: "2026-08-04T17:25:04.906Z"
updated_at: "2026-08-04T18:33:17.366Z"
---

## 0426. Consolidated all-in-one per-run workflow run log sink

### Background

Feature D2 — the producer for the consolidated run log. Builds the read-only WorkflowObservabilityBus subscriber that writes `.spur/run/<RUNID>.log` from run creation to terminal status, subsuming the current `RunOutputSink` (which today writes only agent output to `.spur/run/<RUNID>-output.log`). One cohesive module (packages/app observability + agent-run/steering wiring), so kept as one task despite covering most core scenarios.

Implements: R1 — workflow run writes a single all-in-one log at .spur/run/RUNID.log covering creation to terminal status; R2 — the all-in-one log captures the run's foreground rendering; R3 — the all-in-one log captures every child agent's stdout and stderr; R4 — the all-in-one log captures steering commands consumed from stdin; R5 — --async runs write their narration to the all-in-one log; R10 — the all-in-one log never leaks prompt bodies or shell command text; R11 — the all-in-one log stays bounded with an explicit truncation marker; R12 — an unwritable .spur/run directory degrades the log, never the run.

Rubric: E3 D2 L1 C1 R1 = 8 → decompose (parent scored 14); kept whole on cohesion (single observability module).

### Requirements
- [ ] R1. Write a single all-in-one log at `.spur/run/<RUNID>.log` covering the run from creation to terminal status, produced in-process by a read-only `WorkflowObservabilityBus` subscriber.
- [ ] R2. Capture the run's foreground rendering into the log: plan preview, per-step progress lines, FSM transitions, and the final summary.
- [ ] R3. Capture every child agent's stdout and stderr into the log (the current `RunOutputSink` chunk contract).
- [ ] R4. Capture steering commands consumed from stdin into the log, note text redacted before the 1,024-char bound.
- [ ] R5. Produce the log for `--async` detached runs via an in-process file write, independent of the nohup std-stream `/dev/null` redirect.
- [ ] R6. Redaction holds end-to-end: prompt bodies become `[prompt N chars]`, shell commands `[shell command redacted]`, configured secrets `[REDACTED]` — the consolidated log is not a leak.
- [ ] R7. Enforce bounded volume with an explicit truncation marker when a configured byte/line bound is hit; never silently cut.
- [ ] R8. Best-effort writes: an unwritable `.spur/run/` dir or failing disk degrades the log, never the run.
- [ ] R9. Subsume `<RUNID>-output.log` (fold its output into `<RUNID>.log`) and repoint the timed-out-implement runbook consumer to the new path in the same change.
### Acceptance Criteria
```gherkin
Feature: Consolidated all-in-one per-run workflow run log sink

  @core
  Scenario: R1 — workflow run writes a single all-in-one log at .spur/run/RUNID.log covering creation to terminal status
    Given a workflow run is started with spur workflow run
    When the run reaches a terminal status
    Then exactly one log file exists at .spur/run/RUNID.log for that run
    And that log file contains entries spanning from run creation to terminal status

  @core
  Scenario: R2 — the all-in-one log captures the run's foreground rendering
    Given a workflow run is started with spur workflow run
    When the run completes
    Then the log at .spur/run/RUNID.log contains the plan preview
    And the log contains per-step progress lines
    And the log contains the FSM transitions
    And the log contains the final summary

  @core
  Scenario: R3 — the all-in-one log captures every child agent's stdout and stderr
    Given a workflow run with at least one agent.run step that writes to stdout and stderr
    When the run completes
    Then the log at .spur/run/RUNID.log contains each child agent's stdout
    And the log contains each child agent's stderr

  @core
  Scenario: R4 — the all-in-one log captures steering commands consumed from stdin
    Given a workflow run is started with spur workflow run --steer
    When the operator sends steering commands via stdin during the run
    Then the log at .spur/run/RUNID.log contains each steering command consumed by the run

  @core
  Scenario: R5 — --async runs write their narration to the all-in-one log instead of discarding it
    Given a workflow run is started with spur workflow run --async
    When the detached worker runs to a terminal status
    Then the log at .spur/run/RUNID.log contains the run's foreground rendering
    And the log contains the child agents' output

  @edge
  Scenario: R10 — the all-in-one log never leaks prompt bodies or shell command text
    Given a workflow run whose agent prompts contain secret material and whose shell actions contain command text
    When the run completes
    Then the log at .spur/run/RUNID.log does not contain any prompt body
    And the log does not contain any shell command text

  @edge
  Scenario: R11 — the all-in-one log stays bounded with an explicit truncation marker
    Given a workflow run whose combined output exceeds the configured log byte or line limit
    When the run completes
    Then the log at .spur/run/RUNID.log is capped at the configured limit
    And a visible truncation marker is written at the truncation point

  @edge
  Scenario: R12 — an unwritable .spur/run directory degrades the log, never the run
    Given the .spur/run directory is unwritable
    When a workflow run is started with spur workflow run
    Then the run proceeds and reaches a terminal status
    And no RUNID.log file is written for that run
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

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

D2

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
