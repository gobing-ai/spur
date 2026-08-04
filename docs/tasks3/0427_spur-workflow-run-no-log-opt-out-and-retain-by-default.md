---
template: feature-impl
schema_version: 1
name: "spur workflow run --no-log opt-out and retain-by-default"
description: ""
status: todo
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "cli", "log", "retention"]
dependencies: ["0426"]
created_at: "2026-08-04T17:25:04.934Z"
updated_at: "2026-08-04T18:35:54.029Z"
---

## 0427. spur workflow run --no-log opt-out and retain-by-default

### Background

Feature D2 — the run command surface for log retention. Adds `spur workflow run --no-log` to opt out of the consolidated log, retains the log by default, and propagates the flag to the `--async` detached worker. Operator-settled: retain-by-default with `--no-log` (no `--keep-log`, no delete-by-default). Updates its own `spur-cli` workflow reference row (ADR-038 parity) so the flag ships in the same change.

Implements: R6 — the all-in-one log is retained by default after the run ends; R7 — --no-log opts out of writing the all-in-one log.

Rubric: E2 D1 L2 C1 R0 = 6 → decompose (child of parent score 14).

### Requirements
- [ ] R1. Retain the consolidated `.spur/run/<RUNID>.log` by default after a run reaches terminal status.
- [ ] R2. `spur workflow run --no-log` opts out of writing the consolidated log.
- [ ] R3. Propagate `--no-log` to the `--async` detached worker (same propagation path as `--trace-file`).
- [ ] R4. Do not add a `--keep-log` flag or delete-by-default behavior (operator-settled polarity).
- [ ] R5. Update the `spur-cli` workflow reference run signature (ADR-038 parity test must pass).
### Acceptance Criteria
```gherkin
Feature: spur workflow run --no-log opt-out and retain-by-default

  @core
  Scenario: R6 — the all-in-one log is retained by default after the run ends
    Given a workflow run completes
    When the operator inspects .spur/run
    Then the file RUNID.log still exists for that run
    And no --keep-log flag or delete-by-default behavior applies

  @core
  Scenario: R7 — --no-log opts out of writing the all-in-one log
    Given an operator starts a workflow run with spur workflow run --no-log
    When the run completes
    Then no RUNID.log file is written for that run
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
