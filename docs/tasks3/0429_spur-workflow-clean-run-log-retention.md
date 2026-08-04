---
template: feature-impl
schema_version: 1
name: "spur workflow clean run-log retention"
description: ""
status: todo
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: ["workflow", "cli", "clean", "log", "retention"]
dependencies: ["0426"]
created_at: "2026-08-04T17:25:04.943Z"
updated_at: "2026-08-04T18:35:54.440Z"
---

## 0429. spur workflow clean run-log retention

### Background

Feature D2 — reclamation of retained run logs. Extends the existing `spur workflow clean` housekeeping verb to remove retained `.spur/run/<RUNID>.log` files older than a retention threshold, configurable via a new `workflow.logRetentionDays` config key (default 30 days). Preserves the verb's existing stale-run finalization. Updates its own `spur-cli` workflow reference row (ADR-038 parity).

Implements: R9 — spur workflow clean reclaims retained run logs under a retention policy.

Rubric: E2 D1 L2 C1 R0 = 6 → decompose (child of parent score 14).

### Requirements
- [ ] R1. `spur workflow clean` reclaims retained `.spur/run/<RUNID>.log` files older than a retention threshold.
- [ ] R2. The retention threshold is configurable via `workflow.logRetentionDays` (default 30 days).
- [ ] R3. `--logs` scopes clean to log reclamation only; `--dry-run` lists what would be removed without writing.
- [ ] R4. Existing stale-run finalization behavior (`--force`/`--older-than`) is preserved.
- [ ] R5. Update the `spur-cli` workflow reference clean signature (ADR-038 parity test must pass).
### Acceptance Criteria
```gherkin
Feature: spur workflow clean run-log retention

  @core
  Scenario: R9 — spur workflow clean reclaims retained run logs under a retention policy
    Given one or more retained RUNID.log files exist in .spur/run
    When the operator runs spur workflow clean
    Then logs exceeding the configured retention policy are removed
    And logs within the retention policy are kept
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
